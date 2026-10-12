"""Zones de départ des équipes d'une carte, trouvées sur la médiane de la minimap (map_mask.py enregistre <Carte>_mediane.png).

  python analysis/map_spawn.py --all                  affiche les zones trouvées pour chaque carte
  python analysis/map_spawn.py --all --write          les écrit dans analysis/map_spawns.json (sans toucher aux cartes déjà réglées à la main : Polaris)

Une zone de départ est une grande tache vive de la couleur de l'équipe (orange : équipe A, à gauche ; bleu : équipe B). La boîte de capture est teintée aussi mais plus sombre :
on la distingue par la luminosité (au moins MIN_VALUE). Une équipe peut avoir plusieurs zones (Artefact : deux plateformes de départ par équipe). Une carte dont les zones sont
sombres (Outlaw) n'a pas de zone trouvée : le suivi garde alors le comportement d'avant (la couleur autour du disque décide seule)."""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
MASK_DIR = HERE / "map_masks"
OUT = HERE / "map_spawns.json"
MIN_VALUE = 140  # luminosité moyenne d'une zone de départ (la boîte de capture est à 118 à 134)
MIN_SAT = 110
MIN_AREA = 300  # pixels de la minimap lue
MARGIN = 0.01  # marge ajoutée autour de la tache
HUES = {"A": (5, 22), "B": (100, 120)}
MANUAL = {"Polaris"}  # réglées à la main, jamais écrasées


def find_zones(median):
    """{"A": [rect, ...], "B": [...]} : rectangles (x0, y0, x1, y1, fractions de la minimap) des taches vives de chaque couleur d'équipe."""
    h, w = median.shape[:2]
    hsv = cv2.cvtColor(median, cv2.COLOR_BGR2HSV)
    out = {}
    for team, (lo, hi) in HUES.items():
        m = ((hsv[:, :, 0] >= lo) & (hsv[:, :, 0] <= hi) & (hsv[:, :, 1] >= MIN_SAT) & (hsv[:, :, 2] >= 100)).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
        n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
        rects = []
        for i in range(1, n):
            x, y, bw, bh, a = stats[i]
            if a >= MIN_AREA and hsv[:, :, 2][lab == i].mean() >= MIN_VALUE:
                rects.append([round(float(max(x / w - MARGIN, 0.0)), 3), round(float(max(y / h - MARGIN, 0.0)), 3), round(float(min((x + bw) / w + MARGIN, 1.0)), 3), round(float(min((y + bh) / h + MARGIN, 1.0)), 3)])
        if rects:
            out[team] = sorted(rects)
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description="Zones de départ des équipes d'une carte.")
    parser.add_argument("--map")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args(argv)
    maps = [p.name[: -len("_mediane.png")] for p in sorted(MASK_DIR.glob("*_mediane.png"))] if args.all else [args.map]
    known = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for m in maps:
        median = cv2.imread(str(MASK_DIR / f"{m}_mediane.png"))
        zones = find_zones(median) if median is not None else {}
        complete = "A" in zones and "B" in zones
        print(f"{m} : {'équipe A ' + str(zones.get('A')) + ' ; équipe B ' + str(zones.get('B')) if complete else 'zones de départ non trouvées'}" + (" (réglée à la main, inchangée)" if m in MANUAL else ""))
        if args.write and complete and m not in MANUAL:
            known[m] = {team: (rects[0] if len(rects) == 1 else rects) for team, rects in zones.items()}
    if args.write:
        OUT.write_text(json.dumps(known, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
