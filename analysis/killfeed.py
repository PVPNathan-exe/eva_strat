"""Killfeed (haut droite de l'écran) : qui a tué qui, quand, avec quelle arme.

Chaque entrée est une ligne : le pseudo du tueur (texte coloré à la couleur de son équipe, sur une pastille grise), l'icône de
l'arme, puis le pseudo de la victime. Les lignes s'empilent vers le bas et durent quelques secondes.

Principe : on découpe chaque ligne en segments de texte coloré (tueur, victime) et l'icône entre les deux, on lit les deux pseudos par
reconnaissance de texte (ocr.py) et on les rattache à l'un des 8 joueurs de la game par comparaison tolérante (names.closest).
Un même kill est vu sur plusieurs images : on ne garde que son apparition.
"""

import hashlib
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

import names as names_mod
import ocr
import weapons

REGION = {"x": 0.78, "y": 0.19, "w": 0.22, "h": 0.30}  # zone du killfeed (relative à l'image)
SCAN_STEP_S = 0.5  # une lecture toutes les 0,5 s (une entrée reste affichée plusieurs secondes)
ORANGE = ((4, 110, 140), (22, 255, 255))
BLUE = ((98, 80, 130), (116, 255, 255))
MIN_ROW_PIXELS = 25  # pixels colorés minimum pour qu'une ligne existe
NAME_GAP_PX = 16  # trou horizontal qui sépare deux segments de texte (le trou de l'icône est plus large)
ENTRY_GAP_S = 1.6  # deux observations de la même victime séparées de moins que cela sont la même entrée du killfeed


def _color_masks(crop):
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    return {
        "A": cv2.inRange(hsv, np.array(ORANGE[0]), np.array(ORANGE[1])) > 0,
        "B": cv2.inRange(hsv, np.array(BLUE[0]), np.array(BLUE[1])) > 0,
    }


def find_rows(crop):
    """Lignes du killfeed : liste de dicts {y0, y1, segments:[{x0, x1, team}]} (segments triés de gauche à droite)."""
    masks = _color_masks(crop)
    any_color = masks["A"] | masks["B"]
    profile = any_color.sum(axis=1)
    rows, start = [], None
    for y, v in enumerate(list(profile) + [0]):
        if v >= 3 and start is None:
            start = y
        elif v < 3 and start is not None:
            if y - start >= 7 and profile[start:y].sum() >= MIN_ROW_PIXELS:
                rows.append((start, y))
            start = None
    out = []
    for y0, y1 in rows:
        cols = any_color[y0:y1].sum(axis=0) > 0
        segments, x = [], 0
        w = len(cols)
        while x < w:
            if not cols[x]:
                x += 1
                continue
            x0 = x
            last = x
            while x < w and (cols[x] or x - last <= NAME_GAP_PX):
                if cols[x]:
                    last = x
                x += 1
            x1 = last + 1
            if x1 - x0 >= 14:
                a = masks["A"][y0:y1, x0:x1].sum()
                b = masks["B"][y0:y1, x0:x1].sum()
                segments.append({"x0": x0, "x1": x1, "team": "A" if a >= b else "B"})
        if len(segments) >= 2:
            out.append({"y0": y0, "y1": y1, "segments": segments})
    return out


def _segment_piece(crop, row, seg):
    y0, y1 = max(row["y0"] - 4, 0), min(row["y1"] + 4, crop.shape[0])
    x0, x1 = max(seg["x0"] - 4, 0), min(seg["x1"] + 4, crop.shape[1])
    return crop[y0:y1, x0:x1]


def _variants(piece):
    """Autres préparations d'un pseudo que la première n'a pas su lire : agrandissements et niveaux de gris inversé."""
    out = []
    for scale in (4, 2):
        big = cv2.resize(piece, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        out.append(cv2.copyMakeBorder(big, 20, 20, 20, 20, cv2.BORDER_REPLICATE))
    big = cv2.resize(piece, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    inv = cv2.cvtColor(255 - cv2.cvtColor(big, cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
    out.append(cv2.copyMakeBorder(inv, 20, 20, 20, 20, cv2.BORDER_REPLICATE))
    return out


def _segment_image(crop, row, seg):
    """Image du pseudo pour la reconnaissance de texte : l'image couleur agrandie 3 fois, sans binarisation (testé : la binarisation
    épaissit les lettres et fait tout perdre ; le gris inversé et les agrandissements plus forts lisent moins bien)."""
    y0, y1 = max(row["y0"] - 4, 0), min(row["y1"] + 4, crop.shape[0])
    x0, x1 = max(seg["x0"] - 4, 0), min(seg["x1"] + 4, crop.shape[1])
    big = cv2.resize(crop[y0:y1, x0:x1], None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    return cv2.copyMakeBorder(big, 20, 20, 20, 20, cv2.BORDER_REPLICATE)


def _icon_image(crop, row):
    a, b = row["segments"][0], row["segments"][-1]
    y0, y1 = row["y0"], row["y1"]
    x0, x1 = a["x1"] + 2, b["x0"] - 1
    if x1 - x0 < 8:
        return None
    piece = crop[max(y0 - 2, 0) : y1 + 2, x0:x1]
    gray = cv2.cvtColor(piece, cv2.COLOR_BGR2GRAY)
    return (gray > 170).astype(np.uint8) * 255


def _grab(video, t, width, height):
    x, y = round(REGION["x"] * width), round(REGION["y"] * height)
    w, h = round(REGION["w"] * width) // 2 * 2, round(REGION["h"] * height) // 2 * 2
    cmd = [
        "ffmpeg", "-v", "error", "-ss", f"{max(t, 0):.2f}", "-i", str(video),
        "-frames:v", "1", "-vf", f"crop={w}:{h}:{x}:{y}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    data = subprocess.run(cmd, capture_output=True).stdout
    if len(data) < w * h * 3:
        return None
    return np.frombuffer(data[: w * h * 3], np.uint8).reshape(h, w, 3)


def iter_regions(video, game, width, height, step_s=SCAN_STEP_S):
    """Recadrages du killfeed à cadence régulière, en un seul passage de ffmpeg : (t, image)."""
    x, y = round(REGION["x"] * width), round(REGION["y"] * height)
    w, h = round(REGION["w"] * width) // 2 * 2, round(REGION["h"] * height) // 2 * 2
    start, end = game["start_s"], game["end_s"]
    cmd = [
        "ffmpeg", "-v", "error", "-an", *(["-ss", f"{start:.2f}"] if start > 0 else []), "-t", f"{end - start:.2f}", "-i", str(video),
        "-vf", f"fps=1/{step_s},crop={w}:{h}:{x}:{y}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    size = w * h * 3
    i = 0
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield start + i * step_s, np.frombuffer(buf, np.uint8).reshape(h, w, 3)
            i += 1
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()


def _fingerprint(img):
    small = cv2.resize(img, (32, 8), interpolation=cv2.INTER_AREA)
    return hashlib.md5((small // 24).tobytes()).hexdigest()


def read_events(video, game, players, width, height, step_s=SCAN_STEP_S, wait=None, emit=None):
    """Kills d'une game : [{"t", "killer", "victim", "killer_team", "victim_team", "weapon"}]. players : {slot: pseudo}.

    weapon : identifiant de l'icône d'arme (« W1 »…, voir weapons.py), ou None."""
    observations = []  # (t, ligne, signature d'image du segment tueur, du segment victime)
    images = {}  # signature -> image à lire
    pieces = {}  # signature -> morceau brut de l'écran (pour retenter la lecture autrement)
    for t, crop in iter_regions(video, game, width, height, step_s):
        if wait:
            wait()
        if emit:
            emit(min(100.0, 100 * (t - game["start_s"]) / max(game["end_s"] - game["start_s"], 1)))
        for row in find_rows(crop):
            a, b = row["segments"][0], row["segments"][-1]
            ka, kb = _segment_image(crop, row, a), _segment_image(crop, row, b)
            sa, sb = _fingerprint(ka), _fingerprint(kb)
            images.setdefault(sa, ka)
            images.setdefault(sb, kb)
            pieces.setdefault(sa, _segment_piece(crop, row, a))
            pieces.setdefault(sb, _segment_piece(crop, row, b))
            observations.append({"t": t, "killer_sig": sa, "victim_sig": sb, "killer_team": a["team"], "victim_team": b["team"], "icon": _icon_image(crop, row)})
    if not observations:
        return []
    with tempfile.TemporaryDirectory() as tmp:
        paths = {}
        for sig, img in images.items():
            p = Path(tmp) / f"{sig}.png"
            cv2.imwrite(str(p), img)
            paths[sig] = str(p)
        read = ocr.read_images(list(paths.values()))
    text_of = {sig: " ".join(line["text"] for line in read.get(path, [])) for sig, path in paths.items()}

    # 1. lecture de chaque observation ; un pseudo non reconnu est relu avec d'autres préparations de l'image
    team_of = {}
    for o in observations:
        team_of[o["killer_sig"]] = o["killer_team"]
        team_of[o["victim_sig"]] = o["victim_team"]
    resolved = {sig: names_mod.closest(text, players, team_of.get(sig)) for sig, text in text_of.items()}
    retry = [sig for sig, slot in resolved.items() if slot is None]
    if retry:
        with tempfile.TemporaryDirectory() as tmp:
            variant_paths = {}
            for sig in retry:
                for k, img in enumerate(_variants(pieces[sig])):
                    p = Path(tmp) / f"{sig}_{k}.png"
                    cv2.imwrite(str(p), img)
                    variant_paths.setdefault(sig, []).append(str(p))
            read2 = ocr.read_images([p for ps in variant_paths.values() for p in ps])
        for sig, ps in variant_paths.items():
            for p in ps:
                text = " ".join(line["text"] for line in read2.get(str(Path(p).resolve()), []))
                slot = names_mod.closest(text, players, team_of.get(sig))
                if slot is not None:
                    resolved[sig] = slot
                    break
    reads = []
    for o in observations:
        killer = resolved.get(o["killer_sig"])
        victim = resolved.get(o["victim_sig"])
        if victim is not None:
            reads.append({**o, "killer": killer, "victim": victim})
    # 2. une entrée reste affichée plusieurs secondes : on regroupe les observations d'une même victime qui se suivent
    #    (écart < ENTRY_GAP_S), et le tueur est le plus souvent lu sur toute la durée d'affichage.
    events = []
    open_by_victim = {}
    for r in sorted(reads, key=lambda r: r["t"]):
        ev = open_by_victim.get(r["victim"])
        if ev is not None and r["t"] - ev["last"] <= ENTRY_GAP_S:
            ev["last"] = r["t"]
            ev["killers"].append(r["killer"])
            ev["icons"].append(r["icon"])
        else:
            ev = {"t": r["t"], "last": r["t"], "victim": r["victim"], "victim_team": r["victim_team"], "killer_team": r["killer_team"], "killers": [r["killer"]], "icons": [r["icon"]]}
            open_by_victim[r["victim"]] = ev
            events.append(ev)
    out = []
    for ev in events:
        known = [k for k in ev["killers"] if k is not None]
        killer = max(set(known), key=known.count) if known else None
        icons = [i for i in ev["icons"] if i is not None]
        weapon = None
        for icon in icons[len(icons) // 2 :] + icons[: len(icons) // 2]:  # on part de l'icône du milieu de l'affichage, la plus nette
            weapon = weapons.identify(icon)
            if weapon:
                break
        out.append({"t": ev["t"], "killer": killer, "victim": ev["victim"], "killer_team": ev["killer_team"], "victim_team": ev["victim_team"], "weapon": weapon})
    return out
