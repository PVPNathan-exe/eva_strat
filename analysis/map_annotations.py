"""Cartographie à la main d'une carte (onglet Lecture, « Cartographie ») : couleurs de la minimap rangées en classes, tyroliennes en paires de cercles, portes et fenêtres, carrés de capture, zones de départ, alignement sur le plan.

  python analysis/map_annotations.py --map Atlantis          applique l'annotation enregistrée de la carte aux fichiers du programme
  python analysis/map_annotations.py --all                   toutes les cartes annotées

L'utilisateur choisit des couleurs à la pipette (au pixel près) sur la médiane de la minimap (`map_masks/<Carte>_mediane.png`) et dit ce qu'elles représentent :
  sol         praticable ;
  mur         ni praticable, ni traversable par la vue ou le tir ;
  tir         on tire au-dessus mais on ne passe pas (couverture basse) ;
  vue         on voit à travers mais on ne tire pas et on ne passe pas (vitre) ;
  porte       porte hachurée : on la traverse (praticable) ;
  porte_vitre porte avec une vitre : on la traverse et on voit à travers.
Les portes, les fenêtres, les murs et les tirs par-dessus se tracent aussi en traits (extrémité à extrémité) : une porte (vitrée ou non) est rendue praticable, une fenêtre est « vue seulement » (ni passage ni
tir), un trait de mur est infranchissable (mur dans un carré de capture), un trait « tir » aussi mais on tire par-dessus. Une même couleur peut avoir deux sens (une fenêtre ici, une couverture
basse ailleurs) : une zone de classe remplace une classe par une autre à l'intérieur d'un polygone (appliquée avant les tracés) ; l'une comme l'autre peut être à sens unique (on ne voit à travers que d'un côté, noté `side`). Les zones des points de capture (forme libre : le carré n'est pas toujours fermé, comme sur Polaris) sont jouables : sol sous les pixels sans classe, les murs classés ou tracés dedans restent des murs. Les zones de départ et les disques des stations de tyrolienne sont jouables de la même façon.
Chaque pixel prend la classe de la couleur choisie la plus proche, à moins de la tolérance de cette couleur.
Les tyroliennes sont des paires de cercles : une station chacun (centre, rayon, direction par laquelle on y entre ou on en sort, les deux directions d'une paire étant à 180 degrés l'une de l'autre : l'écart est réparti entre les deux), valables dans les deux sens. Le trait qui relie
les deux centres sur la minimap a souvent la couleur des murs : sous ce trait, les pixels non praticables entourés de sol sont rendus praticables (le trait ne coupe pas le sol),
sans toucher aux vrais murs épais. Les zones de départ sont des rectangles (deux au plus par équipe), l'alignement sur le plan stratégique des paires de points (minimap, plan).
Un trait ou une zone de classe « passage possible en dessous » (`under`) garde praticable le sol qu'il recouvre (un bord d'étage où l'on tire par-dessus se longe par le niveau du dessous) tout en gardant sa classe dans <Carte>_classes.png.
Avec `usePlan`, le masque est ensuite recoupé avec le plan stratégique (plan_mask.py) puis avec les positions lues avec certitude (elles font foi : reads_step) ; aperçu : <Carte>_plan_ajouts.png et <Carte>_plan_retraits.png.
Sorties : <Carte>.png (praticable : sol, portes, tracé des tyroliennes entouré de sol), <Carte>_lignes.png (murs), <Carte>_classes.png (toutes les classes), map_teleports.json
(centres des paires), map_stations.json (rayon et direction), map_doors.json (portes et fenêtres), map_capture.json, map_spawns.json et map_plan_insets.json. Une annotation l'emporte sur ce que les détections
automatiques avaient trouvé."""

import argparse
import json
import math
import sqlite3
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
MASK_DIR = HERE / "map_masks"
TELEPORTS = HERE / "map_teleports.json"
SPAWNS = HERE / "map_spawns.json"
INSETS = HERE / "map_plan_insets.json"
DOORS = HERE / "map_doors.json"  # portes et fenêtres tracées : extrémités, genre, vitre, sens unique (côté qui voit)
CAPTURE = HERE / "map_capture.json"  # zones des points de capture : polygones (zones jouables)
STATIONS = HERE / "map_stations.json"  # rayon et direction d'entrée et de sortie de chaque station (map_teleports.json ne garde que les centres)
SIZE = 400  # côté du masque enregistré (comme map_mask.py)
CLASSES = ("sol", "mur", "tir", "vue", "porte", "porte_vitre")
LEGACY_CLASSES = ("tp",)  # ancienne classe « chemin de tyrolienne » : ignorée à la lecture (remplacée par les cercles de stations)
PASSABLE = ("sol", "porte", "porte_vitre")  # classes où l'on marche
DEFAULT_STATION_RADIUS = 0.02
MAX_STATION_RADIUS = 0.2
MAX_REFUSED = 0.01  # un masque qui refuserait plus de cette part des lectures sûres de la carte n'est pas écrit (un masque juste en refuse 0,05 % ou moins)
TP_BAND_PX = 5  # largeur de la bande sous une flèche de tyrolienne où un trait fin est rendu au sol
DOOR_WIDTH_PX = 3  # épaisseur d'un trait de porte sur la médiane
CODES = {name: i + 1 for i, name in enumerate(CLASSES)}  # 0 : aucune classe
MAX_SPAWNS = 2
MAX_CAPTURE_ZONES = 8
MAX_OVERRIDES = 40
MAX_POLYGON_POINTS = 80  # zones de départ par équipe
TP_FLOOR_SHARE = 0.5  # un pixel sous le tracé d'une tyrolienne est du sol si au moins cette part de ses voisins l'est
TP_NEIGHBOURHOOD = 7


def classify(median_bgr, colors):
    """Image de classes (uint8, 0 = aucune) d'après les couleurs choisies : colors = [{"rgb": [r, g, b], "tol": n, "cls": nom}]. Chaque pixel prend la classe de la couleur
    la plus proche (distance euclidienne dans RGB) si elle est à moins de sa tolérance."""
    rgb = median_bgr[:, :, ::-1].astype(np.int32)
    best = np.full(rgb.shape[:2], 1 << 30, np.int64)
    out = np.zeros(rgb.shape[:2], np.uint8)
    for c in colors:
        if c.get("cls") not in CODES:
            continue
        d = ((rgb - np.array(c["rgb"], np.int32)) ** 2).sum(axis=2).astype(np.int64)
        hit = (d <= int(c.get("tol", 10)) ** 2) & (d < best)
        out[hit] = CODES[c["cls"]]
        best[hit] = d[hit]
    return out


def walkable_from_classes(labels):
    """Masque praticable (bool, taille de l'image de classes) : le sol et les portes."""
    return np.isin(labels, [CODES[c] for c in PASSABLE])


def open_tp_paths(walk, tps):
    """Sous chaque flèche de tyrolienne, les pixels non praticables dont le voisinage est au moins à moitié du sol (un trait fin, de la couleur des murs, posé sur le sol) deviennent
    praticables ; un vrai mur épais sous la flèche reste un mur."""
    if not tps:
        return
    h, w = walk.shape
    share = cv2.boxFilter(walk.astype(np.float32), -1, (TP_NEIGHBOURHOOD, TP_NEIGHBOURHOOD))
    band = np.zeros((h, w), np.uint8)
    for t in tps:
        a = (round(t["from"][0] * (w - 1)), round(t["from"][1] * (h - 1)))
        b = (round(t["to"][0] * (w - 1)), round(t["to"][1] * (h - 1)))
        cv2.line(band, a, b, 255, TP_BAND_PX)
    walk |= (band > 0) & (share >= TP_FLOOR_SHARE)


def _line_layer(shape, segments):
    """Image bool où les traits (extrémités en fractions) sont dessinés."""
    h, w = shape
    layer = np.zeros((h, w), np.uint8)
    for d in segments:
        a = (round(d["from"][0] * (w - 1)), round(d["from"][1] * (h - 1)))
        b = (round(d["to"][0] * (w - 1)), round(d["to"][1] * (h - 1)))
        cv2.line(layer, a, b, 255, DOOR_WIDTH_PX)
    return layer > 0


def burn_shapes(labels, doors, capture, spawns=None, stations=None):
    """Grave dans l'image de classes ce qui est tracé à la main : carrés de capture (sol sous les seuls pixels sans classe : un mur, un tir par-dessus ou une vue seulement
    déjà classés dans le carré restent ce qu'ils sont), puis portes (porte, ou porte vitrée), fenêtres (vue seulement) et traits de mur."""
    h, w = labels.shape
    # les zones de départ sont jouables aussi (teintées par l'équipe, leur couleur n'est pas celle du sol) : rectangles remplis comme les zones de capture
    capture = list(capture) + [[[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]] for rects in (spawns or {}).values() for r in rects]
    for polygon in capture:
        shape = np.zeros((h, w), np.uint8)
        cv2.fillPoly(shape, [np.array([[round(x * (w - 1)), round(y * (h - 1))] for x, y in polygon], np.int32)], 255)
        labels[(shape > 0) & (labels == 0)] = CODES["sol"]
    for s in stations or []:  # le disque d'une station de tyrolienne : on s'y tient avant de partir et on y arrive
        shape = np.zeros((h, w), np.uint8)
        cv2.circle(shape, (round(s["x"] * (w - 1)), round(s["y"] * (h - 1))), max(1, round(s["r"] * w)), 255, -1)
        labels[(shape > 0) & (labels == 0)] = CODES["sol"]
    for kind, glass, code in (("porte", False, CODES["porte"]), ("porte", True, CODES["porte_vitre"]), ("fenetre", False, CODES["vue"]), ("mur", False, CODES["mur"]), ("tir", False, CODES["tir"])):
        labels[_line_layer(labels.shape, [d for d in doors if d["kind"] == kind and d["glass"] == glass])] = code


def opposite_angles(a, b):
    """Règle des 180 degrés : les directions des deux stations d'une tyrolienne sont opposées. Une seule donnée : l'autre s'en déduit ; deux données (cliquées à la main, rarement
    à 180 degrés exactement) : moyenne circulaire de la première et de l'opposée de la seconde, les deux stations prennent cette direction et son opposée."""
    if a is None and b is None:
        return None, None
    if a is None:
        return (b + 180) % 360, b
    if b is None:
        return a, (a + 180) % 360
    x = math.cos(math.radians(a)) + math.cos(math.radians(b + 180))
    y = math.sin(math.radians(a)) + math.sin(math.radians(b + 180))
    mean = a if abs(x) + abs(y) < 1e-9 else math.degrees(math.atan2(y, x)) % 360
    return mean, (mean + 180) % 360


def _station(s):
    """Station de tyrolienne propre : centre dans la minimap, rayon (fraction de la largeur), direction d'entrée et de sortie en degrés (0 = droite, 90 = bas) ou None."""
    ok = isinstance(s, dict) and all(isinstance(s.get(k), (int, float)) for k in ("x", "y", "r")) and 0 <= s["x"] <= 1 and 0 <= s["y"] <= 1 and 0 < s["r"] <= MAX_STATION_RADIUS
    angle = s.get("angle") if isinstance(s, dict) else None
    if not ok or not (angle is None or isinstance(angle, (int, float))):
        raise ValueError(f"station invalide : {s}")
    return {"x": s["x"], "y": s["y"], "r": s["r"], "angle": None if angle is None else float(angle) % 360}


def _pair(t, unit):
    """Paire de stations {a, b}, ou ancienne flèche {from, to} (stations sans direction, rayon par défaut)."""
    if isinstance(t, dict) and "a" in t:
        a, b = _station(t["a"]), _station(t["b"])
    elif isinstance(t, dict) and unit(t.get("from")) and unit(t.get("to")):
        a, b = (_station({"x": p[0], "y": p[1], "r": DEFAULT_STATION_RADIUS}) for p in (t["from"], t["to"]))
    else:
        raise ValueError(f"tyrolienne invalide : {t}")
    a["angle"], b["angle"] = opposite_angles(a["angle"], b["angle"])
    return {"a": a, "b": b, "from": [a["x"], a["y"]], "to": [b["x"], b["y"]]}


def _polygon(z, unit):
    """Zone de capture : liste d'au moins 3 points (forme libre, pas forcément un carré fermé), ou ancien rectangle [x0, y0, x1, y1] lu comme ses 4 coins."""
    if isinstance(z, list) and len(z) == 4 and all(isinstance(v, (int, float)) for v in z):
        if not (all(0 <= v <= 1 for v in z) and z[0] < z[2] and z[1] < z[3]):
            raise ValueError(f"zone de capture invalide : {z}")
        return [[z[0], z[1]], [z[2], z[1]], [z[2], z[3]], [z[0], z[3]]]
    if not (isinstance(z, list) and 3 <= len(z) <= MAX_POLYGON_POINTS and all(unit(p) for p in z)):
        raise ValueError(f"zone de capture invalide : {z}")
    return [[p[0], p[1]] for p in z]


def _override(o, unit):
    """Zone de remplacement de classe : polygone, classe remplacée (ou « any » : tout pixel de la zone) et classe d'arrivée."""
    if not (isinstance(o, dict) and o.get("to") in CODES and (o.get("from") == "any" or o.get("from") in CODES)):
        raise ValueError(f"zone de classe invalide : {o}")
    return {"polygon": _polygon(o.get("polygon"), unit), "from": o["from"], "to": o["to"], "under": o.get("under") is True}


def _polygon_mask(polygon, h, w):
    """Image bool du polygone (sommets en fractions) à l'échelle w x h : le centre du pixel décide."""
    shape = np.zeros((h, w), np.uint8)
    cv2.fillPoly(shape, [np.array([[round(x * w - 0.5), round(y * h - 0.5)] for x, y in polygon], np.int32)], 255)
    return shape > 0


def blocking_lines(doors):
    """Traits tracés qui bloquent le passage : fenêtres, murs et tirs par-dessus, sauf ceux qu'on peut passer par en dessous (l'autre niveau d'Atlantis ou de The Cliff)."""
    return [d for d in doors if d["kind"] != "porte" and not d.get("under")]


def under_layer(shape, doors, overrides, floor):
    """Sol que les traits et zones « passage possible en dessous » ne bloquent pas : un bord d'étage où l'on tire par-dessus se longe en dessous. Ne rend praticable que ce qui l'était
    avant ces traits et ces zones (`floor`) : le mur qui n'était pas du sol le reste."""
    h, w = shape
    keep = _line_layer(shape, [d for d in doors if d["kind"] != "porte" and d.get("under")])
    for o in overrides:
        if o.get("under"):
            keep |= _polygon_mask(o["polygon"], h, w)
    return keep & floor


def apply_overrides(labels, overrides):
    """Remplace dans chaque zone la classe `from` (ou toute classe, y compris aucune, pour « any ») par `to`. Même règle que applyOverrides du site : le centre du pixel décide."""
    h, w = labels.shape
    for o in overrides:
        inside = _polygon_mask(o["polygon"], h, w)  # sans le décalage de burn_shapes (sommets à (w - 1))
        labels[inside & (True if o["from"] == "any" else labels == CODES[o["from"]])] = CODES[o["to"]]


def validate(data):
    """Annotation propre (couleurs valides, au plus MAX_SPAWNS zones par équipe, coordonnées dans la minimap) ; ValueError sinon."""
    if not isinstance(data, dict):
        raise ValueError("annotation illisible")
    colors = []
    for c in data.get("colors", []):
        rgb = c.get("rgb")
        if c.get("cls") in LEGACY_CLASSES:
            continue
        if c.get("cls") not in CODES or not (isinstance(rgb, list) and len(rgb) == 3 and all(isinstance(v, int) and 0 <= v <= 255 for v in rgb)):
            raise ValueError(f"couleur invalide : {c}")
        colors.append({"rgb": rgb, "tol": max(0, min(int(c.get("tol", 10)), 120)), "cls": c["cls"]})
    unit = lambda p: isinstance(p, list) and len(p) == 2 and all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in p)
    tps = [_pair(t, unit) for t in data.get("tps", [])]
    doors = []
    for d in data.get("doors", []):
        if not (unit(d.get("from")) and unit(d.get("to"))):
            raise ValueError(f"porte invalide : {d}")
        kind = d.get("kind") if d.get("kind") in ("fenetre", "mur", "tir") else "porte"
        doors.append({"from": d["from"], "to": d["to"], "kind": kind, "glass": kind == "porte" and bool(d.get("glass")), "side": d["side"] if (kind == "fenetre" or (kind == "porte" and d.get("glass"))) and d.get("side") in (-1, 1) else 0, "under": kind != "porte" and d.get("under") is True})
    spawns = {}
    for team in ("A", "B"):
        rects = data.get("spawns", {}).get(team, [])
        if len(rects) > MAX_SPAWNS:
            raise ValueError(f"au plus {MAX_SPAWNS} zones de départ par équipe")
        for r in rects:
            if not (isinstance(r, list) and len(r) == 4 and all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in r) and r[0] < r[2] and r[1] < r[3]):
                raise ValueError(f"zone de départ invalide : {r}")
        spawns[team] = rects
    inset = data.get("inset")
    if inset is not None and not (isinstance(inset, dict) and all(isinstance(inset.get(k), (int, float)) for k in ("l", "t", "r", "b"))):
        raise ValueError("alignement invalide")
    overrides = [_override(o, unit) for o in data.get("overrides", [])]
    if len(overrides) > MAX_OVERRIDES:
        raise ValueError(f"au plus {MAX_OVERRIDES} zones de classe")
    capture = [_polygon(z, unit) for z in data.get("capture", [])]
    if len(capture) > MAX_CAPTURE_ZONES:
        raise ValueError(f"au plus {MAX_CAPTURE_ZONES} zones de capture")
    return {"colors": colors, "tps": tps, "doors": doors, "capture": capture, "overrides": overrides, "spawns": spawns, "inset": inset, "pairs": data.get("pairs", []), "use_plan": data.get("usePlan") is True}


def annotation_of(conn, map_name):
    row = conn.execute("SELECT data FROM map_annotations WHERE map = ?", (map_name,)).fetchone()
    return json.loads(row["data"]) if row else None


def _merge_json(path, map_name, value):
    known = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    if value is None:
        known.pop(map_name, None)
    else:
        known[map_name] = value
    path.write_text(json.dumps(known, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def refused_share(conn, map_name, mask):
    """Part des lectures sûres des games de la carte que ce masque ferait refuser au suivi (même mesure que map_mask.py) ; None sans lecture."""
    import map_mask

    try:
        points = map_mask.read_points(conn, map_name)
    except sqlite3.OperationalError:
        return None
    return map_mask.share_outside(mask, points) if points else None


def plan_step(conn, map_name, data, labels, walk, under=None):
    """Recoupe le masque praticable avec le plan stratégique de la carte (plan_mask.py) : ajoute le sol manquant, retire les murs du plan, sauf sous les portes tracées. Renvoie (masque
    praticable corrigé, résumé). `under` : sol que les traits et zones « passage possible en dessous » gardent praticable. Les classes du masque (labels) reçoivent le sol ajouté. Refusé si la correction ferait refuser plus de lectures sûres qu'avant."""
    import plan_mask

    path = plan_mask.plan_file(map_name)
    inset = plan_mask.inset_of(map_name, data["inset"])
    if path is None or not inset:
        return walk, {"plan": "non appliqué : pas de plan de cette carte ou pas de cadre d'alignement (outil Alignement)"}
    fill, walls, exterior = plan_mask.corrections(labels, CODES["sol"], cv2.imread(str(path)), inset)
    protect = _line_layer(walk.shape, [d for d in data["doors"] if d["kind"] == "porte"])
    fixed = plan_mask.apply_to_walk(walk, fill, walls, protect, exterior)
    fixed &= ~_line_layer(walk.shape, blocking_lines(data["doors"]))
    if under is not None:
        fixed |= under  # le passage possible en dessous reste praticable, plan ou pas
    added, removed = fixed & ~walk, walk & ~fixed
    before = refused_share(conn, map_name, cv2.resize(walk.astype(np.uint8) * 255, (SIZE, SIZE), interpolation=cv2.INTER_NEAREST))
    after = refused_share(conn, map_name, cv2.resize(fixed.astype(np.uint8) * 255, (SIZE, SIZE), interpolation=cv2.INTER_NEAREST))
    info = {"plan_ajout_pixels": int(added.sum()), "plan_retrait_pixels": int(removed.sum()), "plan_hors_carte_pixels": int((walk & exterior).sum())}
    base = max(1, int(walk.sum()))
    if added.sum() > plan_mask.MAX_ADD_SHARE * base or removed.sum() > plan_mask.MAX_CUT_SHARE * base:
        return walk, {"plan": f"refusé : il ajouterait {added.sum() / base:.0%} et retirerait {removed.sum() / base:.0%} du sol saisi (maximum {plan_mask.MAX_ADD_SHARE:.0%} et {plan_mask.MAX_CUT_SHARE:.0%}) : le sol de ce plan n'est pas celui de la minimap"}
    if before is not None and after is not None:
        info["plan_lectures_sures_refusees"] = f"{before:.4f} puis {after:.4f}"
        if after > before + plan_mask.MAX_REFUSAL_RISE:
            return walk, {"plan": f"refusé : il ferait refuser {after:.2%} des lectures sûres au lieu de {before:.2%}"}
    else:
        info["plan_non_verifie"] = "aucune lecture sûre sur cette carte : la correction n'est pas contrôlée par les lectures"
    cv2.imwrite(str(MASK_DIR / f"{map_name}_plan_ajouts.png"), added.astype(np.uint8) * 255)
    cv2.imwrite(str(MASK_DIR / f"{map_name}_plan_retraits.png"), removed.astype(np.uint8) * 255)
    labels[added] = CODES["sol"]
    return fixed, info


READS_DISK_PX = 2  # rayon (pixels de la médiane) du sol ajouté autour d'une lecture sûre
READS_SUPPORT = 0.02  # une lecture sûre n'ajoute du sol que si une autre lecture sûre est à moins de cette distance (fraction de la largeur) : une lecture isolée est du bruit
READS_MAX_ADD_SHARE = 0.15  # les lectures n'ajoutent pas plus que cette part du sol


def reads_step(conn, map_name, walk, doors):
    """Les positions lues avec certitude font foi : là où un joueur a été lu de façon sûre (et soutenue par une autre lecture voisine), le sol est praticable, quoi qu'en dise une
    couleur de classe (Atlantis : le joueur 2 de la game 31 est lu sûrement à 4,9 s sur un contour classé en mur). Sauf sous les fenêtres, murs et tirs par-dessus tracés à la main.
    Renvoie (masque praticable, résumé) ; aucune lecture ou aucune table de lectures : rien ne change."""
    import map_mask

    try:
        points = map_mask.read_points(conn, map_name)
    except sqlite3.OperationalError:
        return walk, {}
    if not points:
        return walk, {}
    h, w = walk.shape
    cells = {}
    for x, y in points:
        cells.setdefault((int(x / READS_SUPPORT), int(y / READS_SUPPORT)), []).append((x, y))
    layer = np.zeros((h, w), np.uint8)
    for (i, j), here in cells.items():
        around = [q for di in (-1, 0, 1) for dj in (-1, 0, 1) for q in cells.get((i + di, j + dj), ())]
        for x, y in here:
            if sum(1 for q in around if abs(q[0] - x) <= READS_SUPPORT and abs(q[1] - y) <= READS_SUPPORT) >= 2:  # elle-même et une autre
                cv2.circle(layer, (round(x * (w - 1)), round(y * (h - 1))), READS_DISK_PX, 255, -1)
    added = (layer > 0) & ~walk & ~_line_layer(walk.shape, blocking_lines(doors))
    if added.sum() > READS_MAX_ADD_SHARE * max(1, int(walk.sum())):
        return walk, {"lectures": f"non appliquées : elles ajouteraient {added.sum() / max(1, int(walk.sum())):.0%} du sol (maximum {READS_MAX_ADD_SHARE:.0%})"}
    return walk | added, {"lectures_ajout_pixels": int(added.sum())}


def apply(conn, map_name):
    """Écrit les fichiers du programme d'après l'annotation de la carte. Renvoie un résumé (dict), ou None s'il n'y a pas d'annotation ou de médiane."""
    raw = annotation_of(conn, map_name)
    median = cv2.imread(str(MASK_DIR / f"{map_name}_mediane.png"))
    if raw is None or median is None:
        return None
    data = validate(raw)
    summary = {"map": map_name}
    if data["colors"] or data["capture"] or data["doors"] or data["overrides"]:
        labels = classify(median, data["colors"])
        floor_before = walkable_from_classes(labels)  # le sol avant zones de classe et tracés : base du « passage possible en dessous »
        apply_overrides(labels, data["overrides"])
        burn_shapes(labels, data["doors"], data["capture"], data["spawns"], [s for t in data["tps"] for s in (t["a"], t["b"])])
        walk = walkable_from_classes(labels)
        open_tp_paths(walk, data["tps"])
        walk &= ~_line_layer(walk.shape, blocking_lines(data["doors"]))  # fenêtres, murs et tirs ne se traversent pas, même sous une flèche de tyrolienne
        under = under_layer(walk.shape, data["doors"], data["overrides"], floor_before)
        walk |= under
        if data["use_plan"]:
            before_plan = walk
            walk, plan_info = plan_step(conn, map_name, data, labels, walk, under)
            summary.update(plan_info)
            walk, reads_info = reads_step(conn, map_name, walk, data["doors"])
            summary.update(reads_info)
            if walk is not before_plan:  # aperçu : tout ce qui a changé, plan et lectures ensemble
                labels[walk & ~before_plan] = CODES["sol"]
                cv2.imwrite(str(MASK_DIR / f"{map_name}_plan_ajouts.png"), (walk & ~before_plan).astype(np.uint8) * 255)
                cv2.imwrite(str(MASK_DIR / f"{map_name}_plan_retraits.png"), (before_plan & ~walk).astype(np.uint8) * 255)
        mask = cv2.resize(walk.astype(np.uint8) * 255, (SIZE, SIZE), interpolation=cv2.INTER_NEAREST)
        summary["praticable"] = round(float(walk.mean()), 3)
        refused = refused_share(conn, map_name, mask)
        if refused is not None:
            summary["lectures_sures_refusees"] = round(refused, 4)
        if not walk.any() or (refused is not None and refused > MAX_REFUSED):
            summary["masque_non_ecrit"] = f"{refused:.1%} des lectures sûres de la carte seraient refusées (maximum {MAX_REFUSED:.0%}) : ajoute les couleurs de sol manquantes ou augmente leur tolérance" if walk.any() else "aucun pixel de sol"
        else:
            cv2.imwrite(str(MASK_DIR / f"{map_name}.png"), mask)
            walls = (labels == CODES["mur"]).astype(np.uint8)
            if walls.any():
                cv2.imwrite(str(MASK_DIR / f"{map_name}_lignes.png"), cv2.dilate(walls, np.ones((3, 3), np.uint8)) * 255)
            cv2.imwrite(str(MASK_DIR / f"{map_name}_classes.png"), labels)
            summary["zones_de_classe"] = len(data["overrides"])
        summary["classes"] = {name: int((labels == code).sum()) for name, code in CODES.items()}
    if data["doors"]:
        _merge_json(DOORS, map_name, data["doors"])
        summary["portes"] = sum(d["kind"] == "porte" for d in data["doors"])
        summary["fenetres"] = sum(d["kind"] == "fenetre" for d in data["doors"])
        summary["murs_traces"] = sum(d["kind"] == "mur" for d in data["doors"])
        summary["tirs_traces"] = sum(d["kind"] == "tir" for d in data["doors"])
    if data["capture"]:
        _merge_json(CAPTURE, map_name, data["capture"])
        summary["zones_de_capture"] = len(data["capture"])
    if data["tps"]:
        _merge_json(TELEPORTS, map_name, [[[round(t["from"][0], 4), round(t["from"][1], 4)], [round(t["to"][0], 4), round(t["to"][1], 4)]] for t in data["tps"]])
        _merge_json(STATIONS, map_name, [{"a": t["a"], "b": t["b"]} for t in data["tps"]])
        summary["tyroliennes"] = len(data["tps"])
    if any(data["spawns"].values()):
        known = json.loads(SPAWNS.read_text(encoding="utf-8")).get(map_name, {}) if SPAWNS.exists() else {}
        known.update({team: (rects[0] if len(rects) == 1 else rects) for team, rects in data["spawns"].items() if rects})  # une équipe sans zone saisie garde sa zone détectée
        _merge_json(SPAWNS, map_name, known)
        summary["departs"] = {team: len(rects) for team, rects in data["spawns"].items()}
    if data["inset"]:
        _merge_json(INSETS, map_name, {**{k: round(float(data["inset"][k]), 4) for k in ("l", "t", "r", "b")}, "correlation": None})
        summary["alignement"] = True
    return summary


def main(argv=None):
    import db

    parser = argparse.ArgumentParser(description="Applique la cartographie à la main d'une carte aux fichiers du programme.")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--map")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    maps = [r["map"] for r in conn.execute("SELECT map FROM map_annotations ORDER BY map")] if args.all else [args.map]
    for m in maps:
        result = apply(conn, m)
        print(json.dumps(result if result is not None else {"map": m, "erreur": "pas d'annotation ou pas de médiane"}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
