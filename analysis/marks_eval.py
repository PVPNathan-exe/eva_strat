"""Erreur du suivi mesurée sur les positions et les regards posés à la main (onglet Lecture).

  python analysis/marks_eval.py --game 26          erreur du suivi SANS les corrections, aux instants corrigés
  python analysis/marks_eval.py --game 26 --all    et le détail de chaque correction

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

ARENA_M = (31.0, 16.5)


def errors(rows, marks, times):
    """[(t, joueur, erreur de position en mètres ou None, erreur de regard en degrés ou None)] du suivi `rows` aux instants des corrections."""
    by = {(r[0], r[2]): r for r in rows}
    ordered = sorted(times)
    out = []
    for t, slot, x, y, angle in marks:
        k = min(ordered, key=lambda j: abs(times[j] - t))
        r = by.get((k, slot))
        if r is None or not r[7]:
            out.append((t, slot, None, None))
            continue
        pos = math.hypot((r[4] - x) * ARENA_M[0], (r[5] - y) * ARENA_M[1])
        gaze = None if angle is None or r[6] is None else abs((r[6] - angle + 180) % 360 - 180)
        out.append((t, slot, pos, gaze))
    return out


def solve_without_marks(conn, game_id):
    g = dict(conn.execute("SELECT g.*, v.path, v.width, v.height, v.fps FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (game_id,)).fetchone())
    step_s = 6 / g["fps"]
    data = evaluate._load(conn, g, step_s)
    deaths = [(k["t"], k["victim_slot"]) for k in db.kills_of(conn, game_id)]
    rows = tracking.solve(data["frames"], step_s, deaths, data["states"], db.teleports_for(g["map"]), db.map_points(conn, g["map"], game_id), db.walk_mask_for(g["map"]),
                          data["noise"], db.spawns_for(g["map"]), db.reliability_for(g["map"]))
    return rows, {fi: t for fi, t, _ in data["frames"]}, g


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
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    marks = db.marks_of(conn, args.game)
    if not marks:
        print("Aucune correction pour cette game (onglet Lecture, « Corriger »).")
        return 1
    rows, times, g = solve_without_marks(conn, args.game)
    errs = errors(rows, marks, times)
    print(summary(errs))
    if args.all:
        for t, slot, pos, gaze in errs:
            n = slot if slot <= 4 else slot + 1
            print(f"{t - g['start_s']:7.1f} s  joueur {n}  position : {'?' if pos is None else f'{pos:.2f} m'}  regard : {'-' if gaze is None else f'{gaze:.0f} deg'}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
