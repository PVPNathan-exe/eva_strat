"""Cartographie à la main d'une carte (onglet Lecture, « Cartographie ») : couleurs de la minimap rangées en classes, tyroliennes en flèches, zones de départ, alignement sur le plan.

  python analysis/map_annotations.py --map Atlantis          applique l'annotation enregistrée de la carte aux fichiers du programme
  python analysis/map_annotations.py --all                   toutes les cartes annotées

L'utilisateur choisit des couleurs à la pipette (au pixel près) sur la médiane de la minimap (`map_masks/<Carte>_mediane.png`) et dit ce qu'elles représentent :
  sol         praticable ;
  mur         ni praticable, ni traversable par la vue ou le tir ;
  tir         on tire au-dessus mais on ne passe pas (couverture basse) ;
  vue         on voit à travers mais on ne tire pas et on ne passe pas (vitre) ;
  tp          chemin d'une tyrolienne : ignoré (ce n'est pas un mur : il ne coupe pas le sol qu'il traverse) ;
  porte       porte hachurée : on la traverse (praticable) ;
  porte_vitre porte avec une vitre : on la traverse et on voit à travers.
Les portes peuvent aussi être tracées en traits (extrémité à extrémité, avec ou sans vitre) : le trait est rendu praticable.
Chaque pixel prend la classe de la couleur choisie la plus proche, à moins de la tolérance de cette couleur. Les tyroliennes sont des flèches entre deux stations, valables dans les deux sens ; le trait qui les relie sur la minimap a souvent la couleur des murs : sous la flèche, les pixels
non praticables entourés de sol sont rendus praticables (le trait ne coupe pas le sol), sans toucher aux vrais murs épais. Les tyroliennes sont des flèches, les zones de
départ des rectangles (deux au plus par équipe), l'alignement sur le plan stratégique des paires de points (minimap, plan).
Sorties : <Carte>.png (praticable : sol, plus les pixels « tp » entourés de sol), <Carte>_lignes.png (murs), <Carte>_classes.png (toutes les classes), map_teleports.json,
map_spawns.json et map_plan_insets.json. Une annotation l'emporte sur ce que les détections automatiques avaient trouvé."""

import argparse
import json
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
DOORS = HERE / "map_doors.json"
SIZE = 400  # côté du masque enregistré (comme map_mask.py)
CLASSES = ("sol", "mur", "tir", "vue", "tp", "porte", "porte_vitre")
PASSABLE = ("sol", "porte", "porte_vitre")  # classes où l'on marche
MAX_REFUSED = 0.01  # un masque qui refuserait plus de cette part des lectures sûres de la carte n'est pas écrit (un masque juste en refuse 0,05 % ou moins)
TP_BAND_PX = 5  # largeur de la bande sous une flèche de tyrolienne où un trait fin est rendu au sol
DOOR_WIDTH_PX = 3  # épaisseur d'un trait de porte sur la médiane
CODES = {name: i + 1 for i, name in enumerate(CLASSES)}  # 0 : aucune classe
MAX_SPAWNS = 2  # zones de départ par équipe
TP_FLOOR_SHARE = 0.5  # un pixel « tp » est du sol si au moins cette part de ses voisins l'est
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
    """Masque praticable (bool, taille de l'image de classes) : le sol, plus les pixels du chemin d'une tyrolienne qui sont entourés de sol (le trait traverse le sol sans le couper)."""
    floor = np.isin(labels, [CODES[c] for c in PASSABLE]).astype(np.uint8)
    tp = (labels == CODES["tp"]).astype(np.uint8)
    share = cv2.boxFilter(floor.astype(np.float32), -1, (TP_NEIGHBOURHOOD, TP_NEIGHBOURHOOD))
    return (floor > 0) | ((tp > 0) & (share >= TP_FLOOR_SHARE))


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


def draw_doors(walk, doors):
    """Rend praticable (sur place) chaque trait de porte tracé à la main."""
    h, w = walk.shape
    layer = np.zeros((h, w), np.uint8)
    for d in doors:
        a = (round(d["from"][0] * (w - 1)), round(d["from"][1] * (h - 1)))
        b = (round(d["to"][0] * (w - 1)), round(d["to"][1] * (h - 1)))
        cv2.line(layer, a, b, 255, DOOR_WIDTH_PX)
    walk |= layer > 0


def validate(data):
    """Annotation propre (couleurs valides, au plus MAX_SPAWNS zones par équipe, coordonnées dans la minimap) ; ValueError sinon."""
    if not isinstance(data, dict):
        raise ValueError("annotation illisible")
    colors = []
    for c in data.get("colors", []):
        rgb = c.get("rgb")
        if c.get("cls") not in CODES or not (isinstance(rgb, list) and len(rgb) == 3 and all(isinstance(v, int) and 0 <= v <= 255 for v in rgb)):
            raise ValueError(f"couleur invalide : {c}")
        colors.append({"rgb": rgb, "tol": max(0, min(int(c.get("tol", 10)), 120)), "cls": c["cls"]})
    unit = lambda p: isinstance(p, list) and len(p) == 2 and all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in p)
    tps = []
    for t in data.get("tps", []):
        if not (unit(t.get("from")) and unit(t.get("to"))):
            raise ValueError(f"tyrolienne invalide : {t}")
        tps.append({"from": t["from"], "to": t["to"]})
    doors = []
    for d in data.get("doors", []):
        if not (unit(d.get("from")) and unit(d.get("to"))):
            raise ValueError(f"porte invalide : {d}")
        doors.append({"from": d["from"], "to": d["to"], "glass": bool(d.get("glass"))})
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
    return {"colors": colors, "tps": tps, "doors": doors, "spawns": spawns, "inset": inset, "pairs": data.get("pairs", [])}


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


def apply(conn, map_name):
    """Écrit les fichiers du programme d'après l'annotation de la carte. Renvoie un résumé (dict), ou None s'il n'y a pas d'annotation ou de médiane."""
    raw = annotation_of(conn, map_name)
    median = cv2.imread(str(MASK_DIR / f"{map_name}_mediane.png"))
    if raw is None or median is None:
        return None
    data = validate(raw)
    summary = {"map": map_name}
    if data["colors"]:
        labels = classify(median, data["colors"])
        walk = walkable_from_classes(labels)
        open_tp_paths(walk, data["tps"])
        draw_doors(walk, data["doors"])
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
            summary["classes"] = {name: int((labels == code).sum()) for name, code in CODES.items()}
    if data["doors"]:
        _merge_json(DOORS, map_name, [{"from": d["from"], "to": d["to"], "glass": d["glass"]} for d in data["doors"]])
        summary["portes"] = len(data["doors"])
    if data["tps"]:
        _merge_json(TELEPORTS, map_name, [[[round(t["from"][0], 4), round(t["from"][1], 4)], [round(t["to"][0], 4), round(t["to"][1], 4)]] for t in data["tps"]])
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
