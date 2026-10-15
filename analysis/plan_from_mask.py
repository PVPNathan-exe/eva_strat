"""Dessine le plan stratégique d'une carte, net et lisse comme ceux des autres cartes (Polaris, Atlantis) : murs blancs en polygones simples, portes hachurées, tyroliennes vertes.

  python analysis/plan_from_mask.py --map "Reef Point" --reference chemin/image.png [--check]   part d'un plan de référence (image gardée HORS du dépôt)
  python analysis/plan_from_mask.py --map "Reef Point" [--check]                                 sans référence : murs tirés du masque de la minimap (analysis/map_masks/<Carte>.png)

Avec une référence, les murs sont ses grands blancs (sans pastilles ni logo) plus la bande de fenêtre du spawn (grise dans la référence, MUR sur le plan : une fenêtre n'a pas de couleur de tir à
travers), puis lissés : contours simplifiés, segments à 0, 45 ou 90 degrés rendus exacts, bords de l'arène aplatis, ergots et petits îlots effacés. Le plan garde le cadre de
map_plan_insets.json (la minimap y est posée comme dans le replay) : ce cadre a été aligné sur le plan de référence, donc le plan doit garder SA géométrie, pas celle de la minimap.
Les zones de départ sont lues dans la référence (rectangles orange et bleu), sinon dans map_spawns.json. Portes, boîte de capture, tyroliennes et caisses viennent de map_doors.json,
map_capture.json, map_stations.json et de la classe « tir par-dessus » isolée du masque. --check écrit la planche de superposition (analysis/map_masks/<Carte>_superposition.jpg)."""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
PLANS = HERE.parent / "src" / "assets" / "maps"
SIZE = (1493, 746)  # largeur, hauteur du plan
SS = 3  # le plan est dessiné trois fois plus grand puis réduit (bords lissés)
SMOOTH = 2.2  # flou (pixels du plan) avant seuillage du masque (sans référence)
BLOCK_EPS, OUTLINE_EPS = 7.0, 10.0  # simplification des contours (pixels du plan) : bloc, contour de l'arène (peu de relief sur les bords)
STRAIGHT_DEG, OUTLINE_DEG = 14, 18  # un segment à moins de 14 degrés (18 pour le contour de l'arène) d'un axe ou d'une diagonale à 45 degrés devient exact
NUB_PX = 12  # une saillie ou un filet de mur plus étroit que cela (pixels du plan) est du bruit, effacé
ISLAND_PX = 1500  # un îlot de mur isolé plus petit que cela (pixels du plan au carré) est effacé (reste de caisse ou de pastille)
FRAME_PX = 12  # cadre blanc posé sur le bord du plan (l'arène est toujours fermée)
EDGE_PX, EDGE_SMOOTH = 100, 30  # bandes gauche et droite du plan (pixels) où les dents du bord de l'arène sont effacées par ouverture et fermeture de cette taille
CODE_WALL, CODE_SHOOT = 2, 3  # codes de <Carte>_classes.png (map_annotations.CODES : mur, tir par-dessus)
CRATE_MIN_PX = 40  # pixels de la minimap d'un obstacle bas isolé
FLOOR_LEFT, FLOOR_RIGHT = (44, 50, 58), (66, 56, 46)  # sol sombre, légère teinte d'équipe (BGR)
TEAM = {"A": (30, 110, 200), "B": (190, 110, 30)}  # orange et bleu (BGR)
CRATE_BGR = (210, 210, 210)
REF_WHITE_V, REF_WHITE_S = 235, 40  # mur blanc d'une référence
REF_MIN_PX = 400  # un blanc plus petit que cela dans la référence (pastille, logo, point) n'est pas un mur
REF_WINDOW_V, REF_WINDOW_S, REF_WINDOW_R = 100, 70, 40  # gris de la bande de fenêtre (le sol est plus sombre et plus coloré), rayon autour du trait de fenêtre (pixels du plan)
REF_LOGO = (312, 686, 385, 719)  # logo de la source dans la référence de Reef Point (x0, y0, x1, y1), posé sur un mur
HATCH_LIGHT, HATCH_DARK, HATCH_PX, DOOR_THICK = (170, 170, 170), (12, 12, 12), 6, 24  # bandes des portes comme sur Atlantis
DOOR_CARVE = 56  # épaisseur (pixels du plan) du passage rendu au sol autour d'une porte (sans référence)
TP_GREEN = (131, 211, 0)  # vert des tyroliennes de Polaris et Atlantis (mesuré : 0, 211, 131 en RGB), en BGR
TP_DISK, TP_RING = 27, 40  # rayons (pixels du plan) du disque et de l'anneau
# Boutons vus sur la médiane de la minimap (ronds hachurés au centre, en haut et en bas) ; couleur d'après l'utilisateur : rouge en haut, vert en bas.
BUTTONS = {"Reef Point": [((0.500, 0.145), (36, 43, 130)), ((0.500, 0.833), (100, 255, 100))]}


def _load(name, map_name):
    data = json.loads((HERE / name).read_text(encoding="utf-8"))
    return data.get(map_name, [] if name != "map_spawns.json" else {})


def to_px(inset, scale):
    """Minimap normalisée (0 à 1) vers pixels du plan (échelle `scale`)."""
    w, h = SIZE
    return lambda x, y: (int(round((inset[0] + x * (1 - inset[0] - inset[2])) * w * scale)), int(round((inset[1] + y * (1 - inset[1] - inset[3])) * h * scale)))


def warp_into_plan(img, inset, interp, scale=1):
    """Une image de la minimap (n'importe quelle taille) posée sur le plan avec le cadre (`scale` : plan dessiné plus grand)."""
    w, h = SIZE[0] * scale, SIZE[1] * scale
    l, t, r, b = inset
    ih, iw = img.shape[:2]
    m = np.array([[w * (1 - l - r) / iw, 0, l * w], [0, h * (1 - t - b) / ih, t * h]], np.float32)
    return cv2.warpAffine(img, m, (w, h), flags=interp, borderValue=0)


def walkable(mask, inset, scale):
    """Sol praticable d'après le masque de la minimap (sans référence) : contours lissés, plus grande zone seulement (les taches isolées sont du bruit)."""
    big = warp_into_plan(cv2.GaussianBlur(mask, (0, 0), 1.0), inset, cv2.INTER_CUBIC, scale)
    walk = (cv2.GaussianBlur(big, (0, 0), SMOOTH * scale) > 127).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(walk)
    keep = np.zeros_like(walk)
    for i in range(1, n):
        if stats[i, 4] > 4000 * scale * scale:
            keep[lab == i] = 1
    return keep


def reference_plan(path, map_name, inset, scale):
    """Murs (booléen à l'échelle `scale`) et zones de départ (rectangles en pixels du plan) d'une référence : grands blancs, plus la bande de fenêtre du spawn."""
    ref = cv2.imread(str(path))
    if ref is None:
        raise SystemExit(f"Image de référence illisible : {path}")
    ref = cv2.resize(ref, SIZE, interpolation=cv2.INTER_AREA)
    hsv = cv2.cvtColor(ref, cv2.COLOR_BGR2HSV)
    white = ((hsv[:, :, 2] >= REF_WHITE_V) & (hsv[:, :, 1] <= REF_WHITE_S)).astype(np.uint8)
    x0, y0, x1, y1 = REF_LOGO
    white[y0:y1, x0:x1] = 1  # le logo (lettres noires) est posé sur un mur blanc
    n, lab, stats, _ = cv2.connectedComponentsWithStats(white)
    for i in range(1, n):
        if stats[i, 4] < REF_MIN_PX:
            white[lab == i] = 0
    # fenêtres du spawn : grises dans la référence, murs sur le plan
    px = to_px(inset, 1)
    for d in _load("map_doors.json", map_name):
        if d["kind"] != "fenetre":
            continue
        zone = np.zeros(white.shape, np.uint8)
        cv2.line(zone, px(*d["from"]), px(*d["to"]), 1, 2 * REF_WINDOW_R)
        grey = (hsv[:, :, 2] >= REF_WINDOW_V) & (hsv[:, :, 1] <= REF_WINDOW_S)
        white[(zone > 0) & grey] = 1
    # zones de départ : rectangles très saturés (orange à gauche, bleu à droite, en bas de la carte)
    sat = (hsv[:, :, 1] > 150) & (hsv[:, :, 2] > 90) & (np.arange(SIZE[1])[:, None] > 450)
    half = SIZE[0] // 4
    spawns = {}
    for side, hue, cols in (("A", (5, 25), slice(0, half)), ("B", (95, 115), slice(SIZE[0] - half, SIZE[0]))):
        m = np.zeros_like(sat)
        m[:, cols] = sat[:, cols] & (hsv[:, cols, 0] >= hue[0]) & (hsv[:, cols, 0] <= hue[1])
        ys, xs = np.nonzero(m)
        if len(xs):
            spawns[side] = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    big = cv2.resize(white.astype(np.float32), (SIZE[0] * scale, SIZE[1] * scale), interpolation=cv2.INTER_CUBIC) > 0.5
    return big, spawns


def straighten(pts, tol=STRAIGHT_DEG, passes=8):
    """Segments proches d'une direction franche (0, 45, 90 ou 135 degrés, à `tol` degrés près) rendus exacts : chaque segment tourne autour de son milieu, un sommet partagé
    prend la moyenne des corrections de ses deux segments, plusieurs passes jusqu'à stabilité."""
    p = pts.astype(np.float64).copy()
    n = len(p)
    for _ in range(passes):
        move, count = np.zeros_like(p), np.zeros(n)
        for i in range(n):
            j = (i + 1) % n
            a, b = p[i], p[j]
            d = b - a
            length = np.hypot(*d)
            if length < 1e-6:
                continue
            angle = np.degrees(np.arctan2(d[1], d[0])) % 180
            target = min((0, 45, 90, 135, 180), key=lambda t: abs(angle - t))
            if abs(angle - target) > tol:
                continue
            u = np.array([np.cos(np.radians(target)), np.sin(np.radians(target))])
            if np.dot(u, d) < 0:
                u = -u
            mid = (a + b) / 2
            move[i] += (mid - u * length / 2) - a
            move[j] += (mid + u * length / 2) - b
            count[i] += 1
            count[j] += 1
        p += move / np.maximum(count, 1)[:, None]
    for i in range(n):  # passe finale : les côtés devenus presque horizontaux ou verticaux le deviennent exactement
        a, b = p[i], p[(i + 1) % n]
        d = np.abs(b - a)
        if d[1] < 0.5 and d[0] > 1:
            a[1] = b[1] = (a[1] + b[1]) / 2
        elif d[0] < 0.5 and d[1] > 1:
            a[0] = b[0] = (a[0] + b[0]) / 2
    return p


def straight_floor(walk, scale):
    """Masque du sol redessiné en polygones à bords droits : l'arène est un contour, chaque mur ou bloc un trou (la parité de profondeur donne sol ou mur)."""
    contours, hier = cv2.findContours(walk, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    out = np.zeros_like(walk)
    if hier is None:
        return out
    hier = hier[0]
    for i, c in enumerate(contours):
        depth, j = 0, hier[i][3]
        while j != -1:
            depth, j = depth + 1, hier[j][3]
        is_arena = depth == 0 and cv2.contourArea(c) > walk.size * 0.25  # contour de l'arène : un peu plus de lissage
        if depth % 2 == 1 and cv2.contourArea(c) < ISLAND_PX * scale * scale:
            continue  # îlot de mur minuscule : laissé au sol
        eps = (OUTLINE_EPS if is_arena else BLOCK_EPS) * scale
        poly = cv2.approxPolyDP(c, eps, True)[:, 0, :]
        if len(poly) < 3:
            continue
        poly = cv2.approxPolyDP(np.round(straighten(poly, OUTLINE_DEG if is_arena else STRAIGHT_DEG)).astype(np.int32)[:, None, :], 2.0 * scale, True)[:, 0, :]
        cv2.fillPoly(out, [poly.astype(np.int32)], 1 if depth % 2 == 0 else 0)
    return out


def free_crates(map_name, inset, scale):
    """Obstacles bas isolés (zone « tir par-dessus » sans trait de mur autour : caisses, barre de la boîte A) : rectangles tournés sur le plan, et leur masque."""
    big = (SIZE[1] * scale, SIZE[0] * scale)
    cl = cv2.imread(str(HERE / "map_masks" / f"{map_name}_classes.png"), 0)
    if cl is None:
        return [], np.zeros(big, np.uint8)
    wall = cv2.dilate((cl == CODE_WALL).astype(np.uint8), np.ones((3, 3), np.uint8), iterations=2)
    n, lab, stats, _ = cv2.connectedComponentsWithStats((cl == CODE_SHOOT).astype(np.uint8))
    h, w = cl.shape
    l, t, r, b = inset
    rects, cover = [], np.zeros(big, np.uint8)
    for i in range(1, n):
        comp = lab == i
        if stats[i, 4] < CRATE_MIN_PX or (comp & (wall > 0)).any():
            continue
        ys, xs = np.nonzero(comp)
        pts = np.stack([(l + (xs + 0.5) / w * (1 - l - r)) * SIZE[0] * scale, (t + (ys + 0.5) / h * (1 - t - b)) * SIZE[1] * scale], 1).astype(np.float32)
        box = cv2.boxPoints(cv2.minAreaRect(pts))
        rects.append(box)
        cv2.fillPoly(cover, [np.round(box).astype(np.int32)], 1)
    return rects, cover


def door_floor(map_name, px, shape, scale):
    """Passage au sol autour de chaque porte (sans référence : la porte est dans une ouverture du mur, pas dans un bloc)."""
    zone = np.zeros(shape, np.uint8)
    for d in _load("map_doors.json", map_name):
        if d["kind"] != "porte":
            continue
        a, b = np.array(px(*d["from"]), float), np.array(px(*d["to"]), float)
        v = (b - a) / max(np.linalg.norm(b - a), 1e-6)
        n = np.array([-v[1], v[0]]) * DOOR_CARVE * scale / 2
        cv2.fillPoly(zone, [np.round(np.array([a + n, b + n, b - n, a - n])).astype(np.int32)], 1)
    return zone > 0


def hatch(img, polygon, scale):
    """Bande hachurée noir et gris clair (portes, comme sur les autres plans)."""
    zone = np.zeros(img.shape[:2], np.uint8)
    cv2.fillPoly(zone, [np.round(polygon).astype(np.int32)], 1)
    yy, xx = np.indices(img.shape[:2])
    stripes = ((xx + yy) // int(HATCH_PX * scale)) % 2 == 0
    img[(zone > 0) & stripes] = HATCH_LIGHT
    img[(zone > 0) & ~stripes] = HATCH_DARK


def draw_plan(map_name, inset, reference=None):
    w, h = SIZE
    s = SS
    px = to_px(inset, s)
    crates, crate_cover = free_crates(map_name, inset, s)
    if reference is not None:
        walls, ref_spawns = reference_plan(reference, map_name, inset, s)
        walk = (~walls).astype(np.uint8)
        spawns = {side: tuple(v * s for v in box) for side, box in ref_spawns.items()}
    else:
        walk = walkable(cv2.imread(str(HERE / "map_masks" / f"{map_name}.png"), 0), inset, s)
        walk[door_floor(map_name, px, walk.shape, s)] = 1
        spawns = {side: (*px(box[0], box[1]), *px(box[2], box[3])) for side, box in _load("map_spawns.json", map_name).items()}
    walk[cv2.dilate(crate_cover, np.ones((9 * s, 9 * s), np.uint8)) > 0] = 1  # les caisses sont posées sur le sol, pas dans les murs (marge : restes de leur dessin)
    walk = cv2.morphologyEx(walk, cv2.MORPH_CLOSE, np.ones((NUB_PX * s, NUB_PX * s), np.uint8))  # efface les ergots et filets de mur trop étroits
    walk[: FRAME_PX * s], walk[-FRAME_PX * s :], walk[:, : FRAME_PX * s], walk[:, -FRAME_PX * s :] = 0, 0, 0, 0
    k = np.ones((EDGE_SMOOTH * s, EDGE_SMOOTH * s), np.uint8)  # dents du bord gauche et droit de l'arène effacées
    smooth = cv2.morphologyEx(cv2.morphologyEx(walk, cv2.MORPH_OPEN, k), cv2.MORPH_CLOSE, k)
    edge = np.zeros(walk.shape, bool)
    edge[:, : EDGE_PX * s] = edge[:, -EDGE_PX * s :] = True
    walk = np.where(edge, smooth, walk).astype(np.uint8)
    floor = straight_floor(walk, s).astype(bool)
    # sol en dégradé horizontal à teinte d'équipe, tout le reste en blanc (murs, blocs, extérieur de l'arène)
    t = np.linspace(0, 1, w * s)[None, :, None]
    grad = (np.array(FLOOR_LEFT) * (1 - t) + np.array(FLOOR_RIGHT) * t).astype(np.uint8)
    img = np.full((h * s, w * s, 3), 255, np.uint8)
    img[floor] = np.broadcast_to(grad, img.shape)[floor]
    # zones de départ
    for side, (x0, y0, x1, y1) in spawns.items():
        zone = np.zeros(floor.shape, bool)
        zone[y0:y1, x0:x1] = True
        zone &= floor
        img[zone] = (0.2 * img[zone] + 0.8 * np.array(TEAM[side])).astype(np.uint8)
    # caisses : rectangles gris
    for box in crates:
        shade = img.copy()
        cv2.fillPoly(shade, [np.round(box).astype(np.int32)], CRATE_BGR, cv2.LINE_AA)
        img = cv2.addWeighted(shade, 0.55, img, 0.45, 0)
    # boîte de capture : cadre clair et lettre A
    for poly in _load("map_capture.json", map_name):
        pts = np.array([px(*p) for p in poly], np.int32)
        cv2.polylines(img, [pts], True, (170, 170, 170), 3 * s, cv2.LINE_AA)
        cx, cy = int(pts[:, 0].mean()), int(pts[:, 1].max()) - 22 * s
        cv2.putText(img, "A", (cx - 12 * s, cy), cv2.FONT_HERSHEY_DUPLEX, 1.0 * s, (210, 210, 210), 2 * s, cv2.LINE_AA)
    # portes : bandes hachurées (les fenêtres ne sont PAS dessinées : sur le plan une fenêtre est un mur)
    for d in _load("map_doors.json", map_name):
        if d["kind"] != "porte":
            continue
        a, b = np.array(px(*d["from"]), float), np.array(px(*d["to"]), float)
        v = (b - a) / max(np.linalg.norm(b - a), 1e-6)
        n = np.array([-v[1], v[0]]) * DOOR_THICK * s / 2
        hatch(img, np.array([a + n, b + n, b - n, a - n]), s)
    # tyroliennes : disque vert, flèche blanche, anneau extérieur (comme Polaris et Atlantis)
    for st in _load("map_stations.json", map_name):
        c = px(st["a"]["x"], st["a"]["y"])
        cv2.circle(img, c, int(TP_RING * s), TP_GREEN, int(5 * s), cv2.LINE_AA)
        cv2.circle(img, c, int(TP_DISK * s), TP_GREEN, -1, cv2.LINE_AA)
        tri = np.array([[c[0], c[1] - 11 * s], [c[0] - 11 * s, c[1] + 8 * s], [c[0] + 11 * s, c[1] + 8 * s]], np.int32)
        cv2.fillPoly(img, [tri], (255, 255, 255), cv2.LINE_AA)
    # boutons
    for pos, color in BUTTONS.get(map_name, []):
        c = px(*pos)
        cv2.circle(img, c, 20 * s, (50, 50, 50), -1, cv2.LINE_AA)
        cv2.circle(img, c, 15 * s, color, -1, cv2.LINE_AA)
    return cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA), floor


def superposition(img, map_name, inset):
    """Planche de contrôle : plan sous la minimap lue en vidéo (50 %), puis plan sous le contour du masque."""
    med = cv2.imread(str(HERE / "map_masks" / f"{map_name}_mediane.png"))
    m = warp_into_plan(med, inset, cv2.INTER_CUBIC)
    cover = warp_into_plan(np.full(med.shape[:2], 255, np.uint8), inset, cv2.INTER_NEAREST) > 0
    a = img.copy()
    a[cover] = (0.5 * img[cover] + 0.5 * m[cover]).astype(np.uint8)
    b = img.copy()
    walk = warp_into_plan(cv2.imread(str(HERE / "map_masks" / f"{map_name}.png"), 0), inset, cv2.INTER_LINEAR) > 127
    cnt, _ = cv2.findContours(walk.astype(np.uint8), cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(b, cnt, -1, (0, 0, 255), 1)
    return np.vstack([a, b])


def main(argv=None):
    parser = argparse.ArgumentParser(description="Dessine le plan d'une carte, net et lisse, à partir d'une référence ou du masque de la minimap.")
    parser.add_argument("--map", required=True)
    parser.add_argument("--check", action="store_true", help="écrit aussi la planche de superposition")
    parser.add_argument("--reference", help="plan d'une autre source (hors du dépôt) dont on part pour les murs")
    args = parser.parse_args(argv)
    insets = json.loads((HERE / "map_plan_insets.json").read_text(encoding="utf-8"))
    if args.map not in insets:
        print(f"{args.map} : pas de cadre dans map_plan_insets.json.")
        return 1
    i = insets[args.map]
    inset = (i["l"], i["t"], i["r"], i["b"])
    img, _ = draw_plan(args.map, inset, args.reference)
    out = PLANS / f"{args.map.replace(' ', '_')}.png"
    cv2.imwrite(str(out), img)
    print(f"{out.name} écrit ({img.shape[1]} x {img.shape[0]})")
    if args.check:
        check = HERE / "map_masks" / f"{args.map}_superposition.jpg"
        cv2.imwrite(str(check), superposition(img, args.map, inset), [cv2.IMWRITE_JPEG_QUALITY, 88])
        print(f"{check.name} écrit")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
