"""Pseudo du joueur observé, lu en bas à droite de l'écran : un témoin indépendant du cadre blanc des bandeaux.

Le cadre blanc d'un bandeau clignote ou n'est pas reconnu sur certaines images ; le panneau du bas à droite affiche en permanence le pseudo complet du joueur
dont la vue est affichée. Le texte change rarement : les images sont regroupées par ressemblance de leur texte (comme pour le killfeed), un représentant de
chaque groupe est lu par la reconnaissance de texte de Windows et rapproché des pseudos de la game. On obtient ainsi, pour chaque image, quel joueur est
observé, ce qui sert à compléter les bandeaux (jamais à les contredire : un cadre blanc net l'emporte)."""

import tempfile
from pathlib import Path

import cv2
import numpy as np

import names
import ocr
import timer

ZONE = {"x": 0.880, "y": 0.935, "w": 0.100, "h": 0.033}  # pseudo dans la pastille du bas à droite (fraction de l'écran)
SIGNATURE_SIZE = (96, 16)
TEXT_V, TEXT_S = 190, 70  # le texte est blanc sur la pastille sombre
SAME_NAME = 0.90  # corrélation à partir de laquelle deux images portent le même pseudo
MIN_CLUSTER = 5  # un groupe de moins d'images n'est pas lu (transition, flou)


def signature(crop):
    """Vecteur normalisé du texte blanc d'un recadrage, ou None s'il n'y a pas de texte."""
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    text = ((hsv[:, :, 2] >= TEXT_V) & (hsv[:, :, 1] <= TEXT_S)).astype(np.float32)
    if float(text.sum()) < 30:
        return None
    vec = cv2.resize(text, SIGNATURE_SIZE, interpolation=cv2.INTER_AREA).ravel()
    vec -= vec.mean()
    norm = float(np.linalg.norm(vec))
    return vec / norm if norm > 1e-9 else None


def cluster(vectors):
    """Groupes d'images de même texte, dans l'ordre du temps (les images voisines ont presque toujours le même pseudo : on essaie le dernier groupe d'abord).
    Renvoie (étiquette de chaque image ou None, nombre d'images par groupe)."""
    centres, counts, labels, last = [], [], [], None
    for vec in vectors:
        if vec is None:
            labels.append(None)
            continue
        order = ([last] if last is not None else []) + [k for k in range(len(centres)) if k != last]
        best = next((k for k in order if float(vec @ centres[k]) >= SAME_NAME), None)
        if best is None:
            centres.append(vec.copy())
            counts.append(1)
            best = len(centres) - 1
        else:
            merged = centres[best] * counts[best] + vec
            centres[best] = merged / max(float(np.linalg.norm(merged)), 1e-9)
            counts[best] += 1
        labels.append(best)
        last = best
    return labels, counts


def label_clusters(representatives, counts, players):
    """Joueur (slot) de chaque groupe assez grand : lecture de son image représentative, rapprochée des pseudos de la game ({slot: pseudo}). {groupe: slot}."""
    wanted = [k for k, n in enumerate(counts) if n >= MIN_CLUSTER and representatives.get(k) is not None]
    if not wanted:
        return {}
    with tempfile.TemporaryDirectory() as tmp:
        paths = {}
        for k in wanted:
            big = cv2.resize(representatives[k], None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
            path = Path(tmp) / f"nom_{k}.png"
            cv2.imwrite(str(path), big)
            paths[k] = str(path)
        results = ocr.read_images(list(paths.values()))
    out = {}
    for k, path in paths.items():
        text = " ".join(line["text"] for line in results.get(str(Path(path).resolve()), results.get(path, [])))
        slot, _ = names.closest_scored(text, players)
        if slot is not None:
            out[k] = slot
    return out


def read_slots(video, game, players, width, height, step_s, wait=None):
    """Joueur observé de chaque image d'après le pseudo affiché : [slot ou None], dans l'ordre des images de la minimap. [] si la lecture de texte est indisponible."""
    vectors, best_crop, best_ink = [], {}, {}
    pending = []  # (indice, crop) en attente de leur groupe
    for i, (_, crop) in enumerate(timer.iter_crops(video, ZONE, width, height, step_s=step_s, t0=game["start_s"], t1=game["end_s"])):
        if wait:
            wait()
        vec = signature(crop)
        vectors.append(vec)
        if vec is not None:
            pending.append((i, crop.copy()))
    labels, counts = cluster(vectors)
    for i, crop in pending:  # le représentant d'un groupe est son image au texte le plus net (le plus de pixels blancs)
        k = labels[i]
        ink = int(((cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)[:, :, 2] >= TEXT_V)).sum())
        if k is not None and ink > best_ink.get(k, -1):
            best_ink[k], best_crop[k] = ink, crop
    try:
        slot_of = label_clusters(best_crop, counts, players)
    except ocr.OcrUnavailable:
        return []
    return [slot_of.get(k) if k is not None else None for k in labels]


def fuse_observed(states, name_slots):
    """Complète les bandeaux avec le pseudo lu : quand le cadre blanc ne désigne personne (ou plusieurs joueurs) sur une image, le joueur nommé est l'observé.
    Un cadre blanc net (exactement un joueur) n'est jamais changé. Renvoie (états, {"accord", "desaccord", "ajoutes"}) : combien d'images où cadre et pseudo
    désignent le même joueur, deux joueurs différents, et combien d'images ont reçu un joueur observé grâce au pseudo."""
    stats = {"accord": 0, "desaccord": 0, "ajoutes": 0}
    if not name_slots:
        return states, stats
    for i, name in enumerate(name_slots):
        per = states.get(i)
        if not per or name is None or name not in per:
            continue
        flagged = [s for s, v in per.items() if v["spectated"]]
        if len(flagged) == 1:
            stats["accord" if flagged[0] == name else "desaccord"] += 1
            continue
        for s, v in per.items():
            v["spectated"] = s == name
        stats["ajoutes"] += 1
    return states, stats


MIN_SEGMENT_S = 1.0  # une période d'observation plus courte que cela, entre deux autres, est un clignotement du cadre blanc


def observed_segments(states, times, min_s=MIN_SEGMENT_S):
    """Joueur observé au cours de la game : [(slot, t0, t1)] en temps de vidéo. states : {image: {slot: {"spectated"}}}, times : {image: temps}.
    Les images sans joueur observé unique et les clignotements de moins de min_s sont absorbés par la période voisine quand ses deux bords sont d'accord."""
    keys = sorted(k for k in states if k in times)  # une image sans aucune ligne de suivi (écran vide) n'a pas de temps
    who = []
    for k in keys:
        flagged = [s for s, v in states[k].items() if v.get("spectated")]
        who.append(flagged[0] if len(flagged) == 1 else None)
    runs = []  # [slot, première, dernière]
    for i, w in enumerate(who):
        if runs and runs[-1][0] == w:
            runs[-1][2] = i
        else:
            runs.append([w, i, i])
    step = (times[keys[-1]] - times[keys[0]]) / max(len(keys) - 1, 1) if len(keys) > 1 else 0.1
    short = max(1, round(min_s / step))
    for n in range(1, len(runs) - 1):  # un passage court encadré par le même joueur disparaît dans lui
        if runs[n][2] - runs[n][1] + 1 < short and runs[n - 1][0] == runs[n + 1][0]:
            runs[n][0] = runs[n - 1][0]
    merged = []
    for r in runs:
        if merged and merged[-1][0] == r[0]:
            merged[-1][2] = r[2]
        else:
            merged.append(list(r))
    return [(w, times[keys[a]], times[keys[b]]) for w, a, b in merged if w is not None and times[keys[b]] - times[keys[a]] >= 0.0]
