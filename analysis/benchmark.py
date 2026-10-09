"""Mesure la vitesse des étapes de l'analyse sur ce PC, pour comparer deux machines.

  python analysis/benchmark.py --video Ceres.mp4 [--seconds 30]

Chaque étape est chronométrée sur un extrait de la vidéo : décodage des recadrages, lecture de la minimap (un puis plusieurs processus),
suivi, une extraction d'image isolée (utilisée pour l'équipement, l'arme des kills et les images candidates des icônes).
La machine (cœurs, mémoire) est affichée avec les résultats."""

import argparse
import os
import sys
import time

import db
import names
import positions
import timer
import tracking


def machine():
    free = positions._free_ram_mb()
    return f"{os.cpu_count()} cœurs logiques, mémoire libre {free if free is not None else '?'} Mo, processus de lecture retenus {positions._workers()}"


def main(argv=None):
    parser = argparse.ArgumentParser(description="Chronomètre les étapes de l'analyse.")
    parser.add_argument("--video", default="Ceres.mp4")
    parser.add_argument("--seconds", type=float, default=30.0, help="Durée de l'extrait mesuré")
    parser.add_argument("--db", default="data/eva.db")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    import ingest

    meta = ingest.probe(args.video)
    zone = db.zone_for(conn, None, "minimap")
    game = {"start_s": 1.0, "end_s": 1.0 + args.seconds}
    step = 6 / meta["fps"]
    print(machine())
    out = []

    t = time.time()
    n = sum(1 for _ in timer.iter_crops(args.video, zone, meta["width"], meta["height"], step_s=step, t0=game["start_s"], t1=game["end_s"]))
    out.append(("décodage des recadrages de la minimap", time.time() - t, f"{n} images"))

    t = time.time()
    frames = positions.detect_frames(args.video, game, zone, meta["width"], meta["height"], step_s=step, workers=1)
    out.append(("lecture de la minimap, 1 processus", time.time() - t, f"{len(frames)} images"))

    workers = positions._workers()
    if workers > 1:
        t = time.time()
        positions.detect_frames(args.video, game, zone, meta["width"], meta["height"], step_s=step, workers=workers)
        out.append((f"lecture de la minimap, {workers} processus", time.time() - t, f"{len(frames)} images"))

    t = time.time()
    rows = tracking.solve(frames, step, None, None)
    out.append(("suivi des joueurs", time.time() - t, f"{len(rows)} lignes"))

    t = time.time()
    for k in range(5):
        names._grab(args.video, game["start_s"] + 3 + k, zone, meta["width"], meta["height"])
    out.append(("extraction d'une image isolée (moyenne)", (time.time() - t) / 5, "ffmpeg lancé à chaque fois"))

    print(f"{'étape':<46}{'durée (s)':>10}  détail")
    for label, seconds, detail in out:
        print(f"{label:<46}{seconds:>10.2f}  {detail}")
    per_frame = next(s for l, s, _ in out if l.startswith("lecture de la minimap, 1")) / max(len(frames), 1)
    print(f"\nlecture de la minimap : {per_frame * 1000:.0f} ms par image, soit environ {per_frame * (240 / step) / 60:.1f} min pour une game de 4 min (1 processus)")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
