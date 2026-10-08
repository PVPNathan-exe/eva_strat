"""Pseudos des 8 joueurs d'une game, lus sur les bandeaux du haut (l'ordre des bandeaux donne le slot 1 à 8, donc le numéro).

On ne cherche pas le pseudo exact : les longs pseudos sont tronqués par le jeu (« ORXKALIME… ») et la reconnaissance de texte se
trompe parfois sur une lettre. On lit donc plusieurs images de la game, on normalise (majuscules, lettres et chiffres) et on garde
le pseudo qui revient le plus, en regroupant les variantes proches. Il suffit ensuite de reconnaître un pseudo parmi les 8.
"""

import re
import subprocess
import tempfile
from collections import Counter
from pathlib import Path

import cv2
import numpy as np

import ocr

TEAM_SLOTS = {"team_a_bar": (1, 2, 3, 4), "team_b_bar": (5, 6, 7, 8)}
MIN_LETTERS = 3


def normalize(text):
    """Majuscules, lettres et chiffres seulement (« ORxKalime... » -> « ORXKALIME »)."""
    return re.sub(r"[^A-Z0-9]", "", text.upper().replace("…", ""))


def levenshtein(a, b):
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


# Lettres que la reconnaissance de texte confond souvent sur cette police : les compter comme une demi-erreur
CONFUSABLE = {frozenset(p) for p in ("XH", "VU", "YV", "IL", "I1", "L1", "O0", "OQ", "S5", "B8", "T7", "Z2", "G6", "DO", "NH", "MN", "CG", "EF", "RK", "JU", "AR")}
CONFUSION_COST = 0.35


def soft_distance(a, b):
    """Distance d'édition où une confusion fréquente (X lu H, V lu U…) coûte moins qu'une vraie différence."""
    if a == b:
        return 0.0
    prev = [float(j) for j in range(len(b) + 1)]
    for i, ca in enumerate(a, 1):
        cur = [float(i)]
        for j, cb in enumerate(b, 1):
            sub = 0.0 if ca == cb else (CONFUSION_COST if frozenset((ca, cb)) in CONFUSABLE else 1.0)
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + sub))
        prev = cur
    return prev[-1]


def similar(a, b):
    """Même pseudo à une lettre mal lue près, ou l'un est le début tronqué de l'autre."""
    if not a or not b:
        return False
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if len(short) >= 6 and levenshtein(short, long_[: len(short)]) <= 1:
        return True
    return levenshtein(a, b) <= max(1, round(0.2 * len(long_)))


def vote(candidates):
    """Pseudo le plus fréquent parmi des lectures proches. Renvoie (pseudo, part des votes) ou (None, 0)."""
    candidates = [c for c in candidates if sum(ch.isalpha() for ch in c) >= MIN_LETTERS]
    if not candidates:
        return None, 0.0
    clusters = []  # [(Counter, total)]
    for c in candidates:
        for cl in clusters:
            if similar(c, cl["rep"]):
                cl["votes"][c] += 1
                cl["rep"] = max(cl["votes"].items(), key=lambda kv: (kv[1], len(kv[0])))[0]
                break
        else:
            clusters.append({"rep": c, "votes": Counter([c])})
    best = max(clusters, key=lambda cl: sum(cl["votes"].values()))
    return best["rep"], sum(best["votes"].values()) / len(candidates)


def assign_lines(lines, width_px, n=4):
    """Rattache chaque ligne lue au bandeau (0 à n-1) selon sa position horizontale. Une ligne par bandeau : la plus haute lisible."""
    per = {}
    for line in lines:
        text = normalize(line["text"])
        if sum(ch.isalpha() for ch in text) < MIN_LETTERS:
            continue
        idx = min(n - 1, max(0, int((line["x"] + line["w"] / 2) / (width_px / n))))
        if idx not in per or line["y"] < per[idx][0]:
            per[idx] = (line["y"], text)
    return {idx: text for idx, (_, text) in per.items()}


def closest(text, names, team=None):
    """Pseudo de la game le plus proche d'un texte lu (killfeed, bandeau). names : {slot: pseudo}. Renvoie le slot ou None.

    On compare aussi sur le début (un pseudo tronqué) et on refuse une lecture ambiguë entre deux joueurs."""
    q = normalize(text)
    if len(q) < MIN_LETTERS:
        return None
    scored = []
    for slot, name in names.items():
        if team and slot not in TEAM_SLOTS["team_a_bar" if team == "A" else "team_b_bar"]:
            continue
        n = normalize(name)
        d = min(soft_distance(q, n), soft_distance(q[: len(n)], n), soft_distance(q, n[: len(q)]) + 1)
        scored.append((d / max(len(n), len(q), 1), slot))
    scored.sort()
    if not scored or scored[0][0] > 0.34:
        return None
    if len(scored) > 1 and scored[1][0] - scored[0][0] < 0.08:
        return None
    return scored[0][1]


def _grab(video, t, zone, width, height):
    x, y = round(zone["x"] * width), round(zone["y"] * height)
    w, h = round(zone["w"] * width) // 2 * 2, round(zone["h"] * height) // 2 * 2
    cmd = [
        "ffmpeg", "-v", "error", "-ss", f"{max(t, 0):.2f}", "-i", str(video),
        "-frames:v", "1", "-vf", f"crop={w}:{h}:{x}:{y}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    data = subprocess.run(cmd, capture_output=True).stdout
    if len(data) < w * h * 3:
        return None
    return np.frombuffer(data[: w * h * 3], np.uint8).reshape(h, w, 3)


def read_names(video, game, team_zones, width, height, frames=8):
    """Pseudos {slot: pseudo} d'une game, par vote sur `frames` images. team_zones : {"team_a_bar": zone, "team_b_bar": zone}."""
    start, end = game["start_s"], game["end_s"]
    span = max(end - start - 6, 1)
    times = [start + 3 + span * k / max(frames - 1, 1) for k in range(frames)]
    votes = {slot: [] for slots in TEAM_SLOTS.values() for slot in slots}
    with tempfile.TemporaryDirectory() as tmp:
        files = []  # (chemin, équipe, largeur en pixels de l'image agrandie)
        for k, t in enumerate(times):
            for key, zone in team_zones.items():
                crop = _grab(video, t, zone, width, height)
                if crop is None:
                    continue
                big = cv2.resize(crop, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
                path = Path(tmp) / f"{key}_{k:02d}.png"
                cv2.imwrite(str(path), big)
                files.append((str(path), key, big.shape[1]))
        results = ocr.read_images([f[0] for f in files])
        for path, key, w in files:
            for idx, text in assign_lines(results.get(path, []), w).items():
                votes[TEAM_SLOTS[key][idx]].append(text)
    names = {}
    for slot, cands in votes.items():
        name, share = vote(cands)
        if name:
            names[slot] = name
    return names
