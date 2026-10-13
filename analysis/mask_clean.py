"""Nettoie les masques de zones praticables : retire les taches et les trous minuscules, sans toucher aux couloirs fins, aux traits de mur fins ni aux grands trous.

  python analysis/mask_clean.py                  mesure l'effet sur toutes les cartes sans rien écrire
  python analysis/mask_clean.py --write          écrit les masques nettoyés (analysis/map_masks/<Carte>.png)
  python analysis/mask_clean.py --map Silva      une seule carte

Deux opérations, dans cet ordre (seuils en pixels de la grille 400 x 400 du masque) :
  1. une tache praticable de moins de MIN_SPECK pixels est retirée (reflet, pixel de bruit), sauf si au moins MIN_READS lectures sûres y sont tombées (Atlantis : de petites plates-formes
     réelles, 0,54 point de lectures sûres refusées en plus quand on les retirait toutes) ;
  2. un trou de moins de MIN_HOLE pixels est rebouché (reste de trait de mur, pixel mal classé) ;
Pas de filtre médian : essayé, il effaçait des traits de mur de 1 à 2 pixels (jusqu'à 4 % des pixels des traits de mur de Ceres devenaient praticables) pour un gain négligeable.
Mesures faites par `main` : part des lectures sûres refusées avant et après (elle ne doit pas monter), nombre de taches, part de pixels changés. `apply` (map_annotations.py) appelle
`clean` à chaque « Appliquer » : un masque appliqué est déjà propre."""

import argparse
import sqlite3
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
MASKS = HERE / "map_masks"
MIN_SPECK = 40  # une tache praticable plus petite est du bruit (mesuré : 90 % des taches blanches des masques font moins de 20 pixels, très peu entre 20 et 60)
MIN_HOLE = 24  # un trou plus petit est rebouché
MIN_READS = 3  # une petite tache qui porte au moins ce nombre de lectures sûres est un vrai sol
SURE_CONFIDENCE = 0.9


def _drop_small(binary, min_area, points=None):
    """Retire de `binary` (bool) les composantes connexes (4 voisins) de moins de min_area pixels, sauf celles qui portent au moins MIN_READS des `points` (fractions, n x 2)."""
    n, lab, stats, _ = cv2.connectedComponentsWithStats(binary.astype(np.uint8), connectivity=4)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    if points is not None and len(points):
        h, w = binary.shape
        hit = lab[np.clip((points[:, 1] * h).astype(int), 0, h - 1), np.clip((points[:, 0] * w).astype(int), 0, w - 1)]
        counts = np.bincount(hit[hit > 0], minlength=n)
        keep |= counts >= MIN_READS
        keep[0] = False
    return keep[lab]


def clean(walk, protect=None, reads=None):
    """Masque nettoyé (bool) : taches et trous minuscules retirés. `protect` (bool, facultatif) : pixels qui restent tels quels (disques de stations, zones tracées) ;
    `reads` : lectures sûres (n x 2, fractions) qui gardent une petite tache."""
    out = _drop_small(walk, MIN_SPECK, reads)
    out = ~_drop_small(~out, MIN_HOLE)
    if protect is not None:
        out = np.where(protect, walk, out)
    return out


def refused_share(walk, points):
    """Part des lectures sûres (tableau n x 2 de fractions) qui tombent hors du praticable."""
    if len(points) == 0:
        return 0.0
    h, w = walk.shape
    xi = np.clip((points[:, 0] * w).astype(int), 0, w - 1)
    yi = np.clip((points[:, 1] * h).astype(int), 0, h - 1)
    return float((~walk[yi, xi]).mean())


def _sure_reads(conn, map_name):
    rows = conn.execute("SELECT s.x, s.y FROM samples s JOIN games g ON g.id = s.game_id WHERE g.map = ? AND s.alive = 1 AND s.confidence >= ?", (map_name, SURE_CONFIDENCE)).fetchall()
    return np.array(rows, float).reshape(-1, 2)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Nettoie les masques de zones praticables.")
    parser.add_argument("--map")
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--db", default="data/eva.db")
    args = parser.parse_args(argv)
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    names = [args.map] if args.map else sorted(p.stem for p in MASKS.glob("*.png") if "_" not in p.stem)
    for name in names:
        image = cv2.imread(str(MASKS / f"{name}.png"), cv2.IMREAD_GRAYSCALE)
        if image is None:
            continue
        walk = image > 127
        reads = _sure_reads(conn, name)
        new = clean(walk, reads=reads)
        parts = lambda b: cv2.connectedComponents(b.astype(np.uint8), connectivity=4)[0] - 1
        print(f"{name:11s} taches {parts(walk):4d} -> {parts(new):4d} | trous {parts(~walk):4d} -> {parts(~new):4d} | pixels changés {(new != walk).mean() * 100:.2f} % | praticable {walk.mean() * 100:.1f} -> {new.mean() * 100:.1f} % "
              f"| lectures sûres refusées {refused_share(walk, reads) * 100:.3f} -> {refused_share(new, reads) * 100:.3f} % ({len(reads)} lectures)")
        if args.write:
            cv2.imwrite(str(MASKS / f"{name}.png"), new.astype(np.uint8) * 255)
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
