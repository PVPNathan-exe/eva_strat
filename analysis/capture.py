"""Pourcentages de capture (score de chaque équipe, de part et d'autre du chrono), lus par reconnaissance des chiffres.

Le « % » est toujours le dernier caractère (environ 20 px) : on le retire, puis on découpe les chiffres restants et on compare chacun à
des modèles appris sur une vraie vidéo (capture_digits.npz, plusieurs variantes par chiffre). Une lecture douteuse est abandonnée
plutôt que devinée, puis la série est nettoyée (valeurs aberrantes écartées, petits trous comblés).
"""

from pathlib import Path

import cv2
import numpy as np

import timer

TEMPLATES_PATH = Path(__file__).with_name("capture_digits.npz")
PCT_SIGN_W = 20  # largeur du signe % en pixels (1080p)
GLYPH = (10, 16)
ORANGE = ((4, 110, 140), (22, 255, 255))
BLUE = ((98, 80, 130), (118, 255, 255))
MIN_SCORE = 0.72
MIN_MARGIN = 0.04
OUTLIER_DELTA = 12  # écart (points de %) à la médiane des voisines au-delà duquel une lecture est écartée
MAX_FILL_S = 4.0  # trou comblé par interpolation


def load_templates(path=TEMPLATES_PATH):
    if not Path(path).exists():
        return {}
    data = np.load(path)
    out = {}
    for key in data.files:
        out.setdefault(key.split("_")[0], []).append(data[key].astype(np.float32).ravel() / 255.0)
    return out


def _mask(crop, team):
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    b = ORANGE if team == "A" else BLUE
    return cv2.inRange(hsv, np.array(b[0]), np.array(b[1])) > 0


def digit_glyphs(crop, team):
    """Chiffres du pourcentage : liste d'images binaires (le « % » final est retiré), ou [] si rien de lisible."""
    m = _mask(crop, team)
    cols_any = np.flatnonzero(m.sum(0) > 0)
    if cols_any.size == 0:
        return []
    width = crop.shape[1]
    sign = round(PCT_SIGN_W * width / 90)  # 90 px = largeur de la zone par défaut à 1080p
    m = m[:, : max(cols_any.max() + 1 - sign, 0)]
    rows = np.flatnonzero(m.sum(1) > 0)
    if rows.size == 0 or m.shape[1] < 4:
        return []
    y0, y1 = rows.min(), rows.max() + 1
    cols = m[y0:y1].sum(0) > 0
    runs, start = [], None
    for x, v in enumerate(list(cols) + [False]):
        if v and start is None:
            start = x
        elif not v and start is not None:
            runs.append((start, x))
            start = None
    out = []
    for a, b in runs:
        if b - a < 3:
            continue
        parts = [(a, b)] if b - a <= 17 else [(a, a + (b - a) // 2), (a + (b - a) // 2, b)]  # deux chiffres collés
        for pa, pb in parts:
            out.append(m[y0:y1, pa:pb].astype(np.uint8) * 255)
    return out


def _score(a, b):
    a, b = a - a.mean(), b - b.mean()
    d = np.linalg.norm(a) * np.linalg.norm(b)
    return float(a @ b / d) if d else -1.0


def read_value(crop, team, templates):
    """Pourcentage (0 à 100) ou None si une lecture est douteuse."""
    glyphs = digit_glyphs(crop, team)
    if not glyphs or len(glyphs) > 3 or not templates:
        return None
    digits = []
    for g in glyphs:
        v = cv2.resize(g, GLYPH, interpolation=cv2.INTER_AREA).astype(np.float32).ravel() / 255.0
        scored = sorted(((max(_score(v, t) for t in ts), d) for d, ts in templates.items()), reverse=True)
        if scored[0][0] < MIN_SCORE or (len(scored) > 1 and scored[0][0] - scored[1][0] < MIN_MARGIN):
            return None
        digits.append(scored[0][1])
    value = int("".join(digits))
    return value if 0 <= value <= 100 else None


def clean_series(samples, step_s):
    """samples : [(t, valeur ou None)]. Écarte les valeurs aberrantes (écart à la médiane des voisines) et comble les petits trous."""
    values = [v for _, v in samples]
    n = len(values)
    kept = list(values)
    for i, v in enumerate(values):
        if v is None:
            continue
        around = sorted(x for x in values[max(0, i - 3) : i + 4] if x is not None)
        if len(around) >= 3 and abs(v - around[len(around) // 2]) > OUTLIER_DELTA:
            kept[i] = None
    out = list(kept)
    max_gap = max(1, round(MAX_FILL_S / step_s))
    i = 0
    while i < n:
        if out[i] is None:
            j = i
            while j < n and out[j] is None:
                j += 1
            left = out[i - 1] if i > 0 else None
            right = out[j] if j < n else None
            if left is not None and right is not None and j - i <= max_gap:
                for k in range(i, j):
                    out[k] = left + (right - left) * (k - i + 1) / (j - i + 1)
            elif left is not None and right is None and j - i <= max_gap:
                for k in range(i, j):
                    out[k] = left
            i = j
        else:
            i += 1
    return [(t, None if v is None else round(v, 1)) for (t, _), v in zip(samples, out)]


def read_game(video, game, zones, width, height, step_s=1.0, wait=None, emit=None):
    """Séries de score {"A": [(t, %)], "B": [(t, %)]} d'une game. zones : {"A": zone, "B": zone}."""
    templates = load_templates()
    out = {}
    for k, team in enumerate(("A", "B")):
        raw = []
        for t, crop in timer.iter_crops(video, zones[team], width, height, step_s=step_s, t0=game["start_s"], t1=game["end_s"]):
            if wait:
                wait()
            raw.append((t, read_value(crop, team, templates)))
            if emit:
                emit(min(100.0, 50 * k + 50 * (t - game["start_s"]) / max(game["end_s"] - game["start_s"], 1)))
        out[team] = clean_series(raw, step_s)
    return out
