from pathlib import Path

import cv2
import numpy as np

import hud

FIXTURE = Path(__file__).parent / "fixtures" / "game_hud.png"


def solid(color_bgr, w=640, h=360):
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = color_bgr
    return img


def test_real_game_frame_is_detected():
    frame = cv2.imread(str(FIXTURE))
    assert frame is not None, "image de référence introuvable"
    assert hud.hud_score(frame) >= hud.HUD_THRESHOLD
    assert hud.hud_present(frame)


def test_real_game_frame_is_detected_after_downscale():
    frame = cv2.resize(cv2.imread(str(FIXTURE)), (640, 360), interpolation=cv2.INTER_AREA)
    assert hud.hud_present(frame)


def test_black_screen_is_not_hud():
    assert not hud.hud_present(solid((0, 0, 0)))


def test_green_jungle_is_not_hud():
    assert not hud.hud_present(solid((40, 140, 60)))


def test_only_one_team_color_is_not_hud():
    frame = solid((0, 0, 0))
    zone = hud.DEFAULT_ZONES["team_a_bar"]
    region = hud.crop(frame, zone)
    region[:] = (0, 140, 255)  # orange (BGR), seulement à gauche
    assert not hud.hud_present(frame)


def test_both_team_colors_in_their_zones_is_hud():
    frame = solid((0, 0, 0))
    hud.crop(frame, hud.DEFAULT_ZONES["team_a_bar"])[:] = (0, 140, 255)  # orange
    hud.crop(frame, hud.DEFAULT_ZONES["team_b_bar"])[:] = (230, 120, 30)  # bleu
    assert hud.hud_present(frame)
