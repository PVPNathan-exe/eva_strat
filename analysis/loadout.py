"""Équipement de chaque joueur lu sur les bandeaux : deux armes et un gadget (trois petites icônes sous le pseudo).

L'arme tenue est dessinée en noir, l'autre en pâle : dans les deux cas c'est la même forme, qu'on isole du fond du bandeau (couleur
d'équipe, ou gris quand le joueur est mort). L'équipement ne change pas pendant une game : on moyenne plusieurs images pour obtenir
une forme propre, puis on la compare à des modèles (weapons.py, préfixes B pour les armes et G pour les gadgets).
"""

import cv2
import numpy as np

import weapons

# Boîtes des icônes dans un bandeau (fractions de sa largeur et de sa hauteur) : x0, x1, y0, y1
BOXES = {"arme1": (0.30, 0.54, 0.33, 0.50), "arme2": (0.53, 0.80, 0.33, 0.50), "gadget": (0.80, 0.96, 0.33, 0.50)}
PREFIX = {"arme1": "B", "arme2": "B", "gadget": "G"}
KEEP_SHARE = 0.5  # un pixel fait partie de la forme s'il l'est sur au moins la moitié des images
MIN_AREA = 30


def _dark(piece):
    """Relief de l'icône : de combien chaque pixel est plus sombre que le fond du bandeau (niveau le plus fréquent)."""
    gray = cv2.cvtColor(piece, cv2.COLOR_BGR2GRAY).astype(np.int16)
    bg = np.bincount(gray.ravel().clip(0, 255)).argmax()
    return np.clip(bg - gray, 0, 255).astype(np.uint8)


def _shape(piece):
    """Masque binaire de l'icône (plus sombre que le fond du bandeau), seuil d'Otsu propre à la boîte."""
    dark = _dark(piece)
    if dark.max() < 14:
        return np.zeros(dark.shape, np.uint8)
    thr, _ = cv2.threshold(dark, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return (dark > max(thr * 0.7, 10)).astype(np.uint8)


def icons_of_banners(region, n=4, tones=False):
    """region : recadrage de la zone d'une équipe (4 bandeaux). Renvoie [{nom d'icône: masque}] par bandeau.
    Avec tones=True, chaque valeur est (masque, relief en niveaux de gris) : le relief sert à l'aperçu lisible de l'icône."""
    h, w = region.shape[:2]
    bw = w / n
    out = []
    for i in range(n):
        banner = region[:, int(i * bw) : int((i + 1) * bw)]
        row = {}
        for name, (a, b, c, d) in BOXES.items():
            piece = banner[int(c * h) : int(d * h), int(a * bw) : int(b * bw)]
            row[name] = (_shape(piece), _dark(piece)) if tones else _shape(piece)
        out.append(row)
    return out


def merge_masks(masks):
    """Forme moyenne de plusieurs masques de même taille, en gardant le plus gros amas."""
    if not masks:
        return None
    mean = np.mean([m.astype(np.float32) for m in masks], axis=0)
    shape = (mean >= KEEP_SHARE).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(shape)
    if n <= 1:
        return None
    keep = np.zeros_like(shape)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_AREA:
            keep[lab == i] = 1
    return keep * 255 if keep.sum() else None


def identify(shape, kind, folder=weapons.ICON_DIR, create=True, tone=None, exclude=()):
    """Identifiant d'une icône d'équipement (« B3 » pour une arme, « G1 » pour un gadget)."""
    return weapons.identify(shape, folder=folder, create=create, prefix=PREFIX[kind], tone=tone, exclude=exclude)


def resolve_loadout(reads, folder=weapons.ICON_DIR):
    """Équipement d'un joueur {« arme1 », « arme2 », « gadget »} -> identifiant, à partir de [(forme, relief)] par case.

    Un joueur n'a jamais deux fois la même arme : si les deux cases sont reconnues comme la même icône, celle qui ressemble le moins
    au modèle est relue sans pouvoir prendre ce modèle (autre icône connue, sinon nouvelle icône)."""
    out = {kind: identify(shape, kind, folder=folder, tone=tone) for kind, (shape, tone) in reads.items()}
    a, b = out.get("arme1"), out.get("arme2")
    if a is not None and a == b:
        weaker = min(("arme1", "arme2"), key=lambda k: weapons.similarity(reads[k][0], a, folder))
        shape, tone = reads[weaker]
        out[weaker] = identify(shape, weaker, folder=folder, tone=tone, exclude=(a,))
    return out


def read_loadouts(video, game, team_zones, width, height, frames=8):
    """Équipement {slot: {"arme1", "arme2", "gadget"}} d'une game (slots 1 à 8 dans l'ordre des bandeaux)."""
    import names  # évite un import circulaire au chargement

    start, end = game["start_s"], game["end_s"]
    span = max(end - start - 6, 1)
    times = [start + 3 + span * k / max(frames - 1, 1) for k in range(frames)]
    acc = {}
    for key, slots in names.TEAM_SLOTS.items():
        zone = team_zones[key]
        for t in times:
            crop = names._grab(video, t, zone, width, height)
            if crop is None:
                continue
            for i, row in enumerate(icons_of_banners(crop, tones=True)):
                for kind, (mask, tone) in row.items():
                    acc.setdefault((slots[i], kind), []).append((mask, tone))
    merged = {}
    for (slot, kind), reads in acc.items():
        shape = merge_masks([m for m, _ in reads])
        if shape is not None:
            merged.setdefault(slot, {})[kind] = (shape, np.mean([t.astype(np.float32) for _, t in reads], axis=0).astype(np.uint8))
    return {slot: resolve_loadout(reads) for slot, reads in merged.items()}


HELD_MIN_MARGIN = 30  # l'arme tenue est en noir sur le bandeau (relief vers 120-140), l'autre en pâle (vers 40) : en dessous, on ne tranche pas
HELD_OFFSETS = (-0.5, 0.0)  # images lues avant l'apparition de l'entrée du killfeed (le kill a eu lieu juste avant)


def _held_reads(video, zone, width, height, t, index):
    """Les deux armes du bandeau d'un joueur à l'instant t : [(relief 95e centile, forme)] pour arme1 puis arme2, ou None."""
    import names

    crop = names._grab(video, t, zone, width, height)
    if crop is None:
        return None
    h, w = crop.shape[:2]
    bw = w / 4
    banner = crop[:, int(index * bw) : int((index + 1) * bw)]
    reads = []
    for key in ("arme1", "arme2"):
        a, b, c, d = BOXES[key]
        piece = banner[int(c * h) : int(d * h), int(a * bw) : int(b * bw)]
        reads.append((float(np.percentile(_dark(piece), 95)), _shape(piece)))
    return reads


def _held_scores(video, zone, width, height, t, index):
    """Relief des deux armes du bandeau à l'instant t : (arme1, arme2), ou None."""
    reads = _held_reads(video, zone, width, height, t, index)
    return (reads[0][0], reads[1][0]) if reads else None


def _bar_of(zones, slot):
    import names

    for key, slots in names.TEAM_SLOTS.items():
        if slot in slots:
            return zones[key], slots.index(slot)
    return None, None


def held_icon(video, zones, width, height, t, slot):
    """Identifiant de l'icône de l'arme que le joueur tenait juste avant t (« B3 »), lue directement sur son bandeau à cet instant :
    l'équipement change à chaque réapparition, celui enregistré pour la game ne suffit pas. None si ambigu ou icône inconnue."""
    zone, index = _bar_of(zones, slot)
    if zone is None:
        return None
    icon = None
    for dt in HELD_OFFSETS:
        reads = _held_reads(video, zone, width, height, t + dt, index)
        if reads and abs(reads[0][0] - reads[1][0]) >= HELD_MIN_MARGIN:
            shape = reads[0][1] if reads[0][0] > reads[1][0] else reads[1][1]
            icon = identify(shape, "arme1", create=False) if shape.sum() else None
    return icon


def held_weapon(video, zones, width, height, t, slot):
    """« arme1 » ou « arme2 » : l'arme que le joueur tenait juste avant l'instant t (la dernière image où le bandeau tranche nettement),
    ou None si le bandeau est illisible ou ambigu (changement d'arme en cours, joueur mort)."""
    import names

    for key, slots in names.TEAM_SLOTS.items():
        if slot in slots:
            zone, index = zones[key], slots.index(slot)
            break
    else:
        return None
    held = None
    for dt in HELD_OFFSETS:
        scores = _held_scores(video, zone, width, height, t + dt, index)
        if scores and abs(scores[0] - scores[1]) >= HELD_MIN_MARGIN:
            held = "arme1" if scores[0] > scores[1] else "arme2"
    return held
