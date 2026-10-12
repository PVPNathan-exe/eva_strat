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


def test_station_pairs_keep_radius_and_direction_and_old_arrows_are_still_read():
    pair = {"a": {"x": 0.1, "y": 0.2, "r": 0.03, "angle": 450}, "b": {"x": 0.8, "y": 0.9, "r": 0.02, "angle": None}}
    # règle des 180 degrés : cliquées à la main, deux directions ne sont jamais exactement opposées
    assert map_annotations.opposite_angles(90.0, None) == (90.0, 270.0) and map_annotations.opposite_angles(None, 300.0) == (120.0, 300.0)
    assert map_annotations.opposite_angles(None, None) == (None, None)
    a, b = map_annotations.opposite_angles(320.0, 153.0)  # écart réel de 167 degrés : réparti entre les deux (13 degrés d'écart à 180, 6,5 chacun)
    assert abs(a - 326.5) < 1e-6 and abs(b - 146.5) < 1e-6
    a, b = map_annotations.opposite_angles(350.0, 190.0)  # autour de 0 et 360
    assert abs(a - 0.0) < 1e-6 or abs(a - 360.0) < 1e-6
    again = map_annotations.validate({"tps": [{"a": {"x": 0.1, "y": 0.2, "r": 0.03, "angle": 320.0}, "b": {"x": 0.8, "y": 0.9, "r": 0.02, "angle": 153.0}}]})["tps"][0]
    assert abs((again["b"]["angle"] - again["a"]["angle"]) % 360 - 180) < 1e-6
    old = {"from": [0.3, 0.3], "to": [0.6, 0.6]}
    got = map_annotations.validate({"tps": [pair, old], "colors": [{"rgb": [1, 2, 3], "cls": "tp"}]})
    assert got["tps"][0]["a"]["angle"] == 90.0 and got["tps"][0]["b"]["angle"] == 270.0 and got["tps"][0]["from"] == [0.1, 0.2]
    assert got["tps"][1]["a"]["r"] == map_annotations.DEFAULT_STATION_RADIUS and got["colors"] == []  # ancienne classe « tp » ignorée
    with pytest.raises(ValueError):
        map_annotations.validate({"tps": [{"a": {"x": 0.1, "y": 0.2, "r": 0.5}, "b": pair["b"]}]})


def test_a_thin_wall_coloured_line_under_a_tp_arrow_becomes_floor_but_a_thick_wall_does_not():
    labels = np.full((60, 60), map_annotations.CODES["mur"], np.uint8)
    labels[10:50, 5:55] = map_annotations.CODES["sol"]
    labels[29:31, 5:55] = map_annotations.CODES["mur"]  # trait fin de la couleur des murs posé sur le sol
    walk = map_annotations.walkable_from_classes(labels)
    assert not walk[30, 30]
    map_annotations.open_tp_paths(walk, [{"from": [0.1, 0.5], "to": [0.9, 0.5]}])
    assert walk[30, 30] and not walk[2, 30]
    thick = np.full((60, 60), map_annotations.CODES["mur"], np.uint8)
    thick[:, :20] = map_annotations.CODES["sol"]
    thick[:, 40:] = map_annotations.CODES["sol"]  # 20 pixels de vrai mur entre deux sols
    w2 = map_annotations.walkable_from_classes(thick)
    map_annotations.open_tp_paths(w2, [{"from": [0.0, 0.5], "to": [1.0, 0.5]}])
    assert not w2[30, 30]


def test_door_colours_are_walkable():
    labels = np.full((40, 40), map_annotations.CODES["mur"], np.uint8)
    labels[10:12, 10:30] = map_annotations.CODES["porte"]
    labels[20:22, 10:30] = map_annotations.CODES["porte_vitre"]
    walk = map_annotations.walkable_from_classes(labels)
    assert walk[10, 20] and walk[20, 20]


def test_drawn_doors_open_a_wall_but_windows_stay_closed_even_under_a_tp_arrow():
    labels = np.full((60, 60), map_annotations.CODES["mur"], np.uint8)
    labels[:, :25] = map_annotations.CODES["sol"]
    labels[:, 35:] = map_annotations.CODES["sol"]  # deux sols séparés par un mur de 10 pixels
    doors = [
        {"from": [0.4, 0.2], "to": [0.6, 0.2], "kind": "porte", "glass": False, "side": 0},
        {"from": [0.4, 0.5], "to": [0.6, 0.5], "kind": "porte", "glass": True, "side": 1},
        {"from": [0.4, 0.8], "to": [0.6, 0.8], "kind": "fenetre", "glass": False, "side": -1},
    ]
    map_annotations.burn_shapes(labels, doors, [])
    assert labels[12, 30] == map_annotations.CODES["porte"] and labels[30, 30] == map_annotations.CODES["porte_vitre"] and labels[47, 30] == map_annotations.CODES["vue"]
    walk = map_annotations.walkable_from_classes(labels)
    assert walk[12, 30] and walk[30, 30] and not walk[47, 30]
    map_annotations.open_tp_paths(walk, [{"from": [0.0, 0.8], "to": [1.0, 0.8]}])
    walk &= ~map_annotations._line_layer(walk.shape, [d for d in doors if d["kind"] == "fenetre"])
    assert not walk[47, 30]


def test_spawn_rectangles_are_playable_ground():
    labels = np.zeros((50, 50), np.uint8)
    labels[10:12, 5:15] = map_annotations.CODES["mur"]
    map_annotations.burn_shapes(labels, [], [], {"A": [[0.1, 0.1, 0.3, 0.5]], "B": []})
    walk = map_annotations.walkable_from_classes(labels)
    assert walk[20, 10] and not walk[10, 10] and not walk[40, 40]  # le départ est jouable, un mur classé dedans reste un mur


def test_station_discs_are_playable_ground():
    labels = np.zeros((50, 100), np.uint8)
    map_annotations.burn_shapes(labels, [], [], None, [{"x": 0.5, "y": 0.5, "r": 0.05, "angle": None}])
    walk = map_annotations.walkable_from_classes(labels)
    assert walk[25, 50] and walk[25, 53] and not walk[25, 60] and not walk[2, 2]  # rayon : 5 % de la largeur (5 pixels), cercle rond


def test_capture_squares_are_playable_ground_but_walls_inside_stay_walls():
    labels = np.zeros((50, 50), np.uint8)  # rien de classé : la teinte du carré n'est celle d'aucun sol choisi
    labels[24:26, 20:30] = map_annotations.CODES["mur"]  # mur classé dans le carré
    wall = {"from": [0.3, 0.6], "to": [0.7, 0.6], "kind": "mur", "glass": False, "side": 0}  # mur tracé dans le carré
    map_annotations.burn_shapes(labels, [wall], [map_annotations.validate({"capture": [[0.2, 0.2, 0.8, 0.8]]})["capture"][0]])
    walk = map_annotations.walkable_from_classes(labels)
    assert walk[22, 22] and not walk[5, 5]  # le carré est jouable, le reste non
    assert not walk[24, 25]  # le mur classé reste un mur
    assert not walk[round(0.6 * 49), 25]  # le trait de mur tracé aussi
    with pytest.raises(ValueError):
        map_annotations.validate({"capture": [[0.6, 0.4, 0.4, 0.6]]})
    with pytest.raises(ValueError):
        map_annotations.validate({"capture": [[[0.1, 0.1], [0.2, 0.2]]]})  # moins de 3 points
    # forme libre : un « L » ouvert d'un côté, jouable seulement à l'intérieur de la forme
    l_shape = [[0.2, 0.2], [0.5, 0.2], [0.5, 0.5], [0.8, 0.5], [0.8, 0.8], [0.2, 0.8]]
    labels = np.zeros((50, 50), np.uint8)
    map_annotations.burn_shapes(labels, [], [map_annotations.validate({"capture": [l_shape]})["capture"][0]])
    walk = map_annotations.walkable_from_classes(labels)
    assert walk[35, 15] and walk[15, 15] and walk[35, 35] and not walk[15, 40]
    got = map_annotations.validate({"doors": [{"from": [0.1, 0.1], "to": [0.2, 0.1], "kind": "fenetre", "glass": True, "side": 5}]})
    assert got["doors"][0] == {"from": [0.1, 0.1], "to": [0.2, 0.1], "kind": "fenetre", "glass": False, "side": 0}
    one_way = map_annotations.validate({"doors": [
        {"from": [0.1, 0.1], "to": [0.2, 0.1], "kind": "porte", "glass": True, "side": 1},
        {"from": [0.1, 0.1], "to": [0.2, 0.1], "kind": "porte", "glass": False, "side": 1},
    ]})["doors"]
    assert [d["side"] for d in one_way] == [1, 0]  # sens unique : fenêtre ou porte vitrée seulement


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
    for name in ("TELEPORTS", "SPAWNS", "INSETS", "DOORS", "STATIONS", "CAPTURE"):
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
        "tps": [{"a": {"x": 0.2, "y": 0.2, "r": 0.03, "angle": 90}, "b": {"x": 0.8, "y": 0.8, "r": 0.03, "angle": None}}],
        "doors": [{"from": [0.1, 0.5], "to": [0.9, 0.5], "kind": "fenetre", "glass": False, "side": 1}],
        "capture": [[0.45, 0.45, 0.55, 0.55]],
        "spawns": {"A": [[0.1, 0.1, 0.2, 0.2]], "B": [[0.7, 0.7, 0.8, 0.8], [0.1, 0.7, 0.2, 0.8]]},
        "inset": {"l": 0.01, "t": 0.02, "r": 0.03, "b": 0.04},
    }
    conn.execute("INSERT INTO map_annotations VALUES ('Test', ?, NULL)", (json.dumps(data),))
    summary = map_annotations.apply(conn, "Test")
    assert summary["tyroliennes"] == 1 and summary["fenetres"] == 1 and summary["zones_de_capture"] == 1 and summary["alignement"]
    mask = cv2.imread(str(tmp_path / "Test.png"), cv2.IMREAD_GRAYSCALE)
    assert mask.shape == (400, 400) and mask[150, 200] == 255 and mask[10, 10] == 0
    assert mask[200, 200] == 0  # la fenêtre tracée au milieu ne se traverse pas
    assert cv2.imread(str(tmp_path / "Test_lignes.png"), cv2.IMREAD_GRAYSCALE)[10, 10] == 255
    assert json.loads((tmp_path / "SPAWNS.json").read_text())["Test"]["B"] == [[0.7, 0.7, 0.8, 0.8], [0.1, 0.7, 0.2, 0.8]]
    assert json.loads((tmp_path / "TELEPORTS.json").read_text())["Test"] == [[[0.2, 0.2], [0.8, 0.8]]]
    assert json.loads((tmp_path / "STATIONS.json").read_text())["Test"][0]["a"]["angle"] == 90.0
    (tmp_path / "SPAWNS.json").write_text(json.dumps({"Test": {"A": [0.0, 0.0, 0.1, 0.1], "B": [0.9, 0.9, 1.0, 1.0]}}))
    only_a = dict(data, spawns={"A": [[0.1, 0.1, 0.2, 0.2]], "B": []})
    conn.execute("UPDATE map_annotations SET data = ? WHERE map = 'Test'", (json.dumps(only_a),))
    map_annotations.apply(conn, "Test")
    kept = json.loads((tmp_path / "SPAWNS.json").read_text())["Test"]
    assert kept["A"] == [0.1, 0.1, 0.2, 0.2] and kept["B"] == [0.9, 0.9, 1.0, 1.0]  # l'équipe sans zone saisie garde la sienne
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY, map TEXT)")
    conn.execute("CREATE TABLE samples (game_id INTEGER, alive INTEGER, confidence REAL, x REAL, y REAL)")
    conn.execute("INSERT INTO games VALUES (1, 'Test')")
    conn.executemany("INSERT INTO samples VALUES (1, 1, 0.9, ?, ?)", [(0.02, 0.02)] * 30 + [(0.5, 0.5)] * 70)  # 30 % des lectures sûres sur un mur
    before = (tmp_path / "Test.png").read_bytes()
    bad = map_annotations.apply(conn, "Test")
    assert "masque_non_ecrit" in bad and bad["lectures_sures_refusees"] > 0.2
    assert (tmp_path / "Test.png").read_bytes() == before  # le masque précédent est gardé
    assert map_annotations.apply(conn, "Inconnue") is None
