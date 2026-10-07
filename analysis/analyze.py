"""CLI d'analyse : lit (ou télécharge) une vidéo, détecte les games, écrit dans SQLite.

Les événements sont écrits sur stdout, un objet JSON par ligne :
  {"event": "progress", "stage": "download" | "detect", "pct": 0-100}
  {"event": "done", "video_id": N, "games": N}
  {"event": "error", "message": "..."}
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

import db
import hud
import ingest
import segments

FRAME_W, FRAME_H = 640, 360


def print_event(event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def sample_flags(path, duration_s, step_s, on_progress):
    """Décode la vidéo à 1 image toutes les step_s secondes et teste le HUD."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(path),
        "-vf", f"fps=1/{step_s},scale={FRAME_W}:{FRAME_H}",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    frame_size = FRAME_W * FRAME_H * 3
    flags = []
    while True:
        buf = proc.stdout.read(frame_size)
        if len(buf) < frame_size:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(FRAME_H, FRAME_W, 3)
        flags.append(hud.hud_present(frame))
        if len(flags) % 10 == 0:
            on_progress(min(99.0, len(flags) * step_s / duration_s * 100))
    proc.wait()
    if proc.returncode:
        raise RuntimeError("ffmpeg n'a pas pu décoder la vidéo")
    return flags


def run(source, db_path, cache_dir, step_s, min_len_s, gap_s, emit=print_event):
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

    emit({"event": "progress", "stage": "detect", "pct": 0})
    flags = sample_flags(
        path, meta["duration_s"], step_s,
        lambda p: emit({"event": "progress", "stage": "detect", "pct": round(p, 1)}),
    )
    found = segments.build_segments(flags, step_s, min_len_s, gap_s)
    found = segments.clamp_segments(found, meta["duration_s"])
    db.replace_detected_games(conn, video_id, found)
    emit({"event": "done", "video_id": video_id, "games": len(found)})


def main(argv=None, emit=print_event):
    parser = argparse.ArgumentParser(description="Détecte les games d'une vidéo EVA.")
    parser.add_argument("--source", required=True, help="Chemin d'un .mp4 ou URL YouTube")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--cache", default="data/cache")
    parser.add_argument("--step", type=float, default=1.0, help="Secondes entre deux échantillons")
    parser.add_argument("--min-len", type=float, default=120.0, help="Durée minimale d'une game (s)")
    parser.add_argument("--gap", type=float, default=10.0, help="Coupure tolérée dans une game (s)")
    args = parser.parse_args(argv)
    try:
        run(args.source, args.db, args.cache, args.step, args.min_len, args.gap, emit)
    except Exception as exc:  # noqa: BLE001 - tout échec doit être signalé à l'UI
        emit({"event": "error", "message": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    # Sous Windows, stdout est en cp1252 par défaut : on force l'UTF-8 (Node décode en UTF-8).
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
