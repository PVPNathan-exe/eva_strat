"""Garde-fou « le compteur de morts n'augmente pas : le joueur n'est pas mort ».

Chaque bandeau affiche sous la tête de mort le nombre de morts du joueur. Une période où le bandeau paraît grisé (mort) alors que ce chiffre est le même avant et après n'est pas une mort :
un joueur à 1 ou 2 points de vie a un bandeau presque gris (Reef Point, game 27, 0:11). Seules les périodes que ni le killfeed ni une croix ne confirment sont vérifiées ; le chiffre n'est pas
lu (pas de reconnaissance de chiffres) mais comparé à lui-même, avant et après la période : même forme, même chiffre.

Mesuré sur les 66 morts annoncées par le killfeed de Reef Point (game 27) : similarité du chiffre avant et 19 s après la mort, médiane 0,38, 90 % des cas sous 0,71, maximum 0,80 ; sur 66 instants sans
mort, médiane 0,87. Seuil retenu : 0,85, aucune vraie mort sur les 66 n'est jugée « inchangée »."""

import cv2
import numpy as np

import banners
import db
import names

BOX = (0.62, 0.80, 0.70, 0.86)  # compteur de morts : x0, x1, y0, y1, parts du bandeau (sous la tête de mort ; la boîte déborde un peu à droite pour les bandeaux bleus)
SAME = 0.85  # similarité à partir de laquelle le chiffre est le même
MARGIN_S = 1.5  # instants comparés : cette durée avant le début et après la fin de la période
CONFIRM_BEFORE_S, CONFIRM_AFTER_S = 18.0, 3.5  # une mort du killfeed de 18 s avant à 3,5 s après le début de la période la confirme (une mort dure environ 17 s et le bandeau y paraît parfois vivant au début : le compteur a déjà bougé, The Cliff, joueur 3, mort à 84,5 s, bandeau gris lu de 91,3 s à 101,4 s)
MIN_RUN_S = 1.5


def glyph(crop, index):
    """Masque du chiffre du compteur de morts du bandeau `index` (0 à 3) de l'image `crop` de la barre d'une équipe, ou None si la zone est plate (illisible)."""
    h, w = crop.shape[:2]
    bw = w / 4
    banner = crop[:, int(index * bw) : int((index + 1) * bw)]
    height, width = banner.shape[:2]
    piece = banner[int(BOX[2] * height) : int(BOX[3] * height), int(BOX[0] * width) : int(BOX[1] * width)]
    if piece.size == 0:
        return None
    gray = cv2.resize(cv2.cvtColor(piece, cv2.COLOR_BGR2GRAY), (40, 36), interpolation=cv2.INTER_CUBIC).astype(np.float32)
    if gray.max() - gray.min() < 25:
        return None
    return gray < (gray.min() + gray.max()) / 2


def similarity(a, b):
    """Recouvrement (intersection sur union) de deux masques, au meilleur décalage de 2 pixels."""
    best = 0.0
    for dx in (-2, -1, 0, 1, 2):
        for dy in (-2, -1, 0, 1, 2):
            shifted = np.roll(np.roll(b, dx, axis=1), dy, axis=0)
            union = (a | shifted).sum()
            if union:
                best = max(best, (a & shifted).sum() / union)
    return float(best)


def counter_unchanged(before, after, index):
    """True si le chiffre du compteur est le même sur les deux images, False s'il a changé, None si l'un des deux est illisible."""
    a, b = (glyph(c, index) if c is not None else None for c in (before, after))
    if a is None or b is None:
        return None
    return similarity(a, b) >= SAME


def _runs(frames):
    runs, current = [], []
    for k in sorted(frames):
        if current and k != current[-1] + 1:
            runs.append(current)
            current = []
        current.append(k)
    if current:
        runs.append(current)
    return runs


def veto_states(conn, game, states, deaths, step_s):
    """États des bandeaux sans les périodes « mort » démenties par le compteur de morts (voir l'en-tête). `game` : ligne de games avec path, width, height, start_s, end_s, map ; `deaths` : [(t, joueur)]
    du killfeed. Renvoie (états, [(joueur, début, fin) des périodes retirées, en secondes de la game])."""
    import tracking

    if not states:
        return states, []
    zones = {key: db.zone_for(conn, game["map"], key) for key in ("team_a_bar", "team_b_bar")}
    vetoed = []
    min_frames = max(2, round(MIN_RUN_S / step_s))
    for slot, frames in tracking.dead_frames(states, step_s).items():
        key = "team_a_bar" if slot <= 4 else "team_b_bar"
        index = names.TEAM_SLOTS[key].index(slot)
        for run in _runs(frames):
            if len(run) < min_frames:
                continue
            t0, t1 = run[0] * step_s, run[-1] * step_s  # secondes depuis le début de la game
            if any(s == slot and t0 - CONFIRM_BEFORE_S <= td - game["start_s"] <= t0 + CONFIRM_AFTER_S for td, s in deaths):
                continue  # le killfeed l'annonce : c'est une mort
            if t0 - MARGIN_S < 0 or t1 + MARGIN_S > game["end_s"] - game["start_s"] - 1.0:
                continue
            if any(s == slot and t0 - MARGIN_S <= td - game["start_s"] <= t1 + MARGIN_S for td, s in deaths):
                continue
            before = names._grab(game["path"], game["start_s"] + t0 - MARGIN_S, zones[key], game["width"], game["height"])
            after = names._grab(game["path"], game["start_s"] + t1 + MARGIN_S, zones[key], game["width"], game["height"])
            if counter_unchanged(before, after, index):
                for k in run:
                    if k in states and slot in states[k]:
                        states[k][slot] = {**states[k][slot], "alive": True, "fill": max(states[k][slot].get("fill", 0.0), banners.MIN_FILL)}
                vetoed.append((slot, round(t0, 1), round(t1, 1)))
    return states, vetoed
