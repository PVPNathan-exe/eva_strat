"""Note d'un joueur sur une game, sur 20 (table `player_ratings`, module `player_ratings`, REVISION 1) : `python analysis/player_ratings.py --game N [--db chemin] [--measure]`, `--calibrate` refait l'échelle.

Demande de l'utilisateur du 17 octobre 2026 : la note devient une note SUR 20, moyenne de deux sous-notes sur 20 (poids égaux, `SUBNOTE_WEIGHTS`) :
- **individuelle** : kills, morts et assistances du joueur (valeurs propres, par minute de game), plus la qualité de ses kills et de ses morts (`kill_scores`) ;
- **teamplay** : kills, morts et assistances comparés au total de son équipe, présence sur la map, prise d'espace, prise de fight (2 mesures), prise d'aggro, et autres stats collectives (point actif, trades,
  cohésion, usage du secondaire).
TOUT est une CONVENTION sans vérité terrain : seule la conversion en points vient d'une mesure (voir l'échelle).

**Échelle** (`player_ratings_scale.json`, écrite par `--calibrate` sur toutes les games qui ont des positions) : pour chaque composante, 5e centile, médiane et 95e centile des valeurs brutes de la base ;
note = 10 à la médiane, 0 au 5e centile, 20 au 95e, linéaire par morceaux, plafonnée à [0, 20] ; composante « moins c'est mieux » (morts, cohésion) : note = 20 moins la note. Une composante sans valeur d'échelle
est absente (jamais 0). Quand la base change beaucoup, refaire `--calibrate` puis recalculer. Une sous-note exige au moins `MIN_COVERAGE` du poids total de ses composantes : sinon NULL (« n/d »), avec la raison.
La note globale est NULL si une des deux sous-notes l'est (pas de moyenne partielle). Les composantes sans donnée pour la game sont ignorées de la moyenne pondérée et listées dans `data` avec leur raison.

**Assistance** (`assist_source` de `data`) :
- **tableau de fin de game** quand la table `scoreboard` existe et donne un nombre d'assistances à TOUS les joueurs notés de la game (le jeu affiche les vraies valeurs) ; sinon
- **repli mesuré** : pour chaque kill d'un joueur (mort de `lives` avec tueur adverse), tout coéquipier du tueur (autre que lui) vivant à moins de `ASSIST_R_M` (3 m) de la victime à l'un des instants (pas de
  0,5 s) des `ASSIST_WINDOW_S` (4,6 s : délai de régénération de `regen.py`, un dégât plus ancien est soigné) qui précèdent la mort. Distances mesurées sur 661 kills de 12 games : tueur-victime 2,9 m (25e centile),
  4,9 m (médiane), 8,3 m (75e), et aucune cassure dans celle des coéquipiers au lieu de la mort : le rayon est une convention. 3 m (le 25e centile) plutôt que 5 m (la médiane) parce que les seules valeurs connues du
  jeu (game 26 : GLENS 1 assistance, TAKAA 3) sont de 6 et 7 à 5 m, de 2 et 2 à 3 m : réglage sur DEUX valeurs, donc un biais de sélection, à remplacer par le tableau. Un kill peut avoir plusieurs assistants.
  Ni les dégâts ni le regard ne sont lus (les points de vie des bandeaux n'existent que dans le cache de quelques games : non comparable d'une game à l'autre).
L'échelle des assistances est tenue PAR SOURCE (clés `assists:repli` et `assists:tableau`) : une game dont la source n'a pas d'échelle n'a pas de note d'assistances.

**Composantes** (valeur brute) :
- individuelle : `kills_per_min`, `deaths_per_min` (moins c'est mieux), `assists_per_min` (par minute de game) ; `kill_quality` (note moyenne de ses kills) ; `death_quality` (note moyenne de ses morts, `death_impact`).
- teamplay : `share_kills`, `share_deaths` (moins c'est mieux), `share_assists` (part du total de l'équipe) ; `presence` (part de la game vivant et hors de sa zone de départ) ; `objective` (part du temps vivant
  hors départ à moins de `kill_series.NEAR_M` du point actif, ou des points de la carte sans calendrier) ; `space` (prise d'espace : position moyenne sur l'axe entre le départ de son équipe (0) et celui de
  l'adversaire (1), temps vivant hors départ, comme `waves.axis_frac` ; NULL sur Outlaw dont les départs sont neutres) ; `fight_front` (prise de fight 1 : part des combats de son équipe où il est le plus proche
  d'un ennemi à l'instant du premier kill) ; `fight_first_kill` (prise de fight 2 : part des combats de la game ouverts par son kill, un combat = une série de `kill_series`) ; `aggro` (prise d'aggro : secondes par minute
  de game où 1 ou 2 ennemis vivants à moins de `AGGRO_R_M` se rapprochent de lui d'au moins `AGGRO_CLOSING_M` en `AGGRO_DT_S` alors qu'aucun coéquipier n'est à moins de `HELP_R` d'eux, secondes comptées en entier si
  le joueur survit 3 s ou est vengé (échange, revenge de `kill_links`), au facteur `AGGRO_DEATH_FACTOR` sinon) ; `trades` (revenges faits sur les morts de ses coéquipiers, divisés par leurs morts) ;
  `cohesion` (distance moyenne au coéquipier vivant le plus proche, moins c'est mieux) ; `gadget` (secondaires utilisés sur possibles, plafonné à 1, seulement si `gadget_possible` est établi).
**Regard exclu** : « joueur ennemi te regardant » n'est pas implanté (décision de l'utilisateur) : `AGGRO_USES_GAZE` reste faux, aucun regard n'est lu. Le temps est en secondes depuis le début de la game.
Contrat commun : `compute(conn, game_id) -> int` (idempotent, lignes écrites), `stats_meta`."""

import argparse
import json
import statistics
import sys
from pathlib import Path

import episode_common as ec
import kill_series
import waves as waves_mod

MODULE = "player_ratings"
REVISION = 1
SCALE_FILE = Path(__file__).with_name("player_ratings_scale.json")
STEP_S = 0.5  # pas d'échantillonnage des positions
SUBNOTE_WEIGHTS = {"individual": 1.0, "teamplay": 1.0}  # poids égaux de la note globale
MIN_COVERAGE = 0.5  # part minimale du poids total d'une sous-note qui doit avoir une valeur
SCALE_LOW, SCALE_HIGH = 5, 95  # centiles qui valent 0 et 20 ; la médiane vaut 10
NOT_KILLS = ("suicide", "environment")

# Assistance (repli)
ASSIST_R_M = 3.0
ASSIST_WINDOW_S = 4.6  # = regen.REGEN_DELAY_S
# Fight
FRONT_MAX_M = 16.0  # le plus avancé n'est retenu que s'il est à 16 m au plus d'un ennemi (95e centile de la distance tueur-victime)
FRONT_LEAD_S = 0.5  # positions lues 0,5 s avant le premier kill de la série
# Aggro
AGGRO_USES_GAZE = False  # décision de l'utilisateur : le regard de l'ennemi n'est PAS utilisé
AGGRO_R_M = 10.0  # un ennemi à moins de 10 m (kill_series.HELP_R) peut pousser le joueur
AGGRO_CLOSING_M = 0.5  # il se rapproche d'au moins 0,5 m en AGGRO_DT_S (la marche fait 1,3 m/s)
AGGRO_DT_S = 1.0
AGGRO_MAX_ENEMIES = 2  # « te pushant à 1 ou 2 »
AGGRO_AFTER_S = 3.0  # le joueur survit si sa mort tombe plus de 3 s après la fin de l'épisode
AGGRO_DEATH_FACTOR = 0.5  # épisode suivi d'une mort non vengée : demi-crédit
AGGRO_GAP_S = 1.0  # deux instants d'aggro séparés de moins de 1 s sont le même épisode
AVENGE_S = 1.5  # une mort vengée : lien de kill_links à 1,5 s de la mort

# (nom, groupe, poids, « moins c'est mieux », libellé)
COMPONENTS = [
    ("kills_per_min", "individual", 3, False, "Kills par minute"),
    ("deaths_per_min", "individual", 3, True, "Morts par minute"),
    ("assists_per_min", "individual", 2, False, "Assistances par minute"),
    ("kill_quality", "individual", 1, False, "Qualité des kills (note moyenne)"),
    ("death_quality", "individual", 1, False, "Qualité des morts (note moyenne)"),
    ("share_kills", "teamplay", 2, False, "Part des kills de l'équipe"),
    ("share_deaths", "teamplay", 2, True, "Part des morts de l'équipe"),
    ("share_assists", "teamplay", 1, False, "Part des assistances de l'équipe"),
    ("presence", "teamplay", 2, False, "Présence sur la map (vivant, hors départ)"),
    ("objective", "teamplay", 1, False, "Temps près du point actif"),
    ("space", "teamplay", 1, False, "Prise d'espace (position sur l'axe des départs)"),
    ("fight_front", "teamplay", 1, False, "Prise de fight : le plus avancé au contact"),
    ("fight_first_kill", "teamplay", 1, False, "Prise de fight : premier kill du combat"),
    ("aggro", "teamplay", 2, False, "Prise d'aggro (1 ou 2 ennemis attirés)"),
    ("trades", "teamplay", 1, False, "Trades : coéquipiers vengés"),
    ("cohesion", "teamplay", 1, True, "Cohésion (distance au coéquipier le plus proche)"),
    ("gadget", "teamplay", 1, False, "Secondaires utilisés sur possibles"),
]
SPEC = {c[0]: c for c in COMPONENTS}
SOURCED = ("assists_per_min", "share_assists")  # échelle tenue par source d'assistances


def scale_key(name, source):
    return f"{name}:{source}" if name in SOURCED else name


# ---------------------------------------------------------------- échelle et notes

def load_scale(path=None):
    """Échelle {clé: {p05, p50, p95, n}} du fichier, {} s'il manque."""
    p = Path(path or SCALE_FILE)
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8")).get("components", {})


def note_of(v, sc, down=False):
    """Note de 0 à 20 d'une valeur brute : 10 à la médiane, 0 au 5e centile, 20 au 95e (linéaire par morceaux, plafonnée) ; `down` : moins c'est mieux. Sans étendue de part et d'autre
    de la médiane (valeurs en grande partie égales), une valeur égale à la médiane vaut 10, une valeur au-delà 0 ou 20."""
    lo, mid, hi = sc["p05"], sc["p50"], sc["p95"]
    if v <= mid:
        n = 10.0 * (v - lo) / (mid - lo) if mid > lo else (10.0 if v == mid else 0.0)
    else:
        n = 10.0 + 10.0 * (v - mid) / (hi - mid) if hi > mid else 20.0
    n = max(0.0, min(20.0, n))
    return 20.0 - n if down else n


def rate_group(group, raws, scale, source):
    """({nom: détail}, note sur 20 ou None, raison si None) d'un groupe. Détail : label, raw, note, weight, et reason quand la valeur ou l'échelle manque."""
    detail, num, den, total = {}, 0.0, 0.0, 0.0
    for name, grp, weight, down, label in COMPONENTS:
        if grp != group:
            continue
        total += weight
        raw = raws.get(name)
        item = {"label": label, "weight": weight, "down": down, "raw": None, "note": None}
        if isinstance(raw, tuple):  # (None, raison)
            item["reason"] = raw[1]
        elif raw is None:
            item["reason"] = "donnée absente"
        else:
            item["raw"] = round(raw, 4)
            sc = scale.get(scale_key(name, source))
            if sc is None:
                item["reason"] = f"échelle absente pour {scale_key(name, source)} (relancer --calibrate)"
            else:
                item["note"] = round(note_of(raw, sc, down), 2)
                num += weight * item["note"]
                den += weight
        detail[name] = item
    if total == 0 or den / total < MIN_COVERAGE:
        return detail, None, f"composantes disponibles : {round(100 * den / total) if total else 0} % du poids (minimum {round(100 * MIN_COVERAGE)} %)"
    return detail, round(num / den, 2), None


def overall_of(individual, teamplay):
    """Note globale : moyenne pondérée des deux sous-notes, None si l'une manque."""
    if individual is None or teamplay is None:
        return None
    w = SUBNOTE_WEIGHTS
    return round((w["individual"] * individual + w["teamplay"] * teamplay) / (w["individual"] + w["teamplay"]), 2)


# ---------------------------------------------------------------- positions sur une grille de temps

class Grid:
    """Vivant et position de chaque joueur toutes les STEP_S secondes (la position est celle de la ligne vivante la plus proche, à 1,5 s au plus)."""

    def __init__(self, game):
        self.n = int(game["duration"] / STEP_S) + 1
        self.alive = {s: [False] * self.n for s in range(1, 9)}
        self.pos = {s: [None] * self.n for s in range(1, 9)}
        for s in range(1, 9):
            for i in range(self.n):
                t = i * STEP_S
                if ec.alive_at(game, s, t):
                    self.alive[s][i] = True
                    self.pos[s][i] = ec.pos_at(game, s, t)

    def index(self, t):
        return max(0, min(self.n - 1, int(round(t / STEP_S))))

    def has(self, s, i):
        return self.alive[s][i] and self.pos[s][i] is not None


# ---------------------------------------------------------------- morts, assistances

def death_events(conn, game_id, game):
    """Morts avec un tueur adverse : [{t, victim, killer, pos}], lues dans la table `lives` (les mêmes événements que player_game_stats.kills_deaths : ni suicide ni décor), sinon dans les vies en mémoire."""
    rows = [tuple(r) for r in conn.execute("SELECT slot, t1, x1, y1, killer_slot, kill_kind FROM lives WHERE game_id = ? AND ended = 'death'", (game_id,))]
    if not rows:
        rows = [(s, v["t1"], v.get("x1"), v.get("y1"), v.get("killer_slot"), None) for s in range(1, 9) for v in game["lives"].get(s, []) if v["ended"] == "death"]
    out = []
    for slot, t1, x1, y1, k, kind in rows:
        if not k or k == slot or ec.team_of(k) == ec.team_of(slot) or kind in NOT_KILLS:
            continue
        out.append({"t": t1, "victim": slot, "killer": k, "pos": (x1, y1) if x1 is not None else None})
    return sorted(out, key=lambda e: e["t"])


def kills_deaths(conn, game_id, events):
    """({slot: kills}, {slot: morts}) : mêmes comptes que player_game_stats.kills_deaths (une mort = une vie `ended = death`, un kill = une de ces morts avec un tueur adverse, ni suicide ni décor)."""
    deaths = {}
    for (slot,) in conn.execute("SELECT slot FROM lives WHERE game_id = ? AND ended = 'death'", (game_id,)):
        deaths[slot] = deaths.get(slot, 0) + 1
    kills = {}
    for e in events:
        kills[e["killer"]] = kills.get(e["killer"], 0) + 1
    return kills, deaths


def assist_fallback(game, grid, events):
    """({slot: assistances}, nombre de kills avec au moins une assistance) : définition mesurée du repli (voir l'en-tête)."""
    count = {s: 0 for s in range(1, 9)}
    with_assist = 0
    for e in events:
        i1 = grid.index(e["t"])
        i0 = grid.index(e["t"] - ASSIST_WINDOW_S)
        helpers = set()
        for m in ec.team_slots(ec.team_of(e["killer"])):
            if m == e["killer"]:
                continue
            for i in range(i0, i1 + 1):
                if not grid.has(m, i):
                    continue
                vp = grid.pos[e["victim"]][i] if grid.has(e["victim"], i) else e["pos"]
                d = ec.dist_m(grid.pos[m][i], vp)
                if d is not None and d <= ASSIST_R_M:
                    helpers.add(m)
                    break
        for m in helpers:
            count[m] += 1
        with_assist += bool(helpers)
    return count, with_assist


def scoreboard_assists(conn, game_id, slots):
    """{slot: assistances} du tableau de fin de game si la table `scoreboard` existe et donne une valeur à TOUS les joueurs `slots`, sinon None (table absente, vide ou partielle)."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'scoreboard'").fetchone():
        return None
    try:
        rows = {r[0]: r[1] for r in conn.execute("SELECT slot, assists FROM scoreboard WHERE game_id = ? AND assists IS NOT NULL", (game_id,))}
    except Exception:  # noqa: BLE001 - table d'une autre forme : on retombe sur le repli
        return None
    return {s: rows[s] for s in slots} if slots and all(s in rows for s in slots) else None


# ---------------------------------------------------------------- composantes collectives

def spawn_info(game):
    """({équipe: zones de départ}, axe) ; axe = (centre du départ A, centre du départ B) ou None (départs neutres d'Outlaw, aucun départ connu)."""
    spawns = waves_mod.spawn_rects(game["map"])
    if not spawns or spawns.get("A") == spawns.get("B"):
        return spawns, None
    a, b = kill_series.team_spawn_centre(game, "A"), kill_series.team_spawn_centre(game, "B")
    return spawns, (None if a is None or b is None else (a, b))


def in_play(game, grid, spawns):
    """{slot: [vrai à chaque pas où le joueur est vivant, positionné et hors de sa zone de départ]}."""
    out = {}
    for s in range(1, 9):
        rects = spawns.get(ec.team_of(s), [])
        out[s] = [grid.has(s, i) and not any(waves_mod._in_rect(r, grid.pos[s][i], waves_mod.SPAWN_MARGIN_M) for r in rects) for i in range(grid.n)]
    return out


def axis_fraction(p, own, enemy):
    """Fraction du trajet entre le départ du joueur (0) et celui de l'adversaire (1) où se trouve p, bornée à [0, 1] ; None si les deux départs sont confondus."""
    ux, uy = (enemy[0] - own[0]) * ec.ARENA_M[0], (enemy[1] - own[1]) * ec.ARENA_M[1]
    n2 = ux * ux + uy * uy
    if n2 < 1e-9:
        return None
    f = ((p[0] - own[0]) * ec.ARENA_M[0] * ux + (p[1] - own[1]) * ec.ARENA_M[1] * uy) / n2
    return max(0.0, min(1.0, f))


def objective_rects(game, t):
    """Cadres des points à l'instant t : point actif du calendrier s'il existe, sinon les points de la carte (instances), [] sans point connu."""
    if game["schedule"]:
        return [s["rect"] for s in game["schedule"] if s["t0"] <= t < s["t1"]]
    return [i["rect"] for i in game["instances"] if i["t0"] <= t <= i["t1"]]


def presence_values(game, grid, playing, axis):
    """{slot: {presence, objective, space, cohesion}} (None quand la mesure est impossible, avec une raison dans `why`)."""
    n = grid.n
    has_objective = bool(game["schedule"] or game["instances"])
    out = {}
    for s in range(1, 9):
        team, own, enemy = ec.team_of(s), None, None
        if axis is not None:
            own, enemy = (axis[0], axis[1]) if team == "A" else (axis[1], axis[0])
        play = [i for i in range(n) if playing[s][i]]
        near = 0
        coh = []
        fr = []
        for i in play:
            t = i * STEP_S
            if has_objective:
                rects = objective_rects(game, t)
                near += any((d := ec.dist_rect_m(grid.pos[s][i], r)) is not None and d <= kill_series.NEAR_M for r in rects)
            if axis is not None:
                f = axis_fraction(grid.pos[s][i], own, enemy)
                if f is not None:
                    fr.append(f)
            ds = [d for m in ec.team_slots(team) if m != s and grid.has(m, i) and (d := ec.dist_m(grid.pos[s][i], grid.pos[m][i])) is not None]
            if ds:
                coh.append(min(ds))
        out[s] = {
            "presence": len(play) / n,
            "objective": (near / len(play) if play else None) if has_objective else (None, "aucun point de capture connu pour cette carte"),
            "space": (sum(fr) / len(fr) if fr else None) if axis is not None else (None, "départs neutres ou inconnus : pas d'axe entre les deux spawns"),
            "cohesion": sum(coh) / len(coh) if coh else None,
        }
    return out


# ---------------------------------------------------------------- prise de fight

def fights(game):
    """Séries de kills de la game : [(indice du premier kill, indice du dernier)] (kill_series.chain_end)."""
    out, i, kills = [], 0, game["kills"]
    while i < len(kills):
        j = kill_series.chain_end(kills, i)
        out.append((i, j))
        i = j + 1
    return out


def fight_values(game, grid):
    """{slot: {fight_front, fight_first_kill}} : part des combats où le joueur est le plus proche d'un ennemi à son équipe (parmi les combats où son équipe a un tel joueur) et part des combats ouverts par son kill."""
    kills, series = game["kills"], fights(game)
    front = {s: 0 for s in range(1, 9)}
    front_den = {"A": 0, "B": 0}
    first = {s: 0 for s in range(1, 9)}
    for i0, _i1 in series:
        t, killer = kills[i0][0], kills[i0][1]
        first[killer] += 1
        i = grid.index(t - FRONT_LEAD_S)
        for team in ec.TEAMS:
            enemies = [m for m in ec.team_slots(ec.other_team(team)) if grid.has(m, i)]
            best = None
            for s in ec.team_slots(team):
                if not grid.has(s, i):
                    continue
                d = min((ec.dist_m(grid.pos[s][i], grid.pos[m][i]) for m in enemies), default=None)
                if d is not None and d <= FRONT_MAX_M and (best is None or d < best[0]):
                    best = (d, s)
            if best is not None:
                front[best[1]] += 1
                front_den[team] += 1
    n = len(series)
    out = {}
    for s in range(1, 9):
        den = front_den[ec.team_of(s)]
        out[s] = {"fight_front": front[s] / den if den else (None, "aucun combat avec un joueur au contact"),
                  "fight_first_kill": first[s] / n if n else (None, "aucun kill dans la game")}
    return out


# ---------------------------------------------------------------- prise d'aggro

def _avenged(links, slot, t_death):
    """Vrai si la mort du joueur à t_death est un échange ou a été vengée (lignes de kill_links : (t, victim, kind, other, dt))."""
    for t, victim, kind, other, dt in links:
        if kind == "trade" and victim == slot and abs(t - t_death) <= AVENGE_S:
            return True
        if kind == "revenge" and other == slot and abs((t - (dt or 0.0)) - t_death) <= AVENGE_S:
            return True
    return False


def aggro_values(game, grid, links):
    """{slot: secondes d'aggro créditées}, une valeur par joueur (voir l'en-tête : 1 ou 2 ennemis attirés loin de ses coéquipiers, regard exclu)."""
    k = max(1, int(round(AGGRO_DT_S / STEP_S)))
    out = {}
    for s in range(1, 9):
        mates = [m for m in ec.team_slots(ec.team_of(s)) if m != s]
        enemies = list(ec.team_slots(ec.other_team(ec.team_of(s))))
        active = []
        for i in range(k, grid.n):
            if not (grid.has(s, i) and grid.has(s, i - k)):
                continue
            pulled = 0
            for e in enemies:
                if not (grid.has(e, i) and grid.has(e, i - k)):
                    continue
                d_now = ec.dist_m(grid.pos[s][i], grid.pos[e][i])
                d_before = ec.dist_m(grid.pos[s][i - k], grid.pos[e][i - k])
                if d_now is None or d_before is None or d_now > AGGRO_R_M or d_before - d_now < AGGRO_CLOSING_M:
                    continue
                if any(grid.has(m, i) and (dm := ec.dist_m(grid.pos[m][i], grid.pos[e][i])) is not None and dm <= kill_series.HELP_R for m in mates):
                    continue  # un coéquipier est aussi près de lui : il ne vient pas que sur ce joueur
                pulled += 1
            if 1 <= pulled <= AGGRO_MAX_ENEMIES:
                active.append(i)
        # épisodes, crédités selon le sort du joueur
        credit, j = 0.0, 0
        while j < len(active):
            a = b = active[j]
            while j + 1 < len(active) and (active[j + 1] - b) * STEP_S <= AGGRO_GAP_S:
                j += 1
                b = active[j]
            j += 1
            seconds = (b - a + 1) * STEP_S
            t_end = b * STEP_S
            death = ec.death_time(game, s, t_end, AGGRO_AFTER_S)
            factor = 1.0 if death is None or _avenged(links, s, death) else AGGRO_DEATH_FACTOR
            credit += seconds * factor
        out[s] = credit
    return out


# ---------------------------------------------------------------- valeurs brutes de la game

def read_links(conn, game_id):
    return [tuple(r) for r in conn.execute("SELECT t, victim_slot, kind, other_slot, dt FROM kill_links WHERE game_id = ?", (game_id,))]


def revenge_counts(game, links):
    """{slot: revenges faits} d'après les lignes `revenge` de kill_links (le tueur est retrouvé dans les kills du killfeed à 0,5 s près)."""
    made = {s: 0 for s in range(1, 9)}
    for t, victim, kind, _other, _dt in links:
        if kind != "revenge":
            continue
        killer = next((k[1] for k in game["kills"] if abs(k[0] - t) <= 0.5 and k[2] == victim), None)
        if killer is not None:
            made[killer] += 1
    return made


def raw_components(conn, game_id):
    """{slot: {"raw": {composante: valeur ou (None, raison)}, "assists": n, "assist_source", "meta": {...}}} d'une game, rien d'écrit. {} si la game n'a pas de position."""
    game = ec.load_game(conn, game_id)
    if game is None or not game["tracks"]:
        return {}
    slots = sorted(set(game["tracks"]) | set(game["lives"]))
    grid = Grid(game)
    events = death_events(conn, game_id, game)
    kills, deaths = kills_deaths(conn, game_id, events)
    fallback, kills_with_assist = assist_fallback(game, grid, events)
    board = scoreboard_assists(conn, game_id, slots)
    source = "tableau" if board is not None else "repli"
    assists = board if board is not None else {s: fallback.get(s, 0) for s in slots}
    spawns, axis = spawn_info(game)
    playing = in_play(game, grid, spawns)
    pres = presence_values(game, grid, playing, axis)
    fight = fight_values(game, grid)
    links = read_links(conn, game_id)
    aggro = aggro_values(game, grid, links)
    revenges = revenge_counts(game, links)
    minutes = game["duration"] / 60.0
    stats = {r[0]: r for r in conn.execute("SELECT slot, gadget_uses, gadget_possible FROM player_game_stats WHERE game_id = ?", (game_id,))}
    notes_k, notes_d = {}, {}
    for r in conn.execute("SELECT killer_slot, victim_slot, impact, death_impact FROM kill_scores WHERE game_id = ?", (game_id,)):
        if r[0] is not None:
            notes_k.setdefault(r[0], []).append(r[2])
        notes_d.setdefault(r[1], []).append(r[3] if r[3] is not None else -r[2])
    team_tot = {t: {"kills": sum(kills.get(s, 0) for s in ec.team_slots(t)), "deaths": sum(deaths.get(s, 0) for s in ec.team_slots(t)),
                    "assists": sum(assists.get(s, 0) for s in ec.team_slots(t) if s in assists)} for t in ec.TEAMS}
    out = {}
    for s in slots:
        team, tot = ec.team_of(s), team_tot[ec.team_of(s)]
        k, d, a = kills.get(s, 0), deaths.get(s, 0), assists.get(s, 0)
        mates_deaths = tot["deaths"] - d
        g = stats.get(s)
        raw = {
            "kills_per_min": k / minutes, "deaths_per_min": d / minutes, "assists_per_min": a / minutes,
            "kill_quality": statistics.fmean(notes_k[s]) if notes_k.get(s) else (None, "aucun kill noté"),
            "death_quality": statistics.fmean(notes_d[s]) if notes_d.get(s) else (None, "aucune mort notée"),
            "share_kills": k / tot["kills"] if tot["kills"] else (None, "équipe sans kill"),
            "share_deaths": d / tot["deaths"] if tot["deaths"] else (None, "équipe sans mort"),
            "share_assists": a / tot["assists"] if tot["assists"] else (None, "équipe sans assistance"),
            "presence": pres[s]["presence"], "objective": pres[s]["objective"], "space": pres[s]["space"],
            "fight_front": fight[s]["fight_front"], "fight_first_kill": fight[s]["fight_first_kill"],
            "aggro": aggro[s] / minutes,
            "trades": revenges[s] / mates_deaths if mates_deaths > 0 else (None, "aucun coéquipier mort"),
            "cohesion": pres[s]["cohesion"] if pres[s]["cohesion"] is not None else (None, "aucun instant hors départ avec un coéquipier vivant"),
            "gadget": min(1.0, g[1] / g[2]) if g and g[1] is not None and g[2] else (None, "secondaire non établi (délai ou lecture manquants)"),
        }
        out[s] = {"raw": raw, "assists": a, "assist_source": source,
                  "meta": {"kills": k, "deaths": d, "assists_fallback": fallback.get(s, 0), "team_kills": tot["kills"], "team_deaths": tot["deaths"], "team_assists": tot["assists"],
                           "game_minutes": round(minutes, 2), "kills_with_assist": kills_with_assist, "kills_total": len(events),
                           "assist_board_complete": board is not None}}
    return out


def rate_game(conn, game_id, scale=None):
    """Lignes de notes d'une game : [{slot, individual, teamplay, overall, assists, assist_source, data}] ; [] sans position."""
    scale = load_scale() if scale is None else scale
    out = []
    for slot, r in sorted(raw_components(conn, game_id).items()):
        ind_detail, individual, ind_why = rate_group("individual", r["raw"], scale, r["assist_source"])
        team_detail, teamplay, team_why = rate_group("teamplay", r["raw"], scale, r["assist_source"])
        overall = overall_of(individual, teamplay)
        data = {"revision": REVISION, "assist_source": r["assist_source"], "gaze_excluded": not AGGRO_USES_GAZE, "meta": r["meta"],
                "individual": {"note": individual, "components": ind_detail, "reason": ind_why},
                "teamplay": {"note": teamplay, "components": team_detail, "reason": team_why},
                "overall_reason": None if overall is not None else "une sous-note manque : pas de note globale"}
        out.append({"slot": slot, "individual": individual, "teamplay": teamplay, "overall": overall, "assists": r["assists"], "assist_source": r["assist_source"], "data": data})
    return out


def compute(conn, game_id, scale=None):
    """Efface puis réécrit les notes de la game ; renvoie le nombre de joueurs notés (une ligne par joueur, notes NULL comprises). Écrit aussi stats_meta."""
    rows = rate_game(conn, game_id, scale)
    conn.execute("DELETE FROM player_ratings WHERE game_id = ?", (game_id,))
    for r in rows:
        conn.execute("INSERT INTO player_ratings (game_id, slot, individual, teamplay, overall, assists, assist_source, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     (game_id, r["slot"], r["individual"], r["teamplay"], r["overall"], r["assists"], r["assist_source"], json.dumps(r["data"], ensure_ascii=False)))
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, MODULE, REVISION))
    conn.commit()
    return len(rows)


# ---------------------------------------------------------------- calibration et mesure

def percentile(sorted_values, p):
    """Centile p (0 à 100) par interpolation linéaire."""
    if not sorted_values:
        return None
    pos = (len(sorted_values) - 1) * p / 100.0
    lo = int(pos)
    hi = min(lo + 1, len(sorted_values) - 1)
    return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def game_ids(conn):
    return [r[0] for r in conn.execute("SELECT DISTINCT game_id FROM samples ORDER BY game_id")]


def calibrate(conn, games=None):
    """Échelle de la base : {clé: {p05, p50, p95, n}} d'après les valeurs brutes de toutes les games qui ont des positions (rien d'écrit)."""
    values = {}
    for g in games or game_ids(conn):
        for r in raw_components(conn, g).values():
            for name, v in r["raw"].items():
                if isinstance(v, tuple) or v is None:
                    continue
                values.setdefault(scale_key(name, r["assist_source"]), []).append(v)
    out = {}
    for key, vs in sorted(values.items()):
        vs.sort()
        out[key] = {"p05": round(percentile(vs, SCALE_LOW), 5), "p50": round(percentile(vs, 50), 5), "p95": round(percentile(vs, SCALE_HIGH), 5), "n": len(vs)}
    return out


def write_scale(scale, path=None):
    doc = {"_doc": "Échelle des notes de player_ratings.py (écrite par --calibrate) : 5e centile (note 0), médiane (10) et 95e centile (20) des valeurs brutes de la base, n = nombre de joueurs-games. Une convention, voir l'en-tête du module.",
           "revision": REVISION, "components": scale}
    Path(path or SCALE_FILE).write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def spread(values):
    """Médiane, quartiles, minimum et maximum d'une liste (None si vide)."""
    v = sorted(values)
    if not v:
        return None
    return {"n": len(v), "min": round(v[0], 2), "q1": round(percentile(v, 25), 2), "mediane": round(percentile(v, 50), 2), "q3": round(percentile(v, 75), 2), "max": round(v[-1], 2)}


def measure(conn, games=None):
    """Distribution des notes écrites dans la table (individuelle, teamplay, globale), part de kills avec assistance et sources d'assistances par game."""
    where = f"WHERE game_id IN ({','.join(str(int(g)) for g in games)})" if games else ""
    rows = conn.execute(f"SELECT game_id, slot, individual, teamplay, overall, assists, assist_source, data FROM player_ratings {where}").fetchall()
    per_game = {}
    for r in rows:
        d = json.loads(r["data"]) if r["data"] else {}
        m = d.get("meta", {})
        per_game[r["game_id"]] = {"source": r["assist_source"], "kills_avec_assistance": m.get("kills_with_assist"), "kills": m.get("kills_total")}
    return {"joueurs_games": len(rows), "individuelle": spread([r["individual"] for r in rows if r["individual"] is not None]),
            "teamplay": spread([r["teamplay"] for r in rows if r["teamplay"] is not None]), "globale": spread([r["overall"] for r in rows if r["overall"] is not None]),
            "sans_globale": sum(1 for r in rows if r["overall"] is None), "games": per_game}


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Calcule la note sur 20 de chaque joueur d'une game.")
    parser.add_argument("--game", type=int, default=None)
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--calibrate", action="store_true", help="Refait l'échelle sur toutes les games qui ont des positions et l'écrit dans player_ratings_scale.json")
    parser.add_argument("--measure", action="store_true", help="Affiche la distribution des notes déjà écrites, sans rien écrire")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    if args.calibrate:
        scale = calibrate(conn)
        write_scale(scale)
        print(json.dumps({"calibrate": {k: v for k, v in scale.items()}}, ensure_ascii=False))
        return 0
    if args.measure:
        print(json.dumps(measure(conn, [args.game] if args.game else None), ensure_ascii=False))
        return 0
    if args.game is None:
        parser.error("indique --game N, --calibrate ou --measure")
    print(json.dumps({MODULE: compute(conn, args.game)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
