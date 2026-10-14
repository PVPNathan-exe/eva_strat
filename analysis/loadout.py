"""Équipement de chaque joueur lu sur les bandeaux : deux armes et un gadget (trois petites icônes sous le pseudo).

L'arme tenue est dessinée en noir, l'autre en pâle : dans les deux cas c'est la même forme, qu'on isole du fond du bandeau (couleur
d'équipe, ou gris quand le joueur est mort). L'équipement change à chaque réapparition (loadout_life.py le lit par vie) : on moyenne plusieurs images
pour obtenir une forme propre, puis on la compare à des modèles (weapons.py, préfixes B pour les armes et G pour les gadgets).

Géométrie (mesurée sur le profil des bords de bandeau de The Cliff, 20 images par équipe) : les 4 bandeaux d'une équipe ne partagent pas la zone en quatre parts
égales. Le pas est de 0,2548 de la largeur de la zone et un bandeau en fait 0,2377 (une division en quatre faisait glisser les cases de 4, 8 et 12 pixels
pour les bandeaux 2, 3 et 4 : l'arme 1 des joueurs 4 et 8 était coupée ou lue à côté). Les cases sont donc placées par `box_piece`.
"""

import cv2
import numpy as np

import weapons

# Boîtes des icônes dans un bandeau (fractions de sa largeur et de sa hauteur) : x0, x1, y0, y1
BOXES = {"arme1": (0.30, 0.56, 0.26, 0.50), "arme2": (0.56, 0.82, 0.26, 0.50), "gadget": (0.84, 0.99, 0.26, 0.50)}  # creux entre les icônes mesurés vers 0,30 0,55 et 0,83
BANNER_OFFSET = 0.0  # début du premier bandeau, en fraction de la largeur de la zone d'équipe
BANNER_PITCH = 0.2548  # écart entre deux bandeaux
BANNER_WIDTH = 0.2377  # largeur d'un bandeau
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


def box_piece(region, index, kind):
    """Recadrage de la case `kind` (« arme1 », « arme2 », « gadget ») du bandeau `index` (0 à 3) dans le recadrage `region` de la zone d'une équipe.
    Les coordonnées partent de la géométrie réelle (BANNER_*), pas d'une division en quatre ; une case qui dépasse d'un pixel est tronquée."""
    h, w = region.shape[:2]
    a, b, c, d = BOXES[kind]
    x0, bw = (BANNER_OFFSET + index * BANNER_PITCH) * w, BANNER_WIDTH * w
    return region[int(c * h) : int(d * h), int(x0 + a * bw) : int(round(x0 + b * bw))]


def banner_crop(region, index):
    """Recadrage du bandeau `index` (0 à 3) entier : pour l'aperçu d'un contrôle visuel."""
    w = region.shape[1]
    x0 = (BANNER_OFFSET + index * BANNER_PITCH) * w
    return region[:, int(x0) : int(round(x0 + BANNER_WIDTH * w))]


def icons_of_banners(region, n=4, tones=False):
    """region : recadrage de la zone d'une équipe (4 bandeaux). Renvoie [{nom d'icône: masque}] par bandeau.
    Avec tones=True, chaque valeur est (masque, relief en niveaux de gris) : le relief sert à l'aperçu lisible de l'icône."""
    out = []
    for i in range(n):
        row = {}
        for name in BOXES:
            piece = box_piece(region, i, name)
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


def identify_pale(shape, tone, folder=weapons.ICON_DIR):
    """Identifiant d'une arme RANGÉE (pâle, forme souvent incomplète) ou None : seule la silhouette à taille réelle est utilisée (weapons._native_match), jamais la
    comparaison de forme étirée, qui prenait un ATLAS pâle pour un NEEDLE. Mesuré sur 60 cases de The Cliff contre l'arme tenue de la même vie : 55 justes, 5 fausses
    (92 %), 20 sans réponse ; la comparaison de forme donnait 15 justes, 10 fausses et 55 sans réponse."""
    if shape is None or not shape.any():
        return None
    return weapons._native_match(shape, tone, weapons._templates(folder), folder, ())


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


HELD_TONE = 90  # ancien seuil absolu (icon_fix) : une arme fine (AK, pistolet) tenue n'a qu'un relief de 60 à 90, et 48 % des bandeaux étaient refusés
HELD_TONE_MIN = 55  # relief (95e centile) minimal de l'arme tenue dans la lecture par paire ; l'arme rangée reste sous 50 (mesuré sur 320 bandeaux : 11 à 47)
HELD_PAIR_MARGIN = 20  # écart minimal entre les reliefs des deux armes pour dire laquelle est tenue (écarts mesurés : 13 au 10e centile, 58 à la médiane)
ICON_MIN_AREA = 60  # surface minimale (pixels de l'image native) d'une icône d'arme exploitable (un pistolet fin tenu fait 73 à 87)
ICON_MAX_SHARE = 0.6  # part maximale de la boîte occupée par l'icône (au-delà : fond mal séparé)
ICON_MIN_ASPECT = 1.2  # une arme est plus longue que haute (largeur / hauteur)


def usable_shape(shape):
    """La forme a la taille et le rapport d'une arme, et ne touche ni le haut ni le bas de la case."""
    if not shape.any() or shape[0].any() or shape[-1].any():
        return False  # coupée en haut ou en bas de la boîte : l'icône dépasse, on lira une autre image (en largeur elle peut remplir la boîte)
    ys, xs = np.nonzero(shape)
    area, (h, w) = int(shape.sum()), shape.shape
    return area >= ICON_MIN_AREA and area <= ICON_MAX_SHARE * h * w and (xs.max() - xs.min() + 1) >= ICON_MIN_ASPECT * (ys.max() - ys.min() + 1)


def usable_weapon_read(shape, tone, min_tone=HELD_TONE):
    """Une lecture d'arme n'est gardée que si l'arme est tenue (noire, bien lisible) et que la forme a la taille et le rapport d'une arme.
    L'arme rangée est pâle et sa forme incomplète ; mélangée aux lectures nettes elle rétrécit l'icône (icône coupée, ou aperçu entre les deux armes).
    Le seuil absolu `min_tone` ne voit pas les armes fines : read_held préfère comparer les deux cases du même bandeau."""
    return bool(shape.any() and float(np.percentile(tone, 95)) >= min_tone and usable_shape(shape))


def read_held(row):
    """Arme tenue d'un bandeau : row = {"arme1": (forme, relief), "arme2": (forme, relief), ...} (icons_of_banners avec tones=True).
    Renvoie (case, forme, relief) pour la case tenue (celle dont le relief est le plus fort, au moins HELD_TONE_MIN et HELD_PAIR_MARGIN au-dessus de l'autre),
    ou None si on ne peut pas trancher (changement d'arme en cours, joueur mort) ou si la forme n'est pas celle d'une arme entière."""
    p = {k: float(np.percentile(row[k][1], 95)) for k in ("arme1", "arme2")}
    held = max(p, key=p.get)
    other = "arme2" if held == "arme1" else "arme1"
    if p[held] < HELD_TONE_MIN or p[held] - p[other] < HELD_PAIR_MARGIN or not usable_shape(row[held][0]):
        return None
    return held, row[held][0], row[held][1]


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
                    # Armes : seule la case de l'arme tenue compte (comparée à l'autre case du bandeau). Gadgets : toutes les images.
                    held = read_held(row)
                    if held:
                        acc.setdefault((slots[i], held[0]), []).append((held[1], held[2]))
                    if row["gadget"][0].any():
                        acc.setdefault((slots[i], "gadget"), []).append(row["gadget"])
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


HELD_MIN_MARGIN = HELD_PAIR_MARGIN  # l'arme tenue est en noir sur le bandeau (relief de 60 à 150), l'autre en pâle (sous 50) : en dessous de l'écart, on ne tranche pas
HELD_OFFSETS = (-0.5, 0.0)  # images lues avant l'apparition de l'entrée du killfeed (le kill a eu lieu juste avant)


def _held_reads(video, zone, width, height, t, index):
    """Les deux armes du bandeau d'un joueur à l'instant t : [(relief 95e centile, forme)] pour arme1 puis arme2, ou None."""
    import names

    crop = names._grab(video, t, zone, width, height)
    if crop is None:
        return None
    reads = []
    for key in ("arme1", "arme2"):
        piece = box_piece(crop, index, key)
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
        if reads and abs(reads[0][0] - reads[1][0]) >= HELD_MIN_MARGIN and max(reads[0][0], reads[1][0]) >= HELD_TONE_MIN:
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
        if scores and abs(scores[0] - scores[1]) >= HELD_MIN_MARGIN and max(scores) >= HELD_TONE_MIN:
            held = "arme1" if scores[0] > scores[1] else "arme2"
    return held
