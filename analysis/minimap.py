"""Lecture de la minimap : une pastille par joueur (équipe, position, numéro, direction, vivant, observé).

Sur la minimap, un joueur est une pastille ronde à pointe (la pointe donne la direction) portant son numéro, orange pour
l'équipe de gauche (1 à 4) et bleue pour l'équipe de droite (6 à 9). Un joueur mort devient une croix colorée, le joueur
observé par la caméra est une pastille blanche cerclée de sa couleur d'équipe. Le numéro est lu par comparaison à des modèles
(digit_templates ci-dessous), appris une fois depuis des vidéos.
"""

import math
from pathlib import Path

import cv2
import numpy as np

BASE_ZONE_W = 440.0  # largeur en pixels de la minimap de référence (1080p) : les surfaces sont mises à l'échelle
MARKER_AREA = (140, 900)  # surface d'une pastille à l'échelle de référence
SPAWN_MIN_AREA = 1500  # une zone d'apparition colorée est bien plus grande qu'une pastille
GLYPH_SIZE = (20, 20)
DIGIT_TEMPLATES_PATH = Path(__file__).with_name("minimap_digits.npz")
DEAD_SOLIDITY = 0.82  # en dessous : forme suspecte, confirmée ou non par la ressemblance avec la croix
CROSS_PATH = Path(__file__).with_name("minimap_cross.npz")
MIN_CROSS_SCORE = 0.75
MIN_DIGIT_SCORE = 0.65
MIN_DIGIT_MARGIN = 0.03

ORANGE = ((3, 150, 195), (22, 255, 255))  # V élevé : les zones d'apparition colorées sont plus sombres
BLUE = ((98, 100, 195), (118, 255, 255))
# Pastille atténuée (apparition, fond sombre derrière la minimap transparente) : même teinte, luminosité plus basse. Acceptée sans numéro,
# seulement si aucune pastille de la même équipe n'est déjà là ; le suivi la rattache à une trajectoire, et les taches fixes du décor
# sont retirées plus tard (tracking.drop_static_noise).
ORANGE_DIM = ((3, 150, 135), (22, 255, 255))
BLUE_DIM = ((98, 100, 140), (118, 255, 255))
WAITING_CIRCULARITY = 0.85  # un joueur mort qui attend sa réapparition est un petit disque blanc (un joueur observé est une goutte pointée)
WAITING_SPAWN_SHARE = 0.25  # part du pourtour sur la couleur de la zone de départ de son équipe
WHITE_REQUIRE_DIGIT = False  # vrai : une pastille blanche n'est acceptée que si son numéro est lisible (les symboles blancs de la carte n'en ont pas)
WHITE_MAX_UNNUMBERED = 2  # une image normale a au plus un joueur observé : plus de pastilles blanches sans numéro, c'est du décor (Polaris)
WHITE_RING_SHARE = 0.35  # part minimale du pourtour d'une pastille blanche qui doit être du liseré de la couleur de l'équipe
WHITE_MIN_AREA = 90  # le joueur observé rétrécit par moments (animation) : sa pastille blanche peut tomber vers 100 pixels ; le liseré coloré reste exigé
DIM_MIN_SEPARATION = 0.03  # distance minimale (relative à la largeur) à une pastille déjà trouvée de la même équipe
RING_ORANGE = ((3, 110, 110), (22, 255, 255))  # liseré du joueur observé : plus sombre qu'une pastille pleine
RING_BLUE = ((98, 90, 110), (118, 255, 255))
# Halo pâle du joueur observé quand la scène derrière la minimap est sombre : moins saturé, donc plus de pixels exigés.
RING_ORANGE_WEAK = ((3, 45, 60), (22, 255, 255))
RING_BLUE_WEAK = ((98, 35, 60), (125, 255, 255))
RING_WEAK_PIXELS = 25  # à l'échelle de référence


def _scale(crop):
    return (crop.shape[1] / BASE_ZONE_W) ** 2


def _color_mask(hsv, bounds):
    m = cv2.inRange(hsv, np.array(bounds[0]), np.array(bounds[1]))
    return cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def _split_blob(mask, label_img, i, expected):
    """Une pastille de plus d'une surface normale : deux joueurs superposés. On les sépare par k-means sur les pixels."""
    ys, xs = np.nonzero(label_img == i)
    pts = np.column_stack([xs, ys]).astype(np.float32)
    k = 2
    _, lab, centers = cv2.kmeans(pts, k, None, (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 0.5), 3, cv2.KMEANS_PP_CENTERS)
    parts = []
    for j in range(k):
        sel = pts[lab.ravel() == j].astype(int)
        part = np.zeros_like(mask)
        part[sel[:, 1], sel[:, 0]] = 1
        parts.append(part)
    return parts


def _blobs(mask, scale, min_area=None):
    """Composantes de la taille d'une pastille, avec un indicateur « coupée » (les gros amas sont séparés en deux)."""
    lo, hi = MARKER_AREA[0] * scale, MARKER_AREA[1] * scale
    if min_area is not None:
        lo = min_area
    n, lab, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8))
    out = []
    for i in range(1, n):
        area = stats[i, cv2.CC_STAT_AREA]
        if area < lo or area >= SPAWN_MIN_AREA * scale:
            continue
        single = np.uint8(lab == i)
        if area > 1.5 * 320 * scale:
            out.extend((part, True) for part in _split_blob(single, lab, i, 320 * scale))
        else:
            out.append((single, False))
    return out


def _orientation(blob):
    """Direction de la pastille : (angle, axe, asymétrie) ou None.

    L'axe (degrés, 0-180, 0 = horizontal) est l'axe principal de la forme pleine : très stable. Le sens vers la pointe vient
    de l'asymétrie (la pointe fait une queue de ce côté) : moins fiable, surtout pour une pastille presque ronde. On garde
    donc l'asymétrie (positive = pointe du côté de l'axe, négative = côté opposé) pour que le suivi choisisse le sens
    sur toute la trajectoire. angle = axe si asymétrie ≥ 0, sinon axe + 180."""
    cnts, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cnts:
        return None
    solid = np.zeros_like(blob)
    cv2.drawContours(solid, [max(cnts, key=cv2.contourArea)], -1, 1, cv2.FILLED)
    ys, xs = np.nonzero(solid)
    if xs.size < 30:
        return None
    x, y = xs - xs.mean(), ys - ys.mean()
    vals, vecs = np.linalg.eigh(np.cov(np.vstack([x, y])))
    u = vecs[:, 1]
    p = x * u[0] + y * u[1]
    sigma = max(float(np.sqrt(vals[1])), 1e-6)
    skew = float((p**3).mean() / sigma**3)
    axis = math.degrees(math.atan2(u[1], u[0])) % 180
    angle = axis if skew >= 0 else (axis + 180) % 360
    # u pointe dans le sens (axis) ou (axis + 180) selon la convention de eigh : on ramène l'asymétrie à l'axe.
    if abs(math.degrees(math.atan2(u[1], u[0])) % 360 - axis) > 1:
        skew = -skew
        angle = axis if skew >= 0 else (axis + 180) % 360
    return angle, axis, skew


def _solidity(blob):
    """Surface / surface de l'enveloppe convexe : ~0,95 pour une pastille, ~0,6 pour une croix (joueur mort)."""
    cnts, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cnts:
        return 1.0
    c = max(cnts, key=cv2.contourArea)
    return cv2.contourArea(c) / max(cv2.contourArea(cv2.convexHull(c)), 1.0)


def _touches_border(blob):
    """Pastille coupée par le bord de la minimap : sa forme est tronquée, elle ne peut pas être prise pour une croix."""
    h, w = blob.shape
    return bool(blob[0, :].any() or blob[-1, :].any() or blob[:, 0].any() or blob[:, -1].any())


_CROSS = []


def _cross_templates():
    if not _CROSS and CROSS_PATH.exists():
        data = np.load(CROSS_PATH)
        _CROSS.extend(data[k].astype(np.float32).ravel() / 255.0 for k in data.files)
    return _CROSS


def _centered_window(blob, size=32):
    """Masque de la pastille dans une fenêtre size x size centrée sur son centre de gravité."""
    m = cv2.moments(blob, binaryImage=True)
    cx, cy = int(m["m10"] / m["m00"]), int(m["m01"] / m["m00"])
    h, w = blob.shape
    out = np.zeros((size, size), np.float32)
    y0, x0 = cy - size // 2, cx - size // 2
    ys, xs = max(y0, 0), max(x0, 0)
    ye, xe = min(y0 + size, h), min(x0 + size, w)
    out[ys - y0 : ye - y0, xs - x0 : xe - x0] = blob[ys:ye, xs:xe]
    return out.ravel()


def _is_cross(blob):
    """Vrai si la forme est la croix d'un joueur mort (comparée à des croix réelles de la vidéo)."""
    templates = _cross_templates()
    if not templates:
        return _solidity(blob) < DEAD_SOLIDITY
    v = _centered_window(blob)
    best = -1.0
    for tpl in templates:
        a, b = v - v.mean(), tpl - tpl.mean()
        d = np.linalg.norm(a) * np.linalg.norm(b)
        best = max(best, float(a @ b / d) if d else -1.0)
    return best >= MIN_CROSS_SCORE


def _glyph(crop_gray, blob):
    """Chiffre du numéro : fenêtre centrée sur le corps rond de la pastille, agrandie, puis pixels sombres (seuil d'Otsu)."""
    cnts, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cnts:
        return None
    solid = np.zeros_like(blob)
    cv2.drawContours(solid, [max(cnts, key=cv2.contourArea)], -1, 1, cv2.FILLED)
    _, rmax, _, (bx, by) = cv2.minMaxLoc(cv2.distanceTransform(solid, cv2.DIST_L2, 3))
    r = int(round(rmax))
    if r < 4:
        return None
    h, w = crop_gray.shape
    y0, y1, x0, x1 = max(by - r, 0), min(by + r + 1, h), max(bx - r, 0), min(bx + r + 1, w)
    win = cv2.resize(crop_gray[y0:y1, x0:x1], (GLYPH_SIZE[0], GLYPH_SIZE[1]), interpolation=cv2.INTER_CUBIC)
    yy, xx = np.mgrid[0 : GLYPH_SIZE[1], 0 : GLYPH_SIZE[0]]
    inside = ((xx - GLYPH_SIZE[0] / 2 + 0.5) ** 2 / (GLYPH_SIZE[0] * 0.42) ** 2 + (yy - GLYPH_SIZE[1] / 2 + 0.5) ** 2 / (GLYPH_SIZE[1] * 0.42) ** 2) <= 1
    thr, _ = cv2.threshold(win[inside].reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    dark = ((win < thr) & inside).astype(np.uint8)
    if dark.sum() < 12:
        return None
    return dark * 255


def _vec(g):
    return g.astype(np.float32).ravel() / 255.0


def load_digit_templates(path=DIGIT_TEMPLATES_PATH):
    """Modèles par chiffre : plusieurs variantes possibles (clés « 3 », « 3_2 »…)."""
    if not Path(path).exists():
        return {}
    data = np.load(path)
    out = {}
    for key in data.files:
        out.setdefault(key.split("_")[0], []).append(_vec(data[key]))
    return out


def _read_digit(glyph, templates):
    if glyph is None or not templates:
        return None
    v = _vec(glyph)
    scored = []
    for label, variants in templates.items():
        best = -1.0
        for tpl in variants:
            a, b = v - v.mean(), tpl - tpl.mean()
            d = np.linalg.norm(a) * np.linalg.norm(b)
            best = max(best, float(a @ b / d) if d else -1.0)
        scored.append((best, label))
    scored.sort(reverse=True)
    if scored[0][0] < MIN_DIGIT_SCORE or (len(scored) > 1 and scored[0][0] - scored[1][0] < MIN_DIGIT_MARGIN):
        return None
    return int(scored[0][1])


def _holes(glyph):
    """Ordonnées (sur 60) des centres des trous du chiffre : 8 en a deux, 6 un en bas, 9 un en haut."""
    up = (cv2.resize(glyph, (60, 60), interpolation=cv2.INTER_CUBIC) > 127).astype(np.uint8)
    cnts, hier = cv2.findContours(up, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = []
    if hier is not None:
        for c, h in zip(cnts, hier[0]):
            if h[3] != -1 and cv2.contourArea(c) >= 15:
                m = cv2.moments(c)
                out.append(m["m01"] / m["m00"])
    return out


def _read_blue_digit(glyph, templates):
    """Équipe bleue (6 à 9) : 6, 8 et 9 se distinguent par leurs trous, bien mieux que par corrélation. Le 7 n'a pas de trou."""
    if glyph is None:
        return None
    holes = _holes(glyph)
    if len(holes) >= 2:
        return 8
    if len(holes) == 1:
        return 9 if holes[0] < 30 else 6
    return 7 if _read_digit(glyph, templates) == 7 else None


def slot_of(number):
    """Numéro affiché (1-4 puis 6-9) -> slot 1 à 8."""
    return number if number <= 4 else number - 1


def _is_waiting_circle(blob, spawn_colors):
    """Disque blanc (et non goutte pointée) posé sur la couleur de la zone de départ : un joueur mort attend sa réapparition."""
    cnts, _ = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cnts:
        return False
    c = max(cnts, key=cv2.contourArea)
    _, r = cv2.minEnclosingCircle(c)
    if r <= 0 or cv2.contourArea(c) / (math.pi * r * r) < WAITING_CIRCULARITY:
        return False
    around = (cv2.dilate(blob, np.ones((21, 21), np.uint8)) - cv2.dilate(blob, np.ones((5, 5), np.uint8))) > 0
    n = int(around.sum())
    return n > 0 and any(int((mask > 0)[around].sum()) / n >= WAITING_SPAWN_SHARE for mask in spawn_colors.values())


GLYPH_DARK_V = 110  # pixel sombre : le chiffre noir du joueur observé
GLYPH_AREA = (10, 90)  # surface (échelle de référence) d'un chiffre
GLYPH_HEIGHT = (6, 16)  # hauteur (pixels, échelle de référence)
GLYPH_ASPECT = (0.3, 1.1)  # largeur / hauteur
DISC_WHITE_SHARE = 0.55  # part de pixels clairs et peu colorés autour du chiffre pour dire « disque blanc »
RING_MIN_PIXELS = 5  # pixels de la couleur d'équipe exigés autour du disque (liseré partiel accepté)


def _glyph_discs(hsv, scale, found):
    """Joueur observé que la détection par taches blanches a manqué : sur Polaris le disque blanc touche une zone claire de la carte et fusionne
    avec elle. On cherche donc le chiffre noir entouré de blanc, puis la couleur d'équipe autour, sans dépendre de la forme de la tache.
    Renvoie [(blob disque, équipe)]. Le liseré de la couleur d'équipe est exigé : les symboles blancs de la carte (flèche de tyrolienne) n'en ont pas."""
    h, w = hsv.shape[:2]
    v, s_ch = hsv[:, :, 2], hsv[:, :, 1]
    dark = cv2.morphologyEx((v < GLYPH_DARK_V).astype(np.uint8), cv2.MORPH_CLOSE, np.ones((2, 2), np.uint8))
    n, lab, stats, cents = cv2.connectedComponentsWithStats(dark)
    k = math.sqrt(scale)
    bright = (v >= 175) & (s_ch <= 95)
    out = []
    for i in range(1, n):
        x0, y0, bw, bh, area = stats[i]
        if not (GLYPH_AREA[0] * scale <= area <= GLYPH_AREA[1] * scale and GLYPH_HEIGHT[0] * k <= bh <= GLYPH_HEIGHT[1] * k and GLYPH_ASPECT[0] <= bw / bh <= GLYPH_ASPECT[1]):
            continue
        cx, cy = cents[i]
        r = max(4, int(round(0.7 * max(bw, bh))))  # rayon du disque blanc autour du chiffre (le contour sombre du disque est au-delà)
        yy, xx = np.mgrid[max(int(cy) - r, 0) : min(int(cy) + r + 1, h), max(int(cx) - r, 0) : min(int(cx) + r + 1, w)]
        inside = ((xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) & (lab[yy, xx] != i)
        if inside.sum() < 20 or bright[yy, xx][inside].mean() < DISC_WHITE_SHARE:
            continue
        ring = np.zeros((h, w), np.uint8)
        cv2.circle(ring, (int(round(cx)), int(round(cy))), r + 4, 1, -1)
        cv2.circle(ring, (int(round(cx)), int(round(cy))), r, 0, -1)
        votes = {
            "A": int((_color_mask(hsv, RING_ORANGE_WEAK) > 0)[ring > 0].sum()),
            "B": int((_color_mask(hsv, RING_BLUE_WEAK) > 0)[ring > 0].sum()),
        }
        team = max(votes, key=votes.get)
        if votes[team] < RING_MIN_PIXELS or votes[team] < 2 * votes["A" if team == "B" else "B"]:
            continue
        disc = np.zeros((h, w), np.uint8)
        # Disque de lecture du chiffre : de la taille de la pastille réelle (le chiffre en occupe la moitié centrale, comme pour les modèles appris).
        cv2.circle(disc, (int(round(cx)), int(round(cy))), max(r, int(round(0.9 * max(bw, bh)))), 1, -1)
        if any(d["team"] == team and d["spectated"] and math.hypot(d["x"] - cx / w, d["y"] - cy / h) < 0.03 for d in found):
            continue
        out.append((disc, team))
    return out


def find_markers(crop, templates=None):
    """Toutes les pastilles de la minimap. Coordonnées normalisées (0 à 1) dans le recadrage."""
    templates = templates if templates is not None else load_digit_templates()
    cv2.setRNGSeed(0)  # le découpage des amas (k-means) est aléatoire : sans graine, deux lectures de la même image pouvaient différer
    h, w = crop.shape[:2]
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    gray = hsv[:, :, 2]  # luminosité : le numéro est plus sombre que la pastille quelle que soit sa couleur
    scale = _scale(crop)
    found = []

    def add(blob, team, alive, spectated, silhouette=None, no_digit=False, require_digit=False):
        m = cv2.moments(blob, binaryImage=True)
        if not m["m00"]:
            return
        glyph = _glyph(gray, blob)
        # Direction mesurée sur la silhouette complète (pour le joueur observé : blanc + liseré coloré, dont la pointe est plus nette).
        orient = _orientation(silhouette if silhouette is not None else blob) if alive else None
        # Pastille atténuée : le numéro y est mal lu (un 1 passe pour un 2), on ne s'y fie pas ; le suivi la relie par sa position.
        number = None if no_digit else (_read_blue_digit(glyph, templates) if team == "B" else _read_digit(glyph, templates))
        if require_digit and number is None:
            return
        found.append(
            {
                "team": team,
                "x": m["m10"] / m["m00"] / w,
                "y": m["m01"] / m["m00"] / h,
                "number": number,
                "slot": slot_of(number) if number else None,
                "angle": orient[0] if orient else None,
                "axis": orient[1] if orient else None,
                "skew": orient[2] if orient else None,
                "alive": alive,
                "spectated": spectated,
                "glyph": glyph,
                "area": int(m["m00"]),
            }
        )

    for team, bounds in (("A", ORANGE), ("B", BLUE)):
        for blob, split in _blobs(_color_mask(hsv, bounds), scale):
            add(blob, team, alive=split or _touches_border(blob) or _solidity(blob) >= DEAD_SOLIDITY or not _is_cross(blob), spectated=False)

    # Pastilles atténuées que le seuil de luminosité élevé a manquées.
    for team, bounds in (("A", ORANGE_DIM), ("B", BLUE_DIM)):
        for blob, split in _blobs(_color_mask(hsv, bounds), scale):
            if split:
                continue  # un gros amas (zone d'apparition) n'est pas une pastille
            m = cv2.moments(blob, binaryImage=True)
            if not m["m00"]:
                continue
            cx, cy = m["m10"] / m["m00"] / w, m["m01"] / m["m00"] / h
            if any(d["team"] == team and math.hypot(d["x"] - cx, d["y"] - cy) < DIM_MIN_SEPARATION for d in found):
                continue
            add(blob, team, alive=not _is_cross(blob), spectated=False, no_digit=True)

    # Joueur observé : pastille blanche, cerclée de la couleur de son équipe.
    white = cv2.inRange(hsv, np.array((0, 0, 205)), np.array((180, 70, 255)))
    white = cv2.morphologyEx(white, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    spawn_colors = {
        "A": cv2.morphologyEx(cv2.inRange(hsv, np.array((3, 90, 90)), np.array((22, 255, 255))), cv2.MORPH_OPEN, np.ones((9, 9), np.uint8)),
        "B": cv2.morphologyEx(cv2.inRange(hsv, np.array((98, 90, 90)), np.array((118, 255, 255))), cv2.MORPH_OPEN, np.ones((9, 9), np.uint8)),
    }
    for blob, _ in _blobs(white, scale, min_area=WHITE_MIN_AREA * scale):
        if _is_waiting_circle(blob, spawn_colors):
            continue  # joueur mort qui attend dans sa zone de départ : ce n'est pas une pastille en jeu
        ring = cv2.dilate(blob, np.ones((7, 7), np.uint8)) - blob
        votes = {
            "A": int((_color_mask(hsv, RING_ORANGE) > 0)[ring > 0].sum()),
            "B": int((_color_mask(hsv, RING_BLUE) > 0)[ring > 0].sum()),
        }
        team = max(votes, key=votes.get)
        pale_ring = votes[team] < 10 * scale
        if pale_ring:
            weak = {
                "A": int((_color_mask(hsv, RING_ORANGE_WEAK) > 0)[ring > 0].sum()),
                "B": int((_color_mask(hsv, RING_BLUE_WEAK) > 0)[ring > 0].sum()),
            }
            team = max(weak, key=weak.get)
            votes[team] = weak[team] if weak[team] >= RING_WEAK_PIXELS * scale and weak[team] > 2 * weak["A" if team == "B" else "B"] else 0
        # Un vrai joueur observé a un liseré de sa couleur sur 30 à 75 % de son pourtour (mesuré) ; un reflet bleuté du décor autour d'une tache blanche n'en
        # couvre qu'un petit bout. On exige une vraie proportion du pourtour, pas seulement quelques pixels.
        if votes[team] and votes[team] < WHITE_RING_SHARE * int((ring > 0).sum()):
            votes[team] = 0
        if votes[team] >= 10 * scale:
            # Le liseré coloré qui entoure la pastille blanche en dessine la pointe : on l'ajoute pour mesurer la direction.
            rim = (_color_mask(hsv, RING_ORANGE if team == "A" else RING_BLUE) > 0) & (ring > 0)
            silhouette = cv2.morphologyEx(np.maximum(blob, rim.astype(np.uint8)), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
            add(blob, team, alive=True, spectated=True, silhouette=silhouette, require_digit=pale_ring or WHITE_REQUIRE_DIGIT)  # halo pâle : le numéro doit être lisible
    # Le joueur observé fusionné avec une zone claire de la carte (Polaris) : cherché par son chiffre noir sur disque blanc, hors zones de départ.
    for disc, team in _glyph_discs(hsv, scale, found):
        waiting = _is_waiting_circle(disc, spawn_colors)
        before = len(found)
        add(disc, team, alive=True, spectated=True)  # numéro lu si possible ; sinon le bandeau dit quel joueur est observé
        for d in found[before:]:
            d["verified"] = True  # chiffre noir sur disque blanc et liseré de la couleur d'équipe : pas un symbole du décor
            if waiting:
                d["waiting"] = True  # disque blanc dans la zone de départ : joueur mort qui attend, OU joueur observé qui y est encore (le suivi tranche avec les bandeaux)
    noise = [d for d in found if d["spectated"] and not d["number"] and not d.get("verified")]
    if len(noise) > WHITE_MAX_UNNUMBERED:
        found = [d for d in found if not (d["spectated"] and not d["number"] and not d.get("verified"))]
    return found
