"""Lecture du nom de la carte (texte blanc sous le chrono) par comparaison à des modèles appris.

Chaque modèle est une petite image binaire du nom, rangée dans map_names/<Carte>.png (ou <Carte>__2.png pour une
variante). Les modèles viennent de games dont la carte est connue : ils sont appris automatiquement depuis les games
que l'utilisateur a étiquetées. Une carte sans modèle reste « inconnue » et n'est jamais devinée.
"""

import re
import subprocess
from pathlib import Path

import cv2
import numpy as np

TEMPLATES_DIR = Path(__file__).with_name("map_names")
REGION = {"x": 0.40, "y": 0.110, "w": 0.20, "h": 0.037}  # bande du nom, sous le chrono (relative)
SIZE = (160, 24)  # largeur, hauteur des modèles normalisés
BRIGHT = 205  # niveau de gris minimal d'un pixel de texte
MIN_SCORE = 0.80
MIN_MARGIN = 0.06
# Une autre vidéo (qualité différente) lit le même nom à 0,70-0,79 seulement, mais avec une avance énorme sur la carte suivante (0,73 contre 0,20) :
# un score plus bas est accepté quand l'écart avec la deuxième carte est grand.
LOW_SCORE = 0.65
WIDE_MARGIN = 0.30
SAMPLE_OFFSETS_S = (12.0, 25.0, 45.0, 70.0, 100.0, 140.0, 190.0)  # instants testés après le début d'une game, dans l'ordre : on s'arrête dès que le vote est net
VOTES_NEEDED = 3  # lectures concordantes qui suffisent


def name_mask(crop):
    """Recadrage BGR de la bande du nom -> masque binaire normalisé du texte, ou None si rien de lisible."""
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    mask = (gray >= BRIGHT).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    cols = np.flatnonzero(mask.sum(axis=0) >= 2)
    rows = np.flatnonzero(mask.sum(axis=1) >= 2)
    if cols.size < 20 or rows.size < 6:
        return None
    mask = mask[rows[0] : rows[-1] + 1, cols[0] : cols[-1] + 1]
    return cv2.resize(mask * 255, SIZE, interpolation=cv2.INTER_AREA)


def _vec(mask):
    return mask.astype(np.float32).ravel() / 255.0


def load_templates(folder=TEMPLATES_DIR):
    out = {}
    for path in sorted(Path(folder).glob("*.png")):
        img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if img is not None:
            out.setdefault(re.sub(r"__\d+$", "", path.stem), []).append(_vec(img))
    return out


def save_template(mask, name, folder=TEMPLATES_DIR):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    n = 1
    path = folder / f"{name}.png"
    while path.exists():
        n += 1
        path = folder / f"{name}__{n}.png"
    cv2.imwrite(str(path), mask)
    return path


def _score(a, b):
    a, b = a - a.mean(), b - b.mean()
    d = np.linalg.norm(a) * np.linalg.norm(b)
    return float(a @ b / d) if d else -1.0


def recognize(mask, templates):
    """Renvoie (nom, score) ou (None, meilleur score) si rien n'est assez net."""
    if mask is None or not templates:
        return None, -1.0
    v = _vec(mask)
    per_map = sorted(((max(_score(v, t) for t in ts), name) for name, ts in templates.items()), reverse=True)
    best = per_map[0]
    second = per_map[1][0] if len(per_map) > 1 else -1.0
    margin = best[0] - second
    if (best[0] >= MIN_SCORE and margin >= MIN_MARGIN) or (best[0] >= LOW_SCORE and margin >= WIDE_MARGIN):
        return best[1], best[0]
    return None, best[0]


def grab_crop(video, t, width, height):
    """Recadrage BGR de la bande du nom à l'instant t (ffmpeg, accès direct : rapide même sur une vidéo d'1 h)."""
    x = round(REGION["x"] * width)
    y = round(REGION["y"] * height)
    w = round(REGION["w"] * width) // 2 * 2
    h = round(REGION["h"] * height) // 2 * 2
    cmd = [
        "ffmpeg", "-v", "error", "-ss", f"{max(t, 0):.2f}", "-i", str(video),
        "-frames:v", "1", "-vf", f"crop={w}:{h}:{x}:{y}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    data = subprocess.run(cmd, capture_output=True, stdin=subprocess.DEVNULL).stdout
    if len(data) < w * h * 3:
        return None
    return np.frombuffer(data[: w * h * 3], np.uint8).reshape(h, w, 3)


def game_masks(video, game, width, height):
    """Masques du nom à plusieurs instants de la game (ceux qui tombent dans ses bornes)."""
    masks = []
    for off in SAMPLE_OFFSETS_S:
        t = game["start_s"] + off
        if t >= game["end_s"] - 1:
            continue
        crop = grab_crop(video, t, width, height)
        mask = name_mask(crop) if crop is not None else None
        if mask is not None:
            masks.append(mask)
    return masks


def recognize_game(video, game, width, height, templates):
    """Nom de carte d'une game (vote entre plusieurs instants), ou None. Une image illisible ou ambiguë est passée : on regarde l'instant suivant,
    jusqu'à ce que VOTES_NEEDED lectures concordent ou qu'il n'y ait plus d'instant dans la game."""
    votes = {}
    for off in SAMPLE_OFFSETS_S:
        t = game["start_s"] + off
        if t >= game["end_s"] - 1:
            break
        crop = grab_crop(video, t, width, height)
        mask = name_mask(crop) if crop is not None else None
        name, _ = recognize(mask, templates)
        if name:
            votes[name] = votes.get(name, 0) + 1
            if votes[name] >= VOTES_NEEDED:
                break
    if not votes:
        return None
    name, n = max(votes.items(), key=lambda kv: kv[1])
    return name if n * 2 > sum(votes.values()) else None
