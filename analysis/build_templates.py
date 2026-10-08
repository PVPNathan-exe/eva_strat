"""Génère digit_templates.npz à partir d'une vidéo dont on connaît le chrono.

Usage : python build_templates.py VIDEO --t0 T0 --start-value SECONDES [--from A --to B]
Le chrono vaut `start_value - (t - t0)` à l'instant t de la vidéo (t0 = instant où il quitte sa valeur de départ).
"""

import argparse
import json
from pathlib import Path

import numpy as np

import ingest
import timer

ZONES = json.loads(Path(__file__).with_name("default_zones.json").read_text(encoding="utf-8"))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("video")
    p.add_argument("--t0", type=float, required=True)
    p.add_argument("--start-value", type=int, required=True)
    p.add_argument("--from", dest="t_from", type=float, default=None)
    p.add_argument("--to", dest="t_to", type=float, default=None)
    args = p.parse_args()

    meta = ingest.probe(Path(args.video))
    t_from = args.t_from if args.t_from is not None else args.t0 + 2
    t_to = args.t_to if args.t_to is not None else meta["duration_s"] - 2
    acc = {}
    for t, crop in timer.iter_crops(args.video, ZONES["timer"], meta["width"], meta["height"]):
        if not t_from <= t <= t_to:
            continue
        value = args.start_value - round(t - args.t0)
        parts = timer.glyphs(crop)
        if parts is None:
            continue
        text = f"{value // 60:02d}{value % 60:02d}"
        for glyph, ch in zip((parts[0], parts[1], parts[3], parts[4]), text):
            acc.setdefault(ch, []).append(timer._normalize(glyph))
    missing = [c for c in "0123456789" if c not in acc]
    if missing:
        raise SystemExit(f"Chiffres jamais vus : {missing}")
    np.savez_compressed(timer.TEMPLATES_PATH, **{c: np.mean(v, axis=0) for c, v in acc.items()})
    print({c: len(v) for c, v in sorted(acc.items())})


if __name__ == "__main__":
    main()
