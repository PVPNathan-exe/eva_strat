"""Épisodes de retake, REVISION 4 (table `episodes`, kind = retake) : `python analysis/retakes.py --game N [--db chemin] [--dry-run] [--sheet]`.

Refonte autour de la VAGUE (docs/PLAN_STATS_AGENTS.md, section 11 ; waves.py détecte les vagues, kill_series.py décrit les séries de kills). Une **vague** est un départ du spawn (au moins 2 joueurs d'une équipe
sortent de leur zone de départ en `WAVE_JOIN_S`). Chaque vague de l'équipe qui n'a PAS le point (ou d'un point neutre) est un épisode ; la vague de l'équipe qui TIENT le point (renfort, défense) est classée
`defense` mais n'est pas écrite. Une vague dont le point n'est pas exploitable (propriétaire jamais lu : Ceres ; pas de lecture à cet instant) n'est pas classée.
**Teamfight** (kill_series.py, précision de l'utilisateur du 14 octobre 2026) : suite de kills des deux équipes (≤ `WIPE_S` entre deux kills, où que ce soit sur la carte : la position n'est pas filtrée, `axis_frac` et
`near_point` la mesurent) qui contient le premier kill d'un membre de la vague. Teamfight si les deux équipes ont au moins 2 engagés (vivants à moins de `HELP_R` du centre du combat) ou si une autre action a lieu ailleurs
en même temps ; sinon `duel` (1 contre 1 ou 1 contre 2 sans aide possible : jamais gagné ni perdu, jamais un retake). Gagnant = l'équipe qui perd le moins de joueurs, puis qui garde le plus de survivants.
**Issues** (`outcome`) :
- `initial` : prise initiale, l'équipe de la vague prend un point lu neutre (premier propriétaire d'un point ou d'une instance d'Outlaw) dans [départ, fin de la série + SUCCESS_S] : PAS un retake. `data.wave.opening`
  marque la première prise de la game.
- `success` : retake réussi, le point passe de l'autre équipe à l'équipe de la vague dans la même fenêtre. Une prise vaut même si la série est perdue ou si elle n'a pas eu lieu (`data.wave.tf_result` : won, draw, lost, duel
  ou none) : le propriétaire lu sur la minimap prime sur le décompte des morts ; ces cas sont comptés dans `measure` comme douteux.
- `fail` : retake raté, point tenu par l'autre équipe, teamfight perdu (ou à égalité) avec au moins `FAIL_MIN_DEAD` morts (2) de l'équipe de la vague (série entière), sans prise. `initial_lost` : la même chose sur un
  point neutre (teamfight d'ouverture perdu).
- `won_no_capture` : teamfight gagné sans prise du point dans la fenêtre. `duel` : la série n'est pas un teamfight. `indecis` : égalité avec moins de 2 morts. `no_contact` : aucun kill d'un membre de la vague avant sa limite.
- `defense` (jamais écrite) : l'équipe de la vague tient déjà le point à son premier kill.
Correspondance des issues de la révision 2 (le site les lisait) : `success` -> `success` (ou `initial` si le point était neutre) ; `no_push` (changement sans 2 attaquants au point) -> plus d'épisode si aucune vague ne l'explique
(prise hors vague, comptée dans `measure`, la prise reste dans les bandes de propriétaire) ; `fail` -> `fail` (plus d'exigence de survivants repliés : `data.wave.survivors_retreated` les compte) ; `series_fail` -> `fail` ;
`series_changed` -> `success` ; `series_collapse` (le tenant subit la série) -> `success` ou `won_no_capture` de la vague adverse ; `series_hold` -> `defense` (non écrit) ; `series_neutral` -> `initial`, `initial_lost`
ou `won_no_capture`. Nouvelles issues sans équivalent : `initial`, `initial_lost`, `won_no_capture`, `duel`, `indecis`, `no_contact`.
Temps en secondes depuis le début de la game ; distances en mètres. Épisode : `team` = équipe de la vague, `point` = point visé (celui pris, sinon le plus proche du barycentre au premier kill, Outlaw : le point actif),
`t0` = départ du spawn (`t_start`), `t1` = résolution (`t_end` : dernier kill du teamfight, ou instant de la prise s'il est plus tard ; sans kill, fin de suivi de la vague).
Schéma de `data` : clés lues par le site (révision 2, remplies avec les valeurs de la vague) : change_t (instant de la prise, sinon None), push_t (= t_start), window [t0 - 5 s, t1 + 5 s], from_team (tenant avant),
to_team (équipe de la vague), attackers [{slot, pos, dist_m}] (membres, au premier kill), defenders [{slot, pos, dist_m, fate, death_t}] (ennemis vivants au premier kill ; fate mort, recule, reste), first_death, deaths
[{slot, t, dt_push, killer, weapon, killer_dist_m, defenders_near, cause, pos, team}] (victimes du teamfight), stagger_s (écart de sortie des deux premiers joueurs), survivors (membres vivants 3 s après le teamfight).
Nouveau : `wave` {team, t_start, t_full, t_contact (premier kill d'un membre), t_end, duration_s, to_contact_s, to_fight_s, kind (teamfight, duel ou None), n_fights, axis_frac (0 au spawn de la vague, 1 à celui de l'adversaire ; None sur Outlaw), size, speed (rapide, progressif ou None sans contact), n_stops, stop_s, mean_speed_ms, path_m, point, holder_before, holder_after,
tf_result, captured_t, capture_from, opening (première prise de la game), survivors_retreated, members [{slot, life_idx, t_exit, t_death}], fight {t_first, t_last, n_kills, losses {A, B}, alive_end, winner, kind, heavy (REVISION 4 : les deux équipes perdent au moins HEAVY_MIN_LOSSES joueurs ; absent des anciennes lignes), foyers, engaged {A, B}, center, near_point}}.
Idempotent, verdicts conservés au recalcul si l'épisode correspond (même équipe, même point, début à 5 s près). Contrat commun des modules Stats : `compute(conn, game_id) -> int`, `stats_meta` (module `retakes`, révision REVISION)."""

import argparse
import json
import sys

import episode_common as ec
import kill_series
import waves as waves_mod

MODULE = "retakes"
REVISION = 4  # 4 : `wave.fight.heavy` (teamfight lourd : les deux équipes perdent au moins 3 joueurs, losses déjà enregistré) ; 3 : refonte autour des vagues (initial, success, fail, won_no_capture, no_contact), plus de séries de kills ; 2 : séries de kills ; 1 : poussée au point
SUCCESS_S = 15.0  # une prise dans les 15 s qui suivent la fin du teamfight (ou le départ, sans kill) fait partie de la vague
FAIL_MIN_DEAD = 2  # un teamfight perdu : au moins 2 morts de la vague
R_RETREAT = 7.0  # « reculé » : à plus de 7 m du point, 3 s après le teamfight
RETREAT_AFTER_S = 3.0
KILLER_NEAR_M = 4.0  # tueur « sur le point » à moins de 4 m
PAD_S = 5.0  # la fenêtre d'un épisode déborde de 5 s de chaque côté
MATCH_S = 5.0  # un épisode recalculé reprend le verdict d'un ancien de la même équipe et du même point dont le début est à 5 s au plus

# Fonctions de propriétaire déplacées dans episode_common (rotations.py les appelle par ce module).
holder_timeline, owner_changes, holder_at = ec.holder_timeline, ec.owner_changes, ec.holder_at


# ---------------------------------------------------------------- contexte des points

def instance_contexts(game):
    """Une entrée par instance de point : {inst, timeline, caps}. Une instance sans aucune période de propriétaire lue (carte sans point_owner) est ignorée plus loin."""
    out = []
    for inst in game["instances"]:
        segs = [s for s in game["owners"].get(inst["point"], []) if inst["t0"] - 1 <= (s[0] + s[1]) / 2 <= inst["t1"] + 1]
        tl = ec.holder_timeline(segs)
        if not any(x is not None for _a, _b, x in tl):  # aucune équipe n'a jamais été lue propriétaire : le propriétaire n'est pas lu sur cette carte (Ceres), on ne sait rien
            tl = []
        out.append({"inst": inst, "timeline": tl, "caps": ec.captures(tl)})
    return out


def _live(c, lo, hi):
    """L'instance a des lectures de propriétaire et recouvre [lo, hi]."""
    return bool(c["timeline"]) and c["inst"]["t1"] >= lo - 1 and c["inst"]["t0"] <= hi + 1


def pick_target(game, wave, ctxs, hi, used):
    """(indice de l'instance, prise) visées par la vague : la première prise de l'équipe de la vague dans [t_start, hi] (une prise n'est donnée qu'à une vague), sinon (instance la plus proche du
    barycentre au premier kill ou au départ, None) ; (None, None) sans instance exploitable."""
    team, lo = wave["team"], wave["t_start"]
    best = None
    for ci, c in enumerate(ctxs):
        if not _live(c, lo, hi):
            continue
        for cap in c["caps"]:
            if cap[2] == team and lo <= cap[0] <= hi and (ci, cap[0]) not in used and (best is None or cap[0] < best[1][0]):
                best = (ci, cap)
    if best:
        return best
    t_ref = wave["t_contact"] if wave["t_contact"] is not None else lo
    cands = [ci for ci, c in enumerate(ctxs) if ec.known_at(c["timeline"], t_ref) and c["inst"]["t0"] - 1 <= t_ref <= c["inst"]["t1"] + 1]
    if not cands:
        return None, None
    cen = waves_mod.centroid_of(game, wave["members"], t_ref)
    key = (lambda ci: ec.dist_rect_m(cen, ctxs[ci]["inst"]["rect"])) if cen else (lambda ci: 0)
    return min(cands, key=key), None


# ---------------------------------------------------------------- classement

def tf_result(wave):
    """Résultat du teamfight pour l'équipe de la vague : won, lost, draw, duel (la série n'est pas un teamfight : jamais gagnée ni perdue) ou none (aucun kill)."""
    f = wave["fight"]
    if f is None:
        return "none"
    if f["kind"] == "duel":
        return "duel"
    return "won" if f["winner"] == wave["team"] else "draw" if f["winner"] is None else "lost"


def classify(wave, holder, cap, result):
    """Issue d'une vague (voir l'en-tête). `holder` : tenant avant (A, B ou None) ; `cap` : prise de la vague (t, ancien, nouveau) ou None ; `result` : tf_result."""
    team = wave["team"]
    if cap is not None:
        return "initial" if cap[1] is None else "success"
    if holder == team:
        return "defense"
    if result == "none":
        return "no_contact"
    lost_n = wave["fight"]["losses"][team]
    if result == "duel":
        return "duel"
    if result == "won":
        return "won_no_capture"
    if lost_n >= FAIL_MIN_DEAD:
        return "initial_lost" if holder is None else "fail"
    return "indecis"


def wave_end(wave, cap):
    """Résolution : dernier kill du teamfight, ou prise si elle est plus tardive ; sans kill, fin de suivi de la vague (dernier mort des membres, sinon limite)."""
    f = wave["fight"]
    if f is not None:
        t = f["t_last"]
    else:
        t = min(wave["limit"], max(m["life_end"] for m in wave["members"]))
    return round(max(t, cap[0]) if cap else t, 2)


# ---------------------------------------------------------------- données de l'épisode

def _fmt_pos(p):
    return None if p is None else [round(p[0], 4), round(p[1], 4)]


def _player(game, slot, rect, t):
    p = ec.pos_at(game, slot, t)
    d = ec.dist_rect_m(p, rect)
    return {"slot": slot, "pos": _fmt_pos(p), "dist_m": None if d is None else round(d, 1)}


def _death_row(game, k, rect, t_start):
    """Mort d'une victime du teamfight au format des retakes : slot, t, tueur, arme, distance du tueur au point, tueurs proches, cause, position."""
    kd = ec.dist_rect_m(ec.pos_at(game, k["killer"], k["t"]), rect)
    p = kill_series.death_pos(game, k["victim"], k["t"])
    return {"slot": k["victim"], "t": k["t"], "dt_push": round(k["t"] - t_start, 1), "killer": k["killer"], "weapon": k["weapon"], "killer_dist_m": None if kd is None else round(kd, 1),
            "defenders_near": len(ec.team_near(game, ec.team_of(k["killer"]), rect, k["t"], R_RETREAT)),
            "cause": "tue_sur_le_point" if kd is not None and kd <= KILLER_NEAR_M else "tue_a_distance", "pos": _fmt_pos(p), "team": ec.team_of(k["victim"])}


def _defenders(game, team, rect, t_ref, fight, t_after):
    """Ennemis vivants à t_ref : fiche, et sort (mort dans le teamfight, recule, reste) à la fin."""
    dead = {k["victim"]: k["t"] for k in (fight["kills"] if fight else [])}
    out = []
    for s in ec.team_slots(ec.other_team(team)):
        if not ec.alive_at(game, s, t_ref):
            continue
        d_after = ec.dist_rect_m(ec.pos_at(game, s, t_after), rect)
        fate = "mort" if s in dead else "recule" if d_after is not None and d_after > R_RETREAT else "reste"
        out.append(dict(_player(game, s, rect, t_ref), fate=fate, death_t=dead.get(s)))
    return out


def build_data(game, wave, ctxs, ci, cap, holder, result, outcome, t_end, opening):
    """`data` de l'épisode (voir l'en-tête)."""
    team, f = wave["team"], wave["fight"]
    inst = ctxs[ci]["inst"]
    rect = inst["rect"]
    t_ref = wave["t_contact"] if wave["t_contact"] is not None else wave["t_start"]
    t_after = (f["t_last"] if f else t_end) + RETREAT_AFTER_S
    members = wave["members"]
    survivors = [m["slot"] for m in members if ec.alive_at(game, m["slot"], t_after)]
    retreated = sum(1 for s in survivors if (ec.dist_rect_m(ec.pos_at(game, s, t_after), rect) or 0) > R_RETREAT)
    deaths = [_death_row(game, k, rect, wave["t_start"]) for k in (f["kills"] if f else [])]
    after = ec.holder_at(ctxs[ci]["timeline"], t_end + 1.0)
    slots = sorted(m["slot"] for m in members)
    exits = sorted(m["t_exit"] for m in members)
    w = {"team": team, "t_start": wave["t_start"], "t_full": wave["t_full"], "t_contact": wave["t_contact"], "t_end": t_end, "duration_s": round(t_end - wave["t_start"], 1),
         "to_contact_s": wave["to_contact_s"], "size": wave["size"], "speed": wave["speed"] if wave["t_contact"] is not None else None, "n_stops": wave["n_stops"], "stop_s": wave["stop_s"],
         "mean_speed_ms": wave["mean_speed_ms"], "path_m": wave["path_m"], "point": inst["point"], "holder_before": holder, "holder_after": after, "tf_result": result,
         "captured_t": None if cap is None else round(cap[0], 1), "capture_from": None if cap is None else cap[1], "opening": opening, "survivors_retreated": retreated,
         "members": [{k: m[k] for k in ("slot", "life_idx", "t_exit", "t_death")} for m in members],
         "kind": None if f is None else f["kind"], "to_fight_s": wave["to_fight_s"], "n_fights": wave["n_fights"], "axis_frac": wave["axis_frac"],
         "fight": None if f is None else {k: f[k] for k in ("t_first", "t_last", "n_kills", "losses", "alive_end", "winner", "kind", "heavy", "foyers", "engaged", "center")} | {"near_point": kill_series.victims_near_share(game, f, rect)}}
    return {"change_t": None if cap is None else round(cap[0], 1), "push_t": wave["t_start"], "window": [round(max(0.0, wave["t_start"] - PAD_S), 2), round(min(game["duration"], t_end + PAD_S), 2)],
            "from_team": holder, "to_team": team,
            "attackers": [_player(game, s, rect, t_ref) for s in slots], "defenders": _defenders(game, team, rect, t_ref, f, t_after),
            "first_death": deaths[0] if deaths else None, "deaths": deaths, "stagger_s": round(exits[1] - exits[0], 1) if len(exits) > 1 else None,
            "survivors": survivors, "wave": w}


# ---------------------------------------------------------------- épisodes

def classified_waves(game):
    """Toutes les vagues de la game avec leur issue : [(vague, issue, épisode ou None)] triées par départ ; `defense` et les vagues sans point exploitable n'ont pas d'épisode (issue None sans point)."""
    ctxs = instance_contexts(game)
    out, used, first_cap = [], set(), True
    for w in waves_mod.find_waves(game):
        f = w["fight"]
        hi = (f["t_last"] if f else w["limit"]) + SUCCESS_S
        ci, cap = pick_target(game, w, ctxs, hi, used)
        if ci is None:
            out.append((w, None, None))
            continue
        if cap is not None:
            used.add((ci, cap[0]))
        t_ref = w["t_contact"] if w["t_contact"] is not None else w["t_start"]
        holder = cap[1] if cap is not None else ec.holder_at(ctxs[ci]["timeline"], t_ref)
        result = tf_result(w)
        outcome = classify(w, holder, cap, result)
        if outcome == "defense":
            out.append((w, outcome, None))
            continue
        t_end = wave_end(w, cap)
        opening = bool(cap is not None and cap[1] is None and first_cap)
        first_cap = first_cap and cap is None
        data = build_data(game, w, ctxs, ci, cap, holder, result, outcome, t_end, opening)
        ep = {"point": ctxs[ci]["inst"]["point"], "team": w["team"], "t0": w["t_start"], "t1": t_end, "outcome": outcome, "data": data}
        out.append((w, outcome, ep))
    return out


def find_episodes(game, stats=None):
    """Épisodes de retake d'une game chargée (episode_common.load_game), triés par temps. `stats` (dict) : compte les vagues par issue, y compris `defense` et `sans_point`."""
    eps = []
    for _w, outcome, ep in classified_waves(game):
        if stats is not None:
            key = outcome or "sans_point"
            stats[key] = stats.get(key, 0) + 1
        if ep is not None:
            eps.append(ep)
    return sorted(eps, key=lambda e: e["t0"])


def measure(game):
    """Chiffres de contrôle d'une game : vagues par issue (`defense` et `sans_point` compris), prises de point (changements de main et prises initiales), prises hors vague (aucune vague ne les explique),
    prises douteuses (retake ou prise initiale avec un teamfight perdu), vagues par vitesse."""
    cw = classified_waves(game)
    issues, speeds = {}, {}
    for w, outcome, _ep in cw:
        issues[outcome or "sans_point"] = issues.get(outcome or "sans_point", 0) + 1
        if w["t_contact"] is not None:
            speeds[w["speed"]] = speeds.get(w["speed"], 0) + 1
    taken = {(e["point"], e["data"]["wave"]["captured_t"]) for _w, _o, e in cw if e and e["data"]["wave"]["captured_t"] is not None}
    caps = [(c["inst"]["point"], round(cap[0], 1)) for c in instance_contexts(game) for cap in c["caps"]]
    doubtful = sum(1 for _w, _o, e in cw if e and e["data"]["wave"]["captured_t"] is not None and e["data"]["wave"]["tf_result"] == "lost")
    return {"vagues": len(cw), "issues": issues, "vitesse": speeds, "prises": len(caps), "prises_hors_vague": sum(1 for c in caps if c not in taken), "prises_avec_teamfight_perdu": doubtful}


def compute(conn, game_id):
    """Efface puis réécrit les épisodes de retake de la game ; renvoie leur nombre. Écrit aussi stats_meta."""
    game = ec.load_game(conn, game_id)
    episodes = find_episodes(game) if game else []
    return ec.write_episodes(conn, game_id, "retake", episodes, MODULE, REVISION, MATCH_S)


def sheet_rows(conn, game_id, episodes):
    """Lignes Markdown de la feuille de validation : game, instant dans la vidéo (s et m:ss), issue, vitesse, équipe."""
    start = conn.execute("SELECT start_s FROM games WHERE id = ?", (game_id,)).fetchone()[0]
    rows = []
    for e in episodes:
        w = e["data"]["wave"]
        vt = start + e["t0"]
        rows.append(f"| {game_id} | {vt:.0f} s ({ec.mmss(vt)}) | équipe {e['team']}, {w['size']} joueurs | point {e['point']} | {e['outcome']} | {w['speed'] or '-'} | contact {w['to_contact_s']} s, fin {w['duration_s']} s |")
    return rows


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Calcule les épisodes de retake (vagues) d'une game.")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--dry-run", action="store_true", help="Calcule et affiche les chiffres sans rien écrire")
    parser.add_argument("--sheet", action="store_true", help="Affiche la feuille de validation (Markdown) sans rien écrire")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    game = ec.load_game(conn, args.game)
    if args.dry_run or args.sheet:
        stats = {}
        episodes = find_episodes(game, stats) if game else []
        print("\n".join(sheet_rows(conn, args.game, episodes)) if args.sheet else json.dumps({MODULE: len(episodes), "vagues_par_issue": stats, "mesure": measure(game) if game else None}, ensure_ascii=False))
        return 0
    print(json.dumps({MODULE: compute(conn, args.game)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
