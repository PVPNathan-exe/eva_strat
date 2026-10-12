"""Suivi des joueurs sur toute une game : les pastilles lues image par image deviennent des trajectoires cohérentes.

Lire chaque image isolément se trompe (numéro illisible, pastilles qui se croisent ou se cachent). On travaille donc sur
l'ensemble de la game :
  1. les pastilles sont reliées d'une image à l'autre par proximité, en trajectoires (un joueur bouge peu entre deux lectures) ;
  2. chaque trajectoire reçoit un joueur par vote de tous ses numéros lus, sans que deux trajectoires qui se chevauchent
     dans le temps aient le même joueur ; sans numéro, on prend le joueur libre qui prolonge le mieux une autre trajectoire ;
  3. une croix (joueur mort) est rattachée au joueur dont la trajectoire s'est arrêtée à cet endroit juste avant ;
  4. les petits trous sont comblés par interpolation et les directions lissées (médiane circulaire) ;
  5. les bandeaux disent qui est vivant : un joueur vivant n'a jamais de trou. Une pastille que personne n'a prise est d'abord cherchée près de
     l'endroit attendu, puis les trous restants sont comblés en reliant les deux points visibles (recover_from_unused, bridge_gaps) ;
     un joueur mort n'a aucune position vivante, et une mort du killfeed que le bandeau contredit est ignorée.
"""

import json
import math
from collections import Counter
from pathlib import Path

SLOTS = {"A": (1, 2, 3, 4), "B": (5, 6, 7, 8)}
GATE_BASE = 0.04  # distance maximale (normalisée) entre deux lectures successives du même joueur : base...
GATE_SPEED = 0.25  # ...plus cette vitesse (par seconde) × temps écoulé
MAX_MISS_S = 1.0  # une trajectoire survit à une disparition de cette durée (pastille cachée, chiffre mal lu)
ASSIGN_GAP_S = 1.2  # une trajectoire peut prolonger celle d'un joueur arrêtée jusqu'à cette durée avant (décision d'identité)
ASSIGN_GAP_DIST = 0.18  # ...et à cette distance au plus
# Interpolation affichée : plafonnée en dur, sinon un trait droit traverserait les murs. Ce n'est pas un réglage.
FILL_MAX_S = 1.2
FILL_MAX_DIST = 0.18
X_LINK_S = 3.0  # une croix se rattache à une trajectoire arrêtée au plus tôt cette durée avant
X_LINK_DIST = 0.15
SMOOTH_S = 0.6  # fenêtre de lissage des directions
VOTE_MISMATCH = 0.08  # pénalité de liaison si le numéro lu contredit celui de la trajectoire
CONF_VOTE, CONF_CONTINUITY, CONF_ELIM, CONF_FILL = 1.0, 0.7, 0.4, 0.5


TP_NEAR = 0.07  # distance (relative à la minimap) à une station de tyrolienne en deçà de laquelle un joueur y est
TP_LINK_COST = 0.03  # coût de liaison d'une pastille qui ressort d'une tyrolienne (au lieu de la grande distance parcourue)
TP_MAX_GAP_S = 4.0  # un joueur qui disparaît à une station peut réapparaître à sa sortie jusqu'à cette durée après
_TELEPORTS = []  # paires de stations de la carte en cours (posées par solve)


def _tp_linked(p, q):
    """Vrai si q est la sortie d'une station de tyrolienne où se trouvait p (ou l'inverse) : un joueur y est instantanément téléporté."""
    for a, b in _TELEPORTS:
        for entry, exit_ in ((a, b), (b, a)):
            if math.hypot(p[0] - entry[0], p[1] - entry[1]) <= TP_NEAR and math.hypot(q[0] - exit_[0], q[1] - exit_[1]) <= TP_NEAR:
                return True
    return False


WALK_CELL = 0.02  # taille (relative à la minimap) des cases de la carte des passages
WALK_MIN_HITS = 2  # une case est un passage si au moins ce nombre de lectures sûres y sont tombées
ROUTE_DETOUR = 2.0  # un trajet par les passages plus long que cela (fois le trajet direct) est écarté : on relie alors en ligne droite
ROUTE_BUDGET = 8000  # cases explorées au plus par recherche de trajet
TP_RIDE_COST = 0.03  # coût (en distance) d'une tyrolienne dans la recherche de trajet : presque gratuite
_WALK = set()  # cases praticables de la carte en cours (posées par solve)
_NEAR = set()  # ces cases élargies d'une case (masque de carte seulement) : tolérance pour refuser une détection impossible
_ROUTES = {}  # trajets de cases déjà calculés pour la carte en cours
_JUMPS = set()  # couples de points sans trajet praticable entre eux : le joueur reste au premier jusqu'à sa réapparition au second


def walk_grid(points):
    """Cases de la carte où des joueurs sont réellement passés (lectures sûres), élargies d'une case : une carte des couloirs apprise sur toutes les games de la
    carte. Sans plan des murs, c'est le meilleur indice de ce qui est praticable ; un trou n'est plus comblé en traversant un mur."""
    hits = Counter((int(x / WALK_CELL), int(y / WALK_CELL)) for x, y in points)
    core = [c for c, n in hits.items() if n >= WALK_MIN_HITS]
    return {(cx + i, cy + j) for cx, cy in core for i in (-1, 0, 1) for j in (-1, 0, 1)}


def _cell(p):
    return int(p[0] / WALK_CELL), int(p[1] / WALK_CELL)


def _line_walkable(a, b, ok):
    n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / (WALK_CELL * 0.5)))
    return all(_cell((a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)) in ok for i in range(n + 1))


def _around(cell):
    return {(cell[0] + i, cell[1] + j) for i in (-1, 0, 1) for j in (-1, 0, 1)}


def on_walkable(p):
    """Vrai si le point est sur un passage connu de la carte (ou si la carte des passages est vide : on ne tranche pas). Une pastille hors de tout passage est
    un reflet ou un effet de l'écran, pas un joueur. Avec un masque de carte, on tolère une case de plus (le centre d'une pastille près d'un bord)."""
    return not _WALK or _cell(p) in (_NEAR or _WALK)


def _seg_len(p, q):
    """Longueur d'un tronçon de trajet : nulle pour une tyrolienne ou un saut sans trajet (instantanés), sinon la distance."""
    return 0.0 if (p, q) in _JUMPS or _tp_linked(p, q) else math.hypot(q[0] - p[0], q[1] - p[1])


def _path_length(path):
    return sum(_seg_len(p, q) for p, q in zip(path, path[1:]))


def _station_cells():
    """{case: point exact de la station} pour chaque extrémité de tyrolienne de la carte."""
    return {_cell(pt): pt for pair in _TELEPORTS for pt in pair}


def _cell_route(start, goal, ok, rides=True):
    """Plus court trajet de cases de start à goal par les passages `ok`, tyroliennes comprises (coût fixe). Liste de (case, arrivée par tyrolienne) ou None.
    Recherche de Dijkstra, mémorisée par couple de cases (la mémoire est vidée à chaque game)."""
    key = (start, goal, rides)
    if key in _ROUTES:
        return _ROUTES[key]
    import heapq

    jumps = {}
    for a, b in (_TELEPORTS if rides else []):
        jumps.setdefault(_cell(a), []).append(_cell(b))
        jumps.setdefault(_cell(b), []).append(_cell(a))
    best, came, heap, expanded = {start: 0.0}, {}, [(0.0, start)], 0
    while heap and expanded < ROUTE_BUDGET:
        g, cur = heapq.heappop(heap)
        if cur == goal:
            break
        if g > best.get(cur, 1e9):
            continue
        expanded += 1
        steps = [((cur[0] + di, cur[1] + dj), math.hypot(di, dj) * WALK_CELL, False) for di in (-1, 0, 1) for dj in (-1, 0, 1) if (di or dj) and (cur[0] + di, cur[1] + dj) in ok]
        steps += [(cell, TP_RIDE_COST, True) for cell in jumps.get(cur, [])]
        for nxt, cost, ride in steps:
            if g + cost < best.get(nxt, 1e9):
                best[nxt], came[nxt] = g + cost, (cur, ride)
                heapq.heappush(heap, (g + cost, nxt))
    result = None
    if goal == start or goal in came:
        nodes, cell = [(goal, False)], goal  # (case, vrai si on y arrive par tyrolienne)
        while cell != start:
            prev, ride = came[cell]
            nodes[-1] = (cell, ride)
            nodes.append((prev, False))
            cell = prev
        result = nodes[::-1]
    _ROUTES[key] = result
    return result


def _route_path(a, b, detour=ROUTE_DETOUR, rides=True):
    """Trajet de a à b par les passages connus (tyroliennes comprises), raccourci en ligne droite là où c'est praticable. Liste de points ; None si aucun
    trajet n'existe ou s'il dépasse `detour` fois le trajet direct (detour=None : sans limite). Ligne droite [a, b] si elle est praticable."""
    straight = math.hypot(b[0] - a[0], b[1] - a[1])
    start, goal = _cell(a), _cell(b)
    ok = _WALK | _around(start) | _around(goal) | set(_station_cells())
    if _line_walkable(a, b, ok):
        return [a, b]
    nodes = _cell_route(start, goal, ok, rides)
    if nodes is None:
        return None
    stations = _station_cells()
    pts = [a]
    for k in range(1, len(nodes) - 1):
        cell = nodes[k][0]
        pts.append(stations.get(cell, ((cell[0] + 0.5) * WALK_CELL, (cell[1] + 0.5) * WALK_CELL)))
    pts.append(b)
    ride = [nodes[k + 1][1] for k in range(len(nodes) - 1)]  # tronçon k -> k+1 : tyrolienne si l'on arrive par tyrolienne en k+1
    out, i = [pts[0]], 0
    while i < len(pts) - 1:  # raccourcis : on saute au point le plus lointain visible en ligne droite, sans jamais franchir une tyrolienne
        j = next(j for j in range(len(pts) - 1, i, -1) if j == i + 1 or (not any(ride[i:j]) and _line_walkable(pts[i], pts[j], ok)))
        out.append(pts[j])
        i = j
    if detour is not None and _path_length(out) > detour * straight + 0.05:
        return None
    return out


ARENA_M = (31.0, 16.5)  # taille d'une arène en mètres (largeur, hauteur) : la minimap est normalisée sur chacune de ses deux directions
ELIM_V_MS = 8.0  # vitesse maximale pour attribuer une trajectoire sans numéro par élimination (le 99,9e centile des pas lus est à 7,2 m/s)
FILL_DETOUR = 3.0  # un trou n'est comblé par un trajet plus long que cela (fois la distance directe)...
FILL_DETOUR_SLACK_M = 3.0  # ... plus cette marge (m) que si aucun autre choix : sinon le joueur reste en place
V_MAX_MS = 10.0  # vitesse maximale d'un joueur (m/s) : sur 46 401 pas lus avec certitude, 11 seulement dépassent 10 m/s (99,9e centile : 7,2 m/s)
MOVE_SLACK_M = 1.5  # marge (m) sur le trajet d'un trou : position du centre d'une pastille, arrondis


def _path_m(path):
    """Longueur d'un trajet en mètres (tyroliennes et sauts sans trajet ne comptent pas)."""
    return sum(0.0 if (p, q) in _JUMPS or _tp_linked(p, q) else math.hypot((q[0] - p[0]) * ARENA_M[0], (q[1] - p[1]) * ARENA_M[1]) for p, q in zip(path, path[1:]))


def route(a, b, gap_s=None, rides=True):
    """Trajet de a à b pour combler un trou : par les passages et les tyroliennes si la carte les connaît (aussi long soit-il : on ne traverse jamais un mur),
    sinon en ligne droite. S'il n'existe aucun trajet entre les deux points, ou si le joueur devrait dépasser V_MAX_MS pour le faire dans le temps du trou
    (gap_s), il reste en a jusqu'à sa réapparition en b (saut sans trajet) : un déplacement impossible n'est jamais dessiné. rides=False : sans tyrolienne."""
    if not _WALK or math.hypot(b[0] - a[0], b[1] - a[1]) < 2 * WALK_CELL:
        path = [a, b]
    else:
        path = _route_path(a, b, detour=None, rides=rides)
        if path is None:
            _JUMPS.add((a, b))
            return [a, b]
    length_m = _path_m(path)
    straight_m = math.hypot((b[0] - a[0]) * ARENA_M[0], (b[1] - a[1]) * ARENA_M[1])
    if (gap_s is not None and length_m > V_MAX_MS * gap_s + MOVE_SLACK_M) or length_m > FILL_DETOUR * straight_m + FILL_DETOUR_SLACK_M:
        _JUMPS.add((a, b))  # trop vite, ou un détour sans commune mesure avec la distance (un passage manque au masque, ou le joueur est resté sur place)
        return [a, b]
    return path


READ_MIN_CONF = 0.7  # une position de cette confiance ou plus est une lecture sûre
RIDE_MIN_CONF = 0.7  # une tyrolienne n'est supposée dans un trou que si l'arrivée est une vraie lecture (numérotée ou sûre), pas une pastille récupérée sans numéro


def walk_distance(a, b, rides=True):
    """Longueur du trajet praticable de a à b (tyroliennes gratuites si rides), ou None si aucun trajet n'existe. Sans carte des passages : distance directe."""
    straight = math.hypot(b[0] - a[0], b[1] - a[1])
    if not _WALK or straight < 2 * WALK_CELL:
        return straight
    path = _route_path(a, b, detour=None, rides=rides)
    return None if path is None else _path_length(path)


def _along(path, f):
    """Point situé à la fraction f (0 à 1) de la longueur d'un trajet, à vitesse constante (une tyrolienne ne compte pour rien : on y saute)."""
    total = _path_length(path)
    if total <= 0:
        return path[0]
    want = f * total
    for p, q in zip(path, path[1:]):
        d = _seg_len(p, q)
        if want <= d and d > 0:
            r = want / d
            return p[0] + (q[0] - p[0]) * r, p[1] + (q[1] - p[1]) * r
        want -= d
    return path[-1]


ANCHOR_VOTE = 4  # un disque blanc identifié par le cadre du bandeau et son numéro pèse comme 4 numéros lus : l'identité du joueur observé ne s'échange pas avec un autre


class Track:
    def __init__(self, team, fi, det, dead=False):
        self.team = team
        self.dead = dead
        self.pts = {fi: det}
        self.first = self.last = fi
        self.votes = Counter()
        self.slot = None
        self.how = None
        self._vote(det)

    def _vote(self, det):
        slot = det.get("slot")
        if slot in SLOTS[self.team]:
            self.votes[slot] += ANCHOR_VOTE if det.get("anchored") else 1

    def add(self, fi, det):
        self.pts[fi] = det
        self.last = fi
        self._vote(det)

    @property
    def pos(self):
        d = self.pts[self.last]
        return d["x"], d["y"]

    def dominant(self):
        if not self.votes:
            return None
        slot, n = self.votes.most_common(1)[0]
        return slot if n >= 2 else None


EXHAUSTIVE_BUDGET = 20000  # nombre maximal de combinaisons essayées pour apparier trajectoires et détections


def _greedy_matching(costs):
    """Appariement glouton : les liaisons les moins chères d'abord, chaque trajectoire et chaque détection une seule fois."""
    cells = sorted((c, i, j) for i, row in enumerate(costs) for j, c in enumerate(row) if c is not None)
    used_i, used_j, pairs = set(), set(), []
    for _, i, j in cells:
        if i not in used_i and j not in used_j:
            used_i.add(i)
            used_j.add(j)
            pairs.append((i, j))
    return pairs


def _best_matching(costs, n_dets):
    """costs[i][j] : coût de relier la trajectoire i à la détection j (None = interdit). Maximise le nombre de liaisons,
    puis minimise le coût total. Petits effectifs (≤ 4 trajectoires) : recherche exhaustive."""
    best = (0.0, [])
    n = len(costs)
    # La recherche exhaustive explose quand il y a beaucoup de trajectoires ouvertes et de détections (lectures parasites) :
    # au-delà d'un budget, on apparie au plus proche (glouton), ce qui reste correct pour des pastilles bien séparées.
    size = 1
    for row in costs:
        size *= 1 + sum(c is not None for c in row)
        if size > EXHAUSTIVE_BUDGET:
            return _greedy_matching(costs)

    def rec(i, used, total, pairs):
        nonlocal best
        if i == n:
            score = total - len(pairs) * 10.0
            if score < best[0] - 1e-12 or (not best[1] and pairs):
                best = (score, list(pairs))
            return
        rec(i + 1, used, total, pairs)
        for j in range(n_dets):
            c = costs[i][j]
            if c is not None and j not in used:
                pairs.append((i, j))
                rec(i + 1, used | {j}, total + c, pairs)
                pairs.pop()

    rec(0, frozenset(), 0.0, [])
    return best[1]


NOISE_MAX = 6.0  # une image dont la couleur d'équipe non expliquée dépasse ce nombre d'équivalents de pastille est contaminée (frame_noise.py)


def _link(frames, step_s, contaminated=None):
    """Étape 1 : trajectoires de pastilles vivantes et de croix, par équipe."""
    max_miss = max(1, round(MAX_MISS_S / step_s))
    alive_tracks, dead_tracks = [], []
    for fi, _, dets in frames:
        for team in ("A", "B"):
            mine = [d for d in dets if d["team"] == team]
            living = [d for d in mine if d["alive"]]
            crosses = [d for d in mine if not d["alive"]]

            open_ = [t for t in alive_tracks if t.team == team and 0 < fi - t.last <= max_miss]
            costs = []
            for t in open_:
                gate = GATE_BASE + GATE_SPEED * step_s * (fi - t.last)
                dom = t.dominant()
                row = []
                for d in living:
                    dist = math.hypot(d["x"] - t.pos[0], d["y"] - t.pos[1])
                    jump = dist > gate and _tp_linked(t.pos, (d["x"], d["y"]))
                    if dist > gate and not jump:
                        row.append(None)
                        continue
                    if jump:
                        dist = TP_LINK_COST  # sortie de tyrolienne : presque aussi sûr qu'une pastille voisine, aussi loin soit-elle
                    pen = 0.0
                    if dom and d.get("slot"):
                        pen = -0.02 if d["slot"] == dom else VOTE_MISMATCH
                    row.append(dist + pen + 0.002 * (fi - t.last))
                costs.append(row)
            taken = set()
            for i, j in _best_matching(costs, len(living)) if open_ and living else []:
                open_[i].add(fi, living[j])
                taken.add(j)
            for j, d in enumerate(living):
                if j not in taken and not (contaminated and fi in contaminated and not d.get("number")):  # image contaminée : pas de nouvelle trajectoire sans numéro
                    alive_tracks.append(Track(team, fi, d))

            open_x = [t for t in dead_tracks if t.team == team and 0 < fi - t.last <= 3]
            used = set()
            for d in crosses:
                match = None
                for t in open_x:
                    if t in used:
                        continue
                    if math.hypot(d["x"] - t.pos[0], d["y"] - t.pos[1]) <= 0.05:
                        match = t
                        break
                if match:
                    used.add(match)
                    match.add(fi, d)
                elif not (contaminated and fi in contaminated):  # image contaminée : une croix isolée est une strie de lumière
                    dead_tracks.append(Track(team, fi, d, dead=True))
    return alive_tracks, dead_tracks


def _overlap(a, b, slack=0):
    return a.first <= b.last + slack and b.first <= a.last + slack


SAME_MARKER_DIST = 0.04  # deux trajectoires qui se chevauchent sans jamais s'écarter de plus que cela suivent la même pastille (détectée en double)


def _conflict(a, b):
    """Vrai si deux trajectoires ne peuvent pas être le même joueur parce qu'elles coexistent à des endroits différents. Une pastille détectée en double (deux
    trajectoires superposées pendant quelques images, par exemple quand la détection se coupe en deux) n'est pas un conflit : la seconde prolonge la première."""
    if not _overlap(a, b):
        return False
    common = [k for k in a.pts if k in b.pts]
    if not common:
        return True
    return any(math.hypot(a.pts[k]["x"] - b.pts[k]["x"], a.pts[k]["y"] - b.pts[k]["y"]) > SAME_MARKER_DIST for k in common)


def _gap_cost(a, b, step_s, max_gap=None, max_dist=None):
    """Coût pour que b prolonge a (b commence après la fin de a), None si invraisemblable."""
    max_gap = ASSIGN_GAP_S if max_gap is None else max_gap
    max_dist = ASSIGN_GAP_DIST if max_dist is None else max_dist
    gap = (b.first - a.last) * step_s
    if 0 <= gap <= TP_MAX_GAP_S and _tp_linked(a.pos, (b.pts[b.first]["x"], b.pts[b.first]["y"])):
        return 0.02 + 0.01 * gap  # station de tyrolienne : il ressort à l'autre bout, aussi loin soit-il
    if gap < 0 or gap > max_gap:
        return None
    dist = math.hypot(a.pos[0] - b.pts[b.first]["x"], a.pos[1] - b.pts[b.first]["y"])
    if dist > min(GATE_BASE + GATE_SPEED * max(gap, step_s) * 1.6, max_dist):
        return None
    return dist + 0.01 * gap


TRIM_MIN_FRAMES = 2  # images où la fin d'une trajectoire doit coller à celle d'un autre joueur pour être jugée « fondue » dans lui


def _recount_votes(t):
    t.votes = Counter()
    for d in t.pts.values():
        t._vote(d)
    t.first, t.last = min(t.pts), max(t.pts)


TRIM_NEAR_FRAMES = 15  # une trajectoire Z est « là » à une image donnée si elle a un point à cet écart d'images au plus...
TRIM_NEAR_DIST = 0.03  # ...à cette distance au plus de la détection


def _near_track(z, k, det):
    """Vrai si la trajectoire z a, dans les TRIM_NEAR_FRAMES images autour de k, un point collé à la détection det (z est probablement cachée sous elle à l'image k)."""
    return any(abs(j - k) <= TRIM_NEAR_FRAMES and math.hypot(d["x"] - det["x"], d["y"] - det["y"]) <= TRIM_NEAR_DIST for j, d in z.pts.items())


def trim_merged_tails(tracks):
    """Deux joueurs de la même équipe qui se croisent forment une seule tache : la trajectoire de l'un peut suivre la tache jusque sur l'autre joueur (le 6 qui
    traverse le 8 posé, de 0:04 à 0:05), puis la vraie suite du 6, qui repart, reste sans joueur parce que le numéro 6 est déjà pris. Quand la fin d'une trajectoire
    X colle à celle d'un autre joueur Z (autre numéro dominant) et chevauche en un autre endroit une trajectoire Y qui porte le même numéro que X, la fin de X
    est une copie de Z : on la coupe, et Y reprend le joueur. Renvoie le nombre de trajectoires coupées."""
    cut = 0
    for x in tracks:
        dom = x.dominant()
        if dom is None:
            continue
        for y in tracks:
            if y is x or y.team != x.team or y.dominant() != dom or not _overlap(x, y) or not _conflict(x, y):
                continue
            span = [k for k in x.pts if k >= y.first]
            for z in tracks:
                if z is x or z is y or z.team != x.team or z.dominant() in (None, dom):
                    continue
                copy = [k for k in span if _near_track(z, k, x.pts[k])]
                if len(copy) >= TRIM_MIN_FRAMES and len(copy) >= 0.6 * len(span):
                    first_copy = min(copy)
                    for k in [k for k in x.pts if k >= first_copy]:
                        del x.pts[k]
                    if x.pts:
                        _recount_votes(x)
                        cut += 1
                    break
    return cut


DEAD_TRACK_SHARE = 0.5  # une trajectoire ne peut pas appartenir à un joueur dont le bandeau est grisé pendant plus de cette part de sa durée
MIN_ALIVE_SHARE = 0.2  # un bandeau « mort » plus de 80 % de la game est probablement mal lu : on ne s'en sert pas


def _number_of(slot):
    return slot if slot <= 4 else slot + 1


MIN_STATE_S = 1.5  # un état du bandeau (vivant ou mort) plus court que cela, entre deux périodes de l'état opposé, est un parasite
# (autour d'une mort le bandeau clignote : une mort réelle dure environ 17 s, et on a mesuré plus de mille « vies » de moins d'une seconde)


def _debounce(dead, min_len):
    """dead : liste de booléens (mort). Une « vie » de moins de min_len images entre deux morts est un clignotement du bandeau (on ne
    réapparaît pas en une seconde) : elle redevient une mort. Ensuite, une « mort » de moins de min_len images entre deux vies est un parasite."""
    dead = list(dead)
    for blink in (False, True):  # d'abord les vies parasites, puis les morts parasites
        i = 0
        while i < len(dead):
            j = i
            while j < len(dead) and dead[j] == dead[i]:
                j += 1
            if dead[i] == blink and 0 < i and j < len(dead) and j - i < min_len:
                dead[i:j] = [not blink] * (j - i)
            i = j
    return dead


def dead_frames(states, step_s=0.1):
    """{slot: ensemble d'indices d'images} où le bandeau du joueur est grisé (mort), après avoir retiré les clignotements de moins de
    MIN_STATE_S. Un bandeau qui paraît mort presque toute la game (mal lu) n'est pas utilisé."""
    if not states:
        return {}
    keys = sorted(states)
    out = {}
    min_len = max(2, round(MIN_STATE_S / step_s))
    for slot in range(1, 9):
        alive_share = sum(1 for k in keys if slot in states[k] and states[k][slot]["alive"]) / max(len(keys), 1)
        if alive_share < MIN_ALIVE_SHARE:
            continue
        raw = [slot in states[k] and not states[k][slot]["alive"] for k in keys]
        out[slot] = {k for k, d in zip(keys, _debounce(raw, min_len)) if d}
    return out


DEATH_CONFIRM_BEFORE_S = 1.5  # le bandeau d'un joueur tué doit être grisé au plus tôt cette durée avant la ligne du killfeed...
DEATH_CONFIRM_AFTER_S = 3.0  # ...et au plus tard cette durée après


def confirmed_deaths(deaths, dead, times, step_s):
    """Les morts du killfeed que le bandeau confirme. Une ligne mal lue (victime ou tueur illisible, mort « environnement » alors que le joueur
    est plein de vie) ne doit pas faire mourir un joueur que son bandeau montre vivant. Sans bandeau exploitable pour ce joueur, la mort est gardée."""
    if not deaths or not dead or not times:
        return deaths or []
    ordered = sorted(times)
    out = []
    for t_death, slot in deaths:
        if slot not in dead:
            out.append((t_death, slot))
            continue
        lo, hi = t_death - DEATH_CONFIRM_BEFORE_S, t_death + DEATH_CONFIRM_AFTER_S
        if any(lo <= times[k] <= hi and k in dead[slot] for k in ordered):
            out.append((t_death, slot))
    return out


def _is_other_player(d, slot):
    """Vrai si la pastille porte le numéro d'un autre joueur de l'équipe, lu avec certitude : ce n'est pas le joueur de ce slot (par exemple le disque blanc
    d'une station de tyrolienne lu « 9 » alors que le joueur observé est le « 8 »)."""
    team = "A" if slot <= 4 else "B"
    return bool(d.get("number")) and d["number"] != _number_of(slot) and d["number"] in {_number_of(s) for s in SLOTS[team]}


ANCHOR_WINDOW_S = 3.0  # un disque blanc sans numéro est comparé aux images où le numéro du joueur observé est lu, jusqu'à cet écart
ANCHOR_BOTH = (0.08, 0.10)  # tolérance (relative à la minimap) entre deux ancres : base, plus ceci par seconde d'écart à la plus proche
ANCHOR_ONE = (0.06, 0.25)  # ... avec une seule ancre d'un côté : un joueur qui court peut s'éloigner de 0,25 par seconde
STATION_NEIGHBOUR_FRAMES = 15  # image sans joueur observé unique : on prend celui des images voisines (jusqu'à cet écart) pour écarter les disques de stations
STATION_ARRIVAL = 0.08  # ses lectures voisines sont à moins de cela de la station : il y est arrivé à pied
STATION_NEAR = 0.04  # un disque blanc à moins de cela d'une extrémité de tyrolienne, sans ancre, est le décor de la station


def _is_foreign_white(d, observed, t=None, anchors=None):
    """Vrai si la pastille blanche n'est pas le joueur observé : d'une autre équipe, ou portant le numéro d'un autre joueur. Un disque de la bonne équipe dont le
    chiffre est mal lu (le 8 lu 6) reste le joueur observé s'il colle à ses lectures numérotées voisines (anchors)."""
    team = "A" if observed <= 4 else "B"
    if d["team"] != team:
        return True
    if d.get("number") in (None, _number_of(observed)):
        return False
    return not (anchors and _anchor_ok(d, t, anchors))


def _without_foreign_white(dets, observed, t=None, anchors=None):
    """Seul le joueur observé est un disque blanc vivant : les autres disques blancs sont des joueurs morts qui attendent leur réapparition, ou des icônes de
    stations de tyrolienne. Ils ne sont pas des joueurs en jeu et ne doivent pas être suivis (le 9 était attribué au disque d'attente du 7 mort)."""
    return [d for d in dets if not (d.get("spectated") and _is_foreign_white(d, observed, t, anchors))]


def _observed_between(fi, single, nearest):
    """Joueur observé d'une image dont le cadre clignote : celui des images voisines si la dernière image à cadre net avant et la première après (dans la limite
    STATION_NEIGHBOUR_FRAMES) désignent le même joueur, sinon None."""
    import bisect

    i = bisect.bisect_left(nearest, fi)
    before = nearest[i - 1] if i > 0 else None
    after = nearest[i] if i < len(nearest) else None
    if before is None or after is None or fi - before > STATION_NEIGHBOUR_FRAMES or after - fi > STATION_NEIGHBOUR_FRAMES:
        return None
    return single[before] if single[before] == single[after] else None


def _on_station(d):
    """Vrai si la détection est sur une extrémité de tyrolienne de la carte."""
    return any(math.hypot(d["x"] - p[0], d["y"] - p[1]) <= STATION_NEAR for pair in _TELEPORTS for p in pair)


def _anchor_ok(d, t, anchors):
    """Un disque blanc sans numéro peut-il être le joueur observé ? anchors : [(t, x, y)] positions où le numéro de ce joueur est lu. Cohérent si proche de
    la position attendue entre les deux ancres voisines (ou d'une seule, avec une tolérance plus large), ou à la sortie d'une tyrolienne. Sans ancre proche :
    refusé seulement s'il est sur une station (disque fixe du décor). Évite le disque d'attente d'un joueur mort pris pour le joueur observé."""
    near = [a for a in anchors if abs(a[0] - t) <= ANCHOR_WINDOW_S]
    here = (d["x"], d["y"])
    if not near:
        return not _on_station(d)
    if any(_tp_linked((a[1], a[2]), here) for a in near):
        return True
    if _on_station(d):  # une icône de station n'est le joueur que s'il vient de la rejoindre à pied (ses lectures voisines sont à côté) : le 2 posé sur une station alors qu'il était sur le point
        return any(math.hypot(here[0] - a[1], here[1] - a[2]) <= STATION_ARRIVAL for a in near)
    before = max((a for a in near if a[0] <= t), key=lambda a: a[0], default=None)
    after = min((a for a in near if a[0] > t), key=lambda a: a[0], default=None)
    if before and after:
        span = after[0] - before[0]
        f = (t - before[0]) / span if span > 0 else 0.0
        expected = (before[1] + (after[1] - before[1]) * f, before[2] + (after[2] - before[2]) * f)
        base, rate = ANCHOR_BOTH
        dt = min(t - before[0], after[0] - t)
    else:
        a = before or after
        expected, (base, rate), dt = (a[1], a[2]), ANCHOR_ONE, abs(a[0] - t)
    return math.hypot(here[0] - expected[0], here[1] - expected[1]) <= base + rate * dt


def _in_spawn(d, spawns):
    rect = (spawns or {}).get(d["team"])
    return rect is None or (rect[0] <= d["x"] <= rect[2] and rect[1] <= d["y"] <= rect[3])


def anchor_spectated(frames, states, spawns=None):
    """Le cadre blanc du bandeau dit quel joueur est observé : la pastille blanche de la minimap est donc ce joueur, quel que soit son
    numéro lu (souvent illisible sur cette pastille). Les autres pastilles blanches (joueurs qui attendent leur réapparition) gardent le leur.

    Un disque blanc dans la zone de départ (`waiting`) est un joueur mort qui attend OU le joueur observé qui n'a pas encore quitté sa zone. Les bandeaux
    tranchent : s'il y a plus de disques que de joueurs morts dans l'équipe, le disque en trop est le joueur observé (sûr seulement si un seul est en trop,
    ou si son numéro est lu). Les disques d'attente non retenus sont retirés : ils ne sont pas des joueurs en jeu."""
    if spawns:  # un disque « d'attente » hors de la zone de départ de son équipe est un joueur en jeu (boîte de capture), pas un mort qui attend
        frames = [(fi, t, [({**d, "waiting": False} if d.get("waiting") and not _in_spawn(d, spawns) else d) for d in dets]) for fi, t, dets in frames]
    anchors = {}  # slot -> [(t, x, y)] : où le numéro du joueur observé est lu sur un disque blanc
    for fi, t, dets in frames:
        watched = [s for s, v in (states or {}).get(fi, {}).items() if v["spectated"]]
        if states and len(watched) == 1:
            for d in dets:
                if d.get("spectated") and d.get("number") == _number_of(watched[0]) and d.get("alive", True):
                    anchors.setdefault(watched[0], []).append((t, d["x"], d["y"]))
                    break
    single = {}  # indice d'image -> joueur observé quand le bandeau n'en désigne qu'un
    for fi, _, _ in frames:
        w = [s for s, v in (states or {}).get(fi, {}).items() if v["spectated"]]
        if len(w) == 1:
            single[fi] = w[0]
    nearest = sorted(single)
    out = []
    for fi, t, dets in frames:
        waits = [d for d in dets if d.get("waiting")]
        dets = [d for d in dets if not d.get("waiting")]
        watched = [s for s, v in (states or {}).get(fi, {}).items() if v["spectated"]]
        if len(watched) != 1 and nearest:
            # cadre qui clignote : le joueur observé est celui des images voisines quand celles d'avant et d'après sont d'accord ; sinon, seuls les disques de
            # stations qui ne sont pas lui sont retirés (le plus proche voisin)
            effective = _observed_between(fi, single, nearest)
            if effective is not None:
                dets = _without_foreign_white(dets, effective, t, anchors.get(effective, []))
            elif _TELEPORTS:
                j = min(nearest, key=lambda k: abs(k - fi))
                if abs(j - fi) <= STATION_NEIGHBOUR_FRAMES:
                    dets = [d for d in dets if not (d.get("spectated") and _on_station(d) and _is_foreign_white(d, single[j]))]
        if not states or len(watched) != 1:
            out.append((fi, t, dets))
            continue
        slot = watched[0]
        team = "A" if slot <= 4 else "B"
        dets = [d for d in dets if not (d.get("spectated") and d["team"] != team)]  # un disque blanc de l'autre équipe n'est jamais l'observé
        cands = [d for d in dets if d.get("spectated") and d["team"] == team and d.get("alive", True)]
        mine_waiting = [d for d in waits if d["team"] == team]
        slot_anchors = anchors.get(slot, [])
        has_anchors = any(abs(a[0] - t) <= ANCHOR_WINDOW_S for a in slot_anchors)
        pick = next((d for d in cands if d.get("number") == _number_of(slot)), None)
        if pick is None:  # le joueur observé attend peut-être dans sa zone de départ : son disque porte son numéro
            pick = next((d for d in mine_waiting if d.get("number") == _number_of(slot) and d.get("verified")), None)
            if pick is not None:
                dets = dets + [pick]
        if pick is None and has_anchors:  # chiffre mal lu (le 8 lu 6) : le disque qui colle à ses lectures numérotées voisines est lui
            coherent = [d for d in cands if _anchor_ok(d, t, slot_anchors)]
            if len(coherent) == 1:
                pick = coherent[0]
        elif pick is None and len(cands) == 1 and not _is_other_player(cands[0], slot) and _anchor_ok(cands[0], t, slot_anchors):
            pick = cands[0]
        dets = [d for d in dets if not (d.get("spectated") and d is not pick and d["team"] == team and d.get("number") not in (None, _number_of(slot)))]  # autre numéro : joueur mort qui attend
        if pick is None and not cands:
            mine = [d for d in waits if d["team"] == team]
            dead = sum(1 for s, v in states[fi].items() if (s <= 4) == (team == "A") and not v["alive"])
            pick = next((d for d in mine if d.get("number") == _number_of(slot)), None) or (mine[0] if len(mine) == dead + 1 and dead == 0 else None)
            if pick is not None:
                dets = dets + [pick]
        out.append((fi, t, [({**d, "number": _number_of(slot), "slot": slot, "anchored": True} if d is pick else d) for d in dets]))
    return out


ELIM_MIN_S = 2.0  # une trajectoire sans numéro lu attribuée par élimination doit durer au moins cela, ou être plausible (ci-dessous)
ELIM_BASE = 0.08  # distance (relative à la minimap) qu'on accepte entre deux trajectoires du même joueur, plus...
ELIM_SPEED = 0.35  # ...cette vitesse maximale (par seconde) × temps écoulé entre elles


def _reads_another_player(t, slot):
    """Vrai si la trajectoire porte au moins deux numéros lus qui désignent un autre joueur que `slot` : ce n'est pas lui, même s'il est le seul libre (le disque
    d'une station lu « 9 » n'est pas le joueur « 8 » parce que le « 9 » est mort)."""
    if not t.votes:
        return False
    top, count = t.votes.most_common(1)[0]
    return top != slot and count >= 2


def _elimination_ok(t, same_slot, step_s):
    """Une trajectoire sans numéro ne reçoit le seul joueur libre « par élimination » que si c'est plausible : assez longue pour ne pas être
    du bruit (reflet bleu de l'eau, tache du décor), ou assez proche, au regard du temps écoulé, de la dernière position connue de ce joueur."""
    if not same_slot:
        return True
    near = min(same_slot, key=lambda o: min(abs(t.first - o.last), abs(o.first - t.last)))
    a, b = (near, t) if near.last <= t.first else (t, near)
    gap_s = max(b.first - a.last, 0) * step_s
    start = (b.pts[b.first]["x"], b.pts[b.first]["y"])
    if _WALK and not _tp_linked(a.pos, start):
        # atteignable par les couloirs, sans tyrolienne supposée (une trajectoire sans numéro ne prouve pas qu'il en a pris une), à vitesse humaine
        path = _route_path(a.pos, start, detour=None, rides=False)
        if path is None or _path_m(path) > ELIM_V_MS * gap_s + MOVE_SLACK_M:
            return False
    if (t.last - t.first + 1) * step_s >= ELIM_MIN_S:
        return True
    dist = math.hypot(a.pos[0] - start[0], a.pos[1] - start[1])
    return dist <= ELIM_BASE + ELIM_SPEED * gap_s


MIN_UNVOTED_POINTS = 4  # une trajectoire de moins de lectures n'est attribuée qu'à partir de numéros lus (vote), jamais par continuité ou élimination


def _assign(alive_tracks, step_s, dead=None):
    """Étape 2 : un joueur par trajectoire. dead : {slot: images où son bandeau est grisé} (facultatif)."""
    dead = dead or {}
    for team in ("A", "B"):
        tracks = [t for t in alive_tracks if t.team == team]
        slots = SLOTS[team]
        assigned = {s: [] for s in slots}

        def free(t, s):
            if s in dead and t.pts and sum(1 for k in t.pts if k in dead[s]) / len(t.pts) > DEAD_TRACK_SHARE:
                return False  # le bandeau de ce joueur est grisé pendant la trajectoire : ce n'est pas lui
            return not any(_conflict(t, o) for o in assigned[s])

        # a) par vote : les trajectoires les mieux étayées d'abord
        for t in sorted(tracks, key=lambda t: -sum(t.votes.values())):
            for slot, _ in t.votes.most_common():
                if free(t, slot):
                    t.slot, t.how = slot, CONF_VOTE
                    assigned[slot].append(t)
                    break
        # b) sans vote exploitable : joueur libre qui prolonge au mieux une autre trajectoire, ou élimination
        pending = [t for t in tracks if t.slot is None]
        progress = True
        while pending and progress:
            progress = False
            for t in sorted(pending, key=lambda t: t.first):
                cands = [s for s in slots if free(t, s)]
                if not cands or len(t.pts) < MIN_UNVOTED_POINTS:  # trop court pour être attribué sans numéro : reflet ou clignotement, le trou sera comblé
                    continue
                scored = []
                for s in cands:
                    costs = []
                    for o in assigned[s]:
                        c = _gap_cost(o, t, step_s) if o.last <= t.first else _gap_cost(t, o, step_s)
                        if c is not None:
                            costs.append(c)
                    scored.append((min(costs) if costs else None, s))
                good = sorted((c, s) for c, s in scored if c is not None)
                if good:
                    t.slot, t.how = good[0][1], CONF_CONTINUITY
                elif len(cands) == 1 and not _reads_another_player(t, cands[0]) and _elimination_ok(t, assigned[cands[0]], step_s):
                    t.slot, t.how = cands[0], CONF_ELIM
                else:
                    continue
                assigned[t.slot].append(t)
                pending.remove(t)
                progress = True
                break


def _attach_crosses(dead_tracks, alive_tracks, step_s, deaths=None, times=None):
    """Étape 3 : chaque croix revient au joueur dont la trajectoire s'est arrêtée là juste avant."""
    link = max(1, round(X_LINK_S / step_s))
    kept = []
    for x in dead_tracks:
        x_pos = (x.pts[x.first]["x"], x.pts[x.first]["y"])
        # Le killfeed dit qui est mort et quand : une croix qui apparaît à ce moment-là, dans la bonne équipe, est celle de ce joueur.
        if deaths and times:
            tx = times.get(x.first)
            near = [d for d in deaths if tx is not None and d[1] in SLOTS[x.team] and -1.5 <= tx - d[0] <= 3.0]
            if len(near) == 1:
                x.slot, x.how = near[0][1], CONF_VOTE
                kept.append(x)
                continue
        best = None
        for t in alive_tracks:
            if t.team != x.team or t.slot is None:
                continue
            if not (-2 <= x.first - t.last <= link):
                continue
            dist = math.hypot(t.pos[0] - x_pos[0], t.pos[1] - x_pos[1])
            if dist <= X_LINK_DIST and (best is None or dist < best[0]):
                best = (dist, t)
        if best:
            x.slot, x.how = best[1].slot, CONF_CONTINUITY
        else:
            busy = {t.slot for t in alive_tracks if t.team == x.team and t.slot and t.first <= x.last and t.last >= x.first}
            left = [s for s in SLOTS[x.team] if s not in busy]
            if len(left) == 1:
                x.slot, x.how = left[0], CONF_ELIM
        if x.slot is None:
            continue
        # une croix ne peut pas coexister avec la trajectoire vivante du même joueur
        if any(t.slot == x.slot and _overlap(t, x) and min(t.last, x.last) - max(t.first, x.first) > 2 for t in alive_tracks):
            continue
        kept.append(x)
    return kept


CONF_BRIDGE = 0.3  # confiance d'une position reconstruite (trou comblé entre deux lectures, ou position gardée)
LEAD_MAX_S = 15.0  # un joueur qui vient de réapparaître est gardé à sa première position connue jusqu'à cette durée avant sa première lecture
TRAIL_MAX_S = 10.0  # ...et à sa dernière position connue jusqu'à cette durée après sa dernière lecture, tant que son bandeau dit qu'il vit
RECOVER_BASE = 0.06  # une détection inutilisée peut combler un trou si elle est à cette distance de la position attendue...
RECOVER_GROWTH = 0.12  # ...plus cette distance par seconde écoulée depuis la lecture connue la plus proche
RECOVER_MAX = 0.30


def alive_runs(states, dead):
    """{slot: [(première image, dernière image)]} : périodes où le bandeau du joueur dit « vivant », pour les joueurs dont le bandeau est exploitable.
    C'est le témoin de ce qu'on doit pouvoir montrer : tout joueur vivant doit avoir une position."""
    keys = sorted(states)
    out = {}
    for slot in dead:
        runs, start, prev = [], None, None
        for k in keys:
            alive = slot in states[k] and states[k][slot]["alive"] and k not in dead[slot]
            if alive and start is None:
                start = k
            elif not alive and start is not None:
                runs.append((start, prev))
                start = None
            prev = k
        if start is not None:
            runs.append((start, keys[-1]))
        out[slot] = runs
    return out


def _expected(rows, slot, k, run, step_s):
    """Position attendue d'un joueur vivant à l'image k sans lecture : interpolation entre les lectures voisines de sa période vivante,
    ou dernière/première position connue. Renvoie (x, y, secondes jusqu'à la lecture connue la plus proche) ou None."""
    s, e = run
    before = next((j for j in range(k - 1, s - 1, -1) if rows.get((j, slot)) and rows[(j, slot)][7]), None)
    after = next((j for j in range(k + 1, e + 1) if rows.get((j, slot)) and rows[(j, slot)][7]), None)
    if before is None and after is None:
        return None
    if before is None or after is None:
        j = after if before is None else before
        r = rows[(j, slot)]
        return r[4], r[5], abs(k - j) * step_s
    a, b = rows[(before, slot)], rows[(after, slot)]
    if _tp_linked((a[4], a[5]), (b[4], b[5])):  # il est resté à la station, puis ressort à l'autre bout : on attend la moitié du trou au départ
        near = a if k - before <= after - k else b
        return near[4], near[5], min(k - before, after - k) * step_s
    f = (k - before) / (after - before)
    return a[4] + (b[4] - a[4]) * f, a[5] + (b[5] - a[5]) * f, min(k - before, after - k) * step_s


PERSIST_FRAMES = 3  # une pastille récupérée doit se retrouver dans au moins 2 des images voisines (jusqu'à cet écart)...
PERSIST_STEP = 0.05  # ...à cette distance par image d'écart au plus (un joueur ne bouge pas plus vite ; une tache de lumière balaie l'écran en quelques images)


def _persistent(dets, fi, d):
    """Vrai si la détection d se retrouve (même équipe, proche, en tenant compte de l'écart d'images) dans au moins deux images voisines : un joueur dure,
    un reflet ou une strie de lumière apparaît une image ou deux, ou se déplace trop vite."""
    seen = 0
    for k in range(fi - PERSIST_FRAMES, fi + PERSIST_FRAMES + 1):
        if k == fi:
            continue
        if any(o["team"] == d["team"] and o["alive"] == d["alive"] and math.hypot(o["x"] - d["x"], o["y"] - d["y"]) <= PERSIST_STEP * abs(k - fi) + 0.01 for o in dets.get(k, [])):
            seen += 1
            if seen >= 2:
                return True
    return False


def recover_from_unused(rows, runs, frames, states, step_s, put, contaminated=None):
    """« Mieux regarder » : à chaque image, un joueur vivant (bandeau) sans position est cherché parmi les pastilles que personne n'a prises,
    près de l'endroit où il devrait être. Une pastille blanche (joueur observé ou station de tyrolienne) n'est acceptée que pour le joueur
    que le bandeau dit observé. Plusieurs trous dans la même équipe : on prend les paires les plus proches d'abord."""
    dets = {fi: d for fi, _, d in frames}
    placed = 0
    for fi in sorted(dets):
        missing = []
        for slot, rs in runs.items():
            run = next((r for r in rs if r[0] <= fi <= r[1]), None)
            if run and not rows.get((fi, slot)):
                exp = _expected(rows, slot, fi, run, step_s)
                if exp:
                    missing.append((slot, exp))
        if not missing:
            continue
        taken = [(r[4], r[5]) for (k, _), r in rows.items() if k == fi]
        free = [d for d in dets[fi] if d["alive"] and all(math.hypot(d["x"] - x, d["y"] - y) > 0.02 for x, y in taken)]
        watched = {s for s, v in states.get(fi, {}).items() if v["spectated"]}
        pairs = []
        for slot, (ex, ey, gap) in missing:
            team = "A" if slot <= 4 else "B"
            reach = min(RECOVER_BASE + RECOVER_GROWTH * gap, RECOVER_MAX)
            for i, d in enumerate(free):
                if d["team"] != team or (d.get("spectated") and slot not in watched):
                    continue
                if not on_walkable((d["x"], d["y"])):
                    continue  # hors de tout passage connu : reflet de lumière, pas un joueur
                if not d.get("number") and ((contaminated and fi in contaminated) or not _persistent(dets, fi, d)):
                    continue  # une pastille sans numéro qui n'apparaît pas dans les images voisines : strie de lumière, pas un joueur
                if d.get("number") and d["number"] != _number_of(slot) and d["number"] in {_number_of(s) for s in SLOTS[team]}:
                    continue  # un autre joueur de l'équipe, lu avec certitude
                dist = math.hypot(d["x"] - ex, d["y"] - ey)
                rides = bool(d.get("number"))  # une pastille sans numéro ne prouve pas une tyrolienne (strie de lumière près d'une station)
                if dist <= reach or (_NEAR and rides and _tp_linked((ex, ey), (d["x"], d["y"]))):
                    walked = walk_distance((ex, ey), (d["x"], d["y"]), rides) if _NEAR else dist
                    if walked is not None and walked <= reach + 0.03:  # la distance réelle (couloirs et tyroliennes) compte, pas la ligne droite à travers les murs
                        pairs.append((dist, slot, i))
        used_slots, used_dets = set(), set()
        for dist, slot, i in sorted(pairs):
            if slot in used_slots or i in used_dets:
                continue
            used_slots.add(slot)
            used_dets.add(i)
            d = free[i]
            put(fi, slot, d["team"], d["x"], d["y"], d.get("angle"), True, CONF_BRIDGE + 0.1)
            placed += 1
    return placed


CONF_SPAWN_GUESS = 0.2  # confiance d'un joueur placé au point de réapparition de son équipe faute de toute lecture pendant sa vie


def _spawn_points(rows, runs):
    """Point de réapparition de chaque équipe : médiane des premières positions lues au début des vies des joueurs de l'équipe (None si aucune)."""
    firsts = {"A": [], "B": []}
    for slot, rs in runs.items():
        for s, e in rs:
            for k in range(s, e + 1):
                r = rows.get((k, slot))
                if r and r[7] and r[8] >= RIDE_MIN_CONF:
                    firsts["A" if slot <= 4 else "B"].append((r[4], r[5]))
                    break
    out = {}
    for team, pts in firsts.items():
        if len(pts) >= 3:
            xs, ys = sorted(p[0] for p in pts), sorted(p[1] for p in pts)
            out[team] = (xs[len(xs) // 2], ys[len(ys) // 2])
    return out


STACK_WINDOW = 30  # images de chaque côté examinées pour voir deux numéros alterner sur une même pastille
STACK_MIN_READS = 3  # lectures minimales de chacun des deux numéros dans la fenêtre
STACK_MIN_SHARE = 0.15  # et part minimale de chacun des deux dans les lectures de la fenêtre
STACK_STEADY = 0.03  # déplacement maximal (relatif à la minimap) de la pastille d'une image à l'autre pour qu'elle serve de position à un joueur superposé
STACK_LOOK = 100  # images cherchées avant et après pour retrouver une lecture sûre du joueur placé sur la pile (10 s)
STACK_NEAR_DIST = 0.12  # distance (relative à la minimap) de cette lecture à la pile : il l'a rejointe ou quittée
STACK_NEAR = 10  # images de chaque côté où le joueur ne doit avoir aucune lecture sûre pour être placé sur la pile
STACK_HOLD = 100  # images pendant lesquelles la pile est gardée après la dernière alternance de numéros (10 s)
CONF_STACK = 0.6  # confiance d'un joueur placé sur la pastille d'un coéquipier superposé au sien


def _read_near_stack(rows, slot, k, x, y):
    """Vrai si le joueur a été lu avec certitude tout près de (x, y) peu avant ou peu après l'image k : il a pu rejoindre ou quitter cette pile."""
    for direction in (-1, 1):
        for j in range(1, STACK_LOOK + 1):
            r = rows.get((k + direction * j, slot))
            if r is not None and r[7] and r[8] >= READ_MIN_CONF:
                if math.hypot(r[4] - x, r[5] - y) <= STACK_NEAR_DIST:
                    return True
                break  # sa lecture la plus proche est ailleurs
    return False


def share_stacks(rows, runs, tracks, put):
    """Deux joueurs de la même équipe superposés ne forment qu'une pastille, dont le numéro lu alterne entre les deux (le 2 et le 4 en 2:52 à 3:05 de la Polaris
    NCT vs SNV : le 4 n'avait aucune détection et dérivait vers la boîte de capture). Quand, dans une fenêtre, deux numéros d'une même trajectoire sont chacun lus
    assez souvent, les deux joueurs sont au même endroit : celui qui n'a pas de lecture sûre prend la position de la pastille. La pile est gardée tant que ce
    joueur n'a pas de lecture à lui (jusqu'à STACK_HOLD images après la dernière alternance) : les numéros finissent souvent par se fixer sur un seul des deux."""
    placed = 0
    claimed = {}  # joueur superposé -> {image: trajectoire qui lui a donné sa position} : une seule trajectoire à la fois (sinon la position saute de l'une à l'autre)
    for t in sorted(tracks, key=lambda t: -len(t.pts)):
        if t.slot is None:
            continue
        reads = {k: d["slot"] for k, d in t.pts.items() if d.get("slot") in SLOTS[t.team] and not d.get("anchored")}
        last_alternation = {}  # autre joueur -> dernière image où l'alternance a été vue
        for k in sorted(t.pts):
            window = [slot for j, slot in reads.items() if abs(j - k) <= STACK_WINDOW]
            if len(window) >= 2 * STACK_MIN_READS:
                for other in {slot for slot in window if slot != t.slot}:
                    n_other, n_own = window.count(other), window.count(t.slot)
                    if n_other >= STACK_MIN_READS and n_own >= STACK_MIN_READS and n_other >= STACK_MIN_SHARE * len(window) and n_own >= STACK_MIN_SHARE * len(window):
                        last_alternation[other] = k
            for other, seen in last_alternation.items():
                if k - seen > STACK_HOLD:
                    continue
                run = next((r for r in runs.get(other, []) if r[0] <= k <= r[1]), None)
                current = rows.get((k, other))
                read_near = any((rows.get((k + j, other)) or (0, 0, 0, 0, 0, 0, 0, 0, 0.0))[8] >= READ_MIN_CONF for j in range(-STACK_NEAR, STACK_NEAR + 1))
                d = t.pts[k]
                before = t.pts.get(k - 1)
                if before is not None and math.hypot(d["x"] - before["x"], d["y"] - before["y"]) > STACK_STEADY:
                    continue  # la pastille saute d'un disque à l'autre : pas une pile stable
                mine = claimed.setdefault(other, {})
                if any(mine.get(k + j) not in (None, t) for j in range(-STACK_NEAR, STACK_NEAR + 1)):
                    continue  # une autre trajectoire place déjà ce joueur par ici
                if run is not None and not read_near and (current is None or current[8] < READ_MIN_CONF) and _read_near_stack(rows, other, k, d["x"], d["y"]):
                    mine[k] = t
                    put(k, other, t.team, d["x"], d["y"], None, True, CONF_STACK)  # son regard est inconnu : on ne copie pas celui du coéquipier
                    placed += 1
    return placed


def bridge_gaps(rows, runs, step_s, put):
    """Aucun joueur vivant ne disparaît : dans chaque période vivante, un trou entre deux lectures est comblé en reliant les deux points
    visibles, le début est rempli par la première position connue (réapparition) et la fin par la dernière (jusqu'à la mort)."""
    lead, trail = max(1, round(LEAD_MAX_S / step_s)), max(1, round(TRAIL_MAX_S / step_s))
    spawn = _spawn_points(rows, runs)
    for slot, rs in runs.items():
        for s, e in rs:
            seen = [k for k in range(s, e + 1) if rows.get((k, slot)) and rows[(k, slot)][7]]
            if not seen:  # vie entière sans une seule lecture (réapparu puis tué aussitôt) : au point de réapparition de son équipe
                team = "A" if slot <= 4 else "B"
                if team in spawn:
                    for k in range(s, e + 1):
                        put(k, slot, team, spawn[team][0], spawn[team][1], None, True, CONF_SPAWN_GUESS)
                continue
            first, last = rows[(seen[0], slot)], rows[(seen[-1], slot)]
            for k in range(max(s, seen[0] - lead), seen[0]):
                put(k, slot, first[3], first[4], first[5], first[6], True, CONF_BRIDGE)
            for k in range(seen[-1] + 1, min(e, seen[-1] + trail) + 1):
                put(k, slot, last[3], last[4], last[5], last[6], True, CONF_BRIDGE)
            for a, b in zip(seen, seen[1:]):
                if b - a <= 1:
                    continue
                ra, rb = rows[(a, slot)], rows[(b, slot)]
                teleport = _tp_linked((ra[4], ra[5]), (rb[4], rb[5])) and (b - a) * step_s <= TP_MAX_GAP_S
                path = None if teleport else route((ra[4], ra[5]), (rb[4], rb[5]), (b - a) * step_s, rb[8] >= RIDE_MIN_CONF)
                for k in range(a + 1, b):
                    if rows.get((k, slot)):
                        continue
                    if teleport:  # station de tyrolienne : au départ jusqu'au milieu du trou, puis à la sortie (jamais une droite à travers la carte)
                        near = ra if k - a <= b - k else rb
                        put(k, slot, ra[3], near[4], near[5], near[6], True, CONF_BRIDGE)
                        continue
                    f = (k - a) / (b - a)
                    if ra[6] is not None and rb[6] is not None:
                        ang = (ra[6] + (((rb[6] - ra[6] + 180) % 360) - 180) * f) % 360
                    else:
                        ang = ra[6] if ra[6] is not None else rb[6]
                    x, y = _along(path, f)
                    put(k, slot, ra[3], x, y, ang, True, CONF_BRIDGE)


SKEW_FULL = 0.25  # asymétrie à partir de laquelle le sens est considéré comme sûr
MOVE_WEIGHT = 1.5  # poids du critère « le regard suit le déplacement » dans le choix du sens
GAZE_DOUBT_SKEW = 0.4  # poids de la forme d'un disque dans une case où les regards se lisent mal (carte de fiabilité)
OBSERVED_FOLLOW_SPEED = 0.03  # vitesse (relative à la minimap, par seconde) à partir de laquelle le regard du joueur observé suit son cap
MOVE_BREAK_DIST = 0.12  # un pas plus grand entre deux lectures successives coupe la trajectoire pour mesurer le cap
MOVE_MIN_SPEED = 0.02  # en dessous, le joueur est à l'arrêt : son regard n'a aucun lien avec un déplacement
MOVE_SPEED_FULL = 0.08  # vitesse (normalisée, par seconde) à partir de laquelle ce critère a son poids plein
FLIP_COST = 2.5  # coût d'un retournement de sens entre deux lectures successives


def _angdist(a, b):
    return abs((a - b + 180) % 360 - 180)


WALL_WEIGHT = 0.4  # coût d'un regard qui donne dans un mur à bout portant (la carte des passages le dit) : on regarde où l'on voit, pas contre un mur
WALL_LOOK = 0.06  # distance (relative à la minimap) examinée devant le joueur


def _wall_penalty(pos, angle):
    """0 à 1 : 1 si le premier pas du regard sort des passages, 0 si le regard reste dans les passages sur toute la distance examinée. 0 sans carte des passages."""
    if not _WALK or pos is None:
        return 0.0
    for i in range(1, 7):
        d = WALL_LOOK * i / 6
        p = (pos[0] + d * math.cos(math.radians(angle)), pos[1] + d * math.sin(math.radians(angle)))
        if _cell(p) not in _WALK:
            return 1.0 - (i - 1) / 6
    return 0.0


ENEMY_WEIGHT = 0.6  # préférence pour le sens qui regarde vers le camp ennemi (un joueur regarde d'où viennent les ennemis, même quand personne n'est là) : tranche le sens d'un regard ambigu

def _enemy_headings(spawns):
    """{équipe: cap (degrés) vers le camp ennemi} d'après les zones de départ de la carte : du centre de la zone de son équipe au centre de l'autre. Vide sans zones."""
    if not spawns or "A" not in spawns or "B" not in spawns:
        return {}
    centre = {t: ((r[0] + r[2]) / 2, (r[1] + r[3]) / 2) for t, r in spawns.items()}
    heading = lambda a, b: math.degrees(math.atan2(centre[b][1] - centre[a][1], centre[b][0] - centre[a][0])) % 360
    return {"A": heading("A", "B"), "B": heading("B", "A")}


def _choose_directions(obs, moves=None, positions=None, enemy=None):
    """obs : {indice: (axe, asymétrie)} -> {indice: angle}. Programmation dynamique sur le sens (axe ou axe + 180) :
    chaque lecture « vote » pour le sens de son asymétrie, proportionnellement à sa netteté, et un retournement d'une
    lecture à l'autre coûte cher. Un sens isolé et douteux est donc corrigé, un vrai demi-tour soutenu est conservé.

    moves : {indice: (cap, vitesse)} : un joueur regarde presque toujours dans la direction où il avance, ce qui tranche le sens quand
    la forme de la pastille est ambiguë (surtout la pastille blanche du joueur observé). Poids proportionnel à la vitesse."""
    keys = sorted(k for k, v in obs.items() if v[0] is not None)
    if not keys:
        return {}
    ang = {k: (obs[k][0], (obs[k][0] + 180) % 360) for k in keys}

    def unary(k, c):
        axis, skew = obs[k]
        w = min(1.0, abs(skew) / SKEW_FULL)
        prefers = 0 if skew >= 0 else 1
        cost = 0.0 if c == prefers else w
        move = moves.get(k) if moves else None
        if move is not None:
            heading, speed = move
            weight = MOVE_WEIGHT * min(1.0, speed / MOVE_SPEED_FULL)
            # 0 si le regard suit le déplacement, 1 s'il lui tourne le dos
            cost += weight * (1 - math.cos(math.radians(ang[k][c] - heading))) / 2
        if positions:
            cost += WALL_WEIGHT * _wall_penalty(positions.get(k), ang[k][c])
        if enemy is not None:
            cost += ENEMY_WEIGHT * (1 - math.cos(math.radians(ang[k][c] - enemy))) / 2
        return cost

    cost = [[unary(keys[0], 0), unary(keys[0], 1)]]
    back = []
    for prev, k in zip(keys, keys[1:]):
        row, bk = [], []
        for c in (0, 1):
            opts = [cost[-1][pc] + FLIP_COST * _angdist(ang[prev][pc], ang[k][c]) / 180 for pc in (0, 1)]
            pc = 0 if opts[0] <= opts[1] else 1
            row.append(opts[pc] + unary(k, c))
            bk.append(pc)
        cost.append(row)
        back.append(bk)
    c = 0 if cost[-1][0] <= cost[-1][1] else 1
    choice = [c]
    for bk in reversed(back):
        c = bk[c]
        choice.append(c)
    choice.reverse()
    return {k: ang[k][c] for k, c in zip(keys, choice)}


def _smooth_angles(series, half):
    """Lisse les directions choisies : on écarte celles à plus de 100° de la moyenne locale, puis on moyenne le reste."""
    out = {}
    keys = sorted(series)
    for k in keys:
        window = [series[j] for j in keys if abs(j - k) <= half and series[j] is not None]
        if not window:
            out[k] = None
            continue
        for _ in range(2):
            sx = sum(math.cos(math.radians(a)) for a in window)
            sy = sum(math.sin(math.radians(a)) for a in window)
            mean = math.degrees(math.atan2(sy, sx))
            kept = [a for a in window if _angdist(a, mean) <= 100]
            if kept and len(kept) < len(window):
                window = kept
            else:
                break
        sx = sum(math.cos(math.radians(a)) for a in window)
        sy = sum(math.sin(math.radians(a)) for a in window)
        out[k] = math.degrees(math.atan2(sy, sx)) % 360
    return out


DEATH_NEAR_DIST = 0.06  # une lecture vivante à moins de cette distance de la mort est une erreur de lecture (le joueur ne peut pas y être)
DEATH_SHOWN_S = 2.0  # durée pendant laquelle la croix d'un joueur mort est affichée


def _add_known_deaths(rows, deaths, times, step_s, put):
    """Un kill du killfeed est une mort certaine : si la minimap n'a pas montré la croix (pastille cachée, bord de la carte),
    on pose le joueur mort à sa dernière position connue, le temps d'une croix, sans écraser une lecture vivante."""
    if not deaths or not times:
        return
    ordered = sorted(times)
    for t_death, slot in deaths:
        fi = min(ordered, key=lambda k: abs(times[k] - t_death))
        if abs(times[fi] - t_death) > 1.5:
            continue
        window = [k for k in ordered if fi <= k <= fi + max(1, round(DEATH_SHOWN_S / step_s))]
        if any((k, slot) in rows and not rows[(k, slot)][7] for k in window[:3]):
            continue  # la croix a bien été vue
        before = [rows[(k, slot)] for k in ordered if k <= fi and (k, slot) in rows and rows[(k, slot)][7]]
        if not before or fi - before[-1][0] > round(3.0 / step_s):
            continue  # on ne sait pas où il était
        last = before[-1]
        for k in window:
            cur = rows.get((k, slot))
            if cur and cur[7] and math.hypot(cur[4] - last[4], cur[5] - last[5]) > DEATH_NEAR_DIST:
                break  # il est déjà revenu en vie, ailleurs
            put(k, slot, last[3], last[4], last[5], None, False, CONF_VOTE * 0.9)


def _add_banner_deaths(rows, dead, times, step_s, put):
    """Le bandeau grisé d'un joueur marque sa mort à l'image près, souvent avant que la croix de la minimap soit lue (croix cachée, ou lue 1 s plus tard).
    Entre la mort du bandeau et la première croix, le joueur est posé mort à sa dernière position vivante : plus de trou ni de joueur qui disparaît."""
    ordered = sorted(times)
    span = max(1, round(DEATH_SHOWN_S / step_s))
    for slot, frames in dead.items():
        for f0 in sorted(frames):
            if f0 - 1 in frames or f0 - 1 not in times:
                continue  # pas le début d'une mort
            before = next(((k, rows[(k, slot)]) for k in range(f0 - 1, f0 - 1 - round(3.0 / step_s), -1) if (k, slot) in rows and rows[(k, slot)][7]), None)
            if before is None:
                continue
            last = before[1]
            for k in range(f0, f0 + span):
                if k not in times or k not in frames:
                    break
                cur = rows.get((k, slot))
                if cur is not None and not cur[7]:
                    break  # la croix de la minimap prend le relais
                if cur is None:
                    put(k, slot, last[3], last[4], last[5], None, False, CONF_VOTE * 0.9)


def _between_angle(smooth, idx, k):
    """Direction d'une ligne comblée : interpolation (par le plus court arc) entre les deux lectures voisines qui en ont une."""
    before = [j for j in idx if j < k and smooth.get(j) is not None]
    after = [j for j in idx if j > k and smooth.get(j) is not None]
    if not before and not after:
        return None
    if not before or not after:
        return smooth[(after or before)[0 if after else -1]]
    a, b = before[-1], after[0]
    da = ((smooth[b] - smooth[a] + 180) % 360) - 180
    return (smooth[a] + da * (k - a) / (b - a)) % 360


STATIC_CELL = 0.02  # taille (relative à la minimap) des cases où l'on compte les pastilles sans numéro
STATIC_SHARE = 0.10  # une case où une pastille sans numéro revient dans plus de cette part des images est du décor, pas un joueur
STATIC_MIN_FRAMES = 60  # en dessous, trop peu d'images pour décider


def drop_static_noise(frames):
    """Retire les fausses pastilles du décor : sur certaines cartes le fond de la minimap a des taches de la couleur d'une équipe.
    Elles ne bougent pas et n'ont pas de numéro, alors qu'un joueur ne reste jamais aussi longtemps au même endroit sans que son
    numéro soit lu. Les pastilles numérotées sont toujours conservées."""
    if len(frames) < STATIC_MIN_FRAMES:
        return frames
    seen = {}  # (équipe, case) -> nombre d'images où une pastille sans numéro s'y trouve (voisines comprises)
    for _, _, dets in frames:
        cells = set()
        for d in dets:
            if d.get("number") or d.get("slot"):
                continue
            cx, cy = round(d["x"] / STATIC_CELL), round(d["y"] / STATIC_CELL)
            cells.update((d["team"], cx + i, cy + j) for i in (-1, 0, 1) for j in (-1, 0, 1))
        for c in cells:
            seen[c] = seen.get(c, 0) + 1
    limit = STATIC_SHARE * len(frames)
    banned = {c for c, n in seen.items() if n > limit}
    if not banned:
        return frames
    out = []
    for fi, t, dets in frames:
        keep = [
            d for d in dets
            if d.get("number") or d.get("slot") or (d["team"], round(d["x"] / STATIC_CELL), round(d["y"] / STATIC_CELL)) not in banned
        ]
        out.append((fi, t, keep))
    return out


SPECT_STATIC_SHARE = 0.04  # une case où une pastille blanche « observée » revient dans plus de cette part des images...
SPECT_STATIC_WINDOWS = 4  # ...réparties sur au moins ce nombre de périodes de 15 s, est une station de tyrolienne (fixe, toujours là), pas le joueur observé
SPECT_WINDOW_S = 15.0


def _confirmed_by_banner(d, observed):
    """Vrai si la pastille blanche porte le numéro du joueur que le bandeau dit observé (dans la bonne équipe) : c'est bien lui, même sur une station."""
    return observed is not None and d["team"] == ("A" if observed <= 4 else "B") and d.get("number") == _number_of(observed)


def drop_static_spectated(frames, states=None):
    """Les disques blancs à flèche de certaines cartes (stations de tyrolienne) sont parfois lus comme le joueur observé, avec un numéro. Ils ne bougent
    jamais et reviennent tout au long de la game, alors que le joueur observé ne reste immobile au même pixel que quelques secondes de suite.
    Mais le joueur observé passe réellement par ces stations (il les emprunte) : une pastille blanche dans une de ces cases est gardée quand son
    numéro est celui du joueur que le bandeau dit observé à cet instant (sans cela, un tiers des lectures de Polaris était perdu)."""
    if len(frames) < STATIC_MIN_FRAMES:
        return frames
    hits, spread = {}, {}
    for _, t, dets in frames:
        cells = set()
        for d in dets:
            if d.get("spectated"):
                cx, cy = round(d["x"] / STATIC_CELL), round(d["y"] / STATIC_CELL)
                cells.update((cx + i, cy + j) for i in (-1, 0, 1) for j in (-1, 0, 1))
        for c in cells:
            hits[c] = hits.get(c, 0) + 1
            spread.setdefault(c, set()).add(int(t / SPECT_WINDOW_S))
    banned = {c for c, n in hits.items() if n > SPECT_STATIC_SHARE * len(frames) and len(spread[c]) >= SPECT_STATIC_WINDOWS}
    if not banned:
        return frames
    out = []
    for fi, t, dets in frames:
        watched = [s for s, v in (states or {}).get(fi, {}).items() if v["spectated"]]
        observed = watched[0] if len(watched) == 1 else None
        out.append((fi, t, [
            d for d in dets
            if not (d.get("spectated") and (round(d["x"] / STATIC_CELL), round(d["y"] / STATIC_CELL)) in banned) or _confirmed_by_banner(d, observed)
        ]))
    return out


def solve(frames, step_s, deaths=None, states=None, teleports=None, walk_points=None, walk_mask=None, noise=None, spawns=None, reliability=None):
    """frames : [(indice, t, [détections])]. deaths : [(t, slot)] morts lues dans le killfeed (facultatif).
    states : {indice: {slot: {"alive", "spectated"}}} lu sur les bandeaux (facultatif) : il fixe la pastille du joueur observé, écarte les joueurs
    morts de l'attribution et retire les positions vivantes d'un joueur dont le bandeau est grisé.
    teleports : [((x, y), (x, y))] paires de stations de tyrolienne de la carte (facultatif).
    walk_points : [(x, y)] lectures sûres des autres games de la même carte (facultatif) : avec celles de cette game, elles donnent la carte des passages
    qui guide le comblement des trous (on ne traverse plus les murs).
    walk_mask : masque booléen des zones praticables de la carte (map_mask.load), facultatif : il remplace la carte apprise, refuse les détections hors des couloirs
    et donne la distance réelle (par les couloirs et les tyroliennes) pour accepter une pastille récupérée.
    noise : {indice d'image: couleur d'équipe non expliquée, en équivalents de pastille} (frame_noise.py), facultatif : une image contaminée (stries de lumière)
    ne crée pas de trajectoire et ne sert pas à récupérer une pastille sans numéro.
    spawns : {"A": (x0, y0, x1, y1), "B": ...} zones de départ de la carte (facultatif) : un disque blanc « qui attend » hors de la zone de départ de son équipe
    (la boîte de capture de Polaris) est un joueur en jeu, pas un mort.
    reliability : {"grid": n, "gaze": {(i, j)}} cases de la carte où la forme des disques a donné de mauvais regards (reliability.py) : la forme y pèse moins que le cap et le camp ennemi.
    Renvoie les lignes (frame, t, slot, team, x, y, angle, alive, confiance)."""
    if not frames:
        return []
    _TELEPORTS[:] = teleports or []
    _WALK.clear()
    _NEAR.clear()
    _ROUTES.clear()
    _JUMPS.clear()
    frames = anchor_spectated(frames, states, spawns)
    dead = dead_frames(states, step_s)
    frames = drop_static_spectated(drop_static_noise(frames), states)
    times = {fi: t for fi, t, _ in frames}
    own = [(d["x"], d["y"]) for _, _, dets in frames for d in dets if d["alive"] and d.get("number")]  # pastilles numérotées : les plus fiables
    if walk_mask is not None:
        import map_mask

        near_stations = {c for cell in _station_cells() for c in _around(cell)}
        _WALK.update(map_mask.coverage_cells(walk_mask, WALK_CELL) | near_stations)
        _NEAR.update(set().union(*(_around(c) for c in _WALK)))
        frames = [(fi, t, [d for d in dets if on_walkable((d["x"], d["y"]))]) for fi, t, dets in frames]  # hors des couloirs : reflet ou effet de l'écran, jamais un joueur
    else:
        _WALK.update(walk_grid(own + list(walk_points or [])))
    deaths = confirmed_deaths(deaths, dead, times, step_s)
    contaminated = {fi for fi, v in (noise or {}).items() if v > NOISE_MAX}
    alive_tracks, dead_tracks = _link(frames, step_s, contaminated)
    alive_tracks = [t for t in alive_tracks if len(t.pts) >= 2 or t.votes]  # une pastille vue une fois sans numéro : bruit
    trim_merged_tails(alive_tracks)
    alive_tracks = [t for t in alive_tracks if t.pts]
    _assign(alive_tracks, step_s, dead)
    placed = [t for t in alive_tracks if t.slot is not None]
    crosses = _attach_crosses([t for t in dead_tracks if len(t.pts) >= 2], placed, step_s, deaths, times)

    half = max(1, round(SMOOTH_S / step_s / 2))
    enemy_heading = _enemy_headings(spawns)
    by_slot = {}
    for t in placed:
        by_slot.setdefault(t.slot, []).append(t)

    rows = {}  # (frame, slot) -> ligne

    def put(fi, slot, team, x, y, angle, alive, conf):
        rows[(fi, slot)] = (fi, round(times.get(fi, 0.0), 2), slot, team, round(x, 4), round(y, 4), angle, int(alive), round(conf, 2))

    for slot, tracks in by_slot.items():
        tracks.sort(key=lambda t: t.first)
        for t in tracks:
            idx = sorted(t.pts)
            # trous internes (pastille cachée quelques images) : interpolation
            filled = {}
            for a, b in zip(idx, idx[1:]):
                pa, pb = t.pts[a], t.pts[b]
                teleport = _tp_linked((pa["x"], pa["y"]), (pb["x"], pb["y"]))
                path = None if teleport or b - a <= 2 else route((pa["x"], pa["y"]), (pb["x"], pb["y"]), (b - a) * step_s, t.how >= RIDE_MIN_CONF)
                for k in range(a + 1, b):
                    r = (k - a) / (b - a)
                    if teleport:  # station de tyrolienne : à l'entrée jusqu'au milieu du trou, puis à la sortie
                        near = pa if k - a <= b - k else pb
                        filled[k] = (near["x"], near["y"])
                        continue
                    filled[k] = _along(path, r) if path else (pa["x"] + (pb["x"] - pa["x"]) * r, pa["y"] + (pb["y"] - pa["y"]) * r)
            obs = {}
            for k in idx:
                d = t.pts[k]
                if d.get("axis") is not None:
                    obs[k] = (d["axis"], d.get("skew") or 0.0)
                elif d.get("angle") is not None:  # détection sans asymétrie connue : on retient le sens donné
                    obs[k] = (d["angle"] % 180, 1.0 if d["angle"] < 180 else -1.0)
            # Cap et vitesse de déplacement (différence centrée sur quelques lectures voisines).
            moves = {}
            # Un saut (tyrolienne, trou) coupe la trajectoire : la vitesse et le cap se mesurent d'un seul côté, jamais à travers (sinon le regard d'un joueur qui
            # court vers une station pointait vers sa sortie, à l'autre bout de la carte).
            seg, parts = 0, []
            for j, k in enumerate(idx):
                if j and (_tp_linked((t.pts[idx[j - 1]]["x"], t.pts[idx[j - 1]]["y"]), (t.pts[k]["x"], t.pts[k]["y"])) or math.hypot(t.pts[k]["x"] - t.pts[idx[j - 1]]["x"], t.pts[k]["y"] - t.pts[idx[j - 1]]["y"]) > MOVE_BREAK_DIST):
                    seg += 1
                parts.append(seg)
            for j, k in enumerate(idx):
                lo = next(i for i in range(max(0, j - 2), j + 1) if parts[i] == parts[j])
                hi = next(i for i in range(min(len(idx) - 1, j + 2), j - 1, -1) if parts[i] == parts[j])
                a, b = idx[lo], idx[hi]
                dt = times.get(b, 0.0) - times.get(a, 0.0)
                if b != a and dt > 0:
                    dx, dy = t.pts[b]["x"] - t.pts[a]["x"], t.pts[b]["y"] - t.pts[a]["y"]
                    speed = math.hypot(dx, dy) / dt
                    if speed >= MOVE_MIN_SPEED:
                        moves[k] = (math.degrees(math.atan2(dy, dx)) % 360, speed)
            for k in list(obs):  # disque blanc en mouvement : sa forme ne dit presque rien du regard (mesuré : au hasard, axe faux une fois sur deux), le cap le dit
                if k in moves and t.pts[k].get("spectated") and moves[k][1] >= OBSERVED_FOLLOW_SPEED:
                    heading = moves[k][0]
                    obs[k] = (heading % 180, (1.0 if heading < 180 else -1.0) * SKEW_FULL)
            if reliability and reliability.get("gaze"):  # zone où les disques se lisent mal : la forme décide moins
                g = reliability["grid"]
                for k in list(obs):
                    if (min(g - 1, int(t.pts[k]["x"] * g)), min(g - 1, int(t.pts[k]["y"] * g))) in reliability["gaze"]:
                        obs[k] = (obs[k][0], obs[k][1] * GAZE_DOUBT_SKEW)
            chosen = _choose_directions(obs, moves, {k: (t.pts[k]["x"], t.pts[k]["y"]) for k in idx}, enemy_heading.get(t.team))
            smooth = _smooth_angles({k: chosen.get(k) for k in idx}, half)
            for k in idx:
                d = t.pts[k]
                conf = t.how if d.get("slot") != t.slot else CONF_VOTE
                put(k, slot, t.team, d["x"], d["y"], smooth[k], True, conf)
            for k, (x, y) in filled.items():
                put(k, slot, t.team, x, y, _between_angle(smooth, idx, k), True, CONF_FILL)
        # trous entre deux trajectoires du même joueur (disparition plus longue, même sans réapparition lointaine)
        for a, b in zip(tracks, tracks[1:]):
            if _gap_cost(a, b, step_s, FILL_MAX_S, FILL_MAX_DIST) is None:
                continue
            ia, ib = a.last, b.first
            pa, pb = a.pts[ia], b.pts[ib]
            ang_a, ang_b = rows[(ia, slot)][6], rows[(ib, slot)][6]
            teleport = _tp_linked((pa["x"], pa["y"]), (pb["x"], pb["y"]))
            path = None if teleport else route((pa["x"], pa["y"]), (pb["x"], pb["y"]), (ib - ia) * step_s, b.how >= RIDE_MIN_CONF)
            for k in range(ia + 1, ib):
                r = (k - ia) / (ib - ia)
                if (k, slot) not in rows and teleport:  # station de tyrolienne : à l'entrée jusqu'au milieu du trou, puis à la sortie
                    near, ang = (pa, ang_a) if k - ia <= ib - k else (pb, ang_b)
                    put(k, slot, a.team, near["x"], near["y"], ang, True, CONF_FILL)
                    continue
                if (k, slot) not in rows:
                    if ang_a is not None and ang_b is not None:
                        ang = (ang_a + (((ang_b - ang_a + 180) % 360) - 180) * r) % 360
                    else:
                        ang = ang_a if ang_a is not None else ang_b
                    x, y = _along(path, r)
                    put(k, slot, a.team, x, y, ang, True, CONF_FILL)
    for x in crosses:
        for k, d in x.pts.items():
            if (k, x.slot) not in rows:
                put(k, x.slot, x.team, d["x"], d["y"], None, False, x.how)
    # Un joueur dont le bandeau est grisé n'a pas de pastille vivante (les croix restent : elles montrent où il est mort).
    for key in [k for k, r in rows.items() if r[7] and k[0] in dead.get(k[1], ())]:
        del rows[key]
    if states and dead:
        runs = alive_runs(states, dead)
        recover_from_unused(rows, runs, frames, states, step_s, put, contaminated)
        share_stacks(rows, runs, placed, put)
        drop_isolated_reads(rows, step_s)
        drop_impossible_moves(rows, step_s)
        bridge_gaps(rows, runs, step_s, put)
    _add_known_deaths(rows, deaths or [], times, step_s, put)
    _add_banner_deaths(rows, dead, times, step_s, put)
    remove_excursions(rows, step_s)
    smooth_unsure(rows)
    despike(rows)
    steady_positions(rows)
    snap_to_walkable(rows)
    steady_gaze(rows, step_s)
    steady_still_gaze(rows)
    separate_players(rows)
    return sorted(rows.values(), key=lambda r: (r[0], r[2]))


IMPOSSIBLE_V_MS = 14.0  # un pas plus rapide que cela (hors tyrolienne) n'est pas un déplacement : une des deux lectures est fausse
IMPOSSIBLE_MAX_BLOCK_S = 3.0  # on ne retire que des blocs de lectures peu sûres plus courts que cela


def drop_impossible_moves(rows, step_s):
    """Deux lectures successives d'un même joueur à plus de IMPOSSIBLE_V_MS l'une de l'autre (hors tyrolienne) : la moins sûre est fausse (le 4 « se téléporte »
    sur le point de capture 0,1 s après être resté à côté du 2 : une pastille sans numéro lui avait été attribuée par élimination). Le bloc de lectures peu sûres
    (confiance sous READ_MIN_CONF) auquel elle appartient est retiré ; le trou est comblé ensuite. Deux lectures sûres ne sont jamais touchées."""
    max_block = round(IMPOSSIBLE_MAX_BLOCK_S / step_s)
    dropped = 0
    for _ in range(3):
        changed = False
        by_slot = {}
        for (k, slot), r in rows.items():
            if r[7]:
                by_slot.setdefault(slot, []).append(k)
        for slot, frames in by_slot.items():
            frames.sort()
            for k0, k1 in zip(frames, frames[1:]):
                if (k0, slot) not in rows or (k1, slot) not in rows:
                    continue
                p, q = rows[(k0, slot)], rows[(k1, slot)]
                if _tp_linked((p[4], p[5]), (q[4], q[5])):
                    continue
                dist = math.hypot((q[4] - p[4]) * ARENA_M[0], (q[5] - p[5]) * ARENA_M[1])
                if dist / max((k1 - k0) * step_s, step_s) <= IMPOSSIBLE_V_MS:
                    continue
                weak, start = (p, k0) if p[8] < q[8] else (q, k1)
                if weak[8] >= READ_MIN_CONF:
                    continue
                step = -1 if weak is p else 1  # le bloc s'étend à partir de la lecture douteuse, du côté opposé à l'autre lecture
                block, k = [], start
                while (k, slot) in rows and rows[(k, slot)][7] and rows[(k, slot)][8] < READ_MIN_CONF and len(block) <= max_block:
                    block.append(k)
                    k += step
                if len(block) > max_block:
                    continue
                for k in block:
                    del rows[(k, slot)]
                    dropped += 1
                changed = True
        if not changed:
            break
    return dropped


ISOLATED_MAX_ROWS = 4  # un groupe de lectures de cette taille ou moins, loin des autres, est suspect
ISOLATED_MIN_GAP = 3  # images de vide de chaque côté pour qu'un groupe soit isolé
ISOLATED_DETOUR = 2.5  # passer par ce groupe allonge le trajet de plus de ce facteur (plus ISOLATED_SLACK) : lecture d'un autre joueur, ou chiffre mal lu
ISOLATED_SLACK = 0.12
ISOLATED_WINDOW_S = 6.0  # les lectures sûres voisines qui servent de repère sont à cette durée au plus de la lecture isolée


def drop_isolated_reads(rows, step_s=0.1):
    """Une lecture sûre isolée (1 à 4 images) loin des autres lectures sûres du même joueur, qui forcerait un aller-retour (« le 4 saute à l'autre bout de la carte
    une demi-seconde, puis revient », le 9 qui file vers une station à 3:46 parce qu'une icône de station était lue « 9 ») est un chiffre mal lu : on la retire, avec
    les lignes reconstituées qui la relient à ses voisines, et le trou est comblé ensuite comme un autre. Les trajets par tyrolienne sont laissés."""
    by_slot = {}
    for (k, slot), r in rows.items():
        if r[7] and r[8] >= READ_MIN_CONF:
            by_slot.setdefault(slot, []).append(k)
    dropped = 0
    for slot, frames in by_slot.items():
        frames.sort()
        groups = [[frames[0]]]
        for k in frames[1:]:
            if k == groups[-1][-1] + 1:
                groups[-1].append(k)
            else:
                groups.append([k])
        big = [g for g in groups if len(g) > ISOLATED_MAX_ROWS]
        for g in groups:
            if len(g) > ISOLATED_MAX_ROWS:
                continue
            before = [b for b in big if b[-1] < g[0]]
            after = [b for b in big if b[0] > g[-1]]
            window = round(ISOLATED_WINDOW_S / step_s)
            if not before or not after or not ISOLATED_MIN_GAP <= g[0] - before[-1][-1] <= window or not ISOLATED_MIN_GAP <= after[0][0] - g[-1] <= window:
                continue  # les voisines doivent être proches dans le temps (pas de l'autre côté d'une mort et d'une réapparition)
            a, b = rows[(before[-1][-1], slot)], rows[(after[0][0], slot)]
            bad = []
            for k in g:
                p = rows[(k, slot)]
                if _tp_linked((a[4], a[5]), (p[4], p[5])) or _tp_linked((p[4], p[5]), (b[4], b[5])):
                    continue
                via = math.hypot(p[4] - a[4], p[5] - a[5]) + math.hypot(b[4] - p[4], b[5] - p[5])
                if via > ISOLATED_DETOUR * math.hypot(b[4] - a[4], b[5] - a[5]) + ISOLATED_SLACK:
                    bad.append(k)
            if not bad:
                continue
            # lignes reconstituées qui mènent à la lecture retirée et en reviennent : jusqu'aux lectures sûres voisines (les autres groupes, bons ou mauvais)
            left = max((k for k in frames if k < g[0]), default=before[-1][-1])
            right = min((k for k in frames if k > g[-1]), default=after[0][0])
            for k in range(left + 1, right):
                r = rows.get((k, slot))
                if r is not None and r[7] and (k in bad or (r[8] < READ_MIN_CONF)):
                    del rows[(k, slot)]
                    dropped += 1
    return dropped


GAZE_HOLD_S = 3.0  # une ligne peu sûre prend le regard des lectures sûres voisines jusqu'à cet écart


def steady_gaze(rows, step_s):
    """Le regard d'une position reconstituée ou récupérée (confiance sous READ_MIN_CONF) n'est pas une mesure : il ne doit pas faire de demi-tour ni de tour complet
    d'une ligne à l'autre (le 8 observé tournait sur lui-même à 0:51). Il est interpolé, par le plus court arc, entre les deux lectures sûres voisines qui en ont un
    (celle d'un seul côté si l'autre manque, jusqu'à GAZE_HOLD_S). Les lectures sûres ne sont jamais modifiées."""
    hold = round(GAZE_HOLD_S / step_s)
    by_slot = {}
    for (k, slot), r in rows.items():
        if r[7]:
            by_slot.setdefault(slot, []).append(k)
    changed = 0
    for slot, frames in by_slot.items():
        frames.sort()
        sure = [k for k in frames if rows[(k, slot)][8] >= READ_MIN_CONF and rows[(k, slot)][6] is not None]
        if not sure:
            continue
        import bisect

        for k in frames:
            r = rows[(k, slot)]
            if r[8] >= READ_MIN_CONF:
                continue
            i = bisect.bisect_left(sure, k)
            before = sure[i - 1] if i > 0 and k - sure[i - 1] <= hold else None
            after = sure[i] if i < len(sure) and sure[i] - k <= hold else None
            if before is None and after is None:
                continue
            if before is None or after is None:
                angle = rows[(before if after is None else after, slot)][6]
            else:
                a, b = rows[(before, slot)][6], rows[(after, slot)][6]
                angle = (a + (((b - a + 180) % 360) - 180) * (k - before) / (after - before)) % 360
            if r[6] is None or abs(((r[6] - angle + 180) % 360) - 180) > 20:
                rows[(k, slot)] = r[:6] + (round(angle, 1),) + r[7:]
                changed += 1
    return changed


SNAP_MAX = 0.06  # une position vivante hors des couloirs est ramenée au passage le plus proche si il est à moins de cela


def snap_to_walkable(rows):
    """Un joueur peut être collé à un mur, jamais hors des limites de la carte : une position vivante hors des passages connus (lissage, centre d'un disque coupé
    par un trait de mur) est ramenée au centre de la case praticable la plus proche. Sans carte des passages, rien n'est fait."""
    if not _WALK:
        return 0
    moved = 0
    reach = int(SNAP_MAX / WALK_CELL) + 1
    for key, r in list(rows.items()):
        if not r[7] or on_walkable((r[4], r[5])):
            continue
        ci, cj = _cell((r[4], r[5]))
        best = None
        for di in range(-reach, reach + 1):
            for dj in range(-reach, reach + 1):
                if (ci + di, cj + dj) in _WALK:
                    cx, cy = (ci + di + 0.5) * WALK_CELL, (cj + dj + 0.5) * WALK_CELL
                    d = math.hypot(cx - r[4], cy - r[5])
                    if d <= SNAP_MAX and (best is None or d < best[0]):
                        best = (d, cx, cy)
        if best:
            rows[key] = r[:4] + (round(best[1], 4), round(best[2], 4)) + r[6:]
            moved += 1
    return moved


GAZE_STILL_FRAMES = 8  # images de chaque côté de la fenêtre où le regard d'un joueur arrêté est stabilisé
GAZE_STILL_SPREAD = 0.03  # le joueur est arrêté si toute la fenêtre tient dans ce carré (relatif à la minimap)


def _circular_median(angles):
    """Angle de la liste qui minimise la somme des écarts angulaires aux autres (un retournement isolé de 180 degrés n'est jamais retenu)."""
    return min(angles, key=lambda a: sum(abs((a - b + 180) % 360 - 180) for b in angles))


def steady_still_gaze(rows):
    """Un joueur arrêté ne fait pas des demi-tours à chaque image : la forme de son disque, presque ronde, donne un sens qui bascule (le 8 observé à 0:35, le 3 à
    2:15). Son regard devient la médiane circulaire de la fenêtre quand le joueur est resté dans GAZE_STILL_SPREAD ; un vrai tour qui dure plus que la moitié de la
    fenêtre est conservé."""
    snap = {key: (r[4], r[5], r[6]) for key, r in rows.items() if r[7] and r[6] is not None}
    changed = 0
    for (k, slot), (x, y, ang) in snap.items():
        win = [snap[(k + j, slot)] for j in range(-GAZE_STILL_FRAMES, GAZE_STILL_FRAMES + 1) if (k + j, slot) in snap]
        if len(win) < GAZE_STILL_FRAMES:
            continue
        if max(p[0] for p in win) - min(p[0] for p in win) > GAZE_STILL_SPREAD or max(p[1] for p in win) - min(p[1] for p in win) > GAZE_STILL_SPREAD:
            continue
        med = _circular_median([p[2] for p in win])
        if abs((med - ang + 180) % 360 - 180) > 1:
            r = rows[(k, slot)]
            rows[(k, slot)] = r[:6] + (round(med, 1),) + r[7:]
            changed += 1
    return changed


STEADY_FRAMES = 15  # images de chaque côté de la fenêtre de la médiane pour un joueur qui ne bouge presque pas
STEADY_RAMP = 5  # puis moyenne sur cette demi-fenêtre : un changement de position devient une dérive lente, pas un saut
STEADY_SPREAD = 0.045  # la fenêtre ne doit pas s'étendre de plus que cela (relatif à la minimap) : au-delà, le joueur bouge vraiment


def steady_positions(rows):
    """Un joueur qui ne bouge pas ne doit pas « sauter » d'un point à l'autre : le centre du disque blanc de l'observé change de 0,4 m selon le fond (le 8 à 0:35 et
    à 1:02) et le joueur paraît se téléporter. Quand toute la fenêtre (STEADY_FRAMES de chaque côté) tient dans STEADY_SPREAD, la position devient la médiane de la
    fenêtre, adoucie par une moyenne glissante. Un joueur qui avance régulièrement garde sa position (la médiane d'une droite est son centre)."""
    snap = {key: (r[4], r[5]) for key, r in rows.items() if r[7]}
    med = {}
    for (k, slot) in snap:
        win = [snap[(k + j, slot)] for j in range(-STEADY_FRAMES, STEADY_FRAMES + 1) if (k + j, slot) in snap]
        if len(win) < STEADY_FRAMES:
            continue
        xs, ys = sorted(p[0] for p in win), sorted(p[1] for p in win)
        if xs[-1] - xs[0] > STEADY_SPREAD or ys[-1] - ys[0] > STEADY_SPREAD:
            continue
        med[(k, slot)] = (xs[len(xs) // 2], ys[len(ys) // 2])
    moved = 0
    for (k, slot), _ in med.items():
        around = [med[(k + j, slot)] for j in range(-STEADY_RAMP, STEADY_RAMP + 1) if (k + j, slot) in med]
        mx, my = sum(p[0] for p in around) / len(around), sum(p[1] for p in around) / len(around)
        r = rows[(k, slot)]
        if abs(mx - r[4]) > 1e-4 or abs(my - r[5]) > 1e-4:
            rows[(k, slot)] = r[:4] + (round(mx, 4), round(my, 4)) + r[6:]
            moved += 1
    return moved


EXC_MAX_S = 8.0  # aller-retour : un joueur qui part et revient dans ce temps...
EXC_DEVIATION = 0.06  # ... en s'écartant d'au moins cela (relatif à la minimap)...
EXC_RETURN = 0.10  # ... et revient à moins de cela de son point de départ, sans lecture sûre pendant l'écart : écart inventé par un trou mal comblé


def remove_excursions(rows, step_s):
    """Un joueur sans lecture sûre qui s'écarte puis revient près de son point de départ n'a pas fait ce voyage : le trou (« le 4 part tout seul vers le camp ennemi
    puis revient ») est refermé par une ligne droite entre le dernier point sûr avant et le premier après. Les trajets par une tyrolienne sont laissés."""
    by_slot = {}
    for (k, slot), r in rows.items():
        if r[7]:
            by_slot.setdefault(slot, {})[k] = r
    max_len = round(EXC_MAX_S / step_s)
    fixed = 0
    for slot, seq in by_slot.items():
        frames = sorted(seq)
        i = 0
        while i < len(frames):
            if seq[frames[i]][8] >= READ_MIN_CONF:
                i += 1
                continue
            j = i
            while j + 1 < len(frames) and frames[j + 1] == frames[j] + 1 and seq[frames[j + 1]][8] < READ_MIN_CONF:
                j += 1
            run = frames[i : j + 1]
            before, after = seq.get(frames[i] - 1), seq.get(frames[j] + 1)
            if before and after and len(run) <= max_len and before[8] >= READ_MIN_CONF and after[8] >= READ_MIN_CONF:
                a, b = (before[4], before[5]), (after[4], after[5])
                ride = any(_tp_linked((seq[p][4], seq[p][5]), (seq[q][4], seq[q][5])) for p, q in zip([frames[i] - 1] + run, run + [frames[j] + 1]) if p in seq and q in seq)
                if not ride and math.hypot(a[0] - b[0], a[1] - b[1]) <= EXC_RETURN and max(math.hypot(seq[k][4] - a[0], seq[k][5] - a[1]) for k in run) >= EXC_DEVIATION:
                    for n, k in enumerate(run):
                        f = (n + 1) / (len(run) + 1)
                        r = rows[(k, slot)]
                        rows[(k, slot)] = r[:4] + (round(a[0] + (b[0] - a[0]) * f, 4), round(a[1] + (b[1] - a[1]) * f, 4)) + r[6:]
                    fixed += 1
            i = j + 1
    return fixed


SPIKE_MIN = 0.02  # un écart à la droite entre les deux images voisines au moins égal à cela (relatif à la minimap)...
SPIKE_SHARE = 0.5  # ...et supérieur à cette part de la distance entre ces voisines est une pointe


def despike(rows):
    """Une position peu sûre isolée qui s'écarte de la droite entre ses deux images voisines (une pastille récupérée à côté de la bonne : le 9 qui revient de 0,03 en
    arrière à 5:09) est une pointe : elle prend le milieu de ses voisines. Les lectures sûres ne sont jamais modifiées."""
    fixed = 0
    snap = {key: (r[4], r[5]) for key, r in rows.items() if r[7]}
    for (k, slot), r in list(rows.items()):
        if not r[7] or r[8] >= READ_MIN_CONF:
            continue
        a, b = snap.get((k - 1, slot)), snap.get((k + 1, slot))
        if a is None or b is None:
            continue
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        dev = math.hypot(r[4] - mid[0], r[5] - mid[1])
        if dev > SPIKE_MIN and dev > SPIKE_SHARE * math.hypot(a[0] - b[0], a[1] - b[1]) and not _tp_linked(a, (r[4], r[5])):
            rows[(k, slot)] = r[:4] + (round(mid[0], 4), round(mid[1], 4)) + r[6:]
            fixed += 1
    return fixed


SMOOTH_FRAMES = 3  # images de chaque côté dont la médiane remplace une position non sûre
SMOOTH_MAX_MOVE = 0.08  # on ne déplace pas une position de plus que cela (un vrai déplacement n'est pas lissé)


def smooth_unsure(rows):
    """Positions non sûres (trous comblés, pastilles récupérées) : médiane des positions voisines du même joueur (lectures sûres comprises). Un joueur qui ne
    bouge pas ne « téléporte » plus d'un point à l'autre autour de son point fixe ; les lectures sûres ne sont jamais modifiées."""
    snapshot = {key: (r[4], r[5]) for key, r in rows.items() if r[7]}
    for (k, slot), r in list(rows.items()):
        if not r[7] or r[8] >= READ_MIN_CONF:
            continue
        around = [snapshot[(k + j, slot)] for j in range(-SMOOTH_FRAMES, SMOOTH_FRAMES + 1) if (k + j, slot) in snapshot and math.hypot(snapshot[(k + j, slot)][0] - r[4], snapshot[(k + j, slot)][1] - r[5]) <= 2 * SMOOTH_MAX_MOVE]
        if len(around) < 3:
            continue
        mx = sorted(p[0] for p in around)[len(around) // 2]
        my = sorted(p[1] for p in around)[len(around) // 2]
        if math.hypot(mx - r[4], my - r[5]) <= SMOOTH_MAX_MOVE:
            rows[(k, slot)] = r[:4] + (round(mx, 4), round(my, 4)) + r[6:]


MIN_SEPARATION = 0.035  # deux joueurs ne se superposent pas complètement : deux joueurs lus avec certitude ne sont jamais plus proches que 0,04 (0,1 % des cas)


def separate_players(rows):
    """Deux joueurs vivants ne peuvent pas occuper le même point. Le moins sûr des deux est écarté de MIN_SEPARATION, dans une direction propre à son joueur (stable
    d'une image à l'autre, donc sans clignotement) et praticable si la carte des passages est connue. Les lectures sûres ne sont jamais déplacées."""
    by_frame = {}
    for (k, slot), r in rows.items():
        if r[7]:
            by_frame.setdefault(k, []).append(slot)
    moved = 0
    for k, slots in sorted(by_frame.items()):
        if len(slots) < 2:
            continue
        for _ in range(3):  # trois joueurs superposés : plusieurs passes
            changed = False
            for i in range(len(slots)):
                for j in range(i + 1, len(slots)):
                    a, b = rows[(k, slots[i])], rows[(k, slots[j])]
                    d = math.hypot(a[4] - b[4], a[5] - b[5])
                    if d >= MIN_SEPARATION - 0.001:  # tolérance : les positions sont arrondies à 4 décimales
                        continue
                    # le moins sûr bouge ; à confiance égale, le joueur de plus grand numéro
                    mover, other = (b, a) if (b[8], -b[2]) < (a[8], -a[2]) else (a, b)
                    if mover[8] >= READ_MIN_CONF and other[8] >= READ_MIN_CONF:
                        continue  # deux lectures sûres : ce sont des mesures, on n'y touche pas
                    # parmi les points à MIN_SEPARATION de l'autre joueur, le plus proche de la position du même joueur à l'image d'avant (sinon de la sienne) :
                    # pas de saut d'un côté à l'autre quand ils se frôlent
                    prev = rows.get((k - 1, mover[2]))
                    ref = (prev[4], prev[5]) if prev is not None and prev[7] else (mover[4], mover[5])
                    best = None
                    others = [(rows[(k, o)][4], rows[(k, o)][5]) for o in slots if o != mover[2]]
                    # point à MIN_SEPARATION (puis plus loin) de l'autre joueur ET d'aucun troisième : une zone de départ à 4 joueurs ne se débrouille pas avec un seul voisin
                    for factor in (1.0, 1.5, 2.0):
                        for strict in (True, False):  # d'abord un point praticable ; sinon (zone de départ hors du masque) n'importe quel point de la minimap
                            for n in range(16):
                                ang = n * math.pi / 8
                                cx, cy = other[4] + factor * MIN_SEPARATION * math.cos(ang), other[5] + factor * MIN_SEPARATION * math.sin(ang)
                                if not (0 <= cx <= 1 and 0 <= cy <= 1) or (strict and not on_walkable((cx, cy))):
                                    continue
                                if any(math.hypot(cx - ox, cy - oy) < MIN_SEPARATION - 0.001 for ox, oy in others):
                                    continue
                                dist = math.hypot(cx - ref[0], cy - ref[1])
                                if best is None or dist < best[0]:
                                    best = (dist, cx, cy)
                            if best is not None:
                                break
                        if best is not None:
                            break
                    if best is None:
                        continue
                    nx, ny = best[1], best[2]
                    rows[(k, mover[2])] = mover[:4] + (round(nx, 4), round(ny, 4)) + mover[6:]
                    moved += 1
                    changed = True
            if not changed:
                break
    return moved


# ---------- réglages ----------
# Les valeurs ci-dessus sont les réglages d'origine. tracking_params.json (dans le dépôt) contient les meilleurs trouvés par
# tune.py : ils sont chargés à l'import, donc retrouvés tels quels sur un autre PC.
PARAMS_PATH = Path(__file__).with_name("tracking_params.json")
TUNABLE = (
    "GATE_BASE", "GATE_SPEED", "MAX_MISS_S", "ASSIGN_GAP_S", "ASSIGN_GAP_DIST",
    "X_LINK_S", "X_LINK_DIST", "SMOOTH_S", "VOTE_MISMATCH", "SKEW_FULL", "FLIP_COST", "MOVE_WEIGHT",
)


def current_params():
    return {name: globals()[name] for name in TUNABLE}


def configure(params):
    """Applique des réglages (les noms inconnus sont ignorés)."""
    for name, value in params.items():
        if name in TUNABLE:
            globals()[name] = float(value)


ALGO_REVISION = 34  # à incrémenter quand l'algorithme change : les positions déjà lues sont alors relues
PARAMS_VERSION = ALGO_REVISION  # version des réglages sauvegardés + révision de l'algorithme


def _load_saved():
    global PARAMS_VERSION
    if PARAMS_PATH.exists():
        try:
            saved = json.loads(PARAMS_PATH.read_text(encoding="utf-8"))
            configure(saved.get("params", {}))
            PARAMS_VERSION = int(saved.get("version", 0)) + ALGO_REVISION
        except (OSError, ValueError):
            pass  # fichier illisible : réglages d'origine


_load_saved()
