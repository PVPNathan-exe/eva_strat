"""Tableau de fin de game (table `scoreboard`, module `scoreboard`, REVISION 1) : `python analysis/scoreboard.py --game N [--store] [--db chemin] [--probe]`.

Après l'écran de victoire, le jeu affiche un récapitulatif : pour chaque joueur le pseudo, le SCORE et trois chiffres K (kills), D (morts) et A (assistances), à gauche le pourcentage de capture
de chaque équipe (équipe orange en haut = côté A = slots 1 à 4, bleue en bas = côté B = slots 5 à 8), en haut à droite le nom de la carte. C'est la valeur OFFICIELLE du jeu pour ces chiffres.

- **Où et quand** : mise en page fixe en 1920 par 1080 (toute autre taille de vidéo est ramenée à celle-ci). Le tableau est repéré par les 24 icônes K, D, A (hexagones blancs, corrélation avec un modèle,
  `board_score`) lues à 2 images par seconde de `end_s` à `end_s + SCAN_S`, jamais avec `cv2.VideoCapture.set` (ffmpeg, `-ss` avant `-i`). `find_board` donne la plage (début, fin) : une vidéo coupée avant le tableau
  ne donne aucune plage, donc aucune ligne écrite.
- **Chiffres** : texte clair sur un décor qui change (neige, ciel, jungle) : pixels dont le canal minimal est au moins `TEXT_THS` (190, puis 205 et 175), ou de la couleur de l'équipe (le joueur observé est écrit en bleu ou en
  orange : bleu moins rouge, ou rouge moins bleu, au même seuil), taches recollées à 2 pixels (la compression casse les traits), police à chasse fixe italique (`PITCH` 17,3 pixels : les chiffres d'un score se touchent) donc
  le nombre de chiffres vient de la largeur de l'encre et chaque chiffre est une tranche de cette largeur, ramenée à une vignette de 16 sur 20 et comparée par corrélation à des modèles appris sur des tableaux dont la vérité
  a été lue à l'oeil (`scoreboard_models.npz`, `learn_models`). Une lecture douteuse (corrélation sous `MIN_SCORE_NCC` ou chiffre trop proche d'un autre, `MIN_MARGIN`) vaut `None` (n/d), jamais un chiffre deviné ; entre
  les seuils, la lecture dont le chiffre le moins sûr l'est le plus l'emporte. En domination le score est un multiple de 25 (contrôle : sinon n/d), pas sur Outlaw (897, 728, 686...). Trois images de la plage sont lues,
  la valeur retenue est celle sur laquelle toutes les lectures sûres s'accordent (sinon n/d).
- **Pseudos** : reconnaissance de texte de Windows sur le nom de chaque rangée en trois présentations (`OCR_VARIANTS`), rattachée au slot par la meilleure permutation à l'intérieur de l'équipe (distance de pseudo tolérante,
  5 et S, 0 et O... ; un nom illisible est trouvé par élimination), refusée si deux permutations se valent. Les rangées ne sont PAS dans l'ordre des slots (elles sont triées par score).
- **Contrôles croisés** : nom de la carte (`map_matches` : le tableau est ignoré s'il porte le nom d'une autre carte) et pourcentage de capture de chaque équipe (`read_pct`, affiché seulement, non écrit).
Contrat commun : `compute(conn, game_id) -> int` (idempotent : efface puis réécrit les lignes de la game, 0 sans vidéo ni tableau), `stats_meta`."""

import argparse
import itertools
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

import names
import priority

MODULE = "scoreboard"
REVISION = 1
MODELS_PATH = Path(__file__).with_name("scoreboard_models.npz")
REF_W, REF_H = 1920, 1080

# --- mise en page (pixels de 1920 par 1080, mesurée sur la capture de la game 26 de la vidéo NCT vs SNV)
COL_X0, COL_DX = 516.0, 248.3  # centre de la 1re colonne et pas entre colonnes (4 joueurs par équipe)
BLUE_DY = 462  # l'équipe bleue est 462 pixels plus bas que l'orange
NAME_Y, SCORE_Y, KDA_Y = 396, 458, 538
KDA_DX = {"kills": -76, "deaths": -4, "assists": 60}
ICON_Y = 502  # centre des icônes K, D, A de la rangée orange (965 pour la bleue)
ICON_X = [(COL_X0 - 76 + COL_DX * c, COL_X0 - 4 + COL_DX * c, COL_X0 + 60 + COL_DX * c) for c in range(4)]
ICON_HALF = 18
PCT_BOX = {"A": (30, 360, 430, 535), "B": (30, 300, 625, 725)}  # x0, x1, y0, y1 du pourcentage de capture
MAP_BOX = (1700, 1900, 40, 105)
PCT_PITCH = 75  # largeur d'un chiffre du pourcentage (gros), et du signe % qui suit (PCT_SIGN_W) : mesurés sur la game 26 (100 % et 65 %)
PCT_SIGN_W = 88

# --- repérage du tableau
SCAN_S = 90.0  # on cherche de end_s à end_s + SCAN_S
SCAN_FPS = 2.0
BOARD_MIN = 0.5  # médiane des corrélations des 24 icônes au-dessus de laquelle le tableau est présent (hors tableau : 0,0 à 0,2 ; dessus : 0,87 sur la game 26)
ICON_WIN = 8  # marge de recherche autour de la position attendue d'une icône

# --- lecture des chiffres
TEXT_THS = (190, 205, 175)  # seuils du canal minimal essayés dans l'ordre
MIN_SCORE_NCC = 0.70
MIN_MARGIN = 0.10
GLYPH_H, GLYPH_W = 20, 16
PITCH = 17.3  # largeur d'un chiffre en pixels (mesurée : un score de 3 chiffres fait 51 à 52 pixels, un nombre de 2 chiffres 35)
HUE_TEAM = {"A": ((4, 110, 140), (22, 255, 255)), "B": ((98, 80, 130), (118, 255, 255))}


# ---------------------------------------------------------------- modèles

def load_models(path=MODELS_PATH):
    """{'icon': image 2D ou None, 'digits': {chiffre: [vecteur]}}."""
    if not Path(path).exists():
        return {"icon": None, "digits": {}}
    data = np.load(path)
    digits = {}
    for key in data.files:
        if key.startswith("d") and key[1].isdigit():
            digits.setdefault(key[1], []).append(data[key].astype(np.float32).ravel() / 255.0)
    return {"icon": data["icon"].astype(np.float32) if "icon" in data.files else None, "digits": digits}


# ---------------------------------------------------------------- images

def to_ref(frame):
    """Image ramenée à 1920 par 1080 (la mise en page est mesurée à cette taille)."""
    if frame.shape[1] != REF_W or frame.shape[0] != REF_H:
        return cv2.resize(frame, (REF_W, REF_H), interpolation=cv2.INTER_AREA)
    return frame


def _grab(video, t):
    """Image entière à l'instant t (ffmpeg, recherche précise), ramenée à 1920 par 1080, ou None."""
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{max(t, 0):.3f}", "-i", str(video), "-frames:v", "1",
           "-vf", f"scale={REF_W}:{REF_H}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    data = subprocess.run(cmd, capture_output=True, stdin=subprocess.DEVNULL, creationflags=priority.creation_flags()).stdout
    if len(data) < REF_W * REF_H * 3:
        return None
    return np.frombuffer(data[: REF_W * REF_H * 3], np.uint8).reshape(REF_H, REF_W, 3)


# ---------------------------------------------------------------- repérage du tableau

def board_score(frame, icon):
    """Médiane des corrélations des 24 icônes K, D, A (canal minimal) : proche de 1 sur le tableau, sous 0,3 ailleurs."""
    g = frame.min(axis=2).astype(np.float32)
    scores = []
    for team_dy in (0, BLUE_DY):
        for cols in ICON_X:
            for x in cols:
                x0, y0 = int(round(x)), ICON_Y + team_dy
                win = g[y0 - ICON_HALF - ICON_WIN : y0 + ICON_HALF + ICON_WIN, x0 - ICON_HALF - ICON_WIN : x0 + ICON_HALF + ICON_WIN]
                scores.append(float(cv2.matchTemplate(win, icon, cv2.TM_CCOEFF_NORMED).max()))
    return float(np.median(scores))


def scan(video, t0, span, icon, fps=SCAN_FPS):
    """[(t, score du tableau)] de t0 à t0 + span, une seule lecture ffmpeg (image réduite aux rangées utiles)."""
    cmd = ["ffmpeg", "-v", "error", "-ss", f"{max(t0, 0):.3f}", "-t", f"{span:.1f}", "-i", str(video),
           "-vf", f"fps={fps},scale={REF_W}:{REF_H},crop={REF_W}:560:0:450", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stdin=subprocess.DEVNULL, creationflags=priority.creation_flags())
    size = REF_W * 560 * 3
    out, i = [], 0
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            strip = np.frombuffer(buf, np.uint8).reshape(560, REF_W, 3)
            full = np.zeros((REF_H, REF_W, 3), np.uint8)
            full[450:1010] = strip
            out.append((t0 + i / fps, board_score(full, icon)))
            i += 1
    finally:
        proc.stdout.close()
        proc.wait()
    return out


def runs_of(series, min_score=BOARD_MIN, max_gap_s=1.0):
    """Plages (début, fin, nombre d'images) où le tableau est présent."""
    runs = []
    for t, s in series:
        if s < min_score:
            continue
        if runs and t - runs[-1][1] <= max_gap_s + 1e-6:
            runs[-1][1] = t
            runs[-1][2] += 1
        else:
            runs.append([t, t, 1])
    return [tuple(r) for r in runs]


def find_board(video, end_s, models=None, span=SCAN_S):
    """Plage du tableau de fin de game : {'first', 'last', 'frames'} (temps de VIDÉO) ou None (vidéo coupée avant, pas de tableau)."""
    models = models or load_models()
    if models["icon"] is None:
        raise RuntimeError("modèle d'icône absent : " + str(MODELS_PATH))
    runs = runs_of(scan(video, end_s, span, models["icon"]))
    if not runs:
        return None
    first, last, n = max(runs, key=lambda r: r[2])
    return {"first": first, "last": last, "frames": n}


def sample_times(board):
    """Trois instants à l'intérieur de la plage (un quart, la moitié, les trois quarts), un seul si elle est très courte."""
    a, b = board["first"], board["last"]
    if b - a < 1.0:
        return [(a + b) / 2]
    return [a + (b - a) * k for k in (0.25, 0.5, 0.75)]


# ---------------------------------------------------------------- lecture des chiffres

def cell_box(team, col, kind):
    """(x0, x1, y0, y1) d'une case de chiffres : kind = score ou kills, deaths, assists."""
    dy = BLUE_DY if team == "B" else 0
    cx = COL_X0 + COL_DX * col
    if kind == "score":
        return int(cx - 42), int(cx + 42), SCORE_Y + dy - 16, SCORE_Y + dy + 16
    cx += KDA_DX[kind]
    return int(cx - 31), int(cx + 31), KDA_Y + dy - 17, KDA_Y + dy + 22


def text_mask(crop, team, th):
    """Pixels du texte : clairs (canal minimal au moins th) ou de la couleur de l'équipe (le joueur observé est écrit en bleu ou en orange : bleu moins rouge, ou rouge moins bleu, au moins th).
    Les deux ont la même intensité de crête (environ 210 à 225), donc le même seuil donne la même épaisseur de trait."""
    c = crop.astype(np.int16)
    white = crop.min(axis=2) >= th
    colour = ((c[:, :, 0] - c[:, :, 2]) if team == "B" else (c[:, :, 2] - c[:, :, 0])) >= th
    return white | colour


def glyphs_of(mask, min_area=12, pitch=None, by_components=False, join=3):
    """Vignettes des chiffres d'un masque, de gauche à droite, ou [] (rien, ou rien de plausible).

    La police est à chasse fixe (`PITCH` pixels par chiffre, italique : les chiffres d'un score se touchent) : on retire les petites taches, le nombre de chiffres vient de la largeur de l'encre,
    et chaque chiffre est la tranche de cette largeur (hauteur de l'encre, `GLYPH_W` par `GLYPH_H` pixels)."""
    ink = mask.astype(np.uint8)
    n, labels, stats, _ = cv2.connectedComponentsWithStats(cv2.dilate(ink, np.ones((join, join), np.uint8)), connectivity=8)  # la compression casse les traits fins : on recolle les morceaux à 2 pixels
    comps = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= min_area]
    if not comps:
        return []
    tall = max(stats[i, cv2.CC_STAT_HEIGHT] for i in comps)
    big = [i for i in comps if stats[i, cv2.CC_STAT_HEIGHT] >= 0.6 * tall]
    top = min(stats[i, cv2.CC_STAT_TOP] for i in big)
    bottom = max(stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT] for i in big)
    # on garde les morceaux de chiffre (un chiffre cassé par la compression) qui tiennent dans la bande des grandes taches, pas les taches de décor au-dessus ou au-dessous
    comps = [i for i in comps if top <= stats[i, cv2.CC_STAT_TOP] and stats[i, cv2.CC_STAT_TOP] + stats[i, cv2.CC_STAT_HEIGHT] <= bottom + 1]
    clean = np.isin(labels, comps) & (ink > 0)
    cols, rows = np.flatnonzero(clean.sum(0) > 0), np.flatnonzero(clean.sum(1) > 0)
    left, right, y0, y1 = cols.min(), cols.max() + 1, rows.min(), rows.max() + 1
    pitch = pitch or PITCH
    if by_components:  # chiffres bien séparés (gros pourcentage) : une fenêtre de `pitch` pixels centrée sur chaque tache
        centres = sorted((stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH] / 2) for i in comps)
        windows = [(int(round(c - pitch / 2)), int(round(c - pitch / 2)) + int(round(pitch))) for c in centres]
    else:
        count = int(round((right - left) / pitch))
        if count < 1 or count > 4:
            return []
        centre = (left + right) / 2
        windows = [(int(round(centre - count * pitch / 2 + k * pitch)), int(round(centre - count * pitch / 2 + k * pitch)) + int(round(pitch))) for k in range(count)]
    out = []
    for xa, xb in windows:
        piece = np.zeros((y1 - y0, xb - xa), np.uint8)
        src = clean[y0:y1, max(xa, 0) : min(xb, clean.shape[1])].astype(np.uint8) * 255
        piece[:, max(-xa, 0) : max(-xa, 0) + src.shape[1]] = src
        out.append(cv2.resize(piece, (GLYPH_W, GLYPH_H), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0)
    return out


def _ncc(a, b):
    a, b = a - a.mean(), b - b.mean()
    d = np.linalg.norm(a) * np.linalg.norm(b)
    return float(a @ b / d) if d else -1.0


def classify(glyph, digits):
    """(chiffre, corrélation) si la lecture est sûre (corrélation et marge suffisantes), sinon None."""
    v = glyph.ravel()
    scored = sorted(((max(_ncc(v, t) for t in ts), d) for d, ts in digits.items()), reverse=True)
    if not scored or scored[0][0] < MIN_SCORE_NCC:
        return None
    if len(scored) > 1 and scored[0][0] - scored[1][0] < MIN_MARGIN:
        return None
    return scored[0][1], scored[0][0]


def read_number(frame, box, team, digits, max_digits, step25=False):
    """Entier lu dans la case, ou None (n/d). Plusieurs seuils essayés : la lecture sûre dont le chiffre le moins sûr est le plus sûr l'emporte."""
    x0, x1, y0, y1 = box
    crop = frame[y0:y1, x0:x1]
    best = None  # (confiance, valeur) : la lecture dont le chiffre le moins sûr l'est le plus
    for th in TEXT_THS:
        gl = glyphs_of(text_mask(crop, team, th))
        if not gl or len(gl) > max_digits:
            continue
        got = [classify(g, digits) for g in gl]
        if any(g is None for g in got):
            continue
        value = int("".join(d for d, _ in got))
        if step25 and value % 25:
            continue  # en domination un score est toujours un multiple de 25 : sinon c'est une erreur de lecture
        confidence = min(c for _, c in got)
        if best is None or confidence > best[0]:
            best = (confidence, value)
    return None if best is None else best[1]


def read_cells(frame, models, step25=True):
    """{(équipe, colonne): {'kills', 'deaths', 'assists', 'score'}} d'une image (valeur ou None)."""
    out = {}
    for team in ("A", "B"):
        for col in range(4):
            cell = {}
            for kind in ("kills", "deaths", "assists"):
                cell[kind] = read_number(frame, cell_box(team, col, kind), team, models["digits"], 2)
            cell["score"] = read_number(frame, cell_box(team, col, "score"), team, models["digits"], 4, step25=step25)
            out[(team, col)] = cell
    return out


def vote_cells(readings):
    """Valeur retenue par case sur plusieurs images : les lectures sûres doivent toutes s'accorder, sinon None."""
    out = {}
    for key in readings[0]:
        cell = {}
        for kind in readings[0][key]:
            vals = {r[key][kind] for r in readings if r[key][kind] is not None}
            cell[kind] = vals.pop() if len(vals) == 1 else None
        out[key] = cell
    return out


def _digit_examples(frame, truth, pct_truth, digits):
    """Ajoute à `digits` {chiffre: [vignette]} les chiffres d'une image dont on connaît la vérité (cases dont le nombre de taches égale le nombre de chiffres)."""
    for (team, col), cell in truth.items():
        for kind, value in cell.items():
            x0, x1, y0, y1 = cell_box(team, col, kind)
            gl = glyphs_of(text_mask(frame[y0:y1, x0:x1], team, TEXT_THS[0]))
            text = str(value)
            if len(gl) != len(text):
                continue
            for d, g in zip(text, gl):
                digits.setdefault(d, []).append((g * 255).astype(np.uint8))
    for team, value in (pct_truth or {}).items():  # gros chiffres du pourcentage de capture (vérité : {équipe: valeur})
        mask = _pct_digit_mask(frame, team)
        gl = [] if mask is None else glyphs_of(mask, min_area=200, pitch=PCT_PITCH, by_components=True, join=3)
        if len(gl) == len(str(value)):
            for d, g in zip(str(value), gl):
                digits.setdefault(d, []).append((g * 255).astype(np.uint8))


def _brightest_icon(frame):
    """Icône K la plus claire des 8 colonnes (celle d'un joueur observé est colorée, donc sombre dans le canal minimal : jamais le modèle)."""
    g = frame.min(axis=2)
    crops = []
    for team_dy in (0, BLUE_DY):
        for cols in ICON_X:
            x, y = int(round(cols[0])), ICON_Y + team_dy
            crops.append(g[y - ICON_HALF : y + ICON_HALF, x - ICON_HALF : x + ICON_HALF])
    return max(crops, key=lambda c: float(c.mean()))


def learn_models(items, path=MODELS_PATH):
    """Crée les modèles à partir d'images de tableau dont la vérité est connue (vue à l'œil) : items = [(image, truth, pct_truth)] avec truth = {(équipe, colonne): {'kills', 'deaths', 'assists', 'score'}}
    et pct_truth = {équipe: pourcentage} ou None. Les exemplaires presque identiques (corrélation de 0,98 ou plus) ne sont gardés qu'une fois ; ajoute l'icône K la plus claire de la première image.
    Renvoie le nombre d'exemplaires par chiffre."""
    digits = {}
    for frame, truth, pct_truth in items:
        _digit_examples(frame, truth, pct_truth, digits)
    arrays = {}
    arrays["icon"] = _brightest_icon(items[0][0])
    counts = {}
    for d, examples in sorted(digits.items()):
        kept = []
        for g in examples:
            v = g.astype(np.float32).ravel() / 255.0
            if all(_ncc(v, k.astype(np.float32).ravel() / 255.0) < 0.98 for k in kept):
                kept.append(g)
        counts[d] = len(kept)
        for i, g in enumerate(kept):
            arrays[f"d{d}_{i:02d}"] = g
    np.savez_compressed(path, **arrays)
    return counts


# ---------------------------------------------------------------- pseudos

def name_box(team, col):
    dy = BLUE_DY if team == "B" else 0
    cx = COL_X0 + COL_DX * col
    return int(cx - 126), int(cx + 126), NAME_Y + dy - 18, NAME_Y + dy + 26


OCR_VARIANTS = ("mask0", "hue", "top")  # trois présentations du même nom à la reconnaissance de texte : les erreurs ne sont pas les mêmes, on garde la meilleure correspondance (mesuré sur 13 games : rattachement possible pour 26 équipes sur 26, 19 sur 26 avec la seule image brute)
TOP_ROWS = 32  # « top » : seulement la première ligne du pseudo (un pseudo long passe sur deux lignes, la seconde brouille la lecture)


def _variant(crop, team, kind):
    """Zone de texte agrandie : « mask0 » texte seul en noir sur blanc (pixels clairs ou de la couleur de l'équipe), « hue » texte clair ou de la couleur de l'équipe en niveaux de gris inversés (le joueur
    observé est écrit en bleu ou en orange), « top » couleurs d'origine de la première ligne, « raw » couleurs d'origine (zone de la carte)."""
    if kind == "mask0":
        return cv2.resize((255 - text_mask(crop, team, 185).astype(np.uint8) * 255), None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    if kind == "hue":
        b, g, r = (crop[:, :, i].astype(int) for i in range(3))
        colour = (b - r) if team == "B" else (r - b)
        ink = np.maximum(np.clip(colour * 2, 0, 255), np.clip((crop.min(axis=2).astype(int) - 150) * 3, 0, 255))
        return cv2.resize((255 - ink).astype(np.uint8), None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    if kind == "top":
        return cv2.resize(crop[:TOP_ROWS], None, fx=4, fy=4, interpolation=cv2.INTER_CUBIC)
    return cv2.resize(crop, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)


def read_texts(frame, ocr_module=None):
    """({(équipe, colonne): [textes normalisés, un par présentation]}, texte normalisé de la zone « carte »), par la reconnaissance de texte de Windows (un lot par présentation)."""
    if ocr_module is None:
        import ocr as ocr_module
    out = {(team, col): [] for team in ("A", "B") for col in range(4)}
    map_text = ""
    with tempfile.TemporaryDirectory() as tmp:
        for kind in OCR_VARIANTS:
            files = {}
            for team in ("A", "B"):
                for col in range(4):
                    x0, x1, y0, y1 = name_box(team, col)
                    files[(team, col)] = _save(tmp, f"{kind}_{team}{col}", _variant(frame[y0:y1, x0:x1], team, kind))
            if kind == OCR_VARIANTS[0]:
                x0, x1, y0, y1 = MAP_BOX
                files["map"] = _save(tmp, "map", _variant(frame[y0:y1, x0:x1], "A", "raw"))
            results = ocr_module.read_images(list(files.values()))
            for key, path in files.items():
                lines = sorted(results.get(path, []), key=lambda ln: ln["y"])
                text = names.normalize("".join(ln["text"] for ln in lines))
                if key == "map":
                    map_text = text
                else:
                    out[key].append(text)
    return out, map_text


def _save(tmp, label, img):
    path = Path(tmp) / f"{label}.png"
    cv2.imwrite(str(path), img)
    return str(path)


def _pct_digit_mask(frame, team):
    """Masque des seuls chiffres du pourcentage : le signe % (environ `PCT_SIGN_W` pixels de large, une à trois taches) occupe la fin de l'encre, on le retire."""
    x0, x1, y0, y1 = PCT_BOX[team]
    lo, hi = HUE_TEAM[team]
    mask = cv2.inRange(cv2.cvtColor(frame[y0:y1, x0:x1], cv2.COLOR_BGR2HSV), np.array(lo), np.array(hi)) > 0
    n, _, stats, _ = cv2.connectedComponentsWithStats(cv2.dilate(mask.astype(np.uint8), np.ones((3, 3), np.uint8)), connectivity=8)
    boxes = [(stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_LEFT] + stats[i, cv2.CC_STAT_WIDTH]) for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= 200]
    if not boxes:
        return None
    right = max(r for _, r in boxes)
    sign = [l for l, _ in boxes if l >= right - PCT_SIGN_W - 12]
    digits_n = len(boxes) - len(sign)
    if not sign or digits_n < 1 or digits_n > 3:
        return None
    mask = mask.copy()
    mask[:, min(sign) - 2 :] = False
    return mask


def read_pct(frame, team, digits):
    """Pourcentage de capture de l'équipe (0 à 100) lu à gauche du tableau (gros chiffres de la couleur de l'équipe, signe % retiré), ou None."""
    mask = _pct_digit_mask(frame, team)
    if mask is None:
        return None
    gl = glyphs_of(mask, min_area=200, pitch=PCT_PITCH, by_components=True, join=3)
    got = [classify(g, digits) for g in gl]
    if not gl or any(g is None for g in got):
        return None
    value = int("".join(d for d, _ in got))
    return value if 0 <= value <= 100 else None


def name_cost(read, known):
    """Distance relative (0 = identique) entre un nom lu (texte, ou liste de lectures : la meilleure compte) et un pseudo de la base ; le nom de la base peut être tronqué."""
    reads = [read] if isinstance(read, str) else list(read)
    n = names.normalize(known)
    costs = []
    for r in reads:
        q = names.normalize(r)
        if not q or not n:
            continue
        d = min(names.soft_distance(q, n), names.soft_distance(q[: len(n)], n), names.soft_distance(q, n[: len(q)]) + 1)
        costs.append(d / max(len(n), len(q), 1))
    return min(costs) if costs else 0.6


def _readable(read):
    return any(names.normalize(r) for r in ([read] if isinstance(read, str) else read))


def best_read(reads, known):
    """La lecture de pseudo la plus proche du pseudo de la base (pour garder une trace lisible), ou '' si aucune."""
    reads = [r for r in reads if r]
    return min(reads, key=lambda r: name_cost(r, known)) if reads else ""


def assign_slots(reads, known, team, margin=0.1, max_cost=0.5):
    """Rattache les 4 colonnes d'une équipe à ses 4 slots : {colonne: slot} (permutation de coût minimal), ou {} si deux permutations se valent ou si un nom colle mal.

    reads : {colonne: texte lu}, known : {slot: pseudo de la base}."""
    slots = (1, 2, 3, 4) if team == "A" else (5, 6, 7, 8)
    slots = [s for s in slots if s in known]
    cols = sorted(reads)
    if len(slots) < len(cols):
        cols = cols[: len(slots)]
    scored = []
    for perm in itertools.permutations(slots, len(cols)):
        costs = [name_cost(reads[c], known[s]) for c, s in zip(cols, perm)]
        scored.append((sum(costs), perm, costs))
    if not scored:
        return {}
    scored.sort(key=lambda r: r[0])
    best = scored[0]
    if len(scored) > 1 and scored[1][0] - best[0] < margin:
        return {}
    if any(cost > max_cost for c, cost in zip(cols, best[2]) if _readable(reads[c])):  # un nom illisible n'est jamais refusé, il est trouvé par élimination
        return {}
    return dict(zip(cols, best[1]))


# ---------------------------------------------------------------- tableau d'une game

def read_board(video, game, known, models=None, ocr_module=None):
    """Lit le tableau d'une game. Renvoie {'board': plage, 't': instant, 'rows': [...], 'reads': {...}} ou None sans tableau.

    rows : une ligne par joueur rattaché à un slot (valeurs None = n/d)."""
    models = models or load_models()
    board = find_board(video, game["end_s"], models)
    if board is None:
        return None
    frames = [f for f in (_grab(video, t) for t in sample_times(board)) if f is not None]
    if not frames:
        return None
    step25 = names.normalize(game.get("map") or "") != "OUTLAW"  # le score de la carte à un point (Outlaw) n'est pas un multiple de 25
    cells = vote_cells([read_cells(f, models, step25) for f in frames])
    mid = frames[len(frames) // 2]
    reads, map_read = read_texts(mid, ocr_module)
    pct = {team: read_pct(mid, team, models["digits"]) for team in ("A", "B")}
    rows = []
    for team in ("A", "B"):
        assign = assign_slots({c: reads[(team, c)] for c in range(4)}, known, team)
        for col, slot in assign.items():
            rows.append({"slot": slot, "name_read": best_read(reads[(team, col)], known[slot]), "team": team, "col": col, **cells[(team, col)]})
    return {"board": board, "t": sample_times(board)[len(frames) // 2], "rows": rows, "reads": reads, "cells": cells, "pct": pct, "map_read": map_read, "map": game.get("map")}


def _video_of(conn, game_id):
    row = conn.execute("SELECT g.start_s, g.end_s, g.map, v.path FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (game_id,)).fetchone()
    return dict(row) if row else None


KNOWN_MAPS = ("POLARIS", "ATLANTIS", "ENGINE", "SILVA", "CERES", "REEFPOINT", "OUTLAW", "THECLIFF", "ARTEFACT", "HELIOSSTATION")


def _contains(text, word):
    return any(names.levenshtein(text[i : i + len(word)], word) <= 1 for i in range(0, max(len(text) - len(word), 0) + 1))


def map_matches(read, expected):
    """Faux seulement si le texte lu en haut à droite (« Polaris Domination ») est celui d'une AUTRE carte connue et pas de la carte de la game (un texte illisible ou en français, « Outlaw Point stratégique », ne refuse rien)."""
    q, e = names.normalize(read or ""), names.normalize(expected or "")
    if not q or not e:
        return True
    if _contains(q, e):
        return True
    return not any(_contains(q, m) for m in KNOWN_MAPS if m != e)


def _known_names(conn, game_id):
    return {r["slot"]: r["name"] for r in conn.execute("SELECT slot, name FROM players WHERE game_id = ?", (game_id,)) if r["name"]}


def compute(conn, game_id, result=None):
    """Efface puis réécrit les lignes `scoreboard` de la game ; renvoie leur nombre. Sans vidéo ni tableau : 0 (rien d'effacé). `result` : lecture déjà faite (tests)."""
    if result is None:
        game = _video_of(conn, game_id)
        if game is None or not Path(game["path"]).exists():
            print(json.dumps({"game": game_id, "scoreboard": "vidéo absente"}, ensure_ascii=False), file=sys.stderr)
            return 0
        known = _known_names(conn, game_id)
        if len(known) < 4:
            print(json.dumps({"game": game_id, "scoreboard": "pseudos de la game inconnus"}, ensure_ascii=False), file=sys.stderr)
            return 0
        try:
            result = read_board(game["path"], game, known)
        except (RuntimeError, OSError) as exc:  # reconnaissance de texte ou modèle absents : pas d'erreur pour le reste du calcul
            print(json.dumps({"game": game_id, "scoreboard": "lecture impossible : %s" % exc}, ensure_ascii=False), file=sys.stderr)
            return 0
        if result is None:
            print(json.dumps({"game": game_id, "scoreboard": "pas de tableau après la game"}, ensure_ascii=False), file=sys.stderr)
            return 0
    if not map_matches(result.get("map_read"), result.get("map")):
        print(json.dumps({"game": game_id, "scoreboard": "la carte lue (%s) n'est pas celle de la game (%s) : tableau ignoré" % (result.get("map_read"), result.get("map"))}, ensure_ascii=False), file=sys.stderr)
        return 0
    if not result["rows"]:
        print(json.dumps({"game": game_id, "scoreboard": "aucun pseudo du tableau rattaché à un joueur : rien écrit"}, ensure_ascii=False), file=sys.stderr)
        return 0
    conn.execute("DELETE FROM scoreboard WHERE game_id = ?", (game_id,))
    for r in result["rows"]:
        conn.execute(
            "INSERT INTO scoreboard (game_id, slot, kills, deaths, assists, score, name_read, t_video, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (game_id, r["slot"], r["kills"], r["deaths"], r["assists"], r["score"], r["name_read"], result["t"], "ecran_de_fin"),
        )
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, MODULE, REVISION))
    conn.commit()
    return len(result["rows"])


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Lit le tableau de fin de game.")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--store", action="store_true", help="écrit la table scoreboard (sans cela, affiche seulement)")
    parser.add_argument("--probe", action="store_true", help="donne seulement la plage du tableau après la fin de la game")
    parser.add_argument("--db", default=str(paths.db_path()))
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    game = _video_of(conn, args.game)
    if game is None:
        print("game inconnue", file=sys.stderr)
        return 1
    if not Path(game["path"]).exists():
        print("vidéo absente : " + game["path"], file=sys.stderr)
        return 1
    if args.probe:
        b = find_board(game["path"], game["end_s"])
        print(json.dumps({"game": args.game, "end_s": game["end_s"], "board": b and {**b, "offset_s": round(b["first"] - game["end_s"], 2), "duree_s": round(b["last"] - b["first"], 2)}}, ensure_ascii=False))
        return 0
    result = read_board(game["path"], game, _known_names(conn, args.game))
    if result is None:
        print(json.dumps({"game": args.game, "scoreboard": "pas de tableau après la game"}, ensure_ascii=False))
        return 0
    print(json.dumps({"game": args.game, "t": result["t"], "board": result["board"], "rows": result["rows"]}, ensure_ascii=False, default=str))
    if args.store:
        print(json.dumps({"game": args.game, "lignes": compute(conn, args.game, result)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
