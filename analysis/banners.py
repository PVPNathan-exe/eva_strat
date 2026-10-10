"""État des 8 joueurs lu sur les bandeaux du haut de l'écran : vivant ou mort, et lequel est observé.

Un bandeau vivant a la couleur de son équipe ; un joueur mort a un bandeau grisé (le décompte de réapparition s'affiche sur son portrait) ;
le joueur observé est entouré d'un cadre blanc. Ces trois indices ne dépendent pas de la minimap : ils servent à valider et à guider le suivi
(combien de pastilles vivantes chercher par équipe, quelle pastille blanche est le joueur observé)."""

import cv2
import numpy as np

COLORED = {"S": 100, "V": 140}  # pixel « coloré » (couleur de l'équipe)
FILL_COLUMNS = (0.34, 0.80)  # colonnes examinées : hors portrait (à gauche) et hors points de vie (à droite)
ROW_COLORED = 0.35  # une ligne du bandeau est « remplie » si au moins cette part de ses pixels est colorée
MIN_FILL = 0.03  # remplissage minimal (part de la hauteur) pour être vivant : en dessous, le bandeau est entièrement grisé = mort
BORDER_PX = 3  # épaisseur du cadre blanc examinée
BORDER_WHITE_SHARE = 0.3  # part du haut et du bas du bandeau en blanc pour dire « observé »


def _banner(crop, index, n=4):
    h, w = crop.shape[:2]
    bw = w / n
    return crop[:, int(index * bw) : int((index + 1) * bw)]


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
        # cadre blanc : pourtour du bandeau
        # Seuls le haut et le bas comptent : les côtés se confondent avec le cadre des bandeaux voisins.
        mask = np.zeros((h, w), np.uint8)
        mask[:BORDER_PX, int(0.08 * w) : int(0.92 * w)] = 1
        mask[-BORDER_PX:, int(0.08 * w) : int(0.92 * w)] = 1
        white = (hsv[:, :, 2] >= 225) & (hsv[:, :, 1] <= 55)
        share = float(white[mask > 0].mean())
        out.append({"alive": fill >= MIN_FILL, "spectated": share >= BORDER_WHITE_SHARE, "fill": round(fill, 2), "white_border": round(share, 2)})
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


def confirm_death(video, bar_zone, width, height, t, index, offsets=DEATH_OFFSETS_S):
    """Le bandeau du joueur `index` (0 à 3 dans la zone `bar_zone`) est-il grisé après l'instant t ? True : la victime est bien morte ; False : elle est restée
    vivante (ligne du killfeed inventée : nom flottant dans la vue 3D, transition de fin de game…) ; None : bandeau illisible, on ne tranche pas.
    Il faut au moins deux images sur trois grisées : un parasite isolé du bandeau ne confirme pas une mort."""
    import names  # évite un import circulaire au chargement

    dead = known = 0
    for dt in offsets:
        crop = names._grab(video, t + dt, bar_zone, width, height)
        if crop is None:
            continue
        known += 1
        dead += not read_team(crop)[index]["alive"]
    if known < 2:
        return None
    return dead >= 2
