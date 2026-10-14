"""Épisodes de rotation (table `episodes`, kind = rotation) : `python analysis/rotations.py --game N [--db chemin] [--dry-run] [--sheet]`.

Définition (docs/PLAN_STATS_AGENTS.md, section 2, précisée par l'utilisateur le 14 octobre 2026). Une **rotation** est le MOMENT OÙ LE POINT ACTIF CHANGE (plus facile à déterminer qu'un retake) :
une équipe (au moins 2 joueurs) quitte l'ancien point pour jouer le nouveau. Calendrier du point actif (episode_common.load_schedule) : table `point_active` (lue par le HUD) si elle a des lignes pour
la game, sinon, sur Outlaw, les boîtes vues (`capture_boxes`) ; une carte à plusieurs points sans `point_active` (Atlantis, Engine) ou à un seul point : aucune rotation.
Épisode : `point` = l'ancien point, `point_to` = le nouveau, `team` = l'équipe qui tourne, instant T = début du segment du nouveau point. Un épisode par équipe concernée (au moins 2 joueurs sur
l'ancien point dans les 20 s avant T, ou 2 joueurs arrivés sur le nouveau) : l'autre équipe de la rotation est dans `opponent`.
- Joueurs de départ : vivants de l'équipe à moins de `R_POINT` du cadre de l'ancien point à T - `LOOK_BACK_S`.
- Arrivée d'un joueur : premier instant dans les `ROT_MAX_S` qui suivent T où il est à moins de `R_POINT` du nouveau point.
- Résultat de l'épisode (`outcome`) : `arrived` (au moins 2 joueurs arrivés), `partial` (un seul), `not_arrived` (personne). Le GAGNANT de la rotation est dans `data.result` (voir ci-dessous).
Fenêtre de l'épisode : de T - `PRE_S` (20 s) à T + `ROT_MAX_S` (30 s). Temps en secondes depuis le début de la game ; distances en mètres sur la minimap (31 m x 16,5 m).

Schéma de `data` (JSON ; les clés de la révision 1 sont conservées, le site les lit) :
 switch_t, old_owner (tenant de l'ancien point 3 s avant sa fin), new_owner_after (tenant du nouveau à T + 35 s), distance_points_m, source (point_active ou box),
 start_players [{slot, leave_t, leave_offset_s}], arrivals [{slot, t, travel_s}] triées, second_arrival_s, deaths_en_route [{slot, t, killer}],
 flow : comportement de l'équipe, 20 s avant et 20 s après (calculé par `_flow`), mêmes clés pour `opponent` (l'équipe adverse) :
   team, keys [photos à -20, -10, 0, +10, +20 s de T : {t, alive, centroid, players: [{slot, pos, d: {old, new}}], near: {old, new}}],
   was_on_old (au moins 2 joueurs à moins de R_POINT de l'ancien point, HOLD_S de suite, avant T), stays_on_old (encore au moins 2 à la fin de la fenêtre), leave_old_offset_s (instant où l'équipe a
   moins de 2 joueurs sur l'ancien point, relatif à T), alive_at_leave, leave_phase (`avant` : plus de EARLY_S avant T, `au_changement` : entre -EARLY_S et +LATE_S, `apres`, `reste`, `jamais`),
   concentrate_new_offset_s (début de la première période de 2 joueurs ou plus sur le nouveau point), already_on_new (déjà là au début de la fenêtre), first_arrival_s, second_arrival_s (depuis T),
   shift_m {10, 20} (déplacement du centre de l'équipe depuis T), toward_new_m {10, 20} (rapprochement du centre vers le nouveau point : positif = elle s'en approche),
   owns_old_at_change, owns_new_before, points_owned_before (points tenus 1 s avant T), deaths [{slot, t, offset_s, killer, dist_new_m, dist_old_m}], kills (kills faits dans la fenêtre).
 result : {first_team (équipe dont la deuxième arrivée sur le nouveau point est la première, sinon la première arrivée), owner_t10, owner_t20, owner_first (premier tenant après T), winner (owner_t20, sinon
   owner_first), team_won (équipe de l'épisode), value (`won`, `lost` ou `undecided`)}.
Contrat commun des modules Stats : `compute(conn, game_id) -> int` (idempotent), `stats_meta` (module `rotations`, révision REVISION)."""

import argparse
import json
import sys

import episode_common as ec
import retakes

MODULE = "rotations"
REVISION = 2  # 2 : calendrier point_active, 20 s avant et après, adversaire, gagnant, plusieurs cartes
OUTLAW = "Outlaw"
# Valeurs étalonnées sur Outlaw, game 32 (5 changements de point, 10 équipes) : la game 19 a des boîtes mais pas de positions, donc non mesurée.
R_POINT = 4.0  # « sur un point » : à moins de 4 m du cadre (même seuil que R_PUSH des retakes)
LOOK_BACK_S = 4.0  # joueurs de départ lus 4 s avant l'apparition de la nouvelle boîte (l'ancienne boîte disparaît 2 s avant)
ROT_MAX_S = 30.0  # une arrivée compte si elle a lieu dans les 30 s qui suivent (les deux points sont à 10 à 18 m l'un de l'autre)
PRE_S = 20.0  # fenêtre de l'épisode : 20 s avant le changement de point actif
POST_S = 20.0  # 20 s après pour les photos et les mesures de comportement
KEY_OFFSETS = (-20.0, -10.0, 0.0, 10.0, 20.0)  # photos de l'équipe, relatives à T
HOLD_S = 2.0  # « sur un point » : au moins 2 joueurs pendant au moins 2 s de suite
MIN_ON_POINT = 2  # nombre de joueurs qui font une présence sur un point
EARLY_S = 5.0  # parti plus de 5 s avant le changement : `avant`
LATE_S = 5.0  # parti plus de 5 s après : `apres` (entre les deux : `au_changement`)
MAX_SWITCH_GAP_S = 20.0  # deux segments voisins de points différents séparés de plus de 20 s ne sont pas un changement (lecture manquante)
STEP_S = ec.STEP_S  # pas de balayage des positions


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


# ---------------------------------------------------------------- propriétaires

def _holder(game, seg, t):
    """Tenant (A, B ou None) du point d'un segment à l'instant t : seulement les lectures de `point_owner` qui tombent dans le segment."""
    segs = [s for s in game["owners"].get(seg["point"], []) if seg["t0"] - 1 <= (s[0] + s[1]) / 2 <= seg["t1"] + 1]
    return retakes.holder_at(retakes.holder_timeline(segs), t)


def _holder_any(game, point, t):
    """Tenant du point à l'instant t sur toute la game (un point gris reste tenu 30 s au plus)."""
    return retakes.holder_at(retakes.holder_timeline(game["owners"].get(point, [])), t)


def _owner_after(game, new, t0):
    """Tenants du nouveau point après T : à +10 s, +20 s, et premier tenant après T dans le segment."""
    first = next((x for a, _b, x in retakes.holder_timeline([s for s in game["owners"].get(new["point"], []) if new["t0"] - 1 <= (s[0] + s[1]) / 2 <= new["t1"] + 1])
                  if x is not None and a >= t0 - 1e-6), None)
    return {"owner_t10": _holder(game, new, t0 + 10.0), "owner_t20": _holder(game, new, t0 + POST_S), "owner_first": first}


# ---------------------------------------------------------------- comportement d'une équipe

def _phase(was_on_old, stays, leave_off):
    """Quand l'équipe a quitté l'ancien point par rapport au changement."""
    if not was_on_old:
        return "jamais"
    if stays:
        return "reste"
    if leave_off < -EARLY_S:
        return "avant"
    return "au_changement" if leave_off <= LATE_S else "apres"


def _deaths(game, team, old, new, lo, hi):
    """Morts de l'équipe dans la fenêtre : slot, instant, tueur et distance de la mort aux deux points."""
    out = []
    for s in ec.team_slots(team):
        for v in game["lives"].get(s, []):
            if v["ended"] == "death" and lo <= v["t1"] <= hi:
                p = (v["x1"], v["y1"]) if v.get("x1") is not None else None
                d_new, d_old = ec.dist_rect_m(p, new["rect"]), ec.dist_rect_m(p, old["rect"])
                out.append({"slot": s, "t": round(v["t1"], 1), "killer": v.get("killer_slot"), "dist_new_m": None if d_new is None else round(d_new, 1), "dist_old_m": None if d_old is None else round(d_old, 1)})
    return sorted(out, key=lambda d: d["t"])


def _flow(game, team, old, new, t):
    """Comportement d'une équipe 20 s avant et après le changement de point actif (voir le schéma en tête de module)."""
    lo, hi = max(0.0, t - PRE_S), min(game["duration"], t + ROT_MAX_S)
    rects = {"old": old["rect"], "new": new["rect"]}
    s_old = ec.presence_series(game, team, old["rect"], lo, hi, R_POINT)
    s_new = ec.presence_series(game, team, new["rect"], lo, hi, R_POINT)
    before = [r for r in ec.sustained_runs(s_old, MIN_ON_POINT, HOLD_S) if r[0] <= t + 1e-6]
    was_on, stays, leave_off, alive_leave = bool(before), False, None, None
    if before:
        end = before[-1][1]
        stays = end >= hi - 1e-6
        if not stays:
            leave_off = round(end + STEP_S - t, 1)
            alive_leave = ec.snapshot(game, team, end + STEP_S, rects, R_POINT)["alive"]
    runs_new = ec.sustained_runs(s_new, MIN_ON_POINT, HOLD_S)
    conc = runs_new[0][0] if runs_new else None
    arrivals = sorted(a for a in (_arrival(game, s, new["rect"], t, hi) for s in ec.team_slots(team)) if a is not None)
    keys = [dict(ec.snapshot(game, team, t + o, rects, R_POINT), t=o) for o in KEY_OFFSETS if 0 <= t + o <= game["duration"]]
    by = {k["t"]: k for k in keys}
    c0 = by.get(0.0, {}).get("centroid")
    shift, toward = {}, {}
    for o in (10.0, 20.0):
        c = by.get(o, {}).get("centroid")
        shift[str(int(o))] = None if not c0 or not c else round(ec.dist_m(c0, c), 1)
        d0 = None if not c0 else ec.dist_rect_m(c0, new["rect"])
        d1 = None if not c else ec.dist_rect_m(c, new["rect"])
        toward[str(int(o))] = None if d0 is None or d1 is None else round(d0 - d1, 1)
    owned = [p for p in game["owners"] if _holder_any(game, p, t - 1.0) == team]
    return {
        "team": team, "keys": keys, "was_on_old": was_on, "stays_on_old": stays, "leave_old_offset_s": leave_off, "alive_at_leave": alive_leave,
        "leave_phase": _phase(was_on, stays, leave_off),
        "concentrate_new_offset_s": None if conc is None else round(conc - t, 1), "already_on_new": conc is not None and conc <= lo + 1e-6 and lo > 0,
        "first_arrival_s": round(arrivals[0] - t, 1) if arrivals else None, "second_arrival_s": round(arrivals[1] - t, 1) if len(arrivals) >= 2 else None,
        "shift_m": shift, "toward_new_m": toward,
        "owns_old_at_change": _holder(game, old, t - 1.0) == team, "owns_new_before": _holder_any(game, new["point"], t - 1.0) == team, "points_owned_before": sorted(owned),
        "deaths": _deaths(game, team, old, new, lo, hi),
        "kills": sum(1 for k in game["kills"] if lo <= k[0] <= hi and ec.team_of(k[1]) == team),
    }


def _result(flows, owners, team):
    """Gagnant de la rotation : équipe arrivée la première (deuxième arrivée, sinon première) et tenant du nouveau point 20 s après."""
    def arrive(f):
        return f["second_arrival_s"] if f["second_arrival_s"] is not None else (None if f["first_arrival_s"] is None else 1000.0 + f["first_arrival_s"])
    a, b = arrive(flows["A"]), arrive(flows["B"])
    first = None if a is None and b is None else ("A" if b is None or (a is not None and a < b) else ("B" if a is None or b < a else None))
    winner = owners["owner_t20"] or owners["owner_first"]
    return dict(owners, first_team=first, winner=winner, team_won=team, value="undecided" if winner is None else ("won" if winner == team else "lost"))


# ---------------------------------------------------------------- épisodes

def _episode(game, old, new, team, flows):
    """Épisode de rotation d'une équipe entre deux segments consécutifs, ou None si moins de 2 joueurs sont concernés."""
    t = new["t0"]
    start = [s for s, _d in ec.team_near(game, team, old["rect"], t - LOOK_BACK_S, R_POINT)]
    arrivals = {s: _arrival(game, s, new["rect"], t, t + ROT_MAX_S) for s in ec.team_slots(team)}
    arrived = {s: a for s, a in arrivals.items() if a is not None}
    flow = flows[team]
    if len(set(start) | set(arrived)) < 2 and not flow["was_on_old"]:
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
    owners = _owner_after(game, new, t)
    data = {
        "switch_t": round(t, 1), "old_owner": _holder(game, old, old["t1"] - 3), "new_owner_after": _holder(game, new, min(new["t1"], t + ROT_MAX_S + 5)),
        "distance_points_m": round(ec.dist_m(ec.rect_center(old["rect"]), ec.rect_center(new["rect"])), 1), "source": new.get("source"),
        "start_players": [{"slot": s, "leave_t": leave[s], "leave_offset_s": None if leave[s] is None else round(leave[s] - t, 1)} for s in start],
        "arrivals": [{"slot": s, "t": a, "travel_s": round(a - t, 1)} for s, a in sorted(arrived.items(), key=lambda x: x[1])],
        "second_arrival_s": round(times[1] - t, 1) if len(times) >= 2 else None,
        "deaths_en_route": deaths,
        "flow": flow, "opponent": flows[ec.other_team(team)], "result": _result(flows, owners, team),
    }
    return {"point": old["point"], "point_to": new["point"], "team": team, "t0": round(max(0.0, t - PRE_S), 2), "t1": round(hi, 2), "outcome": outcome, "data": data}


def find_episodes(game):
    """Épisodes de rotation d'une game chargée (episode_common.load_game) : un par équipe et par changement de point actif, triés par temps. Aucun sans calendrier."""
    out = []
    sched = game.get("schedule") or []
    for old, new in zip(sched, sched[1:]):
        if old["point"] == new["point"] or new["t0"] - old["t1"] > MAX_SWITCH_GAP_S:
            continue
        flows = {team: _flow(game, team, old, new, new["t0"]) for team in ec.TEAMS}
        for team in ec.TEAMS:
            ep = _episode(game, old, new, team, flows)
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
        f = d["flow"]
        who = f"equipe {e['team']} : depart " + (", ".join(str(p["slot"]) for p in d["start_players"]) or "aucun") + " ; arrivees " + (", ".join(f"{a['slot']} (+{a['travel_s']:.0f} s)" for a in d["arrivals"]) or "aucune")
        who += f" ; quitte l'ancien point : {f['leave_phase']}" + ("" if f["leave_old_offset_s"] is None else f" ({f['leave_old_offset_s']:+.1f} s)") + f" ; resultat {d['result']['value']}"
        rows.append(f"| {game_id} | {vt:.0f} s ({ec.mmss(vt)}) | rotation {e['point']} vers {e['point_to']} | {e['outcome']} | {who} |")
    return rows


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Calcule les épisodes de rotation d'une game (calendrier du point actif).")
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
