"""Lecture du chrono de game (« MM:SS » dans la boîte grise sous le logo) par reconnaissance de formes.

Le chrono est écrit en noir sur un fond gris (parfois orange quand une équipe capture) : on isole les pixels
sombres, on découpe les colonnes en glyphes (4 chiffres + « : ») puis on compare chaque chiffre à des modèles.
Les modèles (digit_templates.npz) sont générés par build_templates.py à partir d'une vraie vidéo.
"""

from pathlib import Path

import cv2
import numpy as np

TEMPLATES_PATH = Path(__file__).with_name("digit_templates.npz")
GLYPH_SIZE = (12, 20)  # largeur, hauteur des chiffres normalisés
DARK = 80  # niveau de gris sous lequel un pixel est de l'encre
MIN_SCORE = 0.75  # corrélation minimale avec le meilleur modèle
MIN_MARGIN = 0.05  # écart minimal avec le deuxième meilleur modèle


def load_templates(path=TEMPLATES_PATH):
    data = np.load(path)
    return {k: data[k].astype(np.float32) for k in data.files}


def _runs(mask):
    runs, start = [], None
    for i, on in enumerate(mask):
        if on and start is None:
            start = i
        elif not on and start is not None:
            runs.append((start, i))
            start = None
    if start is not None:
        runs.append((start, len(mask)))
    return runs


def glyphs(crop):
    """Découpe le recadrage du chrono en 5 glyphes binaires (M, M, :, S, S), ou None si la mise en page est inattendue."""
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    # On écarte les coins arrondis de la boîte (sombres) en ne gardant que l'intérieur.
    y0, y1, x0, x1 = int(h * 0.12), int(h * 0.88), int(w * 0.10), int(w * 0.92)
    ink = (gray[y0:y1, x0:x1] < DARK).astype(np.uint8)
    rows = np.flatnonzero(ink.sum(axis=1) > 0)
    if rows.size == 0:
        return None
    ink = ink[rows[0] : rows[-1] + 1]
    runs = _runs(ink.sum(axis=0) > 0)
    if len(runs) != 5:
        return None
    out = []
    for a, b in runs:
        out.append(ink[:, a:b] * 255)
    return out


def _normalize(glyph):
    return cv2.resize(glyph, GLYPH_SIZE, interpolation=cv2.INTER_AREA).astype(np.float32).ravel() / 255.0


def _match(vec, templates):
    scores = []
    for label, tpl in templates.items():
        a, b = vec - vec.mean(), tpl - tpl.mean()
        denom = np.linalg.norm(a) * np.linalg.norm(b)
        scores.append((float(a @ b / denom) if denom else -1.0, label))
    scores.sort(reverse=True)
    best, second = scores[0], scores[1]
    if best[0] < MIN_SCORE or best[0] - second[0] < MIN_MARGIN:
        return None, best[0]
    return best[1], best[0]


def read_timer(crop, templates):
    """Renvoie le chrono en secondes restantes, ou None si illisible (HUD absent, image floue, autre écran)."""
    parts = glyphs(crop)
    if parts is None:
        return None
    digits = []
    for i in (0, 1, 3, 4):
        label, _ = _match(_normalize(parts[i]), templates)
        if label is None:
            return None
        digits.append(int(label))
    minutes = digits[0] * 10 + digits[1]
    seconds = digits[2] * 10 + digits[3]
    if seconds > 59:
        return None
    return minutes * 60 + seconds


def timer_box(zone, width, height):
    """Zone relative (x, y, w, h entre 0 et 1) -> rectangle en pixels (x, y, w, h), dimensions paires."""
    w = max(2, round(zone["w"] * width) // 2 * 2)
    h = max(2, round(zone["h"] * height) // 2 * 2)
    return round(zone["x"] * width), round(zone["y"] * height), w, h


def iter_crops(video, zone, width, height, step_s=1.0, t0=0.0, t1=None):
    """Génère (t, recadrage BGR du chrono) toutes les step_s secondes entre t0 et t1, décodé par ffmpeg (seule la zone sort du pipe)."""
    import subprocess

    x, y, w, h = timer_box(zone, width, height)
    cmd = [
        "ffmpeg", "-v", "error", "-an",
        *(["-ss", f"{t0:.2f}"] if t0 > 0 else []),
        *(["-t", f"{t1 - t0:.2f}"] if t1 is not None else []),
        "-i", str(video),
        "-vf", f"fps=1/{step_s},crop={w}:{h}:{x}:{y}",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    size = w * h * 3
    i = 0
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield t0 + i * step_s, np.frombuffer(buf, np.uint8).reshape(h, w, 3)
            i += 1
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()
