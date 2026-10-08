"""Suivi des joueurs sur toute une game : les pastilles lues image par image deviennent des trajectoires cohérentes.

Lire chaque image isolément se trompe (numéro illisible, pastilles qui se croisent ou se cachent). On travaille donc sur
l'ensemble de la game :
  1. les pastilles sont reliées d'une image à l'autre par proximité, en trajectoires (un joueur bouge peu entre deux lectures) ;
  2. chaque trajectoire reçoit un joueur par vote de tous ses numéros lus, sans que deux trajectoires qui se chevauchent
     dans le temps aient le même joueur ; sans numéro, on prend le joueur libre qui prolonge le mieux une autre trajectoire ;
  3. une croix (joueur mort) est rattachée au joueur dont la trajectoire s'est arrêtée à cet endroit juste avant ;
  4. les petits trous sont comblés par interpolation et les directions lissées (médiane circulaire).
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
            self.votes[slot] += 1

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


def _best_matching(costs, n_dets):
    """costs[i][j] : coût de relier la trajectoire i à la détection j (None = interdit). Maximise le nombre de liaisons,
    puis minimise le coût total. Petits effectifs (≤ 4 trajectoires) : recherche exhaustive."""
    best = (0.0, [])
    n = len(costs)

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


def _link(frames, step_s):
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
                    if dist > gate:
                        row.append(None)
                        continue
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
                if j not in taken:
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
                else:
                    dead_tracks.append(Track(team, fi, d, dead=True))
    return alive_tracks, dead_tracks


def _overlap(a, b, slack=0):
    return a.first <= b.last + slack and b.first <= a.last + slack


def _gap_cost(a, b, step_s, max_gap=None, max_dist=None):
    """Coût pour que b prolonge a (b commence après la fin de a), None si invraisemblable."""
    max_gap = ASSIGN_GAP_S if max_gap is None else max_gap
    max_dist = ASSIGN_GAP_DIST if max_dist is None else max_dist
    gap = (b.first - a.last) * step_s
    if gap < 0 or gap > max_gap:
        return None
    dist = math.hypot(a.pos[0] - b.pts[b.first]["x"], a.pos[1] - b.pts[b.first]["y"])
    if dist > min(GATE_BASE + GATE_SPEED * max(gap, step_s) * 1.6, max_dist):
        return None
    return dist + 0.01 * gap


def _assign(alive_tracks, step_s):
    """Étape 2 : un joueur par trajectoire."""
    for team in ("A", "B"):
        tracks = [t for t in alive_tracks if t.team == team]
        slots = SLOTS[team]
        assigned = {s: [] for s in slots}

        def free(t, s):
            return not any(_overlap(t, o) for o in assigned[s])

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
                if not cands:
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
                elif len(cands) == 1:
                    t.slot, t.how = cands[0], CONF_ELIM
                else:
                    continue
                assigned[t.slot].append(t)
                pending.remove(t)
                progress = True
                break


def _attach_crosses(dead_tracks, alive_tracks, step_s):
    """Étape 3 : chaque croix revient au joueur dont la trajectoire s'est arrêtée là juste avant."""
    link = max(1, round(X_LINK_S / step_s))
    kept = []
    for x in dead_tracks:
        x_pos = (x.pts[x.first]["x"], x.pts[x.first]["y"])
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


SKEW_FULL = 0.25  # asymétrie à partir de laquelle le sens est considéré comme sûr
FLIP_COST = 2.5  # coût d'un retournement de sens entre deux lectures successives


def _angdist(a, b):
    return abs((a - b + 180) % 360 - 180)


def _choose_directions(obs):
    """obs : {indice: (axe, asymétrie)} -> {indice: angle}. Programmation dynamique sur le sens (axe ou axe + 180) :
    chaque lecture « vote » pour le sens de son asymétrie, proportionnellement à sa netteté, et un retournement d'une
    lecture à l'autre coûte cher. Un sens isolé et douteux est donc corrigé, un vrai demi-tour soutenu est conservé."""
    keys = sorted(k for k, v in obs.items() if v[0] is not None)
    if not keys:
        return {}
    ang = {k: (obs[k][0], (obs[k][0] + 180) % 360) for k in keys}

    def unary(k, c):
        axis, skew = obs[k]
        w = min(1.0, abs(skew) / SKEW_FULL)
        prefers = 0 if skew >= 0 else 1
        return 0.0 if c == prefers else w

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


def solve(frames, step_s):
    """frames : [(indice, t, [détections])]. Renvoie les lignes (frame, t, slot, team, x, y, angle, alive, confiance)."""
    if not frames:
        return []
    times = {fi: t for fi, t, _ in frames}
    alive_tracks, dead_tracks = _link(frames, step_s)
    alive_tracks = [t for t in alive_tracks if len(t.pts) >= 2 or t.votes]  # une pastille vue une fois sans numéro : bruit
    _assign(alive_tracks, step_s)
    placed = [t for t in alive_tracks if t.slot is not None]
    crosses = _attach_crosses([t for t in dead_tracks if len(t.pts) >= 2], placed, step_s)

    half = max(1, round(SMOOTH_S / step_s / 2))
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
                for k in range(a + 1, b):
                    r = (k - a) / (b - a)
                    pa, pb = t.pts[a], t.pts[b]
                    filled[k] = (pa["x"] + (pb["x"] - pa["x"]) * r, pa["y"] + (pb["y"] - pa["y"]) * r)
            obs = {}
            for k in idx:
                d = t.pts[k]
                if d.get("axis") is not None:
                    obs[k] = (d["axis"], d.get("skew") or 0.0)
                elif d.get("angle") is not None:  # détection sans asymétrie connue : on retient le sens donné
                    obs[k] = (d["angle"] % 180, 1.0 if d["angle"] < 180 else -1.0)
            chosen = _choose_directions(obs)
            smooth = _smooth_angles({k: chosen.get(k) for k in idx}, half)
            for k in idx:
                d = t.pts[k]
                conf = t.how if d.get("slot") != t.slot else CONF_VOTE
                put(k, slot, t.team, d["x"], d["y"], smooth[k], True, conf)
            for k, (x, y) in filled.items():
                put(k, slot, t.team, x, y, None, True, CONF_FILL)
        # trous entre deux trajectoires du même joueur (disparition plus longue, même sans réapparition lointaine)
        for a, b in zip(tracks, tracks[1:]):
            if _gap_cost(a, b, step_s, FILL_MAX_S, FILL_MAX_DIST) is None:
                continue
            ia, ib = a.last, b.first
            pa, pb = a.pts[ia], b.pts[ib]
            for k in range(ia + 1, ib):
                r = (k - ia) / (ib - ia)
                if (k, slot) not in rows:
                    put(k, slot, a.team, pa["x"] + (pb["x"] - pa["x"]) * r, pa["y"] + (pb["y"] - pa["y"]) * r, None, True, CONF_FILL)
    for x in crosses:
        for k, d in x.pts.items():
            if (k, x.slot) not in rows:
                put(k, x.slot, x.team, d["x"], d["y"], None, False, x.how)
    return sorted(rows.values(), key=lambda r: (r[0], r[2]))


# ---------- réglages ----------
# Les valeurs ci-dessus sont les réglages d'origine. tracking_params.json (dans le dépôt) contient les meilleurs trouvés par
# tune.py : ils sont chargés à l'import, donc retrouvés tels quels sur un autre PC.
PARAMS_PATH = Path(__file__).with_name("tracking_params.json")
TUNABLE = (
    "GATE_BASE", "GATE_SPEED", "MAX_MISS_S", "ASSIGN_GAP_S", "ASSIGN_GAP_DIST",
    "X_LINK_S", "X_LINK_DIST", "SMOOTH_S", "VOTE_MISMATCH", "SKEW_FULL", "FLIP_COST",
)


def current_params():
    return {name: globals()[name] for name in TUNABLE}


def configure(params):
    """Applique des réglages (les noms inconnus sont ignorés)."""
    for name, value in params.items():
        if name in TUNABLE:
            globals()[name] = float(value)


PARAMS_VERSION = 0  # version des réglages sauvegardés (0 : réglages d'origine)


def _load_saved():
    global PARAMS_VERSION
    if PARAMS_PATH.exists():
        try:
            saved = json.loads(PARAMS_PATH.read_text(encoding="utf-8"))
            configure(saved.get("params", {}))
            PARAMS_VERSION = int(saved.get("version", 0))
        except (OSError, ValueError):
            pass  # fichier illisible : réglages d'origine


_load_saved()
