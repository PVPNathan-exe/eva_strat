"""Vagues : une équipe part du spawn (`python analysis/waves.py --game N [--db chemin] [--json]` affiche les vagues d'une game, rien n'est écrit : retakes.py les classe et écrit les épisodes).

Définition (docs/PLAN_STATS_AGENTS.md, section 11). **Vague** : au moins `WAVE_MIN` (2) joueurs vivants d'une même équipe sortent de leur zone de départ (`map_spawns.json` ; Outlaw : les 4 zones neutres
sont communes aux deux équipes, un joueur « sort » de la zone où il est apparu) dans une fenêtre de `WAVE_JOIN_S` secondes : chaque joueur compte une fois par vie. Sortie d'un joueur = premier instant de sa vie
(table `lives`, apparition x0, y0 dans la zone élargie de `SPAWN_MARGIN_M`) où sa position est hors de la zone élargie. Les vies qui apparaissent hors zone (position d'apparition devinée, ou respawn hors des 4 zones d'Outlaw : 15 vies sur 90 de la game 32) n'ont pas de sortie : l'Outlaw est sous-compté.
Une vague ne reprend jamais un joueur sans sortie ; un joueur seul (sans deuxième sortie dans la fenêtre) n'est pas une vague.

Mesures de chaque vague (temps en secondes depuis le début de la game ; distances en mètres sur la minimap, 31 m x 16,5 m) :
- `t_start` : première sortie ; `t_full` : dernière sortie de la fenêtre ; `size` : nombre de joueurs ; `members` : [{slot, life_idx, t_exit, t_death}] (t_death : fin de la vie si mort, sinon None).
- Contact : `t_contact` = premier kill du killfeed dont le tueur ou la victime est un membre vivant de la vague (dans sa vie de sortie), au plus `CONTACT_MAX_S` après `t_start` et avant le prochain départ de la même
  équipe (une vague n'emprunte pas le kill d'une vague suivante). Un test de proximité (ennemi à moins de 8 m) a été essayé et écarté : il donne « contact » 0 à 3 s après le départ pour 99 vagues sur 212 (murs, zones
  de départ voisines), il ne distingue rien. `to_contact_s` = `t_contact` - `t_start`.
- Teamfight (kill_series.py) : `fight` = la première série de kills de la vague qui est un teamfight (voir la définition de teamfight et de duel dans kill_series.py), sinon la première série (un duel) ; None sans kill.
  `n_fights` : nombre de séries distinctes rencontrées ; `to_fight_s` (0 si la vague rejoint une série déjà commencée) ; `axis_frac` : fraction du trajet entre le spawn de l'équipe de la vague (0) et celui de l'adversaire (1) où se tient le combat (centre du foyer ; None sur Outlaw, départs neutres).
- Vitesse : le barycentre des membres vivants est suivi toutes les `STEP_S` du départ jusqu'au premier kill (ou jusqu'à `HORIZON_S` sans contact) ; il est « à l'arrêt » quand sa vitesse (déplacement sur
  ±1 s) est sous `STOP_SPEED_MS` pendant au moins `STOP_MIN_S`. `speed` = `progressif` avec au moins `PROGRESSIVE_STOPS` arrêts avant le contact, sinon `rapide` (seuils mesurés, voir retakes.py et CLAUDE.md) ;
  `n_stops`, `stop_s`, `mean_speed_ms`, `path_m` sont gardés. Pas de vérité à la main.
Contrat commun des modules Stats : ce module ne s'écrit pas dans la base (`find_waves(game)` pour retakes.py)."""

import argparse
import json
import sys

import episode_common as ec
import kill_series

WAVE_MIN = 2  # une vague : au moins 2 joueurs
WAVE_JOIN_S = 8.0  # sorties de zone espacées de 8 s au plus depuis la première : convention, pas de cassure (194 à 233 vagues de 6 à 15 s sur 12 games ; 8 s : 212 vagues, 76 % des sorties dans une vague)
SPAWN_MARGIN_M = 1.0  # zone de départ élargie d'1 m (bords tracés un peu justes ; mesuré sur 829 vies : 71 sorties à moins d'1 s de l'apparition sans marge, 7 avec ; 62 vies apparues hors zone sans marge, 23 avec)
CONTACT_MAX_S = 60.0  # le premier kill d'une vague est cherché dans les 60 s qui suivent son départ
HORIZON_S = 60.0  # sans contact, la vague est suivie 60 s au plus
STEP_S = ec.STEP_S
STOP_SPEED_MS = 0.5  # le barycentre est à l'arrêt sous 0,5 m/s
STOP_MIN_S = 3.0  # arrêt d'au moins 3 s
PROGRESSIVE_STOPS = 1  # progressif : au moins 1 arrêt avant le contact (voir le balayage dans le rapport)
SPEED_HALF_S = 1.0  # vitesse mesurée sur ±1 s


# ---------------------------------------------------------------- zones de départ

def spawn_rects(map_name):
    """{équipe: [rectangles (x0, y0, x1, y1)]} des zones de départ de la carte (vide si la carte n'en a pas)."""
    import db

    out = {}
    for team, v in db.spawns_for(map_name).items():
        out[team] = [tuple(v)] if not isinstance(v[0], (tuple, list)) else [tuple(r) for r in v]
    return out


def _in_rect(r, p, margin_m=0.0):
    mx, my = margin_m / ec.ARENA_M[0], margin_m / ec.ARENA_M[1]
    return r[0] - mx <= p[0] <= r[2] + mx and r[1] - my <= p[1] <= r[3] + my


def life_exit(game, slot, life, rects):
    """Instant où le joueur sort de sa zone de départ pendant cette vie, sinon None (apparition hors zone, ou jamais sorti)."""
    if life.get("x0") is None:
        return None
    start = [r for r in rects if _in_rect(r, (life["x0"], life["y0"]), SPAWN_MARGIN_M)]
    if not start:
        return None
    times, pos = game["tracks"].get(slot, ([], []))
    for t, p in zip(times, pos):
        if t < life["t0"]:
            continue
        if t > life["t1"]:
            break
        if not any(_in_rect(r, p, SPAWN_MARGIN_M) for r in start):
            return t
    return None


# ---------------------------------------------------------------- détection

def team_exits(game, team, rects):
    """Sorties de zone d'une équipe : [(t, slot, index de la vie, vie)] triées par temps."""
    out = []
    for slot in ec.team_slots(team):
        for i, life in enumerate(game["lives"].get(slot, [])):
            t = life_exit(game, slot, life, rects)
            if t is not None:
                out.append((t, slot, i, life))
    return sorted(out, key=lambda e: e[0])


def cluster_exits(exits, join_s=WAVE_JOIN_S, minimum=WAVE_MIN):
    """Groupes de sorties : chaque groupe commence à sa première sortie et prend celles qui suivent dans `join_s` secondes ; moins de `minimum` joueurs : pas une vague."""
    out, i = [], 0
    while i < len(exits):
        j = i
        while j < len(exits) and exits[j][0] - exits[i][0] <= join_s:
            j += 1
        if j - i >= minimum:
            out.append(exits[i:j])
            i = j
        else:
            i += 1
    return out


def _member(slot, idx, t_exit, life):
    return {"slot": slot, "life_idx": idx, "t_exit": round(t_exit, 2), "t_death": round(life["t1"], 2) if life["ended"] == "death" else None, "life_end": life["t1"]}


# ---------------------------------------------------------------- mouvement du barycentre

def _alive_members(game, members, t):
    return [m for m in members if m["t_exit"] - 1e-6 <= t <= m["life_end"] + 1e-6]


def centroid_of(game, members, t):
    pts = [p for m in _alive_members(game, members, t) for p in [ec.pos_at(game, m["slot"], t)] if p is not None]
    if not pts:
        return None
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def barycenter_trace(game, members, t_from, t_to):
    """[(t, barycentre des membres vivants ou None)] toutes les STEP_S."""
    out, t = [], t_from
    while t <= t_to + 1e-9:
        out.append((round(t, 3), centroid_of(game, members, t)))
        t += STEP_S
    return out


def speeds(game, members, trace):
    """Vitesse du barycentre (m/s) à chaque point de la trace : déplacement entre t - SPEED_HALF_S et t + SPEED_HALF_S, None si une des deux positions manque."""
    k = int(round(SPEED_HALF_S / STEP_S))
    out = []
    for i, (_t, _c) in enumerate(trace):
        a, b = trace[max(0, i - k)], trace[min(len(trace) - 1, i + k)]
        d = ec.dist_m(a[1], b[1])
        out.append(None if d is None or b[0] <= a[0] else d / (b[0] - a[0]))
    return out


def stop_runs(trace, spd, speed_max=STOP_SPEED_MS, min_s=STOP_MIN_S):
    """Arrêts du barycentre : [(début, fin)] où la vitesse reste sous `speed_max` pendant au moins `min_s` secondes."""
    runs, start, prev = [], None, None
    for (t, _c), v in list(zip(trace, spd)) + [((None, None), 1e9)]:
        if v is not None and v < speed_max:
            start = t if start is None else start
            prev = t
        elif start is not None:
            if prev - start + STEP_S >= min_s:
                runs.append((start, prev))
            start = None
    return runs


def motion(game, members, t_from, t_to, stop_speed=STOP_SPEED_MS, stop_min=STOP_MIN_S, prog_stops=PROGRESSIVE_STOPS):
    """Mesures de vitesse entre t_from et t_to : n_stops, stop_s, mean_speed_ms, path_m, speed (`rapide` ou `progressif`)."""
    trace = barycenter_trace(game, members, t_from, t_to)
    spd = speeds(game, members, trace)
    stops = stop_runs(trace, spd, stop_speed, stop_min)
    pts = [c for _t, c in trace if c is not None]
    path = sum(ec.dist_m(a, b) for a, b in zip(pts, pts[1:]))
    dur = max(t_to - t_from, 1e-6)
    return {"n_stops": len(stops), "stop_s": round(sum(b - a + STEP_S for a, b in stops), 1), "mean_speed_ms": round(path / dur, 2), "path_m": round(path, 1),
            "speed": "progressif" if len(stops) >= prog_stops else "rapide"}


# ---------------------------------------------------------------- contact

def involved_kills(game, members, t_from, t_to):
    """Indices (dans game['kills']) des kills dont le tueur ou la victime est un membre vivant de la vague dans sa vie de sortie, entre t_from et t_to."""
    ids = {m["slot"]: m for m in members}
    out = []
    for i, k in enumerate(game["kills"]):
        if not t_from - 1e-6 <= k[0] <= t_to + 1e-6:
            continue
        if any(ids.get(s) is not None and ids[s]["t_exit"] - 1e-6 <= k[0] <= ids[s]["life_end"] + 1.0 for s in (k[1], k[2])):
            out.append(i)
    return out


def pick_fight(game, idxs):
    """(séries rencontrées, série retenue) : la première série qui est un teamfight, sinon la première (un duel). Les kills d'une série déjà vue ne sont pas rouverts."""
    seen, fights = set(), []
    for i in idxs:
        if i in seen:
            continue
        f = kill_series.fight_from(game, i)
        seen.update(range(f["i0"], f["i1"] + 1))
        fights.append(f)
        if f["kind"] == "teamfight":
            return fights, f
    return fights, (fights[0] if fights else None)


def build_wave(game, team, group, next_start, neutral=False):
    """Une vague décrite à partir d'un groupe de sorties ; `next_start` : prochain départ d'une vague de la même équipe (ou None)."""
    members = [_member(slot, idx, t, life) for t, slot, idx, life in group]
    t_start, t_full = group[0][0], group[-1][0]
    limit = min(t_start + CONTACT_MAX_S, game["duration"], next_start if next_start is not None else 1e9)
    idxs = involved_kills(game, members, t_start, limit)
    t_contact = game["kills"][idxs[0]][0] if idxs else None
    fights, fight = pick_fight(game, idxs)
    t_ref = t_contact if t_contact is not None else min(limit, t_start + HORIZON_S)
    wave = {"team": team, "t_start": round(t_start, 2), "t_full": round(t_full, 2), "size": len(members), "members": members,
            "t_contact": None if t_contact is None else round(t_contact, 2), "limit": round(limit, 2), "fight": fight, "n_fights": len(fights),
            "axis_frac": None if fight is None or neutral else kill_series.axis_frac(game, fight["center"] and tuple(fight["center"]), team)}
    wave["to_contact_s"] = None if t_contact is None else round(t_contact - t_start, 1)
    wave["to_fight_s"] = None if fight is None else round(max(0.0, fight["t_first"] - t_start), 1)
    wave.update(motion(game, members, t_start, max(t_ref, t_start + STEP_S)))
    return wave


def find_waves(game):
    """Toutes les vagues d'une game chargée (episode_common.load_game), triées par t_start. Une carte sans zone de départ : aucune vague."""
    spawns = spawn_rects(game["map"])
    neutral = spawns.get("A") == spawns.get("B")  # départs neutres (Outlaw) : pas de spawn fixe, donc pas d'axe entre les deux spawns
    out = []
    for team in ec.TEAMS:
        rects = spawns.get(team)
        if not rects:
            continue
        groups = cluster_exits(team_exits(game, team, rects))
        for i, g in enumerate(groups):
            nxt = groups[i + 1][0][0] if i + 1 < len(groups) else None
            out.append(build_wave(game, team, g, nxt, neutral))
    return sorted(out, key=lambda w: w["t_start"])


# ---------------------------------------------------------------- ligne de commande

def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Affiche les vagues (départs du spawn) d'une game.")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    game = ec.load_game(db.connect(args.db), args.game)
    waves = find_waves(game) if game else []
    if args.json:
        print(json.dumps(waves, ensure_ascii=False))
        return 0
    for w in waves:
        print(f"{w['team']} {ec.mmss(w['t_start'])} taille {w['size']} contact {w['to_contact_s']} s {w['speed']} arrêts {w['n_stops']}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
