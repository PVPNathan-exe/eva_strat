"""Séries de 3 ou 4 kills autour d'un point (épisodes `retake`, outcome `series_...`), appelées par retakes.py. Pas de ligne de commande : `python analysis/retakes.py --game N` les écrit avec les retakes.

Demande de l'utilisateur : en plus du changement de propriétaire d'un même point (référence du retake), compter les séries de 3 ou 4 kills autour du point, qui sont des échecs de retake (une tentative qui
ne change pas le propriétaire). Pour chaque série : 20 s de déplacements avant, puis le repositionnement de l'équipe adverse 5 à 10 s après les kills.
**Série** : au moins SERIES_MIN (3) et au plus SERIES_MAX (4) victimes distinctes de la MÊME équipe, tuées en au plus WIPE_S secondes par l'autre équipe, à moins de NEAR_M mètres du cadre du point.
**QUESTION OUVERTE (l'utilisateur n'a pas dit quelle équipe fait les kills)** : « 3 ou 4 kills de l'équipe qui n'a pas le point » ? Les deux attributions sont toujours enregistrées dans `data`
(killer_team, victim_team, holder_team, changed_hands) et `outcome_by_view` donne le résultat selon les deux lectures. Constante unique SERIES_VIEW pour choisir celle qui est écrite :
- `victim` (défaut) : la série est classée selon l'équipe qui la SUBIT. Subie par l'équipe qui attaque le point tenu par l'autre : `series_fail` (échec de retake, `team` = l'attaquante). Subie par l'équipe
  qui tient le point : `series_collapse` (défense effondrée, `team` = le tenant ; elle précède souvent un retake réussi : `changed_hands`).
- `killer` (inverse) : classée selon l'équipe qui la FAIT. Faite par l'équipe qui n'a pas le point : `series_fail` si le point ne change pas de main dans les SUCCESS_S (elle a tué 3 ou 4 joueurs
  sans reprendre le point, `team` = l'attaquante), sinon `series_changed`. Faite par le tenant : `series_hold` (la défense tient, `team` = le tenant).
Dans les deux lectures, une série suivie d'un changement de propriétaire dans les SUCCESS_S est `series_changed` quand elle serait un échec (déjà comptée dans les retakes réussis) ; propriétaire inconnu
(point gris plus de 30 s) : `series_neutral`.
Schéma de `data` (JSON, en plus des clés des retakes lues par le site : push_t, window, from_team, to_team, attackers, defenders, deaths, first_death) :
 series_t [premier kill, dernier kill], killer_team, victim_team, holder_team (None si inconnu), changed_hands, changed_to, changed_dt_s, view, outcome_by_view {victim, killer}, team_by_view {victim, killer},
 kills [{t, killer, victim, weapon, kind, victim_dist_m, killer_dist_m}], before {A, B} : photos des équipes à -20, -15, -10, -5 et 0 s du premier kill, after {A, B} : photos à 0, 5 et 10 s du dernier kill,
 adverse_team (l'équipe opposée à `team`), reposition {A, B} : décalage du centre de l'équipe (m) 5 s et 10 s après le dernier kill et nombre de joueurs près du point, overlaps_fail (la même poussée est aussi
 un épisode `fail` du retake classique).
Photo d'équipe (episode_common.snapshot) : {alive, centroid, players: [{slot, pos, d: {point: m}}], near: {point: joueurs à moins de SNAP_RADIUS_M}}, avec l'instant en secondes relatif dans la liste `t`."""

import episode_common as ec

WIPE_S = 10.0  # les kills d'une série tombent dans une fenêtre de 10 s
SERIES_MIN = 3
SERIES_MAX = 4
NEAR_M = 7.0  # une victime est « près du point » à moins de 7 m du cadre (même valeur que R_RETREAT des retakes)
SUCCESS_S = 15.0  # un changement de propriétaire dans les 15 s qui suivent la série la rend « suivie d'un changement »
SERIES_VIEW = "victim"  # lecture écrite dans outcome et team : "victim" (défaut) ou "killer" ; voir la question ouverte ci-dessus
PRE_S = 20.0  # fenêtre de l'épisode : 20 s avant le premier kill
POST_S = 10.0  # et 10 s après le dernier
BEFORE_OFFSETS = (-20.0, -15.0, -10.0, -5.0, 0.0)  # photos avant, relatives au premier kill
AFTER_OFFSETS = (0.0, 5.0, 10.0)  # photos après, relatives au dernier kill
SNAP_RADIUS_M = 4.0  # « au point » dans les photos (même valeur que R_PUSH des retakes)
KILLER_NEAR_M = 4.0  # tueur « sur le point »
DEATH_MATCH_S = 2.0  # la position de mort d'une victime vient de la vie qui finit à 2 s du kill


def death_pos(game, victim, t):
    """Position de mort de la victime d'un kill à l'instant t : fin de la vie qui s'arrête à DEATH_MATCH_S du kill, sinon la ligne vivante la plus proche (3 s au plus)."""
    for v in game["lives"].get(victim, []):
        if v["ended"] == "death" and abs(v["t1"] - t) <= DEATH_MATCH_S and v.get("x1") is not None:
            return (v["x1"], v["y1"])
    return ec.pos_at(game, victim, t, max_gap=3.0)


def near_kills(game, inst):
    """Kills de la plage de l'instance dont la victime est morte à moins de NEAR_M du cadre : [{t, killer, victim, weapon, kind, vpos, victim_dist_m}] triés par temps."""
    out = []
    for k in game["kills"]:
        if not inst["t0"] - 1 <= k[0] <= inst["t1"] + 1:
            continue
        pos = death_pos(game, k[2], k[0])
        d = ec.dist_rect_m(pos, inst["rect"])
        if d is not None and d <= NEAR_M:
            out.append({"t": k[0], "killer": k[1], "victim": k[2], "weapon": k[3], "kind": k[4], "vpos": pos, "victim_dist_m": d})
    return sorted(out, key=lambda x: x["t"])


def group_series(kills):
    """Séries de victimes d'une même équipe : liste de listes de kills (SERIES_MIN à SERIES_MAX victimes distinctes en WIPE_S), sans chevauchement, triées par temps."""
    out = []
    for vteam in ec.TEAMS:
        ks = [k for k in kills if ec.team_of(k["victim"]) == vteam]
        i = 0
        while i < len(ks):
            grp, seen = [], set()
            for k in ks[i:]:
                if k["t"] - ks[i]["t"] > WIPE_S:
                    break
                if k["victim"] not in seen:
                    grp.append(k)
                    seen.add(k["victim"])
            if len(grp) >= SERIES_MIN:
                grp = grp[:SERIES_MAX]
                out.append(grp)
                i += len([k for k in ks[i:] if k["t"] <= grp[-1]["t"] + 1e-6])
            else:
                i += 1
    return sorted(out, key=lambda g: g[0]["t"])


def label(view, victim_team, holder, changed):
    """(outcome, équipe de l'épisode) d'une série selon la lecture `view` ; voir la question ouverte en tête de module."""
    killer_team = ec.other_team(victim_team)
    actor = victim_team if view == "victim" else killer_team
    if holder is None:
        return "series_neutral", actor
    if view == "victim":
        if holder == killer_team:  # l'attaquant du point tenu par l'autre subit la série
            return ("series_changed" if changed else "series_fail"), victim_team
        return "series_collapse", victim_team  # le tenant subit la série
    if holder == victim_team:  # le tenant subit : l'autre équipe, qui n'a pas le point, fait la série
        return ("series_changed" if changed else "series_fail"), killer_team
    return "series_hold", killer_team  # le tenant fait la série


def _kill_info(game, k, rect, killer_team):
    """Fiche d'un kill de la série : victime, tueur, arme, distances au point."""
    kd = ec.dist_rect_m(ec.pos_at(game, k["killer"], k["t"]), rect)
    return {"t": round(k["t"], 1), "killer": k["killer"], "victim": k["victim"], "weapon": k["weapon"], "kind": k["kind"],
            "victim_dist_m": round(k["victim_dist_m"], 1), "killer_dist_m": None if kd is None else round(kd, 1)}


def _death(game, k, rect, t_first, killer_team):
    """Mort d'une victime au format des retakes (lu par le site) : slot, t, dt_push, tueur, arme, distance du tueur, défenseurs proches, cause, position."""
    kd = ec.dist_rect_m(ec.pos_at(game, k["killer"], k["t"]), rect)
    cause = "tue_sur_le_point" if kd is not None and kd <= KILLER_NEAR_M else "tue_a_distance"
    p = k["vpos"]
    return {"slot": k["victim"], "t": round(k["t"], 1), "dt_push": round(k["t"] - t_first, 1), "killer": k["killer"], "weapon": k["weapon"],
            "killer_dist_m": None if kd is None else round(kd, 1), "defenders_near": len(ec.team_near(game, killer_team, rect, k["t"], NEAR_M)),
            "cause": cause, "pos": None if p is None else [round(p[0], 4), round(p[1], 4)], "team": ec.team_of(k["victim"])}


def _photos(game, rects, t_ref, offsets):
    """{A: [photos], B: [photos]} aux instants t_ref + offset ; chaque photo porte `t` (relatif) en plus de la photo d'équipe."""
    out = {}
    for team in ec.TEAMS:
        out[team] = [dict(ec.snapshot(game, team, t_ref + o, rects, SNAP_RADIUS_M), t=o) for o in offsets if 0 <= t_ref + o <= game["duration"]]
    return out


def _shift_m(after, team, offset):
    """Décalage (m) du centre de l'équipe entre la photo à 0 s et la photo à `offset` s après le dernier kill, None si une photo manque."""
    by = {p["t"]: p for p in after[team]}
    a, b = by.get(0.0), by.get(offset)
    if not a or not b or not a["centroid"] or not b["centroid"]:
        return None
    return round(ec.dist_m(a["centroid"], b["centroid"]), 1)


def _reposition(after):
    """Repositionnement de chaque équipe après la série : décalage du centre à 5 s et 10 s, joueurs près du point à 10 s."""
    out = {}
    for team in ec.TEAMS:
        last = after[team][-1] if after[team] else None
        out[team] = {"shift_5_m": _shift_m(after, team, 5.0), "shift_10_m": _shift_m(after, team, 10.0), "near_point_end": None if last is None else last["near"]["point"]}
    return out


def build_episode(game, inst, grp, holder, changes):
    """Épisode d'une série (grp : liste de kills) pour un point tenu par `holder` (A, B ou None) ; `changes` : [(t, ancien, nouveau)] changements de propriétaire de l'instance."""
    rect = inst["rect"]
    t_first, t_last = grp[0]["t"], grp[-1]["t"]
    v_team = ec.team_of(grp[0]["victim"])
    k_team = ec.other_team(v_team)
    hit = [c for c in changes if t_first - 1e-6 <= c[0] <= t_last + SUCCESS_S]
    changed = bool(hit)
    by_view = {v: label(v, v_team, holder, changed) for v in ("victim", "killer")}
    outcome, team = by_view[SERIES_VIEW]
    attack = ec.other_team(holder) if holder else v_team
    rects = {"point": rect}
    after = _photos(game, rects, t_last, AFTER_OFFSETS)
    lo, hi = max(0.0, t_first - PRE_S), min(game["duration"], t_last + POST_S)
    data = {
        "push_t": round(t_first, 1), "series_t": [round(t_first, 1), round(t_last, 1)], "window": [round(lo, 2), round(hi, 2)],
        "from_team": holder, "to_team": attack, "killer_team": k_team, "victim_team": v_team, "holder_team": holder,
        "changed_hands": changed, "changed_to": hit[0][2] if hit else None, "changed_dt_s": round(hit[0][0] - t_last, 1) if hit else None,
        "view": SERIES_VIEW, "outcome_by_view": {v: o for v, (o, _t) in by_view.items()}, "team_by_view": {v: tt for v, (_o, tt) in by_view.items()},
        "kills": [_kill_info(game, k, rect, k_team) for k in grp],
        "attackers": [_player(game, s, rect, t_first) for s in ec.team_slots(attack) if ec.alive_at(game, s, t_first)],
        "defenders": [_player(game, s, rect, t_first) for s in ec.team_slots(ec.other_team(attack)) if ec.alive_at(game, s, t_first)],
        "before": _photos(game, rects, t_first, BEFORE_OFFSETS), "after": after,
        "adverse_team": ec.other_team(team), "reposition": _reposition(after), "overlaps_fail": False,
    }
    deaths = [_death(game, k, rect, t_first, k_team) for k in grp]
    data["deaths"], data["first_death"] = deaths, deaths[0]
    return {"point": inst["point"], "team": team, "t0": round(lo, 2), "t1": round(hi, 2), "outcome": outcome, "data": data}


def _player(game, slot, rect, t):
    """Fiche d'un joueur à l'instant t : slot, position, distance au point en mètres."""
    p = ec.pos_at(game, slot, t)
    d = ec.dist_rect_m(p, rect)
    return {"slot": slot, "pos": None if p is None else [round(p[0], 4), round(p[1], 4)], "dist_m": None if d is None else round(d, 1)}


def find_series(game, inst, holder_of, changes):
    """Épisodes de série d'une instance de point. holder_of(t) : propriétaire tenu (A, B ou None) ; changes : [(t, ancien, nouveau)]."""
    return [build_episode(game, inst, grp, holder_of(grp[0]["t"]), changes) for grp in group_series(near_kills(game, inst))]
