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
import paths

MASK_DIR = Path(__file__).with_name("map_masks")
SIZE = 400  # côté de l'image de la minimap utilisée pour la médiane
FRAMES_PER_GAME = 14  # images prises par game (réparties sur la game, début et fin écartés)
DARK = 95  # niveau de gris en dessous duquel un pixel de la médiane est un couloir
SATURATED = 110  # ...ou une zone colorée (départs, boîte centrale) : praticable aussi
DARK_CORRIDOR_MAPS = {"Polaris"}  # couloirs sombres sur des blocs clairs : seuil de gris (mask_from_median) ; les autres cartes ont un sol gris uni (mask_learned)
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


FLOOR_TOL = 16  # écart de gris au sol (médian sous les pastilles lues) en dessous duquel un pixel est du sol
FLOOR_MAX_SAT = 80  # le sol est neutre : plus saturé, c'est un fond coloré (forêt, eau) ou une zone teintée
LEARNED_MIN_TOL = 4  # tolérance de gris essayée en premier
LEARNED_COVERAGE = 0.997  # part des pastilles lues que le sol seul doit contenir
THICK_BRIGHT_GAP = 40  # une zone plus claire que le sol de cela...
TINT_MIN_VALUE = 90  # luminosité minimale d'une zone teintée praticable
THICK_OPEN_PX = 5  # ...et plus épaisse que cela (pixels) est une plateforme (boîte de capture, icône de station), pas un trait de mur
VISITED_RADIUS = 3  # rayon (pixels de la médiane carrée) autour d'une pastille lue avec certitude : praticable quelle que soit sa couleur (anneaux peints, icônes de station)
CLOSE_PX = 7  # fermeture qui comble les traits fins du sol (marquage, trait de mur) : un mur n'est pas praticable, mais le masque sert de limite, pas de mur


def _floor_class(gray, sat, tint, floor_gray, tol):
    cand = ((np.abs(gray - floor_gray) <= tol) & (sat < FLOOR_MAX_SAT)) | tint
    cand = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((CLOSE_PX, CLOSE_PX), np.uint8))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(cand)
    keep = np.zeros_like(cand)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_AREA:
            keep[labels == i] = 1
    return keep


def mask_learned(median, points):
    """Masque des zones praticables pour une carte dont le sol est gris et uni (toutes sauf Polaris, dont les couloirs sont sombres sur des blocs clairs). Le gris du sol est celui de
    la médiane sous les pastilles lues avec certitude (points : [(x, y)] en fractions de la minimap) ; la tolérance est la plus petite qui garde LEARNED_COVERAGE des pastilles
    sur le sol seul (les obstacles, plus sombres de quelques niveaux de gris, n'y sont alors pas), et l'on y ajoute les zones teintées (départs, boîte de capture) et le voisinage
    de chaque pastille lue (anneaux peints, icônes de station). Le fond (forêt, eau) et les traits fins hors des lectures ne sont pas praticables."""
    hsv = cv2.cvtColor(median, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(median, cv2.COLOR_BGR2GRAY).astype(np.int16)
    sat = hsv[:, :, 1]
    tint = (sat > SATURATED) & (hsv[:, :, 2] >= TINT_MIN_VALUE)  # départs et boîte de capture teintés : vifs ; le fond brun d'une forêt est saturé mais sombre
    h, w = gray.shape
    pix = [(min(h - 1, int(y * h)), min(w - 1, int(x * w))) for x, y in points]
    if not pix:
        return None
    floor_gray = float(np.median([gray[max(cy - 1, 0) : cy + 2, max(cx - 1, 0) : cx + 2].mean() for cy, cx in pix]))
    for tol in range(LEARNED_MIN_TOL, FLOOR_TOL + 1):
        cls = _floor_class(gray, sat, tint, floor_gray, tol)
        if sum(cls[cy, cx] for cy, cx in pix) / len(pix) >= LEARNED_COVERAGE:
            break
    visited = np.zeros((h, w), np.uint8)
    for cy, cx in pix:
        cv2.circle(visited, (cx, cy), VISITED_RADIUS, 1, -1)
    bright = ((gray > floor_gray + THICK_BRIGHT_GAP) & (sat < FLOOR_MAX_SAT)).astype(np.uint8)
    thick = cv2.morphologyEx(bright, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (THICK_OPEN_PX, THICK_OPEN_PX)))  # boîte de capture grise, icônes de station : épais, donc praticables
    return (cls > 0) | (visited > 0) | (thick > 0)


def read_points(conn, map_name, min_conf=0.7):
    """Positions lues avec certitude des games analysées de la carte : [(x, y)] en fractions de la minimap."""
    return [(r["x"], r["y"]) for r in conn.execute(
        "SELECT s.x, s.y FROM samples s JOIN games g ON g.id = s.game_id WHERE g.map = ? AND s.alive = 1 AND s.confidence >= ? AND s.x IS NOT NULL", (map_name, min_conf))]


CELL = 0.02  # case de la carte des passages du suivi (tracking.WALK_CELL)


def share_outside(mask, points):
    """Part des positions lues avec certitude que le suivi refuserait avec ce masque : mêmes cases que tracking.py (cases couvertes au quart au moins par le masque, élargies d'une
    case : une pastille collée à un mur a son centre au bord du masque). Un masque juste en rejette 0,05 % ou moins."""
    cells = coverage_cells(mask, CELL)
    near = {(i + di, j + dj) for i, j in cells for di in (-1, 0, 1) for dj in (-1, 0, 1)}
    out = sum(1 for x, y in points if (int(x / CELL), int(y / CELL)) not in near)
    return out / max(len(points), 1)


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
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--map", required=True)
    parser.add_argument("--reuse", action="store_true", help="reprend la médiane de la planche de contrôle déjà construite (pas de relecture de la vidéo) ; les traits de murs ne sont pas refaits")
    args = parser.parse_args(argv)
    if args.map in DARK_CORRIDOR_MAPS and args.reuse:
        print(f"{args.map} : masque réglé avec la médiane complète, --reuse refusé (il le dégraderait) : relancer sans --reuse")
        return 1
    if args.reuse:
        sheet = cv2.imread(str(MASK_DIR / f"{args.map}_controle.jpg"))
        median, count, native = (None if sheet is None else sheet[:, :SIZE]), 0, None
    else:
        median, count, native = build(db.connect(args.db), args.map)
    if median is None:
        print(f"aucune image pour la carte {args.map}")
        return 1
    conn = db.connect(args.db)
    points = read_points(conn, args.map)
    if args.map in DARK_CORRIDOR_MAPS or not points:
        mask = mask_from_median(median)
    else:
        mask = mask_learned(median, points)
    MASK_DIR.mkdir(exist_ok=True)
    cv2.imwrite(str(MASK_DIR / f"{args.map}.png"), mask.astype(np.uint8) * 255)
    shade = median.copy()
    shade[~mask] = (shade[~mask] * 0.35 + np.array([0, 0, 160]) * 0.65).astype(np.uint8)  # hors masque en rouge
    cv2.imwrite(str(MASK_DIR / f"{args.map}_controle.jpg"), np.hstack([median, shade]))
    if native is not None:
        cv2.imwrite(str(MASK_DIR / f"{args.map}_mediane.png"), native)  # médiane à la taille de la minimap lue, sans perte : sert à trouver les stations (map_tp.py)
        lines = wall_lines_from_median(native)
        cv2.imwrite(str(MASK_DIR / f"{args.map}_lignes.png"), lines)
        print(f"{args.map} : traits de murs {int((lines > 0).sum())} pixels sur {lines.size}")
    print(f"{args.map} : {len(points)} positions lues, dont {share_outside(mask, points) * 100:.2f} % hors du masque")
    print(f"{args.map} : {count} images, {mask.mean() * 100:.0f} % praticable. Contrôler à l'œil : {MASK_DIR / (args.map + '_controle.jpg')}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
