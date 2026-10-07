"""CLI d'analyse : lit (ou télécharge) une vidéo et l'enregistre dans SQLite (les games sont posées à la main).

Les événements sont écrits sur stdout, un objet JSON par ligne :
  {"event": "progress", "stage": "download", "pct": 0-100}
  {"event": "done", "video_id": N}
  {"event": "error", "message": "..."}
"""

import argparse
import json
import sys
from pathlib import Path

import db
import ingest


def print_event(event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def run(source, db_path, cache_dir, emit=print_event):
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

    emit({"event": "done", "video_id": video_id})


def main(argv=None, emit=print_event):
    parser = argparse.ArgumentParser(description="Enregistre une vidéo EVA (fichier local ou URL).")
    parser.add_argument("--source", required=True, help="Chemin d'un .mp4 ou URL YouTube")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--cache", default="data/cache")
    args = parser.parse_args(argv)
    try:
        run(args.source, args.db, args.cache, emit)
    except Exception as exc:  # noqa: BLE001 - tout échec doit être signalé à l'UI
        emit({"event": "error", "message": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    # Sous Windows, stdout est en cp1252 par défaut : on force l'UTF-8 (Node décode en UTF-8).
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
