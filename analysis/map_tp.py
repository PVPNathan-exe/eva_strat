"""Stations de tyrolienne d'une carte, trouvées sur la minimap elle-même, et leurs paires.

  python analysis/map_tp.py --map Artefact          cherche les stations et leurs paires, écrit analysis/map_teleports.json (si --write) et une planche de contrôle
  python analysis/map_tp.py --all                   toutes les cartes qui ont une médiane (map_mask.py)

Une station est un disque blanc d'une vingtaine de pixels, marqué d'une flèche sombre, qui ne bouge jamais : on le retrouve comme un disque blanc de la médiane des images de la
carte (map_mask.py enregistre cette médiane sans perte, <Carte>_mediane.png). Les paires (entrée, sortie) viennent de deux témoins :
  - les sauts du suivi : un joueur qui entre dans une station ressort instantanément à l'autre (plus de SAUT_MIN en au plus deux images de lecture, lecture sûre aux deux bouts) ;
  - le trait pointillé que la minimap trace entre les deux stations d'une paire (une barre claire le long du segment qui les joint).
Une station sans paire est signalée : le suivi ne la traite pas comme une tyrolienne."""

import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
MASK_DIR = HERE / "map_masks"
OUT = HERE / "map_teleports.json"
SMALL_WHITE_V = 150  # petites icônes (Atlantis)
SMALL_OPEN_PX = 3
SMALL_AREA = (35, 400)
WHITE_V = 180  # luminosité (gris) minimale du disque blanc d'une station
OPEN_PX = 5  # ouverture qui retire les barres et traits collés au disque
AREA = (60, 520)  # surface d'un disque de station (pixels de la minimap lue)
SNAP = 0.07  # distance (fraction de la minimap) à laquelle une extrémité de saut est rattachée à une station
SAUT_MIN = 0.11  # déplacement minimal d'un saut de tyrolienne, en fraction de la minimap, en au plus JUMP_FRAMES lectures (un joueur ne parcourt pas plus de 0,07 en 0,2 s)
JUMP_FRAMES = 2
MANUAL = {"Polaris"}  # relevées à la main et confirmées par les trajets : jamais écrasées
MIN_RIDES_FREE = 5  # sauts observés pour accepter une paire dont aucune extrémité n'est sur une icône détectée
MIN_RIDES = 2  # sauts observés pour accepter une paire
NEIGHBOUR_MAX = 0.25  # distance maximale de deux stations seules prises pour une paire de proches voisines
BAR_MIN = 0.40  # score minimal d'un trait pointillé
BAR_MARGIN = 1.25  # et avance sur le deuxième meilleur partenaire de chaque station
BAR_SHARE = 0.72  # part des points du segment qui doivent être clairs pour qu'il soit le trait pointillé d'une paire


def find_stations(median):
    """Centres (x, y en fractions de la minimap) des disques blancs de la médiane (BGR) qui ont la taille d'une icône de station. Certaines cartes (Atlantis) ont de petites icônes :
    si aucune icône normale n'est trouvée, on cherche des disques plus petits."""
    h, w = median.shape[:2]
    gray = cv2.cvtColor(median, cv2.COLOR_BGR2GRAY)
    sat = cv2.cvtColor(median, cv2.COLOR_BGR2HSV)[:, :, 1]
    for white_v, open_px, area in ((WHITE_V, OPEN_PX, AREA), (SMALL_WHITE_V, SMALL_OPEN_PX, SMALL_AREA)):
        white = ((gray >= white_v) & (sat <= 90)).astype(np.uint8)
        core = cv2.morphologyEx(white, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (open_px, open_px)))
        n, _, stats, cen = cv2.connectedComponentsWithStats(core)
        out = []
        for i in range(1, n):
            x, y, bw, bh, a = stats[i]
            if area[0] <= a <= area[1] and 0.6 <= bw / bh <= 1.6 and a / (bw * bh) > 0.6:
                out.append((round(float(cen[i][0]) / w, 3), round(float(cen[i][1]) / h, 3)))
        if out:
            return out
    return []


def ride_pairs(conn, map_name):
    """Paires de points reliés par des sauts du suivi : [(p, q, n)] (extrémités moyennes et nombre de sauts), pour la carte."""
    import collections

    jumps = []
    for g in conn.execute("SELECT id FROM games WHERE map = ? AND EXISTS (SELECT 1 FROM samples WHERE game_id = games.id)", (map_name,)).fetchall():
        rows = collections.defaultdict(list)
        for r in conn.execute("SELECT frame, slot, x, y, confidence, alive FROM samples WHERE game_id = ? ORDER BY slot, frame", (g["id"],)):
            rows[r["slot"]].append(r)
        for rs in rows.values():
            for a, b in zip(rs, rs[1:]):
                if a["alive"] and b["alive"] and 0 < b["frame"] - a["frame"] <= JUMP_FRAMES and a["confidence"] >= 0.7 and b["confidence"] >= 0.7 \
                        and math.hypot(b["x"] - a["x"], b["y"] - a["y"]) > SAUT_MIN:
                    jumps.append(((a["x"], a["y"]), (b["x"], b["y"])))
    clusters = []
    for p, q in jumps:
        for cl in clusters:
            same = math.hypot(cl[0][0] - p[0], cl[0][1] - p[1]) < SNAP and math.hypot(cl[1][0] - q[0], cl[1][1] - q[1]) < SNAP
            swapped = math.hypot(cl[0][0] - q[0], cl[0][1] - q[1]) < SNAP and math.hypot(cl[1][0] - p[0], cl[1][1] - p[1]) < SNAP
            if same or swapped:
                cl[2] += 1
                break
        else:
            clusters.append([p, q, 1])
    return [tuple(cl) for cl in clusters if cl[2] >= MIN_RIDES]


def _nearest(stations, p):
    best = min(range(len(stations)), key=lambda i: math.hypot(stations[i][0] - p[0], stations[i][1] - p[1]), default=None)
    return best if best is not None and math.hypot(stations[best][0] - p[0], stations[best][1] - p[1]) <= SNAP else None


def bar_score(median, a, b):
    """Part des points du segment a-b (hors des disques) qui sont clairs sur la médiane : un trait pointillé les relie."""
    h, w = median.shape[:2]
    gray = cv2.cvtColor(median, cv2.COLOR_BGR2GRAY)
    sat = cv2.cvtColor(median, cv2.COLOR_BGR2HSV)[:, :, 1]
    length = math.hypot((b[0] - a[0]) * w, (b[1] - a[1]) * h)
    n = int(length / 2)
    if n < 12:
        return 0.0
    hits = total = 0
    for k in range(n):
        f = 0.12 + 0.76 * k / (n - 1)  # écarte les disques aux deux bouts
        x, y = int((a[0] + (b[0] - a[0]) * f) * w), int((a[1] + (b[1] - a[1]) * f) * h)
        patch = (gray[max(y - 1, 0) : y + 2, max(x - 1, 0) : x + 2], sat[max(y - 1, 0) : y + 2, max(x - 1, 0) : x + 2])
        total += 1
        hits += int(patch[0].max() >= 110 and patch[1].min() <= 80)
    return hits / max(total, 1)


def pair_stations(median, stations, rides):
    """Paires [(i, j, source)] d'indices de stations : d'abord par les sauts du suivi, puis par le trait pointillé entre deux stations restées seules."""
    pairs, used = [], set()
    for p, q, _ in sorted(rides, key=lambda r: -r[2]):
        i, j = _nearest(stations, p), _nearest(stations, q)
        if i is not None and j is not None and i != j and i not in used and j not in used:
            pairs.append((i, j, "sauts"))
            used |= {i, j}
    free = [i for i in range(len(stations)) if i not in used]
    scores = {(i, j): bar_score(median, stations[i], stations[j]) for i in free for j in free if i < j}

    def partners(i):
        return sorted(((sc, j if a == i else a) for (a, j), sc in scores.items() if i in (a, j)), reverse=True)

    # Le trait pointillé : deux stations qui sont le meilleur partenaire l'une de l'autre, assez nettement devant le deuxième de chacune (un segment qui en croise un autre
    # a un score moyen sans être une paire).
    for (i, j), sc in sorted(scores.items(), key=lambda kv: -kv[1]):
        if i in used or j in used or sc < BAR_MIN:
            continue
        pi, pj = partners(i), partners(j)
        second_i = pi[1][0] if len(pi) > 1 else 0.0
        second_j = pj[1][0] if len(pj) > 1 else 0.0
        if pi[0][1] == j and pj[0][1] == i and (sc >= BAR_SHARE or (sc >= BAR_MIN and sc >= BAR_MARGIN * max(second_i, second_j))):
            pairs.append((i, j, "trait"))
            used |= {i, j}
    # Le trait n'est pas toujours droit (Atlantis : en équerre, Polaris : en courbe) : deux stations restées seules, chacune la plus proche de l'autre et à moins de NEIGHBOUR_MAX, sont une paire.
    left = [i for i in range(len(stations)) if i not in used]
    dist = lambda i, j: math.hypot(stations[i][0] - stations[j][0], stations[i][1] - stations[j][1])
    for i in left:
        if i in used or not [j for j in left if j != i and j not in used]:
            continue
        j = min((j for j in left if j != i and j not in used), key=lambda j: dist(i, j))
        back = min((k for k in left if k != j and k not in used), key=lambda k: dist(j, k))
        if back == i and dist(i, j) <= NEIGHBOUR_MAX:
            pairs.append((i, j, "voisine"))
            used |= {i, j}
    return pairs, [i for i in range(len(stations)) if i not in used]


def draw(median, stations, pairs, alone):
    out = median.copy()
    h, w = out.shape[:2]
    for i, j, src in pairs:
        a, b = (int(stations[i][0] * w), int(stations[i][1] * h)), (int(stations[j][0] * w), int(stations[j][1] * h))
        cv2.line(out, a, b, {"sauts": (0, 255, 0), "trait": (255, 255, 0), "voisine": (0, 165, 255)}[src], 2)
    for k, (x, y) in enumerate(stations):
        cv2.circle(out, (int(x * w), int(y * h)), 14, (0, 0, 255) if k in alone else (0, 255, 0), 2)
    return out


def process(conn, map_name, write):
    path = MASK_DIR / f"{map_name}_mediane.png"
    median = cv2.imread(str(path)) if path.exists() else None
    if median is None:
        print(f"{map_name} : pas de médiane (python analysis/map_mask.py --map \"{map_name}\")")
        return None
    stations = find_stations(median)
    rides = [r for r in ride_pairs(conn, map_name) if _nearest(stations, r[0]) is not None or _nearest(stations, r[1]) is not None or r[2] >= MIN_RIDES_FREE]  # un saut dont aucun bout n'est sur une icône n'est une paire que s'il est très répété
    for p, q, _ in rides:  # une extrémité de saut sans disque détecté (icône plus petite, cachée) est une station aussi
        for e in (p, q):
            if _nearest(stations, e) is None:
                stations.append((round(e[0], 3), round(e[1], 3)))
    pairs, alone = pair_stations(median, stations, rides)
    cv2.imwrite(str(MASK_DIR / f"{map_name}_stations.jpg"), draw(median, stations, pairs, alone))
    print(f"{map_name} : {len(stations)} stations, {len(pairs)} paires ({sum(1 for p in pairs if p[2] == 'sauts')} par les sauts, {sum(1 for p in pairs if p[2] == 'trait')} par le trait, {sum(1 for p in pairs if p[2] == 'voisine')} par proximité), {len(alone)} sans paire ; sauts observés regroupés : {len(rides)}")
    if write and pairs and map_name not in MANUAL:
        known = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
        known[map_name] = [[[float(v) for v in stations[i]], [float(v) for v in stations[j]]] for i, j, _ in pairs]
        OUT.write_text(json.dumps(known, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return stations, pairs, alone


def main(argv=None):
    import db

    parser = argparse.ArgumentParser(description="Stations de tyrolienne d'une carte et leurs paires.")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--map")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--write", action="store_true", help="écrit les paires dans analysis/map_teleports.json (remplace la carte)")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    maps = [p.name[: -len("_mediane.png")] for p in sorted(MASK_DIR.glob("*_mediane.png"))] if args.all else [args.map]
    for m in maps:
        process(conn, m, args.write)
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
