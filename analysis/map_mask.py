"""Masque des zones praticables d'une carte, tiré de la minimap elle-même.

  python analysis/map_mask.py --map Polaris          construit analysis/map_masks/Polaris.png (et une planche de contrôle)

La minimap affiche toujours le même plan (couloirs sombres, bords blancs) sous des pastilles qui bougent : la médiane de beaucoup d'images de la carte fait
disparaître les joueurs et ne laisse que le plan. Le masque est donc exactement aux coordonnées des pastilles, sans recalage avec la carte stratégique.
Seules les cartes dont le plan reste identique d'une image à l'autre ont un masque (Polaris). Une carte à étages superposés ou au fond qui change
(Atlantis, The Cliff) n'en a pas : le suivi garde alors la carte des passages apprise sur les lectures.
Le fichier est une image noir et blanc de SIZE x SIZE pixels : blanc = praticable. Le dossier map_masks/ est versionné.

Traits de murs (`<Carte>_lignes.png`, à la taille de la minimap lue) : sur Polaris les murs sont des traits blancs fins, comme le disque du joueur observé : ils
fusionnent et la direction du disque est mal lue le long des murs. Ces traits sont les structures blanches fines et immobiles de la médiane (ni disque, ni zone
épaisse) : la lecture les efface avant de chercher le disque blanc."""

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

MASK_DIR = Path(__file__).with_name("map_masks")
SIZE = 400  # côté de l'image de la minimap utilisée pour la médiane
FRAMES_PER_GAME = 14  # images prises par game (réparties sur la game, début et fin écartés)
DARK = 95  # niveau de gris en dessous duquel un pixel de la médiane est un couloir
SATURATED = 110  # ...ou une zone colorée (départs, boîte centrale) : praticable aussi
MIN_AREA = 150  # une tache plus petite est un résidu (pastille restée sur place), pas un couloir


def mask_from_median(median):
    """Masque booléen (SIZE x SIZE) des zones praticables d'après l'image médiane de la minimap (BGR)."""
    hsv = cv2.cvtColor(median, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(median, cv2.COLOR_BGR2GRAY)
    walk = ((gray < DARK) | (hsv[:, :, 1] > SATURATED)).astype(np.uint8)
    walk = cv2.morphologyEx(walk, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(walk)
    keep = np.zeros_like(walk)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_AREA:
            keep[labels == i] = 1
    return keep.astype(bool)


def load(map_name):
    """Masque d'une carte (tableau booléen, blanc = praticable), ou None si la carte n'en a pas."""
    path = MASK_DIR / f"{map_name}.png"
    if not map_name or not path.exists():
        return None
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    return None if img is None else img > 127


def load_lines(map_name):
    """Traits de murs d'une carte (tableau uint8, 255 = trait blanc fixe à effacer), ou None si la carte n'en a pas."""
    path = MASK_DIR / f"{map_name}_lignes.png"
    if not map_name or not path.exists():
        return None
    return cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)


LINE_MAX_WIDTH = 5  # une structure blanche plus épaisse que cela (disque, icône de station, zone claire) n'est pas un trait de mur


def wall_lines_from_median(median):
    """Traits blancs fins et immobiles d'une médiane de minimap (BGR, taille de la minimap lue) : le blanc moins son ouverture, élargi d'un pixel."""
    hsv = cv2.cvtColor(median, cv2.COLOR_BGR2HSV)
    white = ((hsv[:, :, 2] >= 205) & (hsv[:, :, 1] <= 70)).astype(np.uint8)
    thick = cv2.morphologyEx(white, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (LINE_MAX_WIDTH, LINE_MAX_WIDTH)))
    thin = cv2.subtract(white, cv2.dilate(thick, np.ones((3, 3), np.uint8)))
    return (cv2.dilate(thin, np.ones((3, 3), np.uint8)) * 255).astype(np.uint8)


def coverage_cells(mask, cell, min_cover=0.25):
    """Cases (de côté `cell`, en fraction de la minimap) dont au moins `min_cover` des pixels sont praticables : {(i, j)}."""
    h, w = mask.shape
    out = set()
    for j in range(int(np.ceil(1.0 / cell))):
        for i in range(int(np.ceil(1.0 / cell))):
            block = mask[int(j * cell * h) : max(int((j + 1) * cell * h), int(j * cell * h) + 1), int(i * cell * w) : max(int((i + 1) * cell * w), int(i * cell * w) + 1)]
            if block.size and block.mean() >= min_cover:
                out.add((i, j))
    return out


def build(conn, map_name, frames_per_game=FRAMES_PER_GAME):
    """Médiane des images de la minimap de toutes les games analysables de la carte. Renvoie (médiane carrée, nombre d'images, médiane à la taille de la minimap lue)."""
    import db
    import names

    zone = db.zone_for(conn, map_name, "minimap")
    images, native = [], []
    for g in conn.execute("SELECT g.*, v.path, v.width, v.height FROM games g JOIN videos v ON v.id = g.video_id WHERE g.map = ? ORDER BY g.id", (map_name,)):
        span = g["end_s"] - g["start_s"] - 40
        if span <= 0:
            continue
        for k in range(frames_per_game):
            crop = names._grab(g["path"], g["start_s"] + 20 + k * span / (frames_per_game - 1), zone, g["width"], g["height"])
            if crop is not None:
                images.append(cv2.resize(crop, (SIZE, SIZE)))
                native.append(crop)
    if not images:
        return None, 0, None
    ref = native[0].shape[1::-1]  # (largeur, hauteur) de la première minimap lue : toutes y sont ramenées
    native = [crop if crop.shape[1::-1] == ref else cv2.resize(crop, ref) for crop in native]
    return np.median(np.stack(images), axis=0).astype(np.uint8), len(images), np.median(np.stack(native), axis=0).astype(np.uint8)


def main(argv=None):
    import db

    parser = argparse.ArgumentParser(description="Construit le masque des zones praticables d'une carte.")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--map", required=True)
    args = parser.parse_args(argv)
    median, count, native = build(db.connect(args.db), args.map)
    if median is None:
        print(f"aucune image pour la carte {args.map}")
        return 1
    mask = mask_from_median(median)
    MASK_DIR.mkdir(exist_ok=True)
    cv2.imwrite(str(MASK_DIR / f"{args.map}.png"), mask.astype(np.uint8) * 255)
    shade = median.copy()
    shade[~mask] = (shade[~mask] * 0.35 + np.array([0, 0, 160]) * 0.65).astype(np.uint8)  # hors masque en rouge
    cv2.imwrite(str(MASK_DIR / f"{args.map}_controle.jpg"), np.hstack([median, shade]))
    lines = wall_lines_from_median(native)
    cv2.imwrite(str(MASK_DIR / f"{args.map}_lignes.png"), lines)
    print(f"{args.map} : traits de murs {int((lines > 0).sum())} pixels sur {lines.size}")
    print(f"{args.map} : {count} images, {mask.mean() * 100:.0f} % praticable. Contrôler à l'œil : {MASK_DIR / (args.map + '_controle.jpg')}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
