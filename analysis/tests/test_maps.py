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


# --- cartographie à la main (map_annotations.py) ---

import json
import sqlite3

import pytest

import map_annotations


def test_classify_uses_the_nearest_colour_within_its_tolerance():
    img = np.zeros((1, 3, 3), np.uint8)
    img[0, 0] = (100, 100, 100)  # BGR identique en RGB
    img[0, 1] = (100, 100, 109)  # BGR : RVB (109, 100, 100)
    img[0, 2] = (100, 100, 160)
    colors = [{"rgb": [100, 100, 100], "tol": 10, "cls": "sol"}, {"rgb": [110, 100, 100], "tol": 10, "cls": "mur"}]
    labels = map_annotations.classify(img, colors)
    assert labels[0].tolist() == [map_annotations.CODES["sol"], map_annotations.CODES["mur"], 0]


def test_a_tp_path_inside_the_floor_is_walkable_but_a_tp_path_over_a_wall_is_not():
    labels = np.zeros((40, 40), np.uint8)
    labels[:, :] = map_annotations.CODES["mur"]
    labels[5:35, 5:35] = map_annotations.CODES["sol"]
    labels[20, 5:35] = map_annotations.CODES["tp"]  # trait de tyrolienne qui traverse le sol
    labels[20, 36:39] = map_annotations.CODES["tp"]  # le même trait au-dessus du mur
    walk = map_annotations.walkable_from_classes(labels)
    assert walk[20, 20] and not walk[20, 37]
    assert not walk[2, 2]


def test_doors_are_walkable_and_the_door_line_is_drawn_walkable():
    labels = np.full((40, 40), map_annotations.CODES["mur"], np.uint8)
    labels[10:12, 10:30] = map_annotations.CODES["porte"]
    labels[20:22, 10:30] = map_annotations.CODES["porte_vitre"]
    walk = map_annotations.walkable_from_classes(labels)
    assert walk[10, 20] and walk[20, 20]
    map_annotations.draw_doors(walk, [{"from": [0.1, 0.8], "to": [0.9, 0.8], "glass": False}])
    assert walk[31, 20]


def test_validate_refuses_three_spawn_zones_for_a_team_and_unknown_classes():
    ok = {"colors": [], "spawns": {"A": [[0.1, 0.1, 0.2, 0.2]] * 2}}
    assert map_annotations.validate(ok)["spawns"]["A"]
    with pytest.raises(ValueError):
        map_annotations.validate({"spawns": {"A": [[0.1, 0.1, 0.2, 0.2]] * 3}})
    with pytest.raises(ValueError):
        map_annotations.validate({"colors": [{"rgb": [1, 2, 3], "cls": "lave"}]})
    with pytest.raises(ValueError):
        map_annotations.validate({"doors": [{"from": [0.1, 0.1], "to": [2, 0.1]}]})


def test_apply_writes_mask_walls_teleports_spawns_and_doors(tmp_path, monkeypatch):
    monkeypatch.setattr(map_annotations, "MASK_DIR", tmp_path)
    for name in ("TELEPORTS", "SPAWNS", "INSETS", "DOORS"):
        monkeypatch.setattr(map_annotations, name, tmp_path / f"{name}.json")
    img = np.zeros((50, 50, 3), np.uint8)
    img[:, :] = (0, 0, 200)  # BGR : rouge = mur
    img[10:40, 10:40] = (90, 90, 90)  # sol
    cv2.imwrite(str(tmp_path / "Test_mediane.png"), img)
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE map_annotations (map TEXT PRIMARY KEY, data TEXT NOT NULL, updated TEXT)")
    data = {
        "colors": [{"rgb": [90, 90, 90], "tol": 5, "cls": "sol"}, {"rgb": [200, 0, 0], "tol": 5, "cls": "mur"}],
        "tps": [{"from": [0.2, 0.2], "to": [0.8, 0.8]}],
        "doors": [{"from": [0.1, 0.5], "to": [0.9, 0.5], "glass": True}],
        "spawns": {"A": [[0.1, 0.1, 0.2, 0.2]], "B": [[0.7, 0.7, 0.8, 0.8], [0.1, 0.7, 0.2, 0.8]]},
        "inset": {"l": 0.01, "t": 0.02, "r": 0.03, "b": 0.04},
    }
    conn.execute("INSERT INTO map_annotations VALUES ('Test', ?, NULL)", (json.dumps(data),))
    summary = map_annotations.apply(conn, "Test")
    assert summary["tyroliennes"] == 1 and summary["portes"] == 1 and summary["alignement"]
    mask = cv2.imread(str(tmp_path / "Test.png"), cv2.IMREAD_GRAYSCALE)
    assert mask.shape == (400, 400) and mask[200, 200] == 255 and mask[10, 10] == 0
    assert cv2.imread(str(tmp_path / "Test_lignes.png"), cv2.IMREAD_GRAYSCALE)[10, 10] == 255
    assert json.loads((tmp_path / "SPAWNS.json").read_text())["Test"]["B"] == [[0.7, 0.7, 0.8, 0.8], [0.1, 0.7, 0.2, 0.8]]
    assert json.loads((tmp_path / "TELEPORTS.json").read_text())["Test"] == [[[0.2, 0.2], [0.8, 0.8]]]
    (tmp_path / "SPAWNS.json").write_text(json.dumps({"Test": {"A": [0.0, 0.0, 0.1, 0.1], "B": [0.9, 0.9, 1.0, 1.0]}}))
    only_a = dict(data, spawns={"A": [[0.1, 0.1, 0.2, 0.2]], "B": []})
    conn.execute("UPDATE map_annotations SET data = ? WHERE map = 'Test'", (json.dumps(only_a),))
    map_annotations.apply(conn, "Test")
    kept = json.loads((tmp_path / "SPAWNS.json").read_text())["Test"]
    assert kept["A"] == [0.1, 0.1, 0.2, 0.2] and kept["B"] == [0.9, 0.9, 1.0, 1.0]  # l'équipe sans zone saisie garde la sienne
    assert map_annotations.apply(conn, "Inconnue") is None
