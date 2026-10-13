"""Points de capture actifs d'une game (Outlaw : un seul point à la fois sur la minimap, qui change toutes les 1 min 30 environ).

  python analysis/capture_points.py --game 32            cherche les boîtes de capture sur la minimap de la game et affiche la suite des points actifs

Sur la minimap, seule la boîte du point actif est dessinée : un carré plein d'une quarantaine de pixels, gris tant que personne ne l'a pris, orange ou bleu une fois pris. La médiane de
la minimap (`map_masks/<Carte>_mediane.png`) n'en contient aucune (elles sont rarement au même endroit) : une boîte est une tache uniforme de la bonne taille qui diffère de la médiane. Les
positions trouvées sont rattachées aux points de la carte (lettres, `map_capture_points.json`) par la plus proche ; une boîte n'est retenue que si elle reste au même endroit au moins
MIN_SEGMENT_S secondes (les transitions de l'écran et les pastilles de joueurs ne font pas de boîtes)."""

import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
POINTS = HERE / "map_capture_points.json"
SAMPLE_S = 2.0  # une image de la minimap toutes les 2 s
MIN_SEGMENT_S = 20.0  # une boîte reste au moins ce temps au même endroit (un point reste actif 1 min 30 ; les zones de départ, où des joueurs entrent et sortent, ne tiennent pas 20 s)
SAME_SPOT = 0.03  # deux détections à moins de cette distance (fraction de la minimap) sont la même boîte
MAX_GAP_S = 4.0  # une boîte perdue (pastille de joueur dessus, image brouillée) au plus cette durée est la même
BOX_W = (30, 62)  # largeur d'une boîte de capture (pixels de la minimap de 380 pixels de large, mesurée 44 à 48 ; la boîte D d'Outlaw est un rectangle debout de 36 sur 56)
BOX_H = (22, 64)
BOX_AREA = (700, 3200)
MIN_FILL = 0.7  # part du rectangle englobant couverte par la tache (les pastilles de joueurs sur la boîte la trouent)
DIFF_MIN = 38  # écart minimal à la médiane (canal le plus éloigné) pour qu'un pixel soit « nouveau »


def load(map_name):
    """Points de capture d'une carte {"points": {lettre: {"x", "y", "w", "h", "vu", "indication"}}, "duree_s", "calendrier": [...]} ou None."""
    if not POINTS.exists():
        return None
    return json.loads(POINTS.read_text(encoding="utf-8")).get(map_name)


def owner_of(bgr_patch):
    """Propriétaire d'une boîte d'après sa couleur moyenne : « neutre » (gris), « orange » ou « bleu »."""
    b, g, r = (float(v) for v in bgr_patch.reshape(-1, 3).mean(axis=0))
    if b > r + 35:
        return "bleu"
    if r > b + 45:
        return "orange"
    return "neutre"


def detect_boxes(frame, median):
    """Boîtes de capture dans une image de la minimap (même taille que la médiane) : [{"x", "y" (centre, fractions), "w", "h" (pixels), "owner"}]."""
    h, w = median.shape[:2]
    if frame.shape[:2] != (h, w):
        frame = cv2.resize(frame, (w, h), interpolation=cv2.INTER_AREA)
    diff = np.abs(frame.astype(np.int16) - median.astype(np.int16)).max(axis=2) >= DIFF_MIN
    mask = cv2.morphologyEx(diff.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))  # le chiffre et le liseré de la boîte ne la trouent pas
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask)
    boxes = []
    for k in range(1, n):
        x0, y0, bw, bh, area = stats[k]
        if BOX_W[0] <= bw <= BOX_W[1] and BOX_H[0] <= bh <= BOX_H[1] and BOX_AREA[0] <= area <= BOX_AREA[1] and area / (bw * bh) >= MIN_FILL:
            boxes.append({"x": (x0 + bw / 2) / w, "y": (y0 + bh / 2) / h, "w": int(bw), "h": int(bh), "fw": bw / w, "fh": bh / h, "owner": owner_of(frame[lab == k])})
    return boxes


def segments(samples):
    """Suite des boîtes actives à partir des détections [(t, [boîtes])] : [{"t0", "t1", "x", "y", "proprietaires": [(t, propriétaire)]}], une boîte restant au même endroit
    (SAME_SPOT) avec des trous d'au plus MAX_GAP_S, gardée si elle dure au moins MIN_SEGMENT_S."""
    open_, done = [], []
    for t, boxes in samples:
        for box in boxes:
            for seg in open_:
                if abs(seg["x"] - box["x"]) <= SAME_SPOT and abs(seg["y"] - box["y"]) <= SAME_SPOT and t - seg["t1"] <= MAX_GAP_S + SAMPLE_S:
                    seg["t1"] = t
                    seg["n"] += 1
                    seg["xs"].append(box["x"])
                    seg["ys"].append(box["y"])
                    seg["fws"].append(box["fw"])
                    seg["fhs"].append(box["fh"])
                    if seg["proprietaires"][-1][1] != box["owner"]:
                        seg["proprietaires"].append((t, box["owner"]))
                    break
            else:
                open_.append({"t0": t, "t1": t, "x": box["x"], "y": box["y"], "n": 1, "xs": [box["x"]], "ys": [box["y"]], "fws": [box["fw"]], "fhs": [box["fh"]], "proprietaires": [(t, box["owner"])]})
        still = []
        for seg in open_:
            (still if t - seg["t1"] <= MAX_GAP_S + SAMPLE_S else done).append(seg)
        open_ = still
    done += open_
    out = []
    for seg in done:
        if seg["t1"] - seg["t0"] + SAMPLE_S >= MIN_SEGMENT_S:
            out.append({"t0": seg["t0"], "t1": seg["t1"], "x": round(float(np.median(seg["xs"])), 4), "y": round(float(np.median(seg["ys"])), 4),
                    "w": round(float(np.median(seg["fws"])), 4), "h": round(float(np.median(seg["fhs"])), 4), "proprietaires": seg["proprietaires"]})
    return sorted(out, key=lambda s: s["t0"])


def name_point(map_name, x, y, hints=None):
    """Lettre du point de la carte le plus proche de (x, y) (positions indiquées ou vues dans map_capture_points.json), ou None (moins de 0,12 de la minimap)."""
    if hints is None:
        hints = {k: (v.get("indication") or (v["x"], v["y"])) for k, v in (load(map_name) or {}).get("points", {}).items()}
    best = min(hints.items(), key=lambda kv: (kv[1][0] - x) ** 2 + (kv[1][1] - y) ** 2, default=None)
    return best[0] if best and ((best[1][0] - x) ** 2 + (best[1][1] - y) ** 2) ** 0.5 <= 0.12 else None


def build_points(map_name, segs, hints, previous=None):
    """Points de la carte d'après les boîtes vues : {lettre: {"x", "y", "w", "h", "vu": True}} (médiane des segments de ce point) ; un point jamais vu garde sa position indiquée (`hints` :
    {lettre: (x, y)}, centre du polygone tracé à la main) avec "vu": False, sauf si `previous` (résultat d'une autre game) l'a déjà vu. Une game courte ne montre pas tous les points."""
    seen = {}
    for s in segs:
        letter = min(hints, key=lambda k: (hints[k][0] - s["x"]) ** 2 + (hints[k][1] - s["y"]) ** 2)
        if ((hints[letter][0] - s["x"]) ** 2 + (hints[letter][1] - s["y"]) ** 2) ** 0.5 <= 0.12:
            seen.setdefault(letter, []).append(s)
    out = {}
    for letter, (hx, hy) in sorted(hints.items()):
        if letter in seen:
            ss = seen[letter]
            out[letter] = {"x": round(float(np.median([s["x"] for s in ss])), 4), "y": round(float(np.median([s["y"] for s in ss])), 4),
                           "w": round(float(np.median([s["w"] for s in ss])), 4), "h": round(float(np.median([s["h"] for s in ss])), 4), "vu": True}
        elif previous and previous.get(letter, {}).get("vu"):
            out[letter] = previous[letter]
        else:
            out[letter] = {"x": round(hx, 4), "y": round(hy, 4), "vu": False}
    return out


def sequence(map_name, segs, hints):
    """Suite des points actifs vue sur la vidéo : [(début en secondes de game, fin, lettre ou None)]."""
    out = []
    for s in segs:
        letter = min(hints, key=lambda k: (hints[k][0] - s["x"]) ** 2 + (hints[k][1] - s["y"]) ** 2)
        near = ((hints[letter][0] - s["x"]) ** 2 + (hints[letter][1] - s["y"]) ** 2) ** 0.5 <= 0.12
        out.append((s["t0"], s["t1"], letter if near else None))
    return out


def grab_minimap(video, t0, seconds, zone, folder, size):
    """Images de la minimap toutes les SAMPLE_S secondes de t0 à t0 + seconds, ramenées à `size` (largeur, hauteur) : liste de (instant de la vidéo, image)."""
    os.makedirs(folder, exist_ok=True)
    for f in glob.glob(folder + "/*.png"):
        os.remove(f)
    filt = f"fps=1/{SAMPLE_S},crop=iw*{zone['w']}:ih*{zone['h']}:iw*{zone['x']}:ih*{zone['y']},scale={size[0]}:{size[1]}"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(t0), "-t", str(seconds), "-i", str(video), "-vf", filt, folder + "/s_%04d.png"], check=True)
    return [(t0 + k * SAMPLE_S, cv2.imread(f)) for k, f in enumerate(sorted(glob.glob(folder + "/s_*.png")))]


def scan_game(video, start_s, end_s, zone, median):
    """Boîtes de capture actives d'une game, d'après la minimap de la vidéo : liste de segments (instants en secondes de game, positions rattachées à la lettre du point quand elle est connue)."""
    h, w = median.shape[:2]
    folder = tempfile.mkdtemp(prefix="capture_")
    samples = [(t - start_s, detect_boxes(img, median)) for t, img in grab_minimap(video, start_s, end_s - start_s, zone, folder, (w, h))]
    return samples, segments(samples)


def scan_and_store(conn, game, path):
    """Cherche les boîtes de capture d'une game (dict : id, start_s, end_s, map) dans la vidéo `path` et les enregistre (table capture_boxes). Renvoie les segments."""
    import db

    median = cv2.imread(str(HERE / "map_masks" / f"{game['map']}_mediane.png"))
    zone = db.zone_for(conn, game["map"], "minimap")
    _, segs = scan_game(path, game["start_s"], game["end_s"], zone, median)
    db.replace_capture_boxes(conn, game["id"], segs, lambda x, y: name_point(game["map"], x, y))
    return segs


def main(argv=None):
    parser = argparse.ArgumentParser(description="Cherche les points de capture actifs d'une game sur la minimap de la vidéo.")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--store", action="store_true", help="enregistre les points vus dans la base (table capture_boxes)")
    parser.add_argument("--write", action="store_true", help="écrit les positions des points vus dans map_capture_points.json (garde celles déjà vues sur d'autres games)")
    args = parser.parse_args(argv)
    import sqlite3

    if args.store:
        import db

        conn = db.connect(args.db)
    else:
        conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
    g = conn.execute("SELECT g.start_s, g.end_s, g.map, v.path FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (args.game,)).fetchone()
    median = cv2.imread(str(HERE / "map_masks" / f"{g['map']}_mediane.png"))
    zone = json.loads((HERE / "map_zones.json").read_text(encoding="utf-8"))[g["map"]]["minimap"]
    samples, segs = scan_game(g["path"], g["start_s"], g["end_s"], zone, median)
    if args.store:
        import db

        db.replace_capture_boxes(conn, args.game, segs, lambda x, y: name_point(g["map"], x, y))
        print(f"{len(segs)} points actifs enregistrés pour la game {args.game}")
    print(f"{g['map']} : {len(samples)} images, {sum(1 for _, b in samples if b)} avec une boîte")
    known = load(g["map"]) or {}
    hints = {k: tuple(v["indication"]) for k, v in known.get("points", {}).items() if "indication" in v}
    for s in segs:
        letter = name_point(g["map"], s["x"], s["y"], hints)
        print(f"  {s['t0']:6.1f} s à {s['t1']:6.1f} s : boîte en ({s['x']:.3f}, {s['y']:.3f}) point {letter} propriétaires {[(round(t), o) for t, o in s['proprietaires']]}")
    if args.write and hints:
        previous = {k: v for k, v in known.get("points", {}).items()}
        points = build_points(g["map"], segs, hints, previous)
        for k, v in points.items():
            v["indication"] = list(hints[k])
        all_ = json.loads(POINTS.read_text(encoding="utf-8"))
        all_[g["map"]]["points"] = points
        POINTS.write_text(json.dumps(all_, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print("écrit dans", POINTS.name, ":", {k: ("vu" if v["vu"] else "indication seulement") for k, v in points.items()})
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
