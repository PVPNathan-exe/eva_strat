"""État des 8 joueurs lu sur les bandeaux du haut de l'écran : vivant ou mort, et lequel est observé.

Un bandeau vivant a la couleur de son équipe ; un joueur mort a un bandeau grisé (le décompte de réapparition s'affiche sur son portrait) ;
le joueur observé est entouré d'un cadre blanc. Ces trois indices ne dépendent pas de la minimap : ils servent à valider et à guider le suivi
(combien de pastilles vivantes chercher par équipe, quelle pastille blanche est le joueur observé)."""

import cv2
import numpy as np

COLORED = {"S": 100, "V": 140}  # pixel « coloré » (couleur de l'équipe)
FILL_COLUMNS = (0.34, 0.80)  # colonnes examinées : hors portrait (à gauche) et hors points de vie (à droite)
ROW_COLORED = 0.35  # une ligne du bandeau est « remplie » si au moins cette part de ses pixels est colorée
MIN_FILL = 0.015  # remplissage minimal (part de la hauteur) pour être vivant : un bandeau de mort est entièrement gris (0,00) ; un joueur vivant à 1 ou 2 points de vie garde un mince filet (0,02), mesuré
FRAME_V, FRAME_S = 200, 130  # pixel du cadre blanc : clair et peu saturé (teinté de bleu ou d'orange sur certaines vidéos : saturation jusqu'à 120)
FRAME_TOP_ROWS = 3  # le trait du haut du cadre est dans ces premières lignes du bandeau
FRAME_TOP_SHARE = 0.7  # part de la largeur du trait du haut qui doit être blanche
FRAME_BOTTOM_ROWS = 30  # le trait du bas est cherché dans ces dernières lignes (la zone du bandeau déborde parfois sous le bandeau)
FRAME_BOTTOM_SHARE = 0.75  # part de la largeur d'une ligne du trait du bas qui doit être blanche
FRAME_BOTTOM_THICKNESS = (2, 6)  # épaisseur (lignes) du trait du bas : une zone claire plus épaisse est le décor derrière le bandeau


def _banner(crop, index, n=4):
    h, w = crop.shape[:2]
    bw = w / n
    return crop[:, int(index * bw) : int((index + 1) * bw)]


def _runs(flags):
    """Longueurs des suites de valeurs vraies."""
    out, n = [], 0
    for v in flags:
        if v:
            n += 1
        elif n:
            out.append(n)
            n = 0
    if n:
        out.append(n)
    return out


def _white_frame(hsv):
    """(part blanche du trait du haut, vrai si le bandeau est entouré du cadre blanc du joueur observé). Le cadre a un trait en haut (première ou deux premières
    lignes) et un trait fin en bas ; seuls le haut et le bas comptent, les côtés se confondent avec le cadre des bandeaux voisins. Mesuré sur trois games :
    une seule personne observée par image dans 69 à 76 images sur 80 (l'ancien test, trop strict sur la saturation et sur la position du bas : 3 sur 80 pour une des games)."""
    h, w = hsv.shape[:2]
    x0, x1 = int(0.08 * w), int(0.92 * w)
    white = (hsv[:, x0:x1, 2] >= FRAME_V) & (hsv[:, x0:x1, 1] <= FRAME_S)
    rows = white.mean(axis=1)
    top = float(rows[:FRAME_TOP_ROWS].max())
    lo, hi = FRAME_BOTTOM_THICKNESS
    bottom = any(lo <= n <= hi for n in _runs(rows[-FRAME_BOTTOM_ROWS:] >= FRAME_BOTTOM_SHARE))
    return top, top >= FRAME_TOP_SHARE and bottom


def read_team(crop, n=4):
    """[{ "alive", "spectated", "fill" }] pour les n bandeaux d'une équipe.

    Le fond du bandeau se remplit de la couleur de l'équipe depuis le bas, proportionnellement aux points de vie : pleine hauteur à 100,
    à moitié à 50, et entièrement grisé à 0 (joueur mort). « fill » est la part de hauteur colorée (≈ points de vie)."""
    out = []
    for i in range(n):
        banner = _banner(crop, i, n)
        h, w = banner.shape[:2]
        hsv = cv2.cvtColor(banner, cv2.COLOR_BGR2HSV)
        cols = hsv[:, int(FILL_COLUMNS[0] * w) : int(FILL_COLUMNS[1] * w)]
        colored = (cols[:, :, 1] >= COLORED["S"]) & (cols[:, :, 2] >= COLORED["V"])
        rows = colored.mean(axis=1) >= ROW_COLORED
        fill = float(rows[int(0.1 * h) :].mean())
        top, spectated = _white_frame(hsv)
        out.append({"alive": fill >= MIN_FILL, "spectated": spectated, "fill": round(fill, 2), "white_border": round(top, 2)})
    return out


def read_states(crop_a, crop_b):
    """{slot: {"alive", "spectated"}} pour les 8 slots (1 à 4 : équipe de gauche, 5 à 8 : équipe de droite)."""
    states = {}
    for base, crop in ((1, crop_a), (5, crop_b)):
        if crop is None:
            continue
        for i, st in enumerate(read_team(crop)):
            states[base + i] = st
    return states


DEATH_OFFSETS_S = (1.2, 2.2, 3.2)  # instants (après l'entrée du killfeed) où le bandeau de la victime doit être grisé : une vraie mort dure environ 17 s


MIN_BAR_BRIGHTNESS = 25  # luminosité moyenne en dessous de laquelle l'écran est noir (fin de game, transition) : le bandeau n'est pas lisible
END_MARGIN_S = 0.5  # on ne lit pas les dernières fractions de seconde d'une game (fondu au noir)


def confirm_death(video, bar_zone, width, height, t, index, offsets=DEATH_OFFSETS_S, end_s=None):
    """Le bandeau du joueur `index` (0 à 3 dans la zone `bar_zone`) est-il grisé après l'instant t ? True : la victime est bien morte ; False : elle est restée
    vivante (ligne du killfeed inventée : nom flottant dans la vue 3D, transition de fin de game…) ; None : bandeau illisible, on ne tranche pas.
    Il faut au moins deux images sur trois grisées : un parasite isolé du bandeau ne confirme pas une mort. Une image noire (fin de game) ou après la fin de la
    game (end_s) ne compte pas : un écran noir n'est pas un bandeau grisé."""
    import names  # évite un import circulaire au chargement

    dead = known = 0
    for dt in offsets:
        if end_s is not None and t + dt > end_s - END_MARGIN_S:
            continue
        crop = names._grab(video, t + dt, bar_zone, width, height)
        if crop is None or float(crop.mean()) < MIN_BAR_BRIGHTNESS:
            continue
        known += 1
        dead += not read_team(crop)[index]["alive"]
    if known < 2:
        return None
    return dead >= 2
