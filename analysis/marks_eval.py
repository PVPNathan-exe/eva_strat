"""Erreur du suivi mesurée sur les positions et les regards posés à la main (onglet Lecture).

  python analysis/marks_eval.py --game 26          erreur du suivi SANS les corrections, aux instants corrigés
  python analysis/marks_eval.py --game 26 --all    et le détail de chaque correction (image d'analyse rattachée, décalage de temps)
  python analysis/marks_eval.py --game 26 --lag    décalage de temps du suivi par rapport à ce que l'utilisateur a vu (négatif : le suivi anticipe)
  python analysis/marks_eval.py --game 26 --holdout   corrections une sur deux données au suivi, erreur mesurée sur les autres : ce que valent les corrections pour le reste

Le suivi est recalculé en mémoire sans les corrections (la base n'est pas modifiée), puis comparé à ce que l'utilisateur a posé : écart de position (en mètres, arène de
31 x 16,5 m) et écart de regard (degrés, sens compris). C'est la mesure à améliorer : un changement de l'algorithme est bon s'il la fait baisser sur les corrections
déjà faites sans la dégrader ailleurs (accord avec les bandeaux, positions confirmées)."""

import argparse
import math
import statistics
import sys

import db
import evaluate
import tracking
import paths

ARENA_M = (31.0, 16.5)


def errors(rows, marks, times):
    """[(t, joueur, erreur de position en mètres ou None, erreur de regard en degrés ou None)] du suivi `rows` aux instants des corrections."""
    by = {(r[0], r[2]): r for r in rows}
    ordered = sorted(times)
    out = []
    for t, slot, x, y, angle in marks:
        k = min(ordered, key=lambda j: abs(times[j] + tracking.FRAME_LAG_S - t))
        r = by.get((k, slot))
        if r is None or not r[7]:
            out.append((t, slot, None, None))
            continue
        pos = math.hypot((r[4] - x) * ARENA_M[0], (r[5] - y) * ARENA_M[1])
        gaze = None if angle is None or r[6] is None else abs((r[6] - angle + 180) % 360 - 180)
        out.append((t, slot, pos, gaze))
    return out


def solve_with(conn, game_id, marks):
    """Suivi recalculé en mémoire avec les corrections `marks` (liste vide : sans). La base n'est pas modifiée."""
    import weapons

    g = dict(conn.execute("SELECT g.*, v.path, v.width, v.height, v.fps FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (game_id,)).fetchone())
    step_s = 6 / g["fps"]
    data = evaluate._load(conn, g, step_s)
    names = weapons.display_names()
    deaths = [(k["t"], k["victim_slot"]) for k in db.kills_of(conn, game_id)]
    kills = db.kill_tuples(conn, game_id, names)
    rows = tracking.solve(data["frames"], step_s, deaths, data["states"], db.teleports_for(g["map"]), db.map_points(conn, g["map"], game_id), db.walk_mask_for(g["map"]),
                          data["noise"], db.spawns_for(g["map"]), db.reliability_for(g["map"]), None, marks, kills, db.stations_for(g["map"]), db.rotors_for(g["map"], g["start_s"]), db.button_doors_for(g["map"]), db.see_through_for(g["map"]))
    return rows, {fi: t for fi, t, _ in data["frames"]}, g


def solve_without_marks(conn, game_id):
    g = dict(conn.execute("SELECT g.*, v.path, v.width, v.height, v.fps FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (game_id,)).fetchone())
    step_s = 6 / g["fps"]
    data = evaluate._load(conn, g, step_s)
    deaths = [(k["t"], k["victim_slot"]) for k in db.kills_of(conn, game_id)]
    rows = tracking.solve(data["frames"], step_s, deaths, data["states"], db.teleports_for(g["map"]), db.map_points(conn, g["map"], game_id), db.walk_mask_for(g["map"]),
                          data["noise"], db.spawns_for(g["map"]), db.reliability_for(g["map"]), stations=db.stations_for(g["map"]), rotors=db.rotors_for(g["map"], g["start_s"]), doors=db.button_doors_for(g["map"]), see=db.see_through_for(g["map"]))
    return rows, {fi: t for fi, t, _ in data["frames"]}, g


LAG_FRAMES = 6  # décalages d'images essayés de chaque côté


def lags(rows, marks, times, min_speed_ms=1.0):
    """Décalage de temps du suivi : pour chaque correction d'un joueur qui avance, l'image (k + d) du suivi la plus proche de la position posée. d négatif : la position posée
    n'est atteinte qu'à une image plus tôt, le suivi anticipe ; d positif : il traîne. Renvoie [(t, joueur, d, erreur à d en mètres, erreur à d = 0 en mètres)]."""
    by = {(r[0], r[2]): r for r in rows}
    ordered = sorted(times)
    out = []
    for t, slot, x, y, _ in marks:
        k = min(ordered, key=lambda j: abs(times[j] + tracking.FRAME_LAG_S - t))
        here, before, after = by.get((k, slot)), by.get((k - 3, slot)), by.get((k + 3, slot))
        if not here or not before or not after or not (here[7] and before[7] and after[7]):
            continue
        dt = max(times.get(k + 3, 0) - times.get(k - 3, 0), 1e-6)
        if math.hypot((after[4] - before[4]) * ARENA_M[0], (after[5] - before[5]) * ARENA_M[1]) / dt < min_speed_ms:
            continue  # à l'arrêt : le décalage ne se mesure pas
        cand = []
        for d in range(-LAG_FRAMES, LAG_FRAMES + 1):
            r = by.get((k + d, slot))
            if r and r[7]:
                cand.append((math.hypot((r[4] - x) * ARENA_M[0], (r[5] - y) * ARENA_M[1]), d))
        if cand:
            err, d = min(cand)
            out.append((t, slot, d, err, math.hypot((here[4] - x) * ARENA_M[0], (here[5] - y) * ARENA_M[1])))
    return out


def lag_summary(lg):
    if not lg:
        return {"corrections_en_mouvement": 0}
    ds = [e[2] for e in lg]
    return {
        "corrections_en_mouvement": len(lg),
        "decalage_median_images": statistics.median(ds),
        "decalage_moyen_images": round(statistics.mean(ds), 2),
        "anticipe": sum(1 for d in ds if d < 0),
        "traine": sum(1 for d in ds if d > 0),
        "exact": sum(1 for d in ds if d == 0),
        "erreur_m_sans_decalage": round(statistics.median(e[4] for e in lg), 2),
        "erreur_m_au_meilleur_decalage": round(statistics.median(e[3] for e in lg), 2),
    }


def summary(errs):
    pos = [e[2] for e in errs if e[2] is not None]
    gaze = [e[3] for e in errs if e[3] is not None]
    return {
        "corrections": len(errs),
        "position_mediane_m": round(statistics.median(pos), 2) if pos else None,
        "position_moyenne_m": round(statistics.mean(pos), 2) if pos else None,
        "position_sup_1m": sum(1 for p in pos if p > 1.0),
        "regard_median_deg": round(statistics.median(gaze)) if gaze else None,
        "regard_sup_60": sum(1 for a in gaze if a > 60),
        "regards_corriges": len(gaze),
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Erreur du suivi mesurée sur les corrections de l'utilisateur.")
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--lag", action="store_true")
    parser.add_argument("--holdout", action="store_true")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    marks = db.marks_of(conn, args.game)
    if not marks:
        print("Aucune correction pour cette game (onglet Lecture, « Corriger »).")
        return 1
    db.index_marks(conn, args.game)
    rows, times, g = solve_with(conn, args.game, [])
    errs = errors(rows, marks, times)
    print("sans corrections :", summary(errs))
    if args.lag:
        print("décalage de temps :", lag_summary(lags(rows, marks, times)))
    if args.holdout:
        given, held = marks[0::2], marks[1::2]
        rows2, times2, _ = solve_with(conn, args.game, given)
        print("sur les corrections non données, sans :", summary(errors(rows, held, times)))
        print("sur les corrections non données, avec la moitié donnée :", summary(errors(rows2, held, times2)))
    if args.all:
        info = {(round(r["t"], 3), r["slot"]): (r["frame"], r["frame_t"]) for r in conn.execute("SELECT t, slot, frame, frame_t FROM user_marks WHERE game_id = ?", (args.game,))}
        for (t, slot, pos, gaze), m in zip(errs, marks):
            frame, frame_t = info.get((round(m[0], 3), m[1]), (None, None))
            n = slot if slot <= 4 else slot + 1
            where = "" if frame is None else f"  image {frame} ({frame_t - g['start_s']:.2f} s, correction à {t - g['start_s']:.2f} s)"
            print(f"{t - g['start_s']:7.1f} s  joueur {n}  position : {'?' if pos is None else f'{pos:.2f} m'}  regard : {'-' if gaze is None else f'{gaze:.0f} deg'}{where}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
