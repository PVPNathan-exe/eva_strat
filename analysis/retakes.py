"""Épisodes de retake (table `episodes`, kind = retake) : `python analysis/retakes.py --game N [--db chemin] [--dry-run] [--sheet]`.

Définition figée (docs/PLAN_STATS_AGENTS.md, section 2). Un **retake** est un point (le MÊME point) qui passe d'une équipe à l'autre (`point_owner`). Un propriétaire à la fois : les périodes
grises (`none`) entre deux propriétaires différents ne comptent pas comme un propriétaire, mais le point reste « tenu » par le dernier propriétaire pendant au plus `NONE_GAP_S`
(Outlaw redevient gris quand il est contesté). La première prise d'un point neutre n'est pas un retake. Épisodes écrits :
- `success` : le point change de propriétaire. Fenêtre de 20 s avant à 10 s après le changement, coupée aux changements voisins. Départ (`push_t`) : début de la dernière période où au moins
  2 attaquants (équipe qui prend) sont à moins de `R_PUSH` du point. Défenseurs au départ classés morts, reculés (au-delà de `R_RETREAT` 3 s après le changement) ou restés.
- `no_push` : le point change de propriétaire sans 2 attaquants à moins de `R_PUSH` dans la fenêtre (prise par un seul joueur, ou position illisible) : à valider, pas un retake sûr.
- `fail` : au moins 2 attaquants à moins de `R_PUSH` du point tenu par l'autre équipe pendant `PUSH_MIN_S`, le point ne change pas de main dans les `SUCCESS_S` qui suivent, 2 à 4 des attaquants
  engagés meurent en `FAIL_WINDOW_S` et aucun survivant n'est à moins de `R_RETREAT` à la fin.
Une poussée qui ne remplit pas ces conditions (un seul mort, survivants sur le point) n'est pas écrite : elle est comptée dans `measure`.
Temps en secondes depuis le début de la game (voir episode_common), distances en mètres sur la minimap (31 m x 16,5 m : les distances au point vont de 0 à 12 à 16 m, d'où des seuils
bien plus petits que les 15 m et 25 m du plan, qui dépassent l'arène). Atlantis et Engine : épisodes seulement si `point_owner` a des lignes pour la game (un point par lettre), sinon aucun.
- `series_*` : séries de 3 ou 4 kills autour du point (kill_series.py : définition, QUESTION OUVERTE sur l'équipe qui fait les kills, constante SERIES_VIEW, schéma de `data`). Elles sont écrites avec les retakes
  (kind retake) : `series_fail` (échec de retake), `series_collapse` (défense effondrée), `series_hold`, `series_changed` (suivie d'un changement de main, déjà dans les réussites), `series_neutral`.
Causes automatiques de chaque mort d'attaquant : tueur, arme, distance du tueur au point, nombre de défenseurs vivants près du point, arrivée décalée des attaquants.
Contrat commun des modules Stats : `compute(conn, game_id) -> int` (idempotent), `stats_meta` (module `retakes`, révision REVISION)."""

import argparse
import json
import sys

import episode_common as ec
import kill_series

MODULE = "retakes"
REVISION = 2  # 2 : séries de kills, cartes à plusieurs points avec point_owner, instances Outlaw fondues
# Valeurs étalonnées sur 10 games (Polaris 16, 22, 26 ; The Cliff 25, 37 ; Reef Point 27, 34 ; Silva 28 ; Artefact 36 ; Outlaw 32 : 36 changements de propriétaire du même point). Les 15 m et 25 m du plan
# dépassent l'arène (31 m x 16,5 m, un joueur est au plus à 12 à 16 m d'un point) : balayage R_PUSH 3 à 6 m et R_RETREAT 5 à 9 m, voir le rapport de mesure.
R_PUSH = 4.0  # « au point » : à moins de 4 m du cadre. 3 m : 2 changements sur 36 sans départ ; 4 m : 1 sur 36 ; 6 m : 0 mais 62 poussées candidates écartées contre 14 (le point est dans la zone de passage)
R_RETREAT = 7.0  # « reculé » : à plus de 7 m du point (médiane des distances de tous les joueurs au point : 4,6 à 9 m selon la carte). 5 à 9 m donnent 18 à 15 échecs avec R_PUSH 4 m, pas de cassure nette
PRE_S = 20.0  # fenêtre d'un retake : 20 s avant le changement
POST_S = 10.0  # et 10 s après
PUSH_MIN_S = 1.5  # deux attaquants au point au moins 1,5 s de suite pour parler de poussée
FAIL_WINDOW_S = 10.0  # les morts d'un échec tombent dans les 10 s qui suivent le début de la poussée
SUCCESS_S = 15.0  # un changement de propriétaire dans les 15 s qui suivent le début d'une poussée en fait un succès, pas un échec
RETREAT_AFTER_S = 3.0  # un défenseur est dit reculé à 3 s après le changement
NONE_GAP_S = 30.0  # un point gris reste « tenu » par le dernier propriétaire pendant 30 s au plus
MIN_OWNER_S = 2.0  # un propriétaire lu moins de 2 s est un accident de lecture
STEP_S = 0.5  # pas de balayage des positions
FAIL_PRE_S = 5.0  # fenêtre d'un échec : 5 s avant le début de la poussée
FAIL_POST_S = 15.0  # et 15 s après
STAGGER_S = 3.0  # attaquants arrivés à plus de 3 s d'écart : arrivée décalée
KILLER_NEAR_M = 4.0  # tueur « sur le point » à moins de 4 m


# ---------------------------------------------------------------- propriétaire tenu

def holder_timeline(segs):
    """Périodes de propriétaire d'un point : [(t0, t1, X)] avec X = A ou B, les périodes grises comblées par le dernier propriétaire (au plus NONE_GAP_S), sinon X = None.
    Les périodes de moins de MIN_OWNER_S sont ignorées."""
    segs = [s for s in segs if s[1] - s[0] >= MIN_OWNER_S]
    out, last, last_end = [], None, None
    for a, b, owner in segs:
        if owner in ec.TEAMS:
            out.append((a, b, owner))
            last, last_end = owner, b
            continue
        fill_end = a if last is None else min(b, last_end + NONE_GAP_S)
        if last is not None and fill_end > a:
            out.append((a, fill_end, last))
        if fill_end < b:
            out.append((max(a, fill_end), b, None))
    return out


def owner_changes(timeline):
    """Changements de propriétaire : [(t, ancien, nouveau)] à l'instant où le nouveau commence."""
    out, prev = [], None
    for a, _b, x in timeline:
        if x is None:
            continue
        if prev is not None and x != prev:
            out.append((a, prev, x))
        prev = x
    return out


def holder_at(timeline, t):
    for a, b, x in timeline:
        if a - 1e-6 <= t < b:
            return x
    return None


# ---------------------------------------------------------------- balayage des attaquants

def push_flags(game, rect, team, lo, hi):
    """[(t, joueurs de l'équipe à moins de R_PUSH du point)] toutes les STEP_S de lo à hi."""
    out, t = [], lo
    while t <= hi + 1e-9:
        out.append((round(t, 3), [s for s, _d in ec.team_near(game, team, rect, t, R_PUSH)]))
        t += STEP_S
    return out


def push_runs(flags):
    """Périodes où au moins 2 attaquants sont au point : [(début, fin)] (fin = dernier instant vrai)."""
    runs, start, prev = [], None, None
    for t, near in flags:
        if len(near) >= 2:
            if start is None:
                start = t
            prev = t
        elif start is not None:
            runs.append((start, prev))
            start = None
    if start is not None:
        runs.append((start, prev))
    return runs


def _death(game, slot, t_from, t_to):
    """Mort du joueur entre t_from et t_to : dict de sa vie, sinon None."""
    for v in game["lives"].get(slot, []):
        if v["ended"] == "death" and t_from - 1e-6 <= v["t1"] <= t_to + 1e-6:
            return v
    return None


def _fmt_pos(p):
    return None if p is None else [round(p[0], 4), round(p[1], 4)]


def _player(game, slot, rect, t):
    """Fiche d'un joueur à l'instant t : slot, position, distance au point."""
    p = ec.pos_at(game, slot, t)
    d = ec.dist_rect_m(p, rect)
    return {"slot": slot, "pos": _fmt_pos(p), "dist_m": None if d is None else round(d, 1)}


def _death_info(game, slot, v, rect, def_team, push_t):
    """Mort d'un attaquant et cause automatique : tueur, arme, distance du tueur au point, défenseurs vivants près du point."""
    killer = v.get("killer_slot")
    kd = ec.dist_rect_m(ec.pos_at(game, killer, v["t1"]), rect) if killer else None
    near_def = len(ec.team_near(game, def_team, rect, v["t1"], R_RETREAT))
    if killer is None:
        cause = "sans_tueur"
    elif ec.team_of(killer) != def_team:
        cause = "autre"
    elif kd is not None and kd <= KILLER_NEAR_M:
        cause = "tue_sur_le_point"
    else:
        cause = "tue_a_distance"
    return {"slot": slot, "t": round(v["t1"], 1), "dt_push": round(v["t1"] - push_t, 1), "killer": killer, "weapon": v.get("weapon"),
            "killer_dist_m": None if kd is None else round(kd, 1), "defenders_near": near_def, "cause": cause,
            "pos": _fmt_pos((v["x1"], v["y1"]) if v.get("x1") is not None else None)}


def _stagger(game, flags, push_t):
    """Écart (s) entre l'arrivée du premier et du deuxième attaquant au point, depuis le début de la poussée : None si inconnu."""
    first = {}
    for t, near in flags:
        if t < push_t - 10:
            continue
        for s in near:
            first.setdefault(s, t)
    ts = sorted(first.values())
    return round(ts[1] - ts[0], 1) if len(ts) >= 2 else None


# ---------------------------------------------------------------- épisodes

def _success(game, inst, change, others, att, dfn):
    """Épisode d'un changement de propriétaire (t, ancien, nouveau) ; outcome success ou no_push."""
    t, _old, _new = change
    rect, duration = inst["rect"], game["duration"]
    lo, hi = ec.clip_window(t, PRE_S, POST_S, others, duration)
    flags = push_flags(game, rect, att, lo, min(hi, t + 2.0))
    runs = [r for r in push_runs(flags) if r[0] <= t + 2.0 and r[1] >= lo]
    outcome = "success" if runs else "no_push"
    push_t = runs[-1][0] if runs else None
    ref = push_t if push_t is not None else max(lo, t - 5.0)
    engaged = engaged_players(game, rect, att, ref) or [s for s in ec.team_slots(att) if ec.alive_at(game, s, ref)]
    defenders = []
    for s in ec.team_slots(dfn):
        if not ec.alive_at(game, s, ref):
            continue
        v = _death(game, s, ref, t + POST_S)
        d_after = ec.dist_rect_m(ec.pos_at(game, s, t + RETREAT_AFTER_S), rect)
        if v is not None and v["t1"] <= t + RETREAT_AFTER_S:
            fate = "mort"
        elif d_after is not None and d_after > R_RETREAT:
            fate = "recule"
        elif v is not None:
            fate = "mort_apres"
        else:
            fate = "reste"
        info = _player(game, s, rect, ref)
        info.update({"fate": fate, "death_t": None if v is None else round(v["t1"], 1)})
        defenders.append(info)
    deaths = [dict(_death_info(game, s, v, rect, dfn, ref), team=att) for s in engaged for v in [_death(game, s, ref, t + POST_S)] if v is not None]
    deaths += [dict(_death_info(game, d["slot"], _death(game, d["slot"], ref, t + POST_S), rect, att, ref), team=dfn) for d in defenders if d["death_t"] is not None and d["fate"] in ("mort", "mort_apres")]
    deaths.sort(key=lambda d: d["t"])
    data = {
        "change_t": round(t, 1), "push_t": push_t, "window": [lo, hi], "from_team": dfn, "to_team": att,
        "attackers": [_player(game, s, rect, ref) for s in engaged], "defenders": defenders,
        "first_death": deaths[0] if deaths else None, "deaths": deaths,
        "stagger_s": _stagger(game, flags, push_t) if push_t is not None else None,
        "defenders_left": sum(1 for d in defenders if d["fate"] == "reste"),
    }
    return {"point": inst["point"], "team": att, "t0": lo, "t1": hi, "outcome": outcome, "data": data}


def _fail_candidates(game, inst, timeline, changes_t):
    """Poussées sans changement de propriétaire : [(début de la poussée, attaquants, flags)] sur la plage de l'instance."""
    rect = inst["rect"]
    out = []
    for a, b, holder in timeline:
        if holder is None:
            continue
        att = ec.other_team(holder)
        flags = push_flags(game, rect, att, max(a, inst["t0"]), min(b, inst["t1"]))
        for s, e in push_runs(flags):
            if e - s + STEP_S < PUSH_MIN_S:
                continue
            if any(s - 1e-6 <= c <= s + SUCCESS_S for c in changes_t):
                continue
            out.append((s, e, att, holder, flags))
    return out


def engaged_players(game, rect, team, t):
    """Joueurs vivants de l'équipe à moins de R_RETREAT du point à l'instant t : ceux qui prennent part à la poussée."""
    out = []
    for x in ec.team_slots(team):
        d = ec.dist_rect_m(ec.pos_at(game, x, t), rect) if ec.alive_at(game, x, t) else None
        if d is not None and d <= R_RETREAT:
            out.append(x)
    return out


def classify_push(game, inst, s, att, dfn, flags):
    """Épisode `fail` d'une poussée qui commence en s, ou (None, raison) : morts des attaquants engagés et survivants."""
    rect = inst["rect"]
    engaged = engaged_players(game, rect, att, s)
    t_end = s + FAIL_WINDOW_S
    dead = [(x, _death(game, x, s, t_end)) for x in engaged]
    dead = [(x, v) for x, v in dead if v is not None]
    if not 2 <= len(dead) <= 4:
        return None, "morts"
    for x in engaged:
        if any(x == d[0] for d in dead):
            continue
        d_end = ec.dist_rect_m(ec.pos_at(game, x, t_end), rect)
        if d_end is not None and d_end <= R_RETREAT:
            return None, "survivants"
    deaths = sorted((dict(_death_info(game, x, v, rect, dfn, s), team=att) for x, v in dead), key=lambda d: d["t"])
    lo, hi = max(0.0, s - FAIL_PRE_S), min(game["duration"], s + FAIL_POST_S)
    data = {
        "push_t": round(s, 1), "window": [lo, hi], "from_team": dfn, "to_team": att,
        "attackers": [_player(game, x, rect, s) for x in engaged], "defenders": [_player(game, x, rect, s) for x in ec.team_slots(dfn) if ec.alive_at(game, x, s)],
        "first_death": deaths[0], "deaths": deaths, "stagger_s": _stagger(game, flags, s),
        "survivors": [x for x in engaged if all(x != d[0] for d in dead)],
    }
    return {"point": inst["point"], "team": att, "t0": round(lo, 2), "t1": round(hi, 2), "outcome": "fail", "data": data}, None


def find_episodes(game, stats=None):
    """Tous les épisodes de retake d'une game chargée (episode_common.load_game), triés par temps. `stats` (dict) : compte les poussées écartées par raison."""
    out = []
    for inst in game["instances"]:
        segs = [s for s in game["owners"].get(inst["point"], []) if inst["t0"] - 1 <= (s[0] + s[1]) / 2 <= inst["t1"] + 1]
        timeline = holder_timeline(segs)
        changes = owner_changes(timeline)
        for c in changes:
            out.append(_success(game, inst, c, [x[0] for x in changes], c[2], c[1]))
        for s, _e, att, holder, flags in _fail_candidates(game, inst, timeline, [c[0] for c in changes]):
            ep, why = classify_push(game, inst, s, att, holder, flags)
            if ep is None:
                if stats is not None:
                    stats[why] = stats.get(why, 0) + 1
                continue
            if out and any(o["outcome"] == "fail" and o["point"] == ep["point"] and o["team"] == ep["team"] and abs(o["data"]["push_t"] - s) < FAIL_WINDOW_S for o in out):
                continue
            out.append(ep)
        for ep in kill_series.find_series(game, inst, lambda t, tl=timeline: holder_at(tl, t), changes):
            first, last = ep["data"]["series_t"]
            ep["data"]["overlaps_fail"] = any(o["outcome"] == "fail" and o["point"] == ep["point"] and first - FAIL_WINDOW_S <= o["data"]["push_t"] <= last for o in out)
            out.append(ep)
    return sorted(out, key=lambda e: e["t0"])


def compute(conn, game_id):
    """Efface puis réécrit les épisodes de retake de la game ; renvoie leur nombre. Écrit aussi stats_meta."""
    game = ec.load_game(conn, game_id)
    episodes = find_episodes(game) if game else []
    return ec.write_episodes(conn, game_id, "retake", episodes, MODULE, REVISION)


def sheet_rows(conn, game_id, episodes):
    """Lignes Markdown de la feuille de validation : game, instant dans la vidéo (s et m:ss), type, résultat, joueurs."""
    start = conn.execute("SELECT start_s FROM games WHERE id = ?", (game_id,)).fetchone()[0]
    rows = []
    for e in episodes:
        d = e["data"]
        t_ref = d.get("push_t") if d.get("push_t") is not None else d.get("change_t", e["t0"])
        vt = start + t_ref
        who = f"attaque {e['team']} : " + ", ".join(str(a["slot"]) for a in d["attackers"])
        fd = d.get("first_death")
        rows.append(f"| {game_id} | {vt:.0f} s ({ec.mmss(vt)}) | retake point {e['point']} | {e['outcome']} | {who}" + (f" ; premier mort le {fd['slot']} a {fd['t']:.0f} s de jeu" if fd else "") + " |")
    return rows


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Calcule les épisodes de retake d'une game.")
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
        if args.sheet:
            print("\n".join(sheet_rows(conn, args.game, episodes)))
        else:
            counts = {}
            for e in episodes:
                counts[e["outcome"]] = counts.get(e["outcome"], 0) + 1
            print(json.dumps({MODULE: len(episodes), "par_resultat": counts, "poussees_ecartees": stats}, ensure_ascii=False))
        return 0
    print(json.dumps({MODULE: compute(conn, args.game)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
