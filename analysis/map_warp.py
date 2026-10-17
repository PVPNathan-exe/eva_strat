"""Alignement PAR SECTIONS de la minimap du jeu sur le plan stratégique d'une carte dont les deux ne sont pas homothétiques (Artefact : trois blocs
très écartés sur le plan, compacts sur la minimap). Un cadre affine (map_plan_insets.json) ne peut pas aligner les trois blocs en même temps : la
carte reçoit un MAILLAGE de repères (point de la minimap, même point du plan), lu par le site (src/lib/planWarp.ts) qui déforme par triangle.

  python analysis/map_warp.py --map Artefact            affiche les repères, l'écart des repères gardés à part et le maillage (rien n'est écrit)
  python analysis/map_warp.py --map Artefact --write    écrit analysis/map_warp.json
  python analysis/map_warp.py --map Artefact --eval     part des lectures sûres de la base qui tombent sur un mur ou hors des blocs du plan (cadre affine, puis maillage)

Repères (tous les points sont en fractions : minimap = x / largeur, y / hauteur de la zone ; plan = x / largeur, y / hauteur de l'image) :
  - stations de tyrolienne (MESURÉES) : les 10 paires de map_stations.json (minimap, posées à la main et alignées sur les sauts réels) et les 20 disques verts du plan
    (couleur, forme) ; l'appariement vient de la STRUCTURE : six rangées (4, 4, 2, 4, 4, 2 disques) de même ordre sur les deux, puis de gauche à droite ;
  - coins des trois blocs (MESURÉS, bord extérieur des murs) : plan = traits blancs, minimap = seuil de luminosité de la médiane (map_masks/<Carte>_mediane.png) ;
  - RETENUS À PART pour contrôler (jamais utilisés pour le calage) : coins des quatre zones de départ (couleur orange et bleue des deux images), boîte de capture A,
    croix et fentes de la fenêtre de vue du bloc du haut (relevés à l'œil sur les images zoomées avec une grille, précision d'environ 2 pixels du plan).
Le maillage est une triangulation de Delaunay (OpenCV) des repères gardés, calculée en pixels de la minimap (le repère garde son aspect)."""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
OUT = HERE / "map_warp.json"
PLANS = HERE.parent / "src" / "assets" / "maps"
MASKS = HERE / "map_masks"
STATIONS = HERE / "map_stations.json"
INSETS = HERE / "map_plan_insets.json"
GREEN_HUE = (60, 90)  # disques de tyrolienne du plan (vert 0, 211, 131 ou 0, 226, 44), teinte OpenCV
ROW_SIZES = [4, 4, 2, 4, 4, 2]  # rangées de stations d'Artefact, de haut en bas (même structure sur la minimap et sur le plan)
WHITE_MIN = 238  # trait blanc du plan (les trois canaux)
EDGE_LUMA = 40  # luminosité minimale du sol d'un bloc sur la médiane de la minimap (fond 14, sol 53, murs 94)

# Retenus à part pour le contrôle (relevés à l'œil sur images zoomées avec grille, environ 2 px du plan ; la boîte A est mesurée à la couleur sur la minimap) :
# nom : (minimap en pixels de la médiane 436 x 258, plan en pixels de l'image 850 x 670)
EYE_CHECKS = {
    "croix gauche": ((138.3, 134.0), (309.0, 317.5)),
    "croix droite": ((299.0, 134.0), (538.5, 317.5)),
    "fente gauche du bloc du haut": ((196.0, 30.0), (392.0, 47.5)),
    "fente droite du bloc du haut": ((241.0, 30.0), (457.0, 47.5)),
}
A_BOX_PLAN = ((398.5, 311.0), (456.0, 364.0))  # boîte de capture A sur le plan : coin haut gauche et bas droit intérieurs (relevé à l'œil)


# ---------------------------------------------------------------- mesures sur les images


def plan_station_discs(plan_bgr):
    """Centres (pixels, repère continu) des disques verts de tyrolienne du plan : couleur, fermeture de la flèche blanche, ouverture qui retire les traits pointillés."""
    hsv = cv2.cvtColor(plan_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = (hsv[..., i].astype(int) for i in range(3))
    green = ((h >= GREEN_HUE[0]) & (h <= GREEN_HUE[1]) & (s > 200) & (v > 200)).astype(np.uint8)
    green = cv2.morphologyEx(green, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
    disc = cv2.morphologyEx(green, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17)))
    n, _, _, centroids = cv2.connectedComponentsWithStats(disc)
    return np.array([[c[0] + 0.5, c[1] + 0.5] for c in centroids[1:]])


def rows_of(points, sizes):
    """Range des points en rangées de haut en bas (tailles `sizes` imposées, coupure aux plus grands écarts verticaux), chaque rangée de gauche à droite : liste d'indices."""
    order = np.argsort(points[:, 1], kind="stable")
    gaps = np.diff(points[order, 1])
    cuts = sorted(np.argsort(gaps)[::-1][: len(sizes) - 1])
    rows, start = [], 0
    for c in list(cuts) + [len(points) - 1]:
        rows.append(order[start : c + 1])
        start = c + 1
    if [len(r) for r in rows] != list(sizes):
        raise ValueError(f"rangées de stations {[len(r) for r in rows]} au lieu de {list(sizes)}")
    return [r[np.argsort(points[r, 0], kind="stable")] for r in rows]


def match_stations(mini_pts, plan_pts, sizes=ROW_SIZES):
    """Apparie les stations de la minimap et du plan par leur place dans la structure (rangée, ordre de gauche à droite) : liste de (indice minimap, indice plan)."""
    mini_rows, plan_rows = rows_of(mini_pts, sizes), rows_of(plan_pts, sizes)
    return [(int(a), int(b)) for ra, rb in zip(mini_rows, plan_rows) for a, b in zip(ra, rb)]


def _span(profile, thr):
    """Premier et dernier indice dont la couverture atteint thr, en repère continu [premier, dernier + 1]."""
    idx = np.nonzero(profile >= thr)[0]
    return (float(idx[0]), float(idx[-1] + 1)) if len(idx) else None


def mini_mid_block(median_gray):
    """Bords extérieurs (gauche, haut, droite, bas, pixels de la médiane) du bloc du milieu de la minimap : seuil de luminosité du sol dans des bandes qui évitent les disques."""
    m = median_gray >= EDGE_LUMA
    h, w = m.shape
    cols = _span(m[int(0.38 * h) : int(0.62 * h), :].mean(axis=0), 0.5)
    rows = _span(m[int(0.27 * h) : int(0.70 * h), int(0.46 * w) : int(0.52 * w)].mean(axis=1), 0.5)
    return (cols[0], rows[0] + int(0.27 * h), cols[1], rows[1] + int(0.27 * h))


def plan_mid_block(plan_bgr):
    """Bords extérieurs (gauche, haut, droite, bas, pixels du plan) du bloc du milieu du plan : traits blancs (le bord extérieur du trait), hors salles latérales et boîte A."""
    white = plan_bgr.min(axis=2) >= WHITE_MIN
    cols = _span(white[270:312, :].sum(axis=0), 8)
    rows = _span(white[240:380, 400:420].sum(axis=1), 15)
    return (cols[0], rows[0] + 240.0, cols[1], rows[1] + 240.0)


def side_room_corners(img, kind):
    """Coins intérieurs (bout ouvert côté bloc) des deux salles latérales : [(x, y) haut gauche, bas gauche, haut droit, bas droit] en pixels de l'image.
    `kind` : "plan" (traits blancs) ou "mini" (luminosité de la médiane, murs plus clairs que le sol). Les murs haut et bas de chaque salle sont deux traits horizontaux."""
    h, w = img.shape[:2]
    if kind == "plan":
        wall = img.min(axis=2) >= WHITE_MIN
        bands = {"L": (60, 120), "R": (730, 790)}  # colonnes qui évitent le disque de la station
        ys, thr_row, thr_col = (300, 370), 8, 6
    else:
        wall = img >= 80
        bands = {"L": (32, 44), "R": (396, 410)}
        ys, thr_row, thr_col = (110, 175), 8, 2
    out = []
    for side in ("L", "R"):
        x0, x1 = bands[side]
        rows = _span(wall[ys[0] : ys[1], x0:x1].sum(axis=1), thr_row)
        top = rows[0] + ys[0]
        # fin du mur de la salle, côté bloc : on lit les colonnes du trait du haut sur une bande plus large
        wide = (60, 120) if (kind == "plan" and side == "L") else (730, 800) if kind == "plan" else (32, 80) if side == "L" else (380, 410)
        cols = _span(wall[int(top) : int(top) + 3, wide[0] : wide[1]].sum(axis=0), 1)
        end = (cols[1] + wide[0]) if side == "L" else (cols[0] + wide[0])
        # bas : dernier trait de la bande
        bottom = _bottom_line(wall, ys, x0, x1, thr_row)
        out.append((float(end), float(top)))
        out.append((float(end), float(bottom)))
    return [out[0], out[1], out[2], out[3]]


def _bottom_line(wall, ys, x0, x1, thr):
    """Bord extérieur (bas) du dernier trait horizontal de la bande."""
    prof = wall[ys[0] : ys[1], x0:x1].sum(axis=1)
    idx = np.nonzero(prof >= thr)[0]
    return float(idx[-1] + 1 + ys[0])


def color_boxes(img_bgr, hue_ranges, min_area=300):
    """Rectangles englobants (x, y, largeur, hauteur) des taches de couleur franche : orange (équipe A) et bleu (équipe B) des zones de départ."""
    hsv = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HSV)
    h, s, v = (hsv[..., i].astype(int) for i in range(3))
    out = {}
    for name, (lo, hi) in hue_ranges.items():
        m = ((h >= lo) & (h <= hi) & (s >= 110) & (v >= 90)).astype(np.uint8)
        m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, _, st, _ = cv2.connectedComponentsWithStats(m)
        out[name] = [tuple(int(v) for v in st[i][:4]) for i in range(1, n) if st[i][4] >= min_area]
    return out


def spawn_boxes(img_bgr, orange_xmax=0.35, orange_ymax=(0.2, 0.8)):
    """Les quatre zones de départ : orange en haut à gauche et en bas à gauche, bleu en haut à droite et en bas à droite (le fond du plan a des reflets orange ailleurs)."""
    h, w = img_bgr.shape[:2]
    boxes = color_boxes(img_bgr, {"orange": (5, 22), "blue": (98, 115)})
    orange = [b for b in boxes["orange"] if b[0] < orange_xmax * w and (b[1] < orange_ymax[0] * h or b[1] > orange_ymax[1] * h)]
    blue = [b for b in boxes["blue"] if b[0] > 0.55 * w]
    return sorted(orange + blue, key=lambda b: (b[1] > 0.5 * h, b[0]))  # haut gauche, haut droit, bas gauche, bas droit


def box_corners(b):
    x, y, w, h = b
    return [(x, y), (x + w, y), (x, y + h), (x + w, y + h)]


# ---------------------------------------------------------------- maillage et transformation


def triangulate(points_px):
    """Triangulation de Delaunay (OpenCV) de points (n, 2) : liste de triplets d'indices."""
    pts = np.asarray(points_px, np.float32)
    lo, hi = pts.min(axis=0) - 10, pts.max(axis=0) + 10
    sub = cv2.Subdiv2D((int(lo[0]), int(lo[1]), int(hi[0] - lo[0]) + 1, int(hi[1] - lo[1]) + 1))
    for p in pts:
        sub.insert((float(p[0]), float(p[1])))
    index = {(float(p[0]), float(p[1])): i for i, p in enumerate(pts)}
    tris = []
    for t in sub.getTriangleList():
        ids = [index.get((float(t[2 * k]), float(t[2 * k + 1]))) for k in range(3)]
        if None not in ids:
            tris.append(sorted(ids))
    return sorted(set(map(tuple, tris)))


def signed_area(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def orientation_ok(mini, plan, triangles):
    """Vrai si aucun triangle du maillage n'est retourné ni aplati entre la minimap et le plan (même signe d'aire partout)."""
    signs = {np.sign(signed_area(mini[i], mini[j], mini[k]) * signed_area(plan[i], plan[j], plan[k])) for i, j, k in triangles}
    return signs == {1.0}


def global_affine(mini, plan):
    """Affine global (moindres carrés) du plan sur la minimap : matrice 2 x 3 telle que plan = M @ (x, y, 1). Repli hors du maillage."""
    a = np.hstack([np.asarray(mini, float), np.ones((len(mini), 1))])
    sol, *_ = np.linalg.lstsq(a, np.asarray(plan, float), rcond=None)
    return sol.T


EXTRAPOLATE_MARGIN = 0.08  # fraction de la minimap : au-delà de cette distance du maillage, repli sur l'affine global


def _bary(a, b, c, x, y):
    d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(d) < 1e-12:
        return None
    u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d
    v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d
    return u, v, 1 - u - v


def to_plan(entry, x, y):
    """Minimap vers plan (fractions) : triangle qui contient le point (coordonnées barycentriques) ; juste hors du maillage (moins de EXTRAPOLATE_MARGIN) le triangle le plus proche est
    prolongé (la transformation reste continue au bord) ; plus loin, affine global. Même règle dans src/lib/planWarp.ts."""
    mini, plan = [p["mini"] for p in entry["points"]], [p["plan"] for p in entry["points"]]
    best, best_w = None, -1e9
    for i, j, k in entry["triangles"]:
        w = _bary(mini[i], mini[j], mini[k], x, y)
        if w is None:
            continue
        m = min(w)
        if m >= -1e-9:
            return (w[0] * plan[i][0] + w[1] * plan[j][0] + w[2] * plan[k][0], w[0] * plan[i][1] + w[1] * plan[j][1] + w[2] * plan[k][1])
        if m > best_w:
            best, best_w = (i, j, k, w), m
    if best is not None and _outside_distance(mini, best, x, y) <= EXTRAPOLATE_MARGIN:
        i, j, k, w = best
        return (w[0] * plan[i][0] + w[1] * plan[j][0] + w[2] * plan[k][0], w[0] * plan[i][1] + w[1] * plan[j][1] + w[2] * plan[k][1])
    m = global_affine(mini, plan)
    return (float(m[0] @ [x, y, 1]), float(m[1] @ [x, y, 1]))


def _outside_distance(mini, tri, x, y):
    """Distance (fractions de la minimap) du point au triangle le plus proche (au plus proche de ses trois côtés)."""
    i, j, k, _ = tri
    best = 1e9
    for p, q in ((i, j), (j, k), (k, i)):
        (x1, y1), (x2, y2) = mini[p], mini[q]
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy))) if dx or dy else 0.0
        best = min(best, float(np.hypot(x - (x1 + t * dx), y - (y1 + t * dy))))
    return best


# ---------------------------------------------------------------- assemblage


# Bords des blocs, en noms de repères : le maillage les garde comme arêtes (repères intermédiaires interpolés, DENSIFY_PX), sinon la triangulation relie un bloc à l'autre à travers
# le vide et un point du bloc du bas se retrouve au-dessus de lui. sp<q>.<k> : coin k (0 HG, 1 HD, 2 BG, 3 BD) de la zone de départ q (0 haut gauche, 1 haut droit, 2 bas gauche,
# 3 bas droit) ; st<rangée>.<n> : station n de la rangée (0 et 1 : bords bas du bloc du haut et haut du milieu, 2 : salles latérales, 3 et 4 : bords bas du milieu et haut du bas,
# 5 : deux stations du bas) ; mid.<k> : coin du bloc du milieu ; room<côté>.<0 haut, 1 bas> : coin de salle latérale.
EDGE_LINES = [
    ["sp0.0", "sp0.1", "sp1.0", "sp1.1"], ["sp0.2", "st0.0", "st0.1", "st0.2", "st0.3", "sp1.3"], ["sp0.0", "sp0.2"], ["sp1.1", "sp1.3"],
    ["mid.0", "st1.0", "st1.1", "st1.2", "st1.3", "mid.1"], ["mid.2", "st3.0", "st3.1", "st3.2", "st3.3", "mid.3"], ["mid.0", "mid.2"], ["mid.1", "mid.3"],
    ["sp2.0", "st4.0", "st4.1", "st4.2", "st4.3", "sp3.1"], ["sp2.2", "sp2.3", "sp3.2", "sp3.3"], ["sp2.0", "sp2.2"], ["sp3.1", "sp3.3"],
    ["st2.0", "roomL.0"], ["st2.0", "roomL.1"], ["roomL.0", "roomL.1"], ["st2.1", "roomR.0"], ["st2.1", "roomR.1"], ["roomR.0", "roomR.1"],
]
# Quatre coins de zones de départ sont au ras des stations sur chaque image mais de l'autre côté de la ligne des stations (minimap : la station est au-dessus du bord bas de la zone
# du haut, plan : en dessous) : les garder en repère retournerait des triangles. Ils servent de contrôle (écart de définition entre les deux images).
CHECK_ONLY = ["sp0.3", "sp1.2", "sp2.1", "sp3.0"]
DENSIFY_PX = 8  # écart maximal (pixels de la minimap) entre deux repères d'un bord


def anchors(plan, median, map_name):
    """Repères mesurés : dict nom -> {"mini": [x, y], "plan": [x, y], "kind", "origin"} (fractions)."""
    ph, pw = plan.shape[:2]
    mh, mw = median.shape[:2]
    out = {}
    stations = json.loads(STATIONS.read_text(encoding="utf-8"))[map_name]
    mini_st = np.array([[s[k]["x"], s[k]["y"]] for s in stations for k in ("a", "b")])
    plan_st = plan_station_discs(plan) / [pw, ph]
    mini_rows, plan_rows = rows_of(mini_st, ROW_SIZES), rows_of(plan_st, ROW_SIZES)
    for r, (ra, rb) in enumerate(zip(mini_rows, plan_rows)):
        for c, (i, j) in enumerate(zip(ra, rb)):
            out[f"st{r}.{c}"] = {"mini": [round(float(v), 5) for v in mini_st[i]], "plan": [round(float(v), 5) for v in plan_st[j]], "kind": "station de tyrolienne", "origin": "mesuré"}
    ms, ps = spawn_boxes(median), spawn_boxes(plan)
    if len(ms) != 4 or len(ps) != 4:
        raise ValueError(f"zones de départ trouvées : {len(ms)} sur la minimap, {len(ps)} sur le plan (4 attendues)")
    for q in range(4):
        for k, ((mx, my), (px, py)) in enumerate(zip(box_corners(ms[q]), box_corners(ps[q]))):
            out[f"sp{q}.{k}"] = {"mini": [round(mx / mw, 5), round(my / mh, 5)], "plan": [round(px / pw, 5), round(py / ph, 5)], "kind": f"coin {k + 1} de la zone de départ {q + 1}", "origin": "mesuré (couleur)"}
    gray = cv2.cvtColor(median, cv2.COLOR_BGR2GRAY)
    for name, (mc, pc) in zip(["roomL.0", "roomL.1", "roomR.0", "roomR.1"], zip(side_room_corners(gray, "mini"), side_room_corners(plan, "plan"))):
        out[name] = {"mini": [round(mc[0] / mw, 5), round(mc[1] / mh, 5)], "plan": [round(pc[0] / pw, 5), round(pc[1] / ph, 5)], "kind": "coin de salle latérale", "origin": "mesuré"}
    mm, pm_ = mini_mid_block(gray), plan_mid_block(plan)
    for k, (cx, cy) in enumerate([(0, 1), (2, 1), (0, 3), (2, 3)]):
        out[f"mid.{k}"] = {"mini": [round(mm[cx] / mw, 5), round(mm[cy] / mh, 5)], "plan": [round(pm_[cx] / pw, 5), round(pm_[cy] / ph, 5)], "kind": "coin du bloc du milieu", "origin": "mesuré"}
    return out


def densify(points, names, lines, size, step=DENSIFY_PX):
    """Ajoute le long de chaque bord des repères intermédiaires (interpolation linéaire des deux côtés) tous les `step` pixels de la minimap : liste des points (dicts)."""
    index = {n: i for i, n in enumerate(names)}
    pts = list(points)
    scale = np.array(size, float)
    seen = set()
    for line in lines:
        ordered = sorted(line, key=lambda n: tuple(points[index[n]]["mini"]))
        for u, v in zip(ordered, ordered[1:]):
            if (u, v) in seen or (v, u) in seen:
                continue
            seen.add((u, v))
            a, b = points[index[u]], points[index[v]]
            dist = float(np.hypot(*((np.array(b["mini"]) - np.array(a["mini"])) * scale)))
            n = int(np.ceil(dist / step))
            for k in range(1, n):
                t = k / n
                pts.append({"mini": [round(a["mini"][i] + t * (b["mini"][i] - a["mini"][i]), 5) for i in range(2)], "plan": [round(a["plan"][i] + t * (b["plan"][i] - a["plan"][i]), 5) for i in range(2)], "kind": "bord interpolé", "origin": "interpolé"})
    return pts


def build(map_name="Artefact"):
    """Repères, maillage et contrôles de la carte. Renvoie (entrée du fichier JSON, rapport)."""
    plan = cv2.imread(str(PLANS / f"{map_name}.png"))
    median = cv2.imread(str(MASKS / f"{map_name}_mediane.png"))
    if plan is None or median is None:
        raise FileNotFoundError(f"plan ou médiane de {map_name} introuvable")
    ph, pw = plan.shape[:2]
    mh, mw = median.shape[:2]
    anc = anchors(plan, median, map_name)
    names = [n for n in anc if n not in CHECK_ONLY]
    base = [dict(anc[n], name=n) for n in names]
    points = densify(base, names, EDGE_LINES, (mw, mh))

    mini = [p["mini"] for p in points]
    plan_pts = [p["plan"] for p in points]
    tris = triangulate(np.array(mini) * [mw, mh])
    entry = {"plan_size": [pw, ph], "mini_size": [mw, mh], "points": points, "triangles": [list(t) for t in tris]}
    if not orientation_ok(mini, plan_pts, tris):
        raise ValueError("un triangle du maillage est retourné : repères à revoir")

    # contrôles retenus à part : écart (en pixels du plan) entre la position prédite et la position mesurée
    checks = []
    for n in CHECK_ONLY:
        mx, my = np.array(anc[n]["mini"]) * [mw, mh]
        px, py = np.array(anc[n]["plan"]) * [pw, ph]
        checks.append((f"coin de zone de départ {n}", (mx, my), (px, py), "couleur"))
    orange_med = [b for b in color_boxes(median, {"o": (5, 22)})["o"] if 0.4 * mw < b[0] < 0.6 * mw and 0.4 * mh < b[1] < 0.7 * mh]
    if orange_med:
        x, y, w, h = orange_med[0]
        checks.append(("boîte A coin haut gauche", (x, y), A_BOX_PLAN[0], "couleur / œil"))
        checks.append(("boîte A coin bas droit", (x + w, y + h), A_BOX_PLAN[1], "couleur / œil"))
        checks.append(("boîte A centre", (x + w / 2, y + h / 2), ((A_BOX_PLAN[0][0] + A_BOX_PLAN[1][0]) / 2, (A_BOX_PLAN[0][1] + A_BOX_PLAN[1][1]) / 2), "couleur / œil"))
    for name, (m_px, p_px) in EYE_CHECKS.items():
        checks.append((name, m_px, p_px, "œil"))
    inset = json.loads(INSETS.read_text(encoding="utf-8")).get(map_name)
    g = global_affine(mini, plan_pts)
    report = {"checks": []}
    for name, m_px, p_px, how in checks:
        x, y = m_px[0] / mw, m_px[1] / mh
        fx, fy = to_plan(entry, x, y)
        gx, gy = g[0] @ [x, y, 1], g[1] @ [x, y, 1]
        row = {"nom": name, "origine": how, "ecart_maillage_px": float(np.hypot(fx * pw - p_px[0], fy * ph - p_px[1])), "ecart_affine_global_px": float(np.hypot(gx * pw - p_px[0], gy * ph - p_px[1]))}
        if inset:  # cadre affine actuel (map_plan_insets.json)
            cx, cy = inset["l"] + x * (1 - inset["l"] - inset["r"]), inset["t"] + y * (1 - inset["t"] - inset["b"])
            row["ecart_cadre_actuel_px"] = float(np.hypot(cx * pw - p_px[0], cy * ph - p_px[1]))
        report["checks"].append(row)
    report["leave_one_out"] = leave_one_out(base, names, size=(mw, mh), plan_size=(pw, ph))
    return entry, report


def leave_one_out(base, names, size, plan_size):
    """Validation croisée sur les stations : pour chacune, le maillage refait SANS elle (ni ses repères de bord) prédit-il sa position sur le plan ? Écarts en pixels du plan."""
    out = {}
    for n in names:
        if not n.startswith("st"):
            continue
        keep = [q for q in base if q["name"] != n]
        kn = [q["name"] for q in keep]
        lines = [[m for m in line if m != n] for line in EDGE_LINES]
        pts = densify(keep, kn, [ln for ln in lines if len(ln) > 1], size)
        mini = [p["mini"] for p in pts]
        tris = triangulate(np.array(mini) * size)
        ent = {"points": pts, "triangles": [list(t) for t in tris]}
        target = next(q for q in base if q["name"] == n)
        fx, fy = to_plan(ent, *target["mini"])
        out[n] = float(np.hypot((fx - target["plan"][0]) * plan_size[0], (fy - target["plan"][1]) * plan_size[1]))
    return out


def _dump(known):
    """JSON lisible et compact : un repère par ligne, les triangles par groupes de huit."""
    nl = chr(10)
    chunks = []
    for name, e in known.items():
        pts = ("," + nl).join("    " + json.dumps(p, ensure_ascii=False, separators=(", ", ": ")) for p in e["points"])
        tri = e["triangles"]
        tris = ("," + nl).join("    " + ", ".join(json.dumps(t, separators=(",", ":")) for t in tri[i : i + 8]) for i in range(0, len(tri), 8))
        head = f'"plan_size": {json.dumps(e["plan_size"])}, "mini_size": {json.dumps(e["mini_size"])}'
        chunks.append("  " + json.dumps(name, ensure_ascii=False) + ": {" + nl + "   " + head + "," + nl + '   "points": [' + nl + pts + nl + "   ]," + nl + '   "triangles": [' + nl + tris + nl + "   ]" + nl + "  }")
    return "{" + nl + ("," + nl).join(chunks) + nl + "}" + nl


def write_entry(map_name, entry, out=OUT):
    """Écrit (ou met à jour) l'entrée de la carte dans map_warp.json ; les autres cartes ne bougent pas."""
    known = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    known[map_name] = entry
    out.write_text(_dump(known), encoding="utf-8")


# ---------------------------------------------------------------- évaluation sur les lectures sûres


def plan_rects(plan_bgr):
    """Rectangles (gauche, haut, droite, bas, pixels du plan) des trois blocs et des deux salles latérales du plan d'Artefact, bords extérieurs des traits blancs (contrôle des positions seulement)."""
    white = plan_bgr.min(axis=2) >= WHITE_MIN
    runs = []  # six traits horizontaux longs : haut et bas de chaque bloc
    for i in np.nonzero(white.sum(axis=1) >= 150)[0]:
        if runs and i == runs[-1][1] + 1:
            runs[-1][1] = int(i)
        else:
            runs.append([int(i), int(i)])
    if len(runs) != 6:
        raise ValueError(f"traits horizontaux des blocs : {len(runs)} au lieu de 6")
    rects = []
    for n, band in enumerate([(35, 70), (270, 312), (605, 640)]):
        cols = _span(white[band[0] : band[1], :].sum(axis=0), 8)
        rects.append((cols[0], float(runs[2 * n][0]), cols[1], float(runs[2 * n + 1][1] + 1)))
    for side, (x0, x1) in (("L", (30, 100)), ("R", (730, 820))):  # salles latérales : traits haut et bas à 316 et 353 environ
        rows = _span(white[300:370, x0:x1].sum(axis=1), 8)
        rects.append((float(x0), rows[0] + 300.0, float(x1), rows[1] + 300.0))
    return rects


def plan_walkable(plan_bgr):
    """Plan : (mur, praticable) en bool à la résolution du plan. Mur = composantes blanches d'au moins 2500 pixels (plan_mask.wall_mask) ; praticable = rectangles des blocs et salles
    plus les disques de tyrolienne (rayon 16 px), murs exclus."""
    import plan_mask

    wall = plan_mask.wall_mask(plan_bgr)
    walk = np.zeros(wall.shape, np.uint8)
    for l, t, r, b in plan_rects(plan_bgr):
        walk[int(t) : int(b), int(l) : int(r)] = 1
    for c in plan_station_discs(plan_bgr):
        cv2.circle(walk, (int(c[0]), int(c[1])), 16, 1, -1)
    return wall, (walk > 0) & ~wall


def evaluate(map_name, db_path, game):
    """Part des lectures sûres (confiance 0,7 ou plus, vivant) qui tombent sur un mur du plan et hors du praticable du plan, avec le cadre affine puis avec le maillage."""
    import sqlite3

    plan = cv2.imread(str(PLANS / f"{map_name}.png"))
    ph, pw = plan.shape[:2]
    wall, walk = plan_walkable(plan)
    entry, _ = build(map_name)
    inset = json.loads(INSETS.read_text(encoding="utf-8"))[map_name]
    con = sqlite3.connect(str(db_path))
    rows = np.array(con.execute("select x, y from samples where game_id=? and alive=1 and confidence>=0.7 and x is not null", (game,)).fetchall())
    res = {"lectures": int(len(rows))}
    for name, fn in [
        ("affine", lambda x, y: (inset["l"] + x * (1 - inset["l"] - inset["r"]), inset["t"] + y * (1 - inset["t"] - inset["b"]))),
        ("maillage", lambda x, y: to_plan(entry, x, y)),
    ]:
        px = np.array([fn(x, y) for x, y in rows])
        ix = np.clip((px[:, 0] * pw).astype(int), 0, pw - 1)
        iy = np.clip((px[:, 1] * ph).astype(int), 0, ph - 1)
        res[name] = {"sur_un_mur": float(wall[iy, ix].mean()), "hors_du_praticable_du_plan": float((~walk[iy, ix]).mean())}
    return res


def main(argv=None):
    parser = argparse.ArgumentParser(description="Maillage minimap -> plan d'une carte (alignement par sections).")
    parser.add_argument("--map", default="Artefact")
    parser.add_argument("--write", action="store_true", help="écrit analysis/map_warp.json")
    parser.add_argument("--eval", action="store_true", help="mesure sur les lectures sûres de la base (EVA_DB ou data/eva.db)")
    parser.add_argument("--game", type=int, default=36)
    args = parser.parse_args(argv)
    entry, report = build(args.map)
    print(f"{args.map} : {len(entry['points'])} repères, {len(entry['triangles'])} triangles")
    for c in report["checks"]:
        print(f"  contrôle {c['nom']:<34} maillage {c['ecart_maillage_px']:5.1f} px   affine global {c['ecart_affine_global_px']:6.1f} px   cadre actuel {c.get('ecart_cadre_actuel_px', float('nan')):6.1f} px   ({c['origine']})")
    gaps = [c["ecart_maillage_px"] for c in report["checks"]]
    print(f"  contrôles : écart médian du maillage {np.median(gaps):.1f} px, maximum {max(gaps):.1f} px (plan {entry['plan_size'][0]} x {entry['plan_size'][1]})")
    loo = [v for k, v in report["leave_one_out"].items() if not k.startswith("st2.")]
    print(f"  validation croisée sur {len(loo)} stations (les 2 stations latérales sont seules à leur extrémité : extrapolation, écart {', '.join(f'{v:.0f}' for k, v in report['leave_one_out'].items() if k.startswith('st2.'))} px) : écart médian {np.median(loo):.1f} px, maximum {max(loo):.1f} px")
    if args.write:
        write_entry(args.map, entry)
        print(f"écrit {OUT}")
    if args.eval:
        import paths

        print(json.dumps(evaluate(args.map, paths.db_path(), args.game), indent=1))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
