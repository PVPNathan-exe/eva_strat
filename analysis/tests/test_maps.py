"""Masques, stations de tyrolienne et zones de départ de toutes les cartes."""

import cv2
import numpy as np

import map_mask
import map_spawn
import map_tp
import tracking


def _floor_image():
    """Minimap synthétique : sol gris, un obstacle plus sombre, un fond brun, une zone orange vive à gauche."""
    img = np.full((400, 400, 3), (22, 28, 38), np.uint8)  # fond brun sombre
    img[40:360, 40:360] = (66, 66, 66)  # sol
    img[150:200, 150:200] = (50, 50, 50)  # obstacle (plus sombre de 16 niveaux)
    img[100:200, 0:40] = (30, 110, 220)  # zone de départ orange (BGR)
    return img


def test_learned_mask_keeps_the_floor_and_rejects_the_background_and_the_obstacle():
    img = _floor_image()
    points = [(x / 100, y / 100) for x in range(15, 85, 7) for y in range(15, 85, 7) if not (0.36 <= x / 100 <= 0.52 and 0.36 <= y / 100 <= 0.52)]
    mask = map_mask.mask_learned(img, points)
    assert mask[300, 300] and mask[100, 300]  # sol
    assert not mask[10, 10] and not mask[390, 390]  # fond
    assert not mask[175, 175]  # obstacle un peu plus sombre
    assert map_mask.share_outside(mask, points) == 0.0


def test_share_outside_counts_reads_the_tracking_would_refuse():
    mask = np.zeros((400, 400), bool)
    mask[100:300, 100:300] = True
    assert map_mask.share_outside(mask, [(0.5, 0.5), (0.9, 0.9)]) == 0.5
    assert map_mask.share_outside(mask, [(0.26, 0.5)]) == 0.0  # une case de tolérance autour du masque


def _station(img, cx, cy):
    cv2.circle(img, (cx, cy), 8, (230, 230, 230), -1)
    cv2.circle(img, (cx, cy), 2, (30, 30, 30), -1)  # la flèche sombre


def test_stations_are_found_as_white_discs_and_paired_by_their_connector():
    img = np.full((300, 400, 3), 60, np.uint8)
    _station(img, 100, 60)
    _station(img, 100, 220)
    cv2.line(img, (100, 75), (100, 205), (180, 180, 180), 2)  # trait pointillé qui les relie
    _station(img, 300, 60)
    _station(img, 300, 120)
    stations = map_tp.find_stations(img)
    assert len(stations) == 4
    pairs, alone = map_tp.pair_stations(img, stations, [])
    assert len(pairs) == 2 and not alone  # le trait pour la première paire, la proximité pour la seconde
    assert {map_tp._nearest(stations, (0.25, 0.2)), map_tp._nearest(stations, (0.25, 0.733))} in [{i, j} for i, j, _ in pairs]


def test_a_station_without_partner_stays_alone():
    img = np.full((300, 400, 3), 60, np.uint8)
    _station(img, 60, 150)
    _station(img, 340, 150)
    pairs, alone = map_tp.pair_stations(img, map_tp.find_stations(img), [])
    assert not pairs and len(alone) == 2


def test_spawn_zones_are_bright_team_coloured_patches_not_the_dimmer_capture_box():
    img = np.full((400, 400, 3), 60, np.uint8)
    img[100:200, 0:60] = (40, 120, 230)  # orange vif
    img[100:200, 340:400] = (230, 120, 40)  # bleu vif
    img[180:230, 180:230] = (60, 90, 130)  # boîte de capture : orange terne
    zones = map_spawn.find_zones(img)
    assert len(zones["A"]) == 1 and len(zones["B"]) == 1
    assert zones["A"][0][0] == 0.0 and zones["B"][0][2] == 1.0


def test_a_team_can_have_several_start_rectangles():
    spawns = {"A": ((0.1, 0.0, 0.2, 0.2), (0.1, 0.8, 0.2, 1.0)), "B": (0.8, 0.4, 0.9, 0.6)}
    assert len(tracking._rects(spawns, "A")) == 2 and len(tracking._rects(spawns, "B")) == 1
    assert tracking._in_spawn({"team": "A", "x": 0.15, "y": 0.9}, spawns)
    assert not tracking._in_spawn({"team": "A", "x": 0.15, "y": 0.5}, spawns)
    assert tracking._in_spawn({"team": "A", "x": 0.5, "y": 0.5}, {})  # carte sans zone : tout point passe
    assert set(tracking._enemy_headings(spawns)) == {"A", "B"}
