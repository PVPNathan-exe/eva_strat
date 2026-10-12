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
MAX_MONOTONE_FILL_S = 60.0  # trou plus long comblé quand le pourcentage ne peut que monter entre ses deux bords (égaux : constant)
MONOTONE_TOLERANCE = 2  # baisse (en points) tolérée avant de dire qu'une lecture est fausse


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


MIN_BLOB_PIXELS = 30  # une tache plus petite que cela (reflet, petit marqueur sous le texte) n'est pas un chiffre
MIN_BLOB_HEIGHT = 0.6  # ni une tache plus basse que cette part de la hauteur du plus haut élément (un petit point bleu sous le texte allongeait les chiffres de 18 à 30 pixels)


def _clean_mask(m):
    """Retire du masque les petites taches et celles bien plus basses que les chiffres."""
    n, labels, stats, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8))
    comps = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= MIN_BLOB_PIXELS]
    if not comps:
        return np.zeros_like(m)
    tallest = max(stats[i, cv2.CC_STAT_HEIGHT] for i in comps)
    keep = [i for i in comps if stats[i, cv2.CC_STAT_HEIGHT] >= MIN_BLOB_HEIGHT * tallest]
    return np.isin(labels, keep)


def digit_glyphs(crop, team):
    """Chiffres du pourcentage : liste d'images binaires (le « % » final est retiré), ou [] si rien de lisible."""
    m = _clean_mask(_mask(crop, team))
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


def read_digits(crop, team, templates, min_score=MIN_SCORE, min_margin=MIN_MARGIN):
    """Chiffres lus d'un recadrage : [(chiffre, score, vecteur du chiffre)], ou None si une lecture est douteuse (score trop bas, ou trop proche d'un autre chiffre)."""
    glyphs = digit_glyphs(crop, team)
    if not glyphs or len(glyphs) > 3 or not templates:
        return None
    out = []
    for g in glyphs:
        v = cv2.resize(g, GLYPH, interpolation=cv2.INTER_AREA).astype(np.float32).ravel() / 255.0
        scored = sorted(((max(_score(v, t) for t in ts), d) for d, ts in templates.items()), reverse=True)
        if scored[0][0] < min_score or (len(scored) > 1 and scored[0][0] - scored[1][0] < min_margin):
            return None
        out.append((scored[0][1], scored[0][0], v))
    return out


def read_value(crop, team, templates, min_score=MIN_SCORE, min_margin=MIN_MARGIN):
    """Pourcentage (0 à 100) ou None si une lecture est douteuse."""
    digits = read_digits(crop, team, templates, min_score, min_margin)
    if digits is None:
        return None
    value = int("".join(d for d, _, _ in digits))
    return value if 0 <= value <= 100 else None


RELAXED_SCORE = 0.55  # seuil abaissé pour une lecture que le contexte permet de contrôler (voir read_series)
RELAXED_MARGIN = 0.03
GROWTH_PER_S = 1.5  # croissance maximale du pourcentage (points par seconde) pour accepter une lecture à seuil abaissé
GROWTH_SLACK = 2  # et marge (points)


def read_series(crops, team, templates):
    """[(t, valeur)] nettoyée. Les chiffres pâles de fin de game (fond clair, texte translucide : « 98 % » lu à 0,67) échouent au seuil normal : un second passage les
    relit avec un seuil abaissé, mais n'accepte la valeur que si elle prolonge la dernière lecture sûre (pas de baisse, croissance plausible)."""
    raw = [(t, read_value(c, team, templates)) for t, c in crops]
    last_t, last_v = None, None
    for i, ((t, v), (_, crop)) in enumerate(zip(raw, crops)):
        if v is not None:
            last_t, last_v = t, v
            continue
        if last_v is None:
            continue
        relaxed = read_value(crop, team, templates, RELAXED_SCORE, RELAXED_MARGIN)
        if relaxed is not None and last_v - 1 <= relaxed <= last_v + GROWTH_PER_S * (t - last_t) + GROWTH_SLACK:
            raw[i] = (t, relaxed)
            last_t, last_v = t, relaxed
    return clean_series(raw, crops[1][0] - crops[0][0] if len(crops) > 1 else 1.0)


ADAPT_SCORE = 0.85  # une lecture dont chaque chiffre dépasse ce score devient un modèle de plus pour cette vidéo
ADAPT_PER_DIGIT = 12  # modèles ajoutés au plus par chiffre


def adapted_templates(crops, team, templates):
    """Modèles de chiffres complétés par ceux de la vidéo lue : la police et le flou changent d'une vidéo à l'autre (l'équipe bleue n'était lue que 4 % du temps
    de la game NCT vs SNV avec les seuls modèles d'origine). Les lectures très sûres de la première passe fournissent des exemplaires de chaque chiffre."""
    extra = {d: [] for d in templates}
    for crop in crops:
        digits = read_digits(crop, team, templates)
        if digits is None or any(score < ADAPT_SCORE for _, score, _ in digits):
            continue
        for d, _, v in digits:
            if len(extra.setdefault(d, [])) < ADAPT_PER_DIGIT and all(_score(v, e) < 0.97 for e in extra[d]):  # pas deux exemplaires presque identiques
                extra[d].append(v)
    return {d: list(templates.get(d, [])) + extra.get(d, []) for d in set(templates) | set(extra)}


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
    # Le pourcentage d'une équipe ne baisse pas : une valeur nettement plus basse que le maximum déjà vu est une lecture fausse.
    top = 0
    for i, v in enumerate(kept):
        if v is None:
            continue
        if v < top - MONOTONE_TOLERANCE:
            kept[i] = None
        else:
            top = max(top, v)
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
            long_gap = left is not None and right is not None and left <= right and (j - i) * step_s <= MAX_MONOTONE_FILL_S
            if left is not None and right is not None and (j - i <= max_gap or long_gap):  # un trou plus long est comblé si le pourcentage n'a pu que monter
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
        crops = []
        for t, crop in timer.iter_crops(video, zones[team], width, height, step_s=step_s, t0=game["start_s"], t1=game["end_s"]):
            if wait:
                wait()
            crops.append((t, crop.copy()))
            if emit:
                emit(min(100.0, 50 * k + 50 * (t - game["start_s"]) / max(game["end_s"] - game["start_s"], 1)))
        mine = adapted_templates([c for _, c in crops], team, templates)  # deuxième lecture avec les modèles de cette vidéo
        out[team] = read_series(crops, team, mine)
    return out
