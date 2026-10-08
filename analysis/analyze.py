"""CLI d'analyse : lit (ou télécharge) une vidéo, détecte les games par le chrono et enregistre le tout dans SQLite.

Les événements sont écrits sur stdout, un objet JSON par ligne :
  {"event": "progress", "stage": "download" | "detect" | "maps", "pct": 0-100}
  {"event": "done", "video_id": N}
  {"event": "error", "message": "..."}
"""

import argparse
import json
import sys
from pathlib import Path

import db
import ingest
import mapname
import segments
import timer

ZONES_PATH = Path(__file__).with_name("default_zones.json")


def print_event(event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def detect(path, meta, emit, pre_roll, post_roll):
    """Lit le chrono toutes les secondes (zone par défaut) et en déduit les games."""
    zone = json.loads(ZONES_PATH.read_text(encoding="utf-8"))["timer"]
    templates = timer.load_templates()
    samples, last_pct = [], -1
    for t, crop in timer.iter_crops(path, zone, meta["width"], meta["height"]):
        samples.append((t, timer.read_timer(crop, templates)))
        pct = int(100 * t / max(meta["duration_s"], 1))
        if pct != last_pct:
            last_pct = pct
            emit({"event": "progress", "stage": "detect", "pct": pct})
    return segments.detect_games(samples, meta["duration_s"], pre_roll=pre_roll, post_roll=post_roll)


def fill_maps(conn, video_id, path, meta, emit):
    """Apprend le nom des cartes que l'utilisateur a étiquetées, puis remplit les games sans carte.
    Une carte déjà choisie n'est jamais écrasée ; une carte non reconnue reste vide."""
    games = [dict(r) for r in conn.execute("SELECT id, start_s, end_s, map FROM games WHERE video_id = ? ORDER BY start_s", (video_id,))]
    templates = mapname.load_templates()
    for g in games:
        if g["map"] and g["map"] not in templates:
            masks = mapname.game_masks(path, g, meta["width"], meta["height"])
            if masks:
                mapname.save_template(masks[len(masks) // 2], g["map"])
                templates = mapname.load_templates()
    todo = [g for g in games if not g["map"]]
    for i, g in enumerate(todo):
        emit({"event": "progress", "stage": "maps", "pct": round(100 * i / max(len(todo), 1))})
        name = mapname.recognize_game(path, g, meta["width"], meta["height"], templates)
        if name:
            conn.execute("UPDATE games SET map = ? WHERE id = ? AND map IS NULL", (name, g["id"]))
    conn.commit()


def run(source, db_path, cache_dir, emit=print_event, do_detect=True, pre_roll=segments.PRE_ROLL_S, post_roll=segments.POST_ROLL_S):
    conn = db.connect(db_path)
    source_url = None

    if ingest.is_url(source):
        emit({"event": "progress", "stage": "download", "pct": 0})
        path = ingest.download(
            source.strip(), cache_dir,
            lambda p: emit({"event": "progress", "stage": "download", "pct": round(p, 1)}),
        )
        source_url = source.strip()
    else:
        path = Path(ingest.clean_path(source))
        if not path.is_file():
            raise FileNotFoundError(f"Fichier introuvable : {path}")

    meta = ingest.probe(path)
    video_id = db.upsert_video(conn, str(path.resolve()), source_url, **meta)

    if do_detect:
        emit({"event": "progress", "stage": "detect", "pct": 0})
        db.replace_detected_games(conn, video_id, detect(path, meta, emit, pre_roll, post_roll))
    fill_maps(conn, video_id, path, meta, emit)

    emit({"event": "done", "video_id": video_id})


def main(argv=None, emit=print_event):
    parser = argparse.ArgumentParser(description="Enregistre une vidéo EVA (fichier local ou URL).")
    parser.add_argument("--source", required=True, help="Chemin d'un .mp4 ou URL YouTube")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--cache", default="data/cache")
    parser.add_argument("--no-detect", action="store_true", help="Ne pas chercher les games (vidéo d'une seule game)")
    parser.add_argument("--pre-roll", type=float, default=segments.PRE_ROLL_S, help="Secondes gardées avant le départ du chrono")
    parser.add_argument("--post-roll", type=float, default=segments.POST_ROLL_S, help="Secondes gardées après la fin du chrono (écran de victoire)")
    args = parser.parse_args(argv)
    try:
        run(args.source, args.db, args.cache, emit, do_detect=not args.no_detect, pre_roll=args.pre_roll, post_roll=args.post_roll)
    except Exception as exc:  # noqa: BLE001 - tout échec doit être signalé à l'UI
        emit({"event": "error", "message": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    # Sous Windows, stdout est en cp1252 par défaut : on force l'UTF-8 (Node décode en UTF-8).
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
