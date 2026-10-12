"""Carte des endroits où le suivi est peu fiable (positions et regards), par carte du jeu.

  python analysis/reliability.py --map Polaris          toutes les games analysées de cette carte
  python analysis/reliability.py --map Polaris --show   résumé des cases douteuses, sans rien écrire

La carte est découpée en cases (GRID x GRID). Pour chaque case, sur les games analysées :
  - positions : part des positions vivantes que la vraie minimap ne confirme pas (superpose.py --store) ;
  - regards : part des directions brutes des disques (avant le choix de sens, le cap et le lissage du suivi) d'un joueur non observé qui s'écartent de plus de
    90 degrés de son cap quand il avance, ou de son regard final quand il est arrêté. Un joueur en mouvement regarde presque toujours où il avance (92 % des
    lignes finales des joueurs non observés), le cap est donc un témoin indépendant de la forme du disque.
Une case est « douteuse » quand elle a assez de lignes et un taux au moins double de celui de la carte entière. Le fichier analysis/map_reliability/<Carte>.json est
affiché par le site (calque « Zones peu fiables ») et lu par tracking.py, qui s'y méfie davantage du regard et abaisse la confiance des positions."""

import argparse
import json
import math
import sys
from pathlib import Path

import db

GRID = 16  # cases par côté
MIN_ROWS_POS = 40  # lignes minimales dans une case pour juger ses positions
MIN_ROWS_GAZE = 25  # ... et ses regards
RATIO = 2.0  # taux d'une case douteuse, en multiples du taux de la carte
MIN_RATE_POS = 0.03  # et taux minimal (une carte presque parfaite n'a pas de case « 2 fois pire » à 0,2 %)
MIN_RATE_GAZE = 0.20
READ_CONF = 0.7
MOVE_MIN_MS, MOVE_MAX_MS = 2.0, 9.0  # vitesses (m/s) où le cap est une mesure : en mouvement, sans saut
RAW_MATCH = 0.02  # distance (relative à la minimap) entre une ligne du suivi et la détection brute qui l'a produite
ARENA_M = (31.0, 16.5)
MAPS_DIR = Path(__file__).with_name("map_reliability")


def _cell(x, y):
    return min(GRID - 1, max(0, int(x * GRID))), min(GRID - 1, max(0, int(y * GRID)))


def _raw_angles(conn, gid, step):
    """{(image, équipe): [(x, y, angle brut)]} : les directions telles que les disques les donnent, avant tout choix de sens ou lissage du suivi."""
    import evaluate

    g = dict(conn.execute("SELECT g.*, v.path, v.width, v.height, v.fps FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (gid,)).fetchone())
    out = {}
    for fi, _, dets in evaluate._load(conn, g, step)["frames"]:
        for d in dets:
            if d["alive"] and d.get("angle") is not None and not d.get("spectated"):
                out.setdefault((fi, d["team"]), []).append((d["x"], d["y"], d["angle"]))
    return out


def collect(conn, game_ids):
    """Compteurs par case sur les games données : {(i, j): {"n", "pos_bad", "gaze_n", "gaze_bad"}}.
    Regard : la direction brute du disque (sans le choix de sens, le cap ni le lissage du suivi) d'un joueur non observé, lu avec certitude, est fausse si elle
    s'écarte de plus de 90 degrés du cap d'un joueur en mouvement, ou du regard final d'un joueur arrêté (qui est stabilisé sur la durée)."""
    cells = {}

    def at(i, j):
        return cells.setdefault((i, j), {"n": 0, "pos_bad": 0, "gaze_n": 0, "gaze_bad": 0})

    for gid in game_ids:
        step = 6 / conn.execute("SELECT v.fps FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (gid,)).fetchone()["fps"]
        rows = {(r["frame"], r["slot"]): r for r in conn.execute("SELECT frame, t, slot, team, x, y, angle, alive, confidence FROM samples WHERE game_id = ? AND alive = 1", (gid,))}
        bad = set(db.flags_of(conn, gid, "unconfirmed"))
        observed = [(r["slot"], r["t0"], r["t1"]) for r in conn.execute("SELECT slot, t0, t1 FROM observed_segments WHERE game_id = ?", (gid,))]
        is_observed = lambda slot, t: any(s == slot and a <= t <= b for s, a, b in observed)
        raw = _raw_angles(conn, gid, step)
        for (k, slot), r in rows.items():
            i, j = _cell(r["x"], r["y"])
            c = at(i, j)
            c["n"] += 1
            c["pos_bad"] += (k, slot) in bad
            if r["angle"] is None or r["confidence"] < READ_CONF or is_observed(slot, r["t"]):
                continue  # le regard du joueur observé suit son cap par construction : il ne mesure rien
            near = [d for d in raw.get((k, r["team"]), []) if math.hypot(d[0] - r["x"], d[1] - r["y"]) < RAW_MATCH]
            if not near:
                continue
            reading = min(near, key=lambda d: math.hypot(d[0] - r["x"], d[1] - r["y"]))[2]
            a, b = rows.get((k - 3, slot)), rows.get((k + 3, slot))
            if not a or not b:
                continue
            dx, dy = (b["x"] - a["x"]) * ARENA_M[0], (b["y"] - a["y"]) * ARENA_M[1]
            speed = math.hypot(dx, dy) / (6 * step)
            if speed > MOVE_MAX_MS:
                continue
            reference = math.degrees(math.atan2(dy, dx)) % 360 if speed >= MOVE_MIN_MS else r["angle"]
            c["gaze_n"] += 1
            c["gaze_bad"] += abs((reading - reference + 180) % 360 - 180) > 90
    return cells


def summarize(cells):
    """Taux de la carte entière et liste des cases douteuses : {"rate_pos", "rate_gaze", "cells": [{i, j, n, pos_rate, pos_flag, gaze_n, gaze_rate, gaze_flag}]}."""
    n = sum(c["n"] for c in cells.values())
    gn = sum(c["gaze_n"] for c in cells.values())
    rate_pos = sum(c["pos_bad"] for c in cells.values()) / max(n, 1)
    rate_gaze = sum(c["gaze_bad"] for c in cells.values()) / max(gn, 1)
    out = []
    for (i, j), c in sorted(cells.items()):
        pos_rate = c["pos_bad"] / max(c["n"], 1)
        gaze_rate = c["gaze_bad"] / max(c["gaze_n"], 1)
        out.append({
            "i": i, "j": j, "n": c["n"], "pos_rate": round(pos_rate, 4),
            "pos_flag": c["n"] >= MIN_ROWS_POS and pos_rate >= max(MIN_RATE_POS, RATIO * rate_pos),
            "gaze_n": c["gaze_n"], "gaze_rate": round(gaze_rate, 4),
            "gaze_flag": c["gaze_n"] >= MIN_ROWS_GAZE and gaze_rate >= max(MIN_RATE_GAZE, RATIO * rate_gaze),
        })
    return {"grid": GRID, "rate_pos": round(rate_pos, 4), "rate_gaze": round(rate_gaze, 4), "cells": out}


def load(map_name):
    """Carte de fiabilité enregistrée pour une carte du jeu, ou None."""
    path = MAPS_DIR / f"{map_name}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def flagged_cells(report, kind):
    """Ensemble des cases (i, j) douteuses pour 'pos' ou 'gaze' d'une carte de fiabilité (vide si None)."""
    if not report:
        return set()
    return {(c["i"], c["j"]) for c in report["cells"] if c[f"{kind}_flag"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Carte des zones où le suivi est peu fiable.")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--map", required=True)
    parser.add_argument("--show", action="store_true")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    ids = [r["id"] for r in conn.execute("SELECT g.id FROM games g WHERE g.map = ? AND EXISTS (SELECT 1 FROM sample_flags f WHERE f.game_id = g.id) ORDER BY g.id", (args.map,))]
    if not ids:
        print("Aucune game de cette carte avec positions contrôlées (python analysis/superpose.py --game N --store).")
        return 1
    report = summarize(collect(conn, ids))
    report.update({"map": args.map, "games": ids})
    pos = [c for c in report["cells"] if c["pos_flag"]]
    gaze = [c for c in report["cells"] if c["gaze_flag"]]
    print(f"{args.map} ({len(ids)} games) : positions non confirmées {report['rate_pos'] * 100:.1f} %, regards faux {report['rate_gaze'] * 100:.1f} % ; "
          f"{len(pos)} cases douteuses pour les positions, {len(gaze)} pour les regards")
    if not args.show:
        MAPS_DIR.mkdir(exist_ok=True)
        (MAPS_DIR / f"{args.map}.json").write_text(json.dumps(report, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
