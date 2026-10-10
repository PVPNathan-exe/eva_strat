"""Équipement de chaque joueur lu sur les bandeaux : deux armes et un gadget (trois petites icônes sous le pseudo).

L'arme tenue est dessinée en noir, l'autre en pâle : dans les deux cas c'est la même forme, qu'on isole du fond du bandeau (couleur
d'équipe, ou gris quand le joueur est mort). L'équipement ne change pas pendant une game : on moyenne plusieurs images pour obtenir
une forme propre, puis on la compare à des modèles (weapons.py, préfixes B pour les armes et G pour les gadgets).
"""

import cv2
import numpy as np

import weapons

# Boîtes des icônes dans un bandeau (fractions de sa largeur et de sa hauteur) : x0, x1, y0, y1
BOXES = {"arme1": (0.30, 0.54, 0.29, 0.52), "arme2": (0.53, 0.80, 0.29, 0.52), "gadget": (0.80, 0.96, 0.29, 0.52)}
PREFIX = {"arme1": "B", "arme2": "B", "gadget": "G"}
KEEP_SHARE = 0.5  # un pixel fait partie de la forme s'il l'est sur au moins la moitié des images
MIN_AREA = 30
BG_PERCENTILE = 90  # le fond d'une ligne de la boîte est ce niveau de sa distribution
PART_GAP_PX = 3  # un morceau détaché (lunette, crosse) est gardé s'il est à moins de ce nombre de pixels de l'amas principal


def _dark(piece):
    """Relief de l'icône : de combien chaque pixel est plus sombre que le fond du bandeau, mesuré ligne par ligne (haut de la distribution de la ligne : le fond
    est plus clair que l'arme noire, et une arme longue occupe plus de la moitié d'une ligne, ce qui empêche de prendre le niveau le plus fréquent).
    Le fond d'un bandeau se remplit de la couleur de l'équipe depuis le bas selon les points de vie : la ligne de séparation (gris au-dessus, couleur
    en dessous) traverse parfois la bande des armes, et un fond unique pour toute la boîte ferait ressortir une moitié de la boîte comme une fausse forme."""
    gray = cv2.cvtColor(piece, cv2.COLOR_BGR2GRAY).astype(np.int16).clip(0, 255)
    bg = np.percentile(gray, BG_PERCENTILE, axis=1).astype(np.int16)[:, None]
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
    # Le plus gros amas est l'arme ; ne restent avec lui que les morceaux qui le touchent presque (lunette, crosse détachées). Un bout de portrait
    # ou du pseudo, loin de l'arme, n'en fait pas partie.
    main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    if stats[main, cv2.CC_STAT_AREA] < MIN_AREA:
        return None
    near = cv2.dilate((lab == main).astype(np.uint8), np.ones((2 * PART_GAP_PX + 1, 2 * PART_GAP_PX + 1), np.uint8))
    keep = np.zeros_like(shape)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= MIN_AREA and (i == main or near[lab == i].any()):
            keep[lab == i] = 1
    return keep * 255


def identify(shape, kind, folder=weapons.ICON_DIR, create=True, tone=None, exclude=()):
    """Identifiant d'une icône d'équipement (« B3 » pour une arme, « G1 » pour un gadget)."""
    return weapons.identify(shape, folder=folder, create=create, prefix=PREFIX[kind], tone=tone, exclude=exclude)


def sharp_enough(tone):
    """Vrai si l'icône est assez nette pour que l'utilisateur puisse la reconnaître et la nommer (contour fin, voir weapons.edge_width)."""
    width = weapons.edge_width(tone)
    return width is not None and width <= weapons.SHARP_MAX


def resolve_loadout(reads, folder=weapons.ICON_DIR):
    """Équipement d'un joueur {« arme1 », « arme2 », « gadget »} -> identifiant, à partir de [(forme, relief)] par case.

    Une icône déjà connue est reconnue même si elle est un peu floue ; une icône INCONNUE n'est créée (pour être nommée par l'utilisateur) que si elle est
    nette : sinon la case reste vide, plutôt que d'ajouter une icône illisible à nommer.
    Un joueur n'a jamais deux fois la même arme : si les deux cases sont reconnues comme la même icône, celle qui ressemble le moins
    au modèle est relue sans pouvoir prendre ce modèle (autre icône connue, sinon nouvelle icône)."""
    out = {kind: identify(shape, kind, folder=folder, tone=tone, create=sharp_enough(tone)) for kind, (shape, tone) in reads.items()}
    a, b = out.get("arme1"), out.get("arme2")
    if a is not None and a == b:
        weaker = min(("arme1", "arme2"), key=lambda k: weapons.similarity(reads[k][0], a, folder))
        shape, tone = reads[weaker]
        out[weaker] = identify(shape, weaker, folder=folder, tone=tone, exclude=(a,), create=sharp_enough(tone))
    return out


HELD_TONE = 90  # relief (95e centile) d'une arme tenue, en noir sur le bandeau ; l'arme rangée est pâle (vers 40) et mal lue
ICON_MIN_AREA = 80  # surface minimale (pixels de l'image native) d'une icône d'arme exploitable
ICON_MAX_SHARE = 0.6  # part maximale de la boîte occupée par l'icône (au-delà : fond mal séparé)
ICON_MIN_ASPECT = 1.2  # une arme est plus longue que haute (largeur / hauteur)


def usable_weapon_read(shape, tone):
    """Une lecture d'arme n'est gardée que si l'arme est tenue (noire, bien lisible) et que la forme a la taille et le rapport d'une arme.
    L'arme rangée est pâle et sa forme incomplète ; mélangée aux lectures nettes elle rétrécit l'icône (icône coupée, ou aperçu entre les deux armes)."""
    if not shape.any() or float(np.percentile(tone, 95)) < HELD_TONE:
        return False
    if shape[0].any() or shape[-1].any():
        return False  # coupée en haut ou en bas de la boîte : l'icône dépasse, on lira une autre image (en largeur elle peut remplir la boîte)
    ys, xs = np.nonzero(shape)
    area, (h, w) = int(shape.sum()), shape.shape
    return area >= ICON_MIN_AREA and area <= ICON_MAX_SHARE * h * w and (xs.max() - xs.min() + 1) >= ICON_MIN_ASPECT * (ys.max() - ys.min() + 1)


BEST_READS = 6  # lectures les plus nettes fusionnées pour obtenir l'icône d'une case
MAX_ROUNDS = 3  # séries d'images lues au plus : on en relit une autre tant qu'un joueur n'a aucune arme exploitable


def read_loadouts(video, game, team_zones, width, height, frames=12, folder=weapons.ICON_DIR):
    """Équipement {slot: {"arme1", "arme2", "gadget"}} d'une game (slots 1 à 8 dans l'ordre des bandeaux).

    On lit une série d'images réparties dans la game ; seules les images où l'arme est tenue, entière et nette comptent (sinon on change d'image). Si un
    joueur n'a encore aucune arme exploitable, on lit une autre série (décalée) avant de renoncer. Les lectures les plus nettes sont fusionnées."""
    import names  # évite un import circulaire au chargement

    start, end = game["start_s"], game["end_s"]
    span = max(end - start - 6, 1)
    acc = {}
    for round_ in range(MAX_ROUNDS):
        shift = round_ / (MAX_ROUNDS * max(frames - 1, 1))  # décale la série pour tomber sur d'autres images
        times = [start + 3 + span * (k / max(frames - 1, 1) + shift) for k in range(frames)]
        times = [t for t in times if t < end - 1]
        for key, slots in names.TEAM_SLOTS.items():
            zone = team_zones[key]
            for t in times:
                crop = names._grab(video, t, zone, width, height)
                if crop is None:
                    continue
                for i, row in enumerate(icons_of_banners(crop, tones=True)):
                    for kind, (mask, tone) in row.items():
                        # Armes : seules les images où l'arme est tenue comptent. Gadgets : toutes.
                        if kind == "gadget" or usable_weapon_read(mask, tone):
                            acc.setdefault((slots[i], kind), []).append((mask, tone))
        slots_all = [s_ for slots in names.TEAM_SLOTS.values() for s_ in slots]
        if all(any(acc.get((slot, k)) for k in ("arme1", "arme2")) for slot in slots_all):
            break
    merged = {}
    for (slot, kind), reads in acc.items():
        best = sorted(reads, key=lambda r: weapons.edge_width(r[1]) or 99.0)[:BEST_READS]  # les plus nettes d'abord
        shape = merge_masks([m for m, _ in best])
        if shape is not None:
            merged.setdefault(slot, {})[kind] = (shape, np.mean([t.astype(np.float32) for _, t in best], axis=0).astype(np.uint8))
    return {slot: resolve_loadout(reads, folder) for slot, reads in merged.items()}


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
        tone = _dark(piece)
        reads.append((float(np.percentile(tone, 95)), _shape(piece), tone))
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
            _, shape, tone = reads[0] if reads[0][0] > reads[1][0] else reads[1]
            icon = identify(shape, "arme1", create=False, tone=tone) if shape.sum() else None
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
