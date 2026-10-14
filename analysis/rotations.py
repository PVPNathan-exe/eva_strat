"""Épisodes de rotation (table `episodes`, kind = rotation) : `python analysis/rotations.py --game N [--db chemin] [--dry-run] [--sheet]`.

Définition figée (docs/PLAN_STATS_AGENTS.md, section 2). Une **rotation** : une équipe (au moins 2 joueurs) quitte un point pour en rejoindre un autre. Seul Outlaw est couvert : le point
actif y change toutes les 1 min 30 (`capture_boxes`), à chaque changement chaque équipe qui avait au moins 2 joueurs sur l'ancien point ou qui en amène au moins 2 sur le nouveau écrit un épisode.
Atlantis et Engine (trois points) n'ont pas de `point_owner` lisible (voir CLAUDE.md « Stats : propriétaire des points ») : aucune rotation. Les cartes à un seul point n'en ont pas.
Épisode : `point` = l'ancien point, `point_to` = le nouveau, `team` = l'équipe qui tourne, instant T = apparition de la boîte du nouveau point.
- Joueurs de départ : vivants de l'équipe à moins de `R_POINT` du cadre de l'ancien point à T - `LOOK_BACK_S`.
- Arrivée d'un joueur : premier instant dans les `ROT_MAX_S` qui suivent T où il est à moins de `R_POINT` du nouveau point.
- Résultat : `arrived` (au moins 2 joueurs arrivés), `partial` (un seul), `not_arrived` (personne : tués en route ou partis ailleurs).
Données (JSON) : T, anciens et nouveaux propriétaires, joueurs de départ avec instant de départ de l'ancien point, arrivées, morts en route, durée de trajet de la deuxième arrivée, distance entre points.
Fenêtre : de T - `PRE_S` à T + `ROT_MAX_S`. Temps en secondes depuis le début de la game ; distances en mètres sur la minimap (31 m x 16,5 m).
Contrat commun des modules Stats : `compute(conn, game_id) -> int` (idempotent), `stats_meta` (module `rotations`, révision REVISION)."""

import argparse
import json
import sys

import episode_common as ec
import retakes

MODULE = "rotations"
REVISION = 1
OUTLAW = "Outlaw"
# Valeurs étalonnées sur Outlaw, game 32 (5 changements de point, 10 équipes) : la game 19 a des boîtes mais pas de positions, donc non mesurée.
R_POINT = 4.0  # « sur un point » : à moins de 4 m du cadre (même seuil que R_PUSH des retakes)
LOOK_BACK_S = 4.0  # joueurs de départ lus 4 s avant l'apparition de la nouvelle boîte (l'ancienne boîte disparaît 2 s avant)
ROT_MAX_S = 30.0  # une arrivée compte si elle a lieu dans les 30 s qui suivent (les deux points sont à 10 à 18 m l'un de l'autre)
PRE_S = 10.0  # fenêtre de l'épisode : 10 s avant l'apparition de la nouvelle boîte
STEP_S = 0.5  # pas de balayage des positions


def _arrival(game, slot, rect, t_from, t_to):
    """Premier instant entre t_from et t_to où le joueur vivant est à moins de R_POINT du cadre, sinon None."""
    t = t_from
    while t <= t_to + 1e-9:
        if ec.alive_at(game, slot, t):
            d = ec.dist_rect_m(ec.pos_at(game, slot, t), rect)
            if d is not None and d <= R_POINT:
                return round(t, 1)
        t += STEP_S
    return None


def _leave(game, slot, rect, t_from, t_to):
    """Premier instant entre t_from et t_to où le joueur n'est plus à moins de R_POINT de l'ancien point (vivant), sinon None."""
    t = t_from
    while t <= t_to + 1e-9:
        if ec.alive_at(game, slot, t):
            d = ec.dist_rect_m(ec.pos_at(game, slot, t), rect)
            if d is not None and d > R_POINT:
                return round(t, 1)
        t += STEP_S
    return None


def _owner_of(game, point, t):
    """Propriétaire tenu du point à l'instant t (A, B ou None)."""
    return retakes.holder_at(retakes.holder_timeline(game["owners"].get(point, [])), t)


def _episode(game, old, new, team):
    """Épisode de rotation d'une équipe entre deux boîtes consécutives, ou None si moins de 2 joueurs sont concernés."""
    t = new["t0"]
    start = [s for s, _d in ec.team_near(game, team, old["rect"], t - LOOK_BACK_S, R_POINT)]
    arrivals = {s: _arrival(game, s, new["rect"], t, t + ROT_MAX_S) for s in ec.team_slots(team)}
    arrived = {s: a for s, a in arrivals.items() if a is not None}
    if len(set(start) | set(arrived)) < 2:
        return None
    n = len(arrived)
    outcome = "arrived" if n >= 2 else ("partial" if n == 1 else "not_arrived")
    leave = {s: _leave(game, s, old["rect"], t - LOOK_BACK_S, t + ROT_MAX_S) for s in start}
    deaths = []
    for s in start:
        if s in arrived:
            continue
        v = next((v for v in game["lives"].get(s, []) if v["ended"] == "death" and t - LOOK_BACK_S <= v["t1"] <= t + ROT_MAX_S), None)
        if v is not None:
            deaths.append({"slot": s, "t": round(v["t1"], 1), "killer": v.get("killer_slot")})
    times = sorted(arrived.values())
    hi = min(game["duration"], t + ROT_MAX_S)
    data = {
        "switch_t": round(t, 1), "old_owner": _owner_of(game, old["point"], old["t1"] - 3), "new_owner_after": _owner_of(game, new["point"], min(new["t1"], t + ROT_MAX_S + 5)),
        "distance_points_m": round(ec.dist_m(ec.rect_center(old["rect"]), ec.rect_center(new["rect"])), 1),
        "start_players": [{"slot": s, "leave_t": leave[s], "leave_offset_s": None if leave[s] is None else round(leave[s] - t, 1)} for s in start],
        "arrivals": [{"slot": s, "t": a, "travel_s": round(a - t, 1)} for s, a in sorted(arrived.items(), key=lambda x: x[1])],
        "second_arrival_s": round(times[1] - t, 1) if len(times) >= 2 else None,
        "deaths_en_route": deaths,
    }
    return {"point": old["point"], "point_to": new["point"], "team": team, "t0": round(max(0.0, t - PRE_S), 2), "t1": round(hi, 2), "outcome": outcome, "data": data}


def find_episodes(game):
    """Épisodes de rotation d'une game chargée (episode_common.load_game) : Outlaw seulement, triés par temps."""
    if game["map"] != OUTLAW:
        return []
    out = []
    for old, new in zip(game["instances"], game["instances"][1:]):
        if old["point"] == new["point"]:
            continue
        for team in ec.TEAMS:
            ep = _episode(game, old, new, team)
            if ep is not None:
                out.append(ep)
    return sorted(out, key=lambda e: (e["t0"], e["team"]))


def compute(conn, game_id):
    """Efface puis réécrit les épisodes de rotation de la game ; renvoie leur nombre. Écrit aussi stats_meta."""
    game = ec.load_game(conn, game_id)
    episodes = find_episodes(game) if game else []
    return ec.write_episodes(conn, game_id, "rotation", episodes, MODULE, REVISION)


def sheet_rows(conn, game_id, episodes):
    """Lignes Markdown de la feuille de validation : game, instant dans la vidéo (s et m:ss), type, résultat, joueurs."""
    start = conn.execute("SELECT start_s FROM games WHERE id = ?", (game_id,)).fetchone()[0]
    rows = []
    for e in episodes:
        d = e["data"]
        vt = start + d["switch_t"]
        who = f"equipe {e['team']} : depart " + (", ".join(str(p["slot"]) for p in d["start_players"]) or "aucun") + " ; arrivees " + (", ".join(f"{a['slot']} (+{a['travel_s']:.0f} s)" for a in d["arrivals"]) or "aucune")
        rows.append(f"| {game_id} | {vt:.0f} s ({ec.mmss(vt)}) | rotation {e['point']} vers {e['point_to']} | {e['outcome']} | {who} |")
    return rows


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Calcule les épisodes de rotation d'une game (Outlaw seulement).")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--dry-run", action="store_true", help="Calcule et affiche les chiffres sans rien écrire")
    parser.add_argument("--sheet", action="store_true", help="Affiche la feuille de validation (Markdown) sans rien écrire")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    if args.dry_run or args.sheet:
        game = ec.load_game(conn, args.game)
        episodes = find_episodes(game) if game else []
        if args.sheet:
            print("\n".join(sheet_rows(conn, args.game, episodes)))
        else:
            counts = {}
            for e in episodes:
                counts[e["outcome"]] = counts.get(e["outcome"], 0) + 1
            print(json.dumps({MODULE: len(episodes), "par_resultat": counts}, ensure_ascii=False))
        return 0
    print(json.dumps({MODULE: compute(conn, args.game)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
