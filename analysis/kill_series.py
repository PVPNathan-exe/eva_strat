"""Teamfights et duels : séries de kills entre les deux équipes (module `kill_series`, appelé par waves.py et retakes.py ; pas de ligne de commande, pas d'écriture dans la base).

Retour de l'utilisateur du 14 octobre 2026 (docs/PLAN_STATS_AGENTS.md, section 11) : les « séries de 3 ou 4 kills » de la révision 2 sont des TEAMFIGHTS PERDUS de l'équipe qui les subit ; un retake est un
teamfight GAGNÉ suivi de la capture du point. Les épisodes `series_*` disparaissent : ce module décrit un teamfight, il ne produit plus d'épisode.

**Série de kills** : suite maximale de kills entre équipes, chacun à `WIPE_S` secondes au plus du précédent, où que ce soit (pas de filtre de lieu : le teamfight se tient souvent au
milieu de la carte, 50 à 60 % du chemin entre les deux spawns, plus avancé si la défense tient des positions hautes, ce que le programme ne sait pas modéliser ; la fraction réelle est mesurée : `axis_frac`).
Les kills viennent de `game["kills"]` (killfeed, équipes adverses seulement).
**Teamfight ou duel** (précision de l'utilisateur) : un duel 1 contre 1 ou 1 contre 2 n'est pas un teamfight quand le joueur est seul, loin de ses coéquipiers, sans aide possible ; c'est un teamfight si l'aide
peut arriver vite OU si l'autre côté de la carte se bat en même temps. Opérationnalisation : les kills de la fenêtre (suite maximale de kills séparés d'au plus WIPE_S, qui contient le kill de départ de la vague) sont regroupés en
foyers (chaînage simple : une victime à moins de `HELP_R` d'un kill du foyer en fait partie) ; engagés d'un foyer = tueurs et victimes du foyer + joueurs vivants à moins de `HELP_R` du centre du foyer (moyenne des
positions de mort) à l'un des instants de ses kills. Teamfight (`kind`) si les DEUX équipes ont au moins `ENGAGED_MIN` (2) engagés dans un foyer, OU s'il y a au moins deux foyers dans la fenêtre (une autre action
ailleurs en même temps), ET au moins `FIGHT_MIN_KILLS` (2) kills ; sinon `duel`. `HELP_R` 10 m : un joueur en marche va à 1,3 m/s (médiane, 75 % : 1,9, 90 % : 2,6, mesuré sur les games 26, 27, 28 et 32), l'aide
« vite » est à 5 à 6 s de marche, soit 8 à 10 m. Les tyroliennes (aide instantanée de loin) ne sont pas modélisées : un coéquipier près d'une station éloignée n'est pas compté.
**Gagnant** (pertes comptées sur toute la série) : l'équipe qui perd le moins de joueurs ; à égalité, celle qui garde le plus de vivants `ALIVE_AFTER_S` après le dernier kill ;
sinon `None` (égalité). Un duel a aussi un gagnant calculé mais il n'est jamais compté comme teamfight gagné ou perdu.
Schéma du dict (`fight_from`) : i0, i1 (indices dans game["kills"]), t_first, t_last, n_kills, losses {A, B}, alive_end {A, B}, winner, kind (`teamfight` ou `duel`), foyers (nombre), engaged {A, B} (plus grand
foyer), center (moyenne des positions de mort du foyer du kill de départ), kills [{t, killer, victim, weapon, kind}]."""

import episode_common as ec

WIPE_S = 10.0  # deux kills d'une même série sont espacés de 10 s au plus
FIGHT_MIN_KILLS = 2  # un teamfight a au moins 2 kills
ENGAGED_MIN = 2  # chaque équipe a au moins 2 joueurs engagés dans un foyer
HELP_R = 10.0  # une aide est à 10 m au plus du centre du combat (5 à 6 s de marche)
ALIVE_AFTER_S = 2.5  # survivants comptés 2,5 s après le dernier kill (la fin d'une vie tombe à 2 s du kill, voir lives.KILL_MATCH_S)
NEAR_M = 7.0  # « près du point » : à moins de 7 m du cadre
DEATH_MATCH_S = 2.0  # la position de mort d'une victime vient de la vie qui finit à 2 s du kill


def death_pos(game, victim, t):
    """Position de mort de la victime d'un kill à l'instant t : fin de la vie qui s'arrête à DEATH_MATCH_S du kill, sinon la ligne vivante la plus proche (3 s au plus)."""
    for v in game["lives"].get(victim, []):
        if v["ended"] == "death" and abs(v["t1"] - t) <= DEATH_MATCH_S and v.get("x1") is not None:
            return (v["x1"], v["y1"])
    return ec.pos_at(game, victim, t, max_gap=3.0)


def chain_end(kills, i0, wipe_s=WIPE_S):
    """Indice du dernier kill de la série qui commence à l'indice i0 (kills triés par temps)."""
    j = i0
    while j + 1 < len(kills) and kills[j + 1][0] - kills[j][0] <= wipe_s:
        j += 1
    return j


def chain_start(kills, i0, wipe_s=WIPE_S):
    """Indice du premier kill de la fenêtre qui contient le kill i0 (kills précédents séparés d'au plus wipe_s)."""
    j = i0
    while j > 0 and kills[j][0] - kills[j - 1][0] <= wipe_s:
        j -= 1
    return j


def winner_of(losses, alive_end):
    """Équipe gagnante (A, B) : moins de pertes, puis plus de survivants ; None si égalité."""
    for key in (lambda t: losses[t], lambda t: -alive_end[t]):
        a, b = key("A"), key("B")
        if a != b:
            return "A" if a < b else "B"
    return None


# ---------------------------------------------------------------- foyers et engagés

def _mean(points):
    pts = [p for p in points if p is not None]
    return None if not pts else (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def foci(game, idxs, help_r=HELP_R):
    """Foyers de kills : liste de listes d'indices de game["kills"] (chaînage simple : la position de mort de la victime à moins de help_r d'un kill du foyer). Un kill sans position va avec le foyer précédent."""
    kills = game["kills"]
    pos = {i: death_pos(game, kills[i][2], kills[i][0]) for i in idxs}
    out = []
    for i in idxs:
        home = next((f for f in out if pos[i] is None or any(pos[j] is not None and ec.dist_m(pos[i], pos[j]) <= help_r for j in f)), None)
        if home is None:
            out.append([i])
        else:
            home.append(i)
    return out


def engaged(game, focus, help_r=HELP_R):
    """Joueurs engagés d'un foyer : ({A: slots, B: slots}, centre). Tueurs et victimes, plus les vivants à moins de help_r du centre (moyenne des positions de mort) à l'un des instants des kills."""
    kills = game["kills"]
    center = _mean(death_pos(game, kills[i][2], kills[i][0]) for i in focus)
    out = {t: set() for t in ec.TEAMS}
    for i in focus:
        for s in (kills[i][1], kills[i][2]):
            out[ec.team_of(s)].add(s)
        if center is None:
            continue
        for s in range(1, 9):
            if ec.alive_at(game, s, kills[i][0]):
                d = ec.dist_m(ec.pos_at(game, s, kills[i][0]), center)
                if d is not None and d <= help_r:
                    out[ec.team_of(s)].add(s)
    return out, center


def kind_of(game, i0, help_r=HELP_R, wipe_s=WIPE_S):
    """(`teamfight` ou `duel`, nombre de foyers, engagés du foyer du kill i0, centre de ce foyer) pour la fenêtre de kills qui contient le kill i0."""
    kills = game["kills"]
    a, b = chain_start(kills, i0, wipe_s), chain_end(kills, i0, wipe_s)
    fs = foci(game, list(range(a, b + 1)), help_r)
    mine = next(f for f in fs if i0 in f)
    eng, center = engaged(game, mine, help_r)
    best = {t: len(eng[t]) for t in ec.TEAMS}
    for f in fs:
        e, _c = engaged(game, f, help_r)
        if min(len(e["A"]), len(e["B"])) >= ENGAGED_MIN:
            best, eng = {t: len(e[t]) for t in ec.TEAMS}, e
            break
    ok = min(best.values()) >= ENGAGED_MIN or len(fs) >= 2
    return ("teamfight" if ok and b - a + 1 >= FIGHT_MIN_KILLS else "duel"), len(fs), best, center


def fight_from(game, i, help_r=HELP_R, wipe_s=WIPE_S):
    """Série de kills qui contient le kill d'indice i de game["kills"] (fenêtre maximale de kills séparés d'au plus wipe_s : dict, voir l'en-tête), None si l'indice est hors liste."""
    kills = game["kills"]
    if i is None or not 0 <= i < len(kills):
        return None
    i0, i1 = chain_start(kills, i, wipe_s), chain_end(kills, i, wipe_s)
    chain = kills[i0:i1 + 1]
    losses = {t: sum(1 for k in chain if ec.team_of(k[2]) == t) for t in ec.TEAMS}
    t_last = chain[-1][0]
    alive_end = {t: sum(1 for s in ec.team_slots(t) if ec.alive_at(game, s, t_last + ALIVE_AFTER_S)) for t in ec.TEAMS}
    kind, n_foci, eng, center = kind_of(game, i, help_r, wipe_s)
    return {"i0": i0, "i1": i1, "t_first": round(chain[0][0], 1), "t_last": round(t_last, 1), "n_kills": len(chain), "losses": losses, "alive_end": alive_end,
            "winner": winner_of(losses, alive_end), "kind": kind, "foyers": n_foci, "engaged": eng, "center": None if center is None else [round(center[0], 4), round(center[1], 4)],
            "kills": [{"t": round(k[0], 1), "killer": k[1], "victim": k[2], "weapon": k[3], "kind": k[4]} for k in chain]}


# ---------------------------------------------------------------- lieu du combat

def victims_near_share(game, fight, rect):
    """Part des victimes du teamfight mortes à moins de NEAR_M du cadre du point (None sans position) : mesure de l'écart entre « autour du point » et « tout affrontement »."""
    dists = [ec.dist_rect_m(death_pos(game, k["victim"], k["t"]), rect) for k in fight["kills"]]
    dists = [d for d in dists if d is not None]
    return None if not dists else round(sum(1 for d in dists if d <= NEAR_M) / len(dists), 2)


def team_spawn_centre(game, team):
    """Centre des apparitions (x0, y0 des vies) de l'équipe dans la game : position du spawn fixe, valable aussi pour les départs neutres d'Outlaw. None sans vie."""
    pts = [(v["x0"], v["y0"]) for s in ec.team_slots(team) for v in game["lives"].get(s, []) if v.get("x0") is not None]
    return _mean(pts)


def axis_frac(game, center, team):
    """Fraction du trajet entre le spawn de `team` (0) et celui de l'adversaire (1) où se trouve `center` (projection, en mètres ; peut sortir de [0, 1]) ; None si une position manque."""
    a, b = team_spawn_centre(game, team), team_spawn_centre(game, ec.other_team(team))
    if center is None or a is None or b is None:
        return None
    ux, uy = (b[0] - a[0]) * ec.ARENA_M[0], (b[1] - a[1]) * ec.ARENA_M[1]
    n2 = ux * ux + uy * uy
    if n2 < 1e-9:
        return None
    return round(((center[0] - a[0]) * ec.ARENA_M[0] * ux + (center[1] - a[1]) * ec.ARENA_M[1] * uy) / n2, 2)
