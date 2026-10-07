"""Détection de la présence du HUD de jeu sur une image BGR.

Le HUD est présent quand les deux bandeaux de joueurs du haut sont colorés,
l'un en orange et l'autre en bleu. Les zones sont en coordonnées relatives.
"""

import json
from pathlib import Path

import cv2
import numpy as np

DEFAULT_ZONES = json.loads(Path(__file__).with_name("default_zones.json").read_text(encoding="utf-8"))

# Bornes HSV d'OpenCV (H sur 0-179).
ORANGE = (np.array([5, 150, 150]), np.array([25, 255, 255]))
BLUE = (np.array([95, 120, 120]), np.array([125, 255, 255]))

HUD_THRESHOLD = 0.10


def crop(frame, zone):
    """Sous-image (vue, pas une copie) correspondant à une zone relative."""
    h, w = frame.shape[:2]
    x0 = int(zone["x"] * w)
    y0 = int(zone["y"] * h)
    x1 = max(x0 + 1, int((zone["x"] + zone["w"]) * w))
    y1 = max(y0 + 1, int((zone["y"] + zone["h"]) * h))
    return frame[y0:y1, x0:x1]


def color_fraction(region, bounds):
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, bounds[0], bounds[1])
    return float(np.count_nonzero(mask)) / mask.size


def hud_score(frame, zones=None):
    z = zones or DEFAULT_ZONES
    left = crop(frame, z["team_a_bar"])
    right = crop(frame, z["team_b_bar"])
    straight = min(color_fraction(left, ORANGE), color_fraction(right, BLUE))
    swapped = min(color_fraction(left, BLUE), color_fraction(right, ORANGE))
    return max(straight, swapped)


def hud_present(frame, zones=None, threshold=HUD_THRESHOLD):
    return hud_score(frame, zones) >= threshold
