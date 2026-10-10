"""Killfeed (haut droite de l'écran) : qui a tué qui, quand, avec quelle arme.

Chaque entrée est une ligne : le pseudo du tueur (texte coloré à la couleur de son équipe, sur une pastille grise), l'icône de
l'arme, puis le pseudo de la victime. Les lignes s'empilent vers le bas et durent quelques secondes.

Principe : on découpe chaque ligne en segments de texte coloré (tueur, victime) et l'icône entre les deux, on lit les deux pseudos par
reconnaissance de texte (ocr.py) et on les rattache à l'un des 8 joueurs de la game par comparaison tolérante (names.closest).
Un même kill est vu sur plusieurs images : on ne garde que son apparition.
"""

import hashlib
import itertools
import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

import names as names_mod
import ocr
import weapons

REGION = {"x": 0.78, "y": 0.19, "w": 0.22, "h": 0.30}  # zone du killfeed (relative à l'image)
RIGHT_EDGE = 0.88  # part de la largeur de la zone à partir de laquelle une ligne du killfeed se termine
SCAN_STEP_S = 0.5  # une lecture toutes les 0,5 s (une entrée reste affichée plusieurs secondes)
ORANGE = ((4, 110, 140), (22, 255, 255))
BLUE = ((98, 80, 130), (116, 255, 255))
MIN_ROW_PIXELS = 25  # pixels colorés minimum pour qu'une ligne existe
NAME_GAP_PX = 16  # trou horizontal qui sépare deux segments de texte (le trou de l'icône est plus large)
MIN_OBSERVATIONS = 2  # une entrée reste affichée plusieurs secondes : vue sur une seule image, elle doit être lue très nettement
CLEAR_READ = 0.22  # distance relative maximale du pseudo de la victime pour accepter une entrée vue une seule fois
REVISION = 4  # version de la lecture du killfeed (1 : texte seul ; 2 : + reconnaissance des pseudos par leur aspect ; 3 : + mort de la victime confirmée sur son bandeau) : les kills lus avec une version plus ancienne sont relus
APPEARANCE_OVERRIDES = 0.25  # une lecture de texte plus mauvaise que cela est remplacée par la reconnaissance par l'aspect
APPEARANCE_DISTANCE = 0.30  # distance donnée à un pseudo reconnu par son aspect (plus que CLEAR_READ : une entrée vue une seule fois ne passe pas pour autant)
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
        # Les lignes du killfeed finissent toutes au bord droit : un texte coloré ailleurs (pseudo flottant dans le décor) n'en est pas une.
        if not segments or segments[-1]["x1"] < RIGHT_EDGE * len(cols):
            continue
        # Une ligne sans tueur (mort du décor, action d'un admin) n'a qu'un seul pseudo. S'il y a du texte en trop à gauche, seuls les
        # deux derniers segments (tueur, victime) comptent.
        out.append({"y0": y0, "y1": y1, "segments": segments[-2:]})
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


def split_icon(icon):
    """Icône binaire du milieu de la ligne -> (arme, headshot).

    Un tir à la tête ajoute une petite cible (anneau d'environ 16 x 16 px) à droite de l'arme. Elle est retirée de l'icône pour ne pas
    fausser la reconnaissance de l'arme. Les icônes rondes (grenade) n'ont pas cette forme et ne sont pas confondues avec elle."""
    if icon is None:
        return None, False
    n, labels, stats, _ = cv2.connectedComponentsWithStats((icon > 0).astype(np.uint8))
    comps = [(stats[i, 0], stats[i, 1], stats[i, 2], stats[i, 3], stats[i, 4], i) for i in range(1, n) if stats[i, 4] >= 6]
    if len(comps) < 2:
        return icon, False
    comps.sort()
    x, y, w, h, area, idx = max(comps, key=lambda c: c[0] + c[2])  # composante la plus à droite
    others = [c for c in comps if c[5] != idx and c[0] + c[2] <= x + 2 and c[4] >= 40]
    if 12 <= w <= 20 and 12 <= h <= 20 and abs(w - h) <= 3 and others:
        weapon = icon.copy()
        weapon[:, max(x - 1, 0):] = 0  # retire la cible et son point central
        return weapon, True
    return icon, False


def _icon_image(crop, row):
    a, b = row["segments"][0], row["segments"][-1]
    y0, y1 = row["y0"], row["y1"]
    x0, x1 = a["x1"] + 2, b["x0"] - 1
    if x1 - x0 < 8:
        return None
    piece = crop[max(y0 - 2, 0) : y1 + 2, x0:x1]
    gray = cv2.cvtColor(piece, cv2.COLOR_BGR2GRAY)
    return (gray > 170).astype(np.uint8) * 255, np.clip(gray.astype(np.int16) - int(np.median(gray)), 0, 255).astype(np.uint8)


MIN_ICON_PIXELS = 40  # une arme fait au moins cela de pixels clairs une fois nettoyée
MIN_ICON_FILL = 0.12  # part de la boîte occupée par l'icône : en dessous, ce sont des fragments épars (décor clair, ligne qui s'efface)


def clean_icon(mask):
    """Retire les pixels isolés (décor clair, bord d'une autre ligne) : on garde les amas d'au moins 10 % du plus gros."""
    n, lab, stats, _ = cv2.connectedComponentsWithStats((mask > 0).astype(np.uint8))
    if n <= 1:
        return np.zeros_like(mask)
    biggest = stats[1:, cv2.CC_STAT_AREA].max()
    keep = [i for i in range(1, n) if stats[i, cv2.CC_STAT_AREA] >= max(6, 0.1 * biggest)]
    return (np.isin(lab, keep).astype(np.uint8)) * 255


def icon_is_reliable(mask):
    """Vrai si la forme ressemble à une arme (assez grosse, assez pleine) et non à des fragments."""
    ys, xs = np.nonzero(mask)
    if xs.size < MIN_ICON_PIXELS:
        return False
    box = (xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1)
    return xs.size / box >= MIN_ICON_FILL


def consensus_icon(reads):
    """Icône d'un kill à partir de toutes ses lectures [(masque, relief)] : on garde les lectures de la taille la plus fréquente (la
    même entrée reste affichée plusieurs secondes, ses pixels tombent aux mêmes endroits) et on vote pixel par pixel. Renvoie
    (masque nettoyé, relief moyen, nombre de lectures retenues) ou (None, None, 0)."""
    reads = [r for r in reads if r is not None]
    if not reads:
        return None, None, 0
    sizes = {}
    for mask, _ in reads:
        sizes[mask.shape] = sizes.get(mask.shape, 0) + 1
    shape = max(sizes, key=sizes.get)
    kept = [r for r in reads if r[0].shape == shape]
    vote = np.mean([(m > 0).astype(np.float32) for m, _ in kept], axis=0)
    tone = np.mean([t.astype(np.float32) for _, t in kept], axis=0).astype(np.uint8)
    return clean_icon((vote >= 0.5).astype(np.uint8) * 255), tone, len(kept)


def _grab(video, t, width, height):
    x, y = round(REGION["x"] * width), round(REGION["y"] * height)
    w, h = round(REGION["w"] * width) // 2 * 2, round(REGION["h"] * height) // 2 * 2
    cmd = [
        "ffmpeg", "-v", "error", "-ss", f"{max(t, 0):.2f}", "-i", str(video),
        "-frames:v", "1", "-vf", f"crop={w}:{h}:{x}:{y}", "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    data = subprocess.run(cmd, capture_output=True, stdin=subprocess.DEVNULL).stdout
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
    proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
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


# ---------- reconnaissance des pseudos par leur aspect ----------
# La lecture de texte échoue sur certaines vidéos (pseudo du tueur sur une pastille grise translucide : 7 tueurs lus sur 61 kills), alors que le pseudo se
# répète des dizaines de fois par game avec exactement le même aspect. On regroupe donc les segments qui se ressemblent (par équipe, il y a 4 gros groupes :
# les 4 joueurs), on donne à chaque groupe son joueur par vote pondéré de TOUTES les lectures de texte du groupe (même mauvaises) et par cohérence (chaque joueur
# une fois), puis on rattache les segments isolés au groupe le plus proche. Mesuré sur 3 games : 100 % de précision sur des lectures sûres cachées,
# 73 % des observations de tueurs lues au lieu de 4,5 %.
TEXT_HUE = {"A": (3, 24), "B": (96, 120)}  # teinte du texte orange et du texte bleu
TEXT_SIZE = (96, 16)
GROUP_LINK = 0.90  # ressemblance (corrélation des masques) à partir de laquelle deux segments sont le même pseudo
ATTACH_MIN = 0.70  # ressemblance minimale d'un segment isolé avec le groupe d'un joueur
ATTACH_MARGIN = 0.04  # et avance minimale sur le deuxième groupe
MIN_GROUP = 6  # un groupe de moins de segments n'est pas un joueur
VOTE_MARGIN = 0.12  # avance minimale (en poids de lectures) de l'affectation retenue sur toute autre pour étiqueter un groupe
TEAM_SLOTS = {"A": (1, 2, 3, 4), "B": (5, 6, 7, 8)}


def text_mask(piece, team):
    """Masque normalisé (vecteur) du texte coloré d'un segment : pixels de la teinte de l'équipe, saturés par rapport au texte lui-même (le fond de la pastille,
    noir ou gris, est peu saturé). None si le segment n'a pas de texte exploitable."""
    big = cv2.resize(piece, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    hsv = cv2.cvtColor(big, cv2.COLOR_BGR2HSV)
    lo, hi = TEXT_HUE[team]
    hue_ok = (hsv[:, :, 0] >= lo) & (hsv[:, :, 0] <= hi)
    if hue_ok.sum() < 30:
        return None
    sat = hsv[:, :, 1].astype(np.float32)
    thr = max(60.0, 0.55 * float(np.percentile(sat[hue_ok], 95)))
    mask = (hue_ok & (sat >= thr) & (hsv[:, :, 2] >= 90)).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask)
    keep = np.zeros_like(mask)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= 12 and stats[i, cv2.CC_STAT_HEIGHT] >= 0.125 * mask.shape[0]:
            keep[lab == i] = 1
    cols, rows = np.flatnonzero(keep.sum(axis=0)), np.flatnonzero(keep.sum(axis=1))
    if cols.size < 30 or rows.size < 12:
        return None
    keep = keep[rows[0] : rows[-1] + 1, cols[0] : cols[-1] + 1]
    return cv2.GaussianBlur(cv2.resize(keep.astype(np.float32), TEXT_SIZE, interpolation=cv2.INTER_AREA), (0, 0), 0.8).ravel()


def _unit(v):
    v = v - v.mean()
    return v / max(float(np.linalg.norm(v)), 1e-9)


def group_segments(vecs, link=GROUP_LINK):
    """vecs : {signature: masque}. Groupes de segments qui se ressemblent (lien simple au-dessus de `link`)."""
    sigs = list(vecs)
    if not sigs:
        return []
    unit = np.array([_unit(vecs[sig]) for sig in sigs])
    similar = np.triu(unit @ unit.T >= link, 1)
    parent = list(range(len(sigs)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, j in zip(*np.nonzero(similar)):
        parent[find(i)] = find(j)
    groups = {}
    for i, sig in enumerate(sigs):
        groups.setdefault(find(i), []).append(sig)
    return list(groups.values())


def label_groups(groups, ocr, team):
    """Joueur de chacun des 4 plus gros groupes de l'équipe : l'affectation groupes -> joueurs (chaque joueur au plus une fois) qui totalise le plus de poids de
    lectures de texte (poids = 0,40 moins la distance de lecture). Un groupe n'est étiqueté que si son affectation bat nettement toute autre.
    ocr : {signature: (joueur ou None, distance)}. Renvoie ([groupes retenus], {indice du groupe: joueur})."""
    big = [g for g in sorted(groups, key=len, reverse=True)[:4] if len(g) >= MIN_GROUP]
    slots = TEAM_SLOTS[team]
    weight = [[sum(max(0.0, 0.40 - (ocr.get(sig, (None, 1.0))[1] or 1.0)) for sig in g if ocr.get(sig, (None, None))[0] == slot) for slot in slots] for g in big]
    total = lambda perm: sum(weight[i][perm[i]] for i in range(len(big)))
    ranked = sorted(itertools.permutations(range(len(slots)), len(big)), key=total, reverse=True)
    if not ranked:
        return big, {}
    best, out = ranked[0], {}
    for i in range(len(big)):
        rival = max((total(p) for p in ranked if p[i] != best[i]), default=0.0)
        if total(best) - rival >= VOTE_MARGIN:
            out[i] = slots[best[i]]
    return big, out


def resolve_by_appearance(pieces, team_of, ocr):
    """Joueur de chaque segment du killfeed, d'après son aspect. pieces : {signature: morceau d'écran}, team_of : {signature: équipe},
    ocr : {signature: (joueur ou None, distance)}. Renvoie {signature: joueur}. Ne renvoie que ce qui est sûr (groupe étiqueté, rattachement net)."""
    out = {}
    for team in ("A", "B"):
        vecs = {}
        for sig, piece in pieces.items():
            if team_of.get(sig) == team:
                mask = text_mask(piece, team)
                if mask is not None:
                    vecs[sig] = mask
        big, labels = label_groups(group_segments(vecs), ocr, team)
        centers = {labels[i]: _unit(np.mean([vecs[sig] for sig in g], axis=0)) for i, g in enumerate(big) if i in labels}
        for sig, vec in vecs.items():
            ranked = sorted(((float(_unit(vec) @ c), slot) for slot, c in centers.items()), reverse=True)
            if ranked and ranked[0][0] >= ATTACH_MIN and (len(ranked) < 2 or ranked[0][0] - ranked[1][0] >= ATTACH_MARGIN):
                out[sig] = ranked[0][1]
    return out


def _fingerprint(img):
    small = cv2.resize(img, (32, 8), interpolation=cv2.INTER_AREA)
    return hashlib.md5((small // 24).tobytes()).hexdigest()


def read_events(video, game, players, width, height, step_s=SCAN_STEP_S, wait=None, emit=None):
    """Kills d'une game : [{"t", "killer", "victim", "killer_team", "victim_team", "weapon", "headshot", "kind"}]. players : {slot: pseudo}.

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
            alone = len(row["segments"]) == 1  # ligne sans pastille de tueur
            ka, kb = _segment_image(crop, row, a), _segment_image(crop, row, b)
            sa, sb = _fingerprint(ka), _fingerprint(kb)
            images.setdefault(sa, ka)
            images.setdefault(sb, kb)
            pieces.setdefault(sa, _segment_piece(crop, row, a))
            pieces.setdefault(sb, _segment_piece(crop, row, b))
            observations.append({"t": t, "killer_sig": None if alone else sa, "victim_sig": sb, "killer_team": None if alone else a["team"], "victim_team": b["team"], "icon": None if alone else _icon_image(crop, row), "alone": alone})
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
        if o["killer_sig"]:
            team_of[o["killer_sig"]] = o["killer_team"]
        team_of[o["victim_sig"]] = o["victim_team"]
    scored = {sig: names_mod.closest_scored(text, players, team_of.get(sig)) for sig, text in text_of.items()}
    resolved = {sig: slot for sig, (slot, _) in scored.items()}
    distance = {sig: d for sig, (_, d) in scored.items()}
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
                slot, d = names_mod.closest_scored(text, players, team_of.get(sig))
                if slot is not None:
                    resolved[sig], distance[sig] = slot, d
                    break
    # Pseudos que la lecture de texte n'a pas su lire (ou lus avec une mauvaise distance) : reconnus par leur aspect.
    seen = resolve_by_appearance(pieces, team_of, {sig: (resolved[sig], distance.get(sig)) for sig in resolved})
    for sig, slot in seen.items():
        if resolved.get(sig) is None or (distance.get(sig) or 0.0) > APPEARANCE_OVERRIDES:
            resolved[sig], distance[sig] = slot, APPEARANCE_DISTANCE
    reads = []
    for o in observations:
        killer = resolved.get(o["killer_sig"]) if o["killer_sig"] else None
        victim = resolved.get(o["victim_sig"])
        if victim is not None:
            reads.append({**o, "killer": killer, "victim": victim, "vdist": distance.get(o["victim_sig"], 1.0)})
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
            ev["seen"] += 1
            ev["vdist"] = min(ev["vdist"], r["vdist"])
            ev["alone"] = ev["alone"] and r["alone"]
        else:
            ev = {"t": r["t"], "last": r["t"], "victim": r["victim"], "victim_team": r["victim_team"], "killer_team": r["killer_team"], "killers": [r["killer"]], "icons": [r["icon"]], "alone": r["alone"], "seen": 1, "vdist": r["vdist"]}
            open_by_victim[r["victim"]] = ev
            events.append(ev)
    out = []
    for ev in (e for e in events if e["seen"] >= MIN_OBSERVATIONS or e["vdist"] <= CLEAR_READ):
        known = [k for k in ev["killers"] if k is not None]
        killer = max(set(known), key=known.count) if known else None
        icons = [i for i in ev["icons"] if i is not None]
        heads = [split_icon(mask)[1] for mask, _ in icons]
        # L'arme n'est plus lue sur l'icône du killfeed (trop petite, trop sale) : elle vient du bandeau du tueur (analyze.kill_weapon).
        # L'icône ne sert qu'à reconnaître le logo de grenade, compact : toutes les lectures du kill votent ensemble.
        grenade = False
        mask, _, _ = consensus_icon(icons)
        if mask is not None:
            shape, _ = split_icon(mask)
            if shape is not None:
                shape = clean_icon(shape)
                grenade = icon_is_reliable(shape) and weapons.is_grenade_shape(shape)
        # Tueur illisible : l'icône de l'arme, si elle ressemble à un modèle connu, aide à le retrouver par déduction (analyze.infer_killers).
        hint = None
        if killer is None and not ev["alone"] and not grenade:
            for mask, _ in icons[len(icons) // 2 :] + icons[: len(icons) // 2]:
                shape, _ = split_icon(mask)
                if hint is None and shape is not None:
                    hint = weapons.identify(shape, create=False)
        kind = "environment" if ev["alone"] else ("unknown" if killer is None else ("suicide" if killer == ev["victim"] else "kill"))
        out.append({"t": ev["t"], "kind": kind, "killer": killer, "victim": ev["victim"], "killer_team": ev["killer_team"], "victim_team": ev["victim_team"], "weapon": None, "grenade": grenade, "hint": hint, "headshot": sum(heads) * 2 > len(heads) if heads else False})
    return out
