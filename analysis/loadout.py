"""Équipement de chaque joueur lu sur les bandeaux : deux armes et un gadget (trois petites icônes sous le pseudo).

L'arme tenue est dessinée en noir, l'autre en pâle : dans les deux cas c'est la même forme, qu'on isole du fond du bandeau (couleur
d'équipe, ou gris quand le joueur est mort). L'équipement ne change pas pendant une game : on moyenne plusieurs images pour obtenir
une forme propre, puis on la compare à des modèles (weapons.py, préfixes B pour les armes et G pour les gadgets).
"""

import cv2
import numpy as np

import weapons

# Boîtes des icônes dans un bandeau (fractions de sa largeur et de sa hauteur) : x0, x1, y0, y1
BOXES = {"arme1": (0.30, 0.54, 0.33, 0.50), "arme2": (0.53, 0.80, 0.33, 0.50), "gadget": (0.80, 0.96, 0.33, 0.50)}
PREFIX = {"arme1": "B", "arme2": "B", "gadget": "G"}
KEEP_SHARE = 0.5  # un pixel fait partie de la forme s'il l'est sur au moins la moitié des images
MIN_AREA = 30


def _shape(piece):
    """Masque binaire de l'icône (plus sombre que le fond du bandeau), seuil d'Otsu propre à la boîte."""
    gray = cv2.cvtColor(piece, cv2.COLOR_BGR2GRAY).astype(np.int16)
    bg = np.bincount(gray.ravel().clip(0, 255)).argmax()  # niveau le plus fréquent : le fond
    dark = np.clip(bg - gray, 0, 255).astype(np.uint8)
    if dark.max() < 14:
        return np.zeros(dark.shape, np.uint8)
    thr, _ = cv2.threshold(dark, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return (dark > max(thr * 0.7, 10)).astype(np.uint8)


def icons_of_banners(region, n=4):
    """region : recadrage de la zone d'une équipe (4 bandeaux). Renvoie [{nom d'icône: masque}] par bandeau."""
    h, w = region.shape[:2]
    bw = w / n
    out = []
    for i in range(n):
        banner = region[:, int(i * bw) : int((i + 1) * bw)]
        row = {}
        for name, (a, b, c, d) in BOXES.items():
            row[name] = _shape(banner[int(c * h) : int(d * h), int(a * bw) : int(b * bw)])
        out.append(row)
    return out


def merge_masks(masks):
    """Forme moyenne de plusieurs masques de même taille, en gardant le plus gros amas."""
    if not masks:
        return None
    mean = np.mean([m.astype(np.float32) for m in masks], axis=0)
    shape = (mean >= KEEP_SHARE).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(shape)
    if n <= 1:
        return None
    keep = np.zeros_like(shape)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_AREA:
            keep[lab == i] = 1
    return keep * 255 if keep.sum() else None


def identify(shape, kind, folder=weapons.ICON_DIR, create=True):
    """Identifiant d'une icône d'équipement (« B3 » pour une arme, « G1 » pour un gadget)."""
    return weapons.identify(shape, folder=folder, create=create, prefix=PREFIX[kind])


def read_loadouts(video, game, team_zones, width, height, frames=8):
    """Équipement {slot: {"arme1", "arme2", "gadget"}} d'une game (slots 1 à 8 dans l'ordre des bandeaux)."""
    import names  # évite un import circulaire au chargement

    start, end = game["start_s"], game["end_s"]
    span = max(end - start - 6, 1)
    times = [start + 3 + span * k / max(frames - 1, 1) for k in range(frames)]
    acc = {}
    for key, slots in names.TEAM_SLOTS.items():
        zone = team_zones[key]
        for t in times:
            crop = names._grab(video, t, zone, width, height)
            if crop is None:
                continue
            for i, row in enumerate(icons_of_banners(crop)):
                for kind, mask in row.items():
                    acc.setdefault((slots[i], kind), []).append(mask)
    out = {}
    for (slot, kind), masks in acc.items():
        shape = merge_masks(masks)
        if shape is not None:
            out.setdefault(slot, {})[kind] = identify(shape, kind)
    return out
