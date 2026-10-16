"""Réévalue les warnings « Chrono illisible sur cette zone » des games déjà analysées.

Un chrono illisible est déterminable quand il reprend exactement là où le temps écoulé le place (segments.GAP_DETERMINED_TOL_S) : l'ancien détecteur
posait un warning pour tout trou de lectures de 6 s ou plus. Les lectures du chrono ne sont pas gardées dans la base : on relit seulement les deux
bords de chaque zone (deux images par warning, début et fin de la zone, à la cadence de l'analyse) et on retire le warning quand le chrono colle.
Sans `--apply` rien n'est écrit : le script affiche ce qu'il retirerait.

  python analysis/recheck_doubts.py --video 17 [--db chemin] [--apply]
"""

import argparse
import json
import sys
from pathlib import Path

import segments

LABEL = "Chrono illisible sur cette zone"
ZONES_PATH = Path(__file__).with_name("default_zones.json")


def edge_reading(path, zone, width, height, t, templates):
    """Chrono (secondes restantes) lu à l'instant t de la vidéo, ou None (première image de la plage de 1,5 s)."""
    import timer

    for _, crop in timer.iter_crops(path, zone, width, height, t0=max(0.0, t), t1=max(0.0, t) + 1.5):
        return timer.read_timer(crop, templates)
    return None


def is_determined(v_before, v_after, gap_s):
    """Vrai si le chrono lu des deux côtés colle au temps écoulé (à GAP_DETERMINED_TOL_S près)."""
    if v_before is None or v_after is None:
        return False  # un bord illisible : on ne tranche pas, le warning reste
    return abs((v_before - v_after) - gap_s) <= segments.GAP_DETERMINED_TOL_S


def recheck_game(game, video, zone, templates, reader=None):
    """Renvoie (doutes gardés, doutes retirés avec leurs lectures) pour une game. `reader(t)` : lecture du chrono à t (injectable pour les tests)."""
    read = reader or (lambda t: edge_reading(video["path"], zone, video["width"], video["height"], t, templates))
    kept, dropped = [], []
    for d in game["doubts"]:
        if d.get("label") != LABEL:
            kept.append(d)
            continue
        before, after = read(d["start_s"]), read(d["end_s"])
        if is_determined(before, after, d["end_s"] - d["start_s"]):
            dropped.append({**d, "before": before, "after": after})
        else:
            kept.append(d)
    return kept, dropped


def main(argv=None):
    import db
    import paths
    import timer

    parser = argparse.ArgumentParser(description="Retire les warnings de chrono illisible que le chrono lu de part et d'autre rend déterminables.")
    parser.add_argument("--video", type=int, required=True)
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--apply", action="store_true", help="Écrit le résultat dans la base (sans cette option : affichage seulement)")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    video = conn.execute("SELECT id, path, width, height FROM videos WHERE id = ?", (args.video,)).fetchone()
    if video is None or not Path(video["path"]).exists():
        print("Vidéo inconnue ou absente du disque", file=sys.stderr)
        return 1
    zone = json.loads(ZONES_PATH.read_text(encoding="utf-8"))["timer"]
    templates = timer.load_templates()
    total = 0
    for row in conn.execute("SELECT id, doubts FROM games WHERE video_id = ? AND doubts IS NOT NULL ORDER BY start_s", (args.video,)).fetchall():
        game = {"id": row["id"], "doubts": json.loads(row["doubts"] or "[]")}
        kept, dropped = recheck_game(game, video, zone, templates)
        for d in dropped:
            print(f"game {game['id']} : retiré à {d['start_s']:.0f} s (chrono {d['before']} puis {d['after']} pour {d['end_s'] - d['start_s']:.0f} s écoulées)")
        if dropped and args.apply:
            conn.execute("UPDATE games SET doubts = ? WHERE id = ?", (json.dumps(kept, ensure_ascii=False) if kept else None, game["id"]))
            conn.commit()
        total += len(dropped)
    print(json.dumps({"retirés": total, "écrit": bool(args.apply)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
