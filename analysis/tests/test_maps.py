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
    assert got["doors"][0] == {"from": [0.1, 0.1], "to": [0.2, 0.1], "kind": "fenetre", "glass": False, "side": 0, "under": False}
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


def test_a_class_zone_replaces_one_class_by_another_only_inside_the_polygon():
    labels = np.full((50, 50), map_annotations.CODES["tir"], np.uint8)
    labels[0:5, :] = map_annotations.CODES["mur"]
    zone = {"polygon": [[0.0, 0.0], [0.5, 0.0], [0.5, 1.0], [0.0, 1.0]], "from": "tir", "to": "vue"}  # moitié gauche
    got = map_annotations.validate({"overrides": [zone]})["overrides"]
    map_annotations.apply_overrides(labels, got)
    assert labels[25, 10] == map_annotations.CODES["vue"] and labels[25, 40] == map_annotations.CODES["tir"]
    assert labels[2, 10] == map_annotations.CODES["mur"]  # un mur dans la zone n'est pas un tir
    any_zone = map_annotations.validate({"overrides": [{**zone, "from": "any", "to": "sol"}]})["overrides"]
    map_annotations.apply_overrides(labels, any_zone)
    assert labels[2, 10] == map_annotations.CODES["sol"] and labels[25, 40] == map_annotations.CODES["tir"]
    with pytest.raises(ValueError):
        map_annotations.validate({"overrides": [{**zone, "to": "lave"}]})
    with pytest.raises(ValueError):
        map_annotations.validate({"overrides": [{**zone, "polygon": [[0, 0], [1, 1]]}]})


def test_shoot_over_lines_are_not_walkable_but_stay_shoot_over_in_the_classes():
    labels = np.full((40, 40), map_annotations.CODES["sol"], np.uint8)
    line = {"from": [0.2, 0.5], "to": [0.8, 0.5], "kind": "tir", "glass": False, "side": 0}
    got = map_annotations.validate({"doors": [line]})["doors"]
    map_annotations.burn_shapes(labels, got, [])
    assert labels[round(0.5 * 39), 20] == map_annotations.CODES["tir"] and got[0]["kind"] == "tir"
    walk = map_annotations.walkable_from_classes(labels)
    assert not walk[round(0.5 * 39), 20] and walk[5, 20]


# --- recoupement avec le plan stratégique (plan_mask.py) ---

import plan_mask


def _plan_image():
    """Plan synthétique 200 x 100 : fond sombre (sol), cadre blanc, un mur blanc vertical épais au milieu, une lettre blanche (petit bloc)."""
    plan = np.full((100, 200, 3), 40, np.uint8)
    plan[0:6, :] = 255
    plan[94:100, :] = 255
    plan[:, 0:6] = 255
    plan[:, 194:200] = 255
    plan[6:94, 95:105] = 255  # mur épais au milieu
    plan[40:55, 40:50] = 255  # lettre : petit bloc blanc, pas un mur
    return plan


def test_plan_walls_ignore_small_white_blocks_and_keep_the_frame_and_thick_walls():
    walls = plan_mask.wall_mask(_plan_image())
    assert walls[50, 100] and walls[2, 100] and not walls[45, 45]  # mur et cadre gardés, lettre écartée


def test_the_plan_adds_missing_floor_inside_the_arena_and_removes_walkable_walls():
    plan = _plan_image()
    inset = {"l": 0.0, "t": 0.0, "r": 0.0, "b": 0.0}
    labels = np.zeros((100, 200), np.uint8)
    labels[10:90, 10:90] = map_annotations.CODES["sol"]  # moitié gauche saisie, moitié droite oubliée
    labels[20:30, 150:160] = map_annotations.CODES["mur"]  # un mur saisi à la main : jamais écrasé
    fill, walls, exterior = plan_mask.corrections(labels, map_annotations.CODES["sol"], plan, inset)
    assert fill[50, 150] and fill[50, 120]  # sol oublié à droite du mur : ajouté
    assert not fill[25, 155]  # la classe explicite de l'utilisateur est respectée
    assert not fill[50, 100]  # le mur du plan n'est pas du sol
    assert not fill[3, 100]  # l'extérieur du cadre n'est pas ajouté (ici le cadre lui-même)
    walk = map_annotations.walkable_from_classes(labels)
    walk[48:52, 98:102] = True  # une saisie trop large qui mord sur le mur du plan
    protect = np.zeros_like(walk)
    protect[49, 99] = True  # une porte tracée dessus reste praticable
    fixed = plan_mask.apply_to_walk(walk, fill, walls, protect, exterior)
    assert not fixed[50, 100] and fixed[49, 99] and fixed[50, 150]


def test_the_plan_step_is_refused_when_it_would_make_more_sure_reads_refused(tmp_path, monkeypatch):
    monkeypatch.setattr(map_annotations, "MASK_DIR", tmp_path)
    monkeypatch.setattr(plan_mask, "PLAN_DIR", tmp_path)
    monkeypatch.setattr(plan_mask, "MAX_ADD_SHARE", 100.0)  # sur ce plan minuscule le sol ajouté dépasse largement le sol saisi : on teste ici les lectures
    monkeypatch.setattr(plan_mask, "MAX_CUT_SHARE", 100.0)
    plan = _plan_image()
    plan[6:94, 70:130] = 255  # mur épais de 60 pixels : le sol est à plus de 2 cases de son centre
    cv2.imwrite(str(tmp_path / "Plan.png"), plan)
    labels = np.zeros((100, 200), np.uint8)
    labels[10:90, 10:90] = map_annotations.CODES["sol"]
    walk = map_annotations.walkable_from_classes(labels)
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY, map TEXT)")
    conn.execute("CREATE TABLE samples (game_id INTEGER, alive INTEGER, confidence REAL, x REAL, y REAL)")
    conn.execute("INSERT INTO games VALUES (1, 'Plan')")
    data = {"inset": {"l": 0.0, "t": 0.0, "r": 0.0, "b": 0.0}, "doors": []}
    # sans lecture : correction appliquée mais non vérifiée, aperçus écrits
    fixed, info = map_annotations.plan_step(conn, "Plan", data, labels.copy(), walk)
    assert info["plan_ajout_pixels"] > 0 and "plan_non_verifie" in info and (tmp_path / "Plan_plan_ajouts.png").exists()
    assert fixed[50, 150] and labels[50, 150] == 0
    # lectures sûres posées sur le mur du plan : les retirer du masque les ferait refuser, la correction est refusée
    conn.executemany("INSERT INTO samples VALUES (1, 1, 0.9, ?, ?)", [(0.5, 0.5)] * 50 + [(0.25, 0.5)] * 50)
    walk_wall = walk.copy()
    walk_wall[10:90, 70:130] = True  # la saisie rend le mur praticable, des joueurs y sont lus
    kept, info = map_annotations.plan_step(conn, "Plan", data, labels.copy(), walk_wall)
    assert "plan" in info and info["plan"].startswith("refusé") and kept is walk_wall
    # sans plan ou sans cadre : non appliqué
    assert "non appliqué" in map_annotations.plan_step(conn, "Inconnue", data, labels.copy(), walk)[1]["plan"]


def test_the_plan_step_is_refused_when_the_plan_floor_is_not_the_minimap_floor(tmp_path, monkeypatch):
    monkeypatch.setattr(map_annotations, "MASK_DIR", tmp_path)
    monkeypatch.setattr(plan_mask, "PLAN_DIR", tmp_path)
    cv2.imwrite(str(tmp_path / "Plan.png"), _plan_image())
    labels = np.zeros((100, 200), np.uint8)
    labels[10:90, 10:90] = map_annotations.CODES["sol"]  # le plan voudrait ajouter tout le côté droit : plus de 25 % du sol saisi
    walk = map_annotations.walkable_from_classes(labels)
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    kept, info = map_annotations.plan_step(conn, "Plan", {"inset": {"l": 0.0, "t": 0.0, "r": 0.0, "b": 0.0}, "doors": []}, labels.copy(), walk)
    assert info["plan"].startswith("refusé") and "ajouterait" in info["plan"] and kept is walk


def test_the_plan_removes_what_is_outside_the_arena_but_keeps_both_levels():
    """Plan 200 x 100 avec un cadre blanc à 20 pixels du bord : au-delà, c'est le fond de la minimap (hors carte). Une couleur de sol saisie qui recouvre aussi le fond y ajoute des pixels."""
    plan = np.full((100, 200, 3), 40, np.uint8)
    plan[20:28, 20:180] = 255  # cadre (assez épais pour compter comme mur : au moins WALL_MIN_AREA pixels)
    plan[72:80, 20:180] = 255
    plan[20:80, 20:28] = 255
    plan[20:80, 172:180] = 255
    plan[35:65, 50:150] = 255  # un bloc de mur intérieur (3 000 pixels : compte comme mur)
    labels = np.zeros((100, 200), np.uint8)
    labels[30:70, 30:170] = map_annotations.CODES["sol"]  # l'arène
    labels[0:15, :] = map_annotations.CODES["sol"]  # fond de la minimap pris pour du sol : hors carte
    labels[66:70, 80:120] = map_annotations.CODES["sol"]  # un deuxième niveau, dans l'arène, sous le bloc
    walk = map_annotations.walkable_from_classes(labels)
    fill, walls, exterior = plan_mask.corrections(labels, map_annotations.CODES["sol"], plan, {"l": 0.0, "t": 0.0, "r": 0.0, "b": 0.0})
    fixed = plan_mask.apply_to_walk(walk, fill, walls, np.zeros_like(walk), exterior)
    assert walk[5, 100] and not fixed[5, 100]  # le fond au-dessus du cadre n'est plus praticable
    assert fixed[33, 40] and fixed[68, 100]  # l'arène et son deuxième niveau le restent
    assert not fixed[45, 100]  # le mur du plan est retiré
    # cadre ouvert ou sol saisi qui déborde : une composante qui porte l'essentiel du sol n'est jamais retirée comme extérieur
    all_floor = np.full((100, 200), map_annotations.CODES["sol"], np.uint8)
    _, _, ext2 = plan_mask.corrections(all_floor, map_annotations.CODES["sol"], np.full((100, 200, 3), 40, np.uint8), {"l": 0.0, "t": 0.0, "r": 0.0, "b": 0.0})
    assert not ext2.any()


def _reads_db(points, map_name="Lu"):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY, map TEXT)")
    conn.execute("CREATE TABLE samples (game_id INTEGER, alive INTEGER, confidence REAL, x REAL, y REAL)")
    conn.execute("INSERT INTO games VALUES (1, ?)", (map_name,))
    conn.executemany("INSERT INTO samples VALUES (1, 1, ?, ?, ?)", points)
    return conn


def test_sure_reads_make_the_ground_walkable_but_an_isolated_read_is_noise():
    walk = np.zeros((100, 200), bool)
    walk[10:90, 10:90] = True  # le sol saisi : à gauche ; le joueur a été lu à droite, sur un contour classé en mur
    path = [(0.60 + 0.004 * k, 0.50, 0.9, 0.0) for k in range(5)]  # lecture soutenue : 5 lectures voisines
    points = [(c, x, y) for x, y, c, _ in path] + [(0.9, 0.95, 0.10)] + [(0.3, 0.60, 0.80)]  # une lecture isolée, une lecture peu sûre
    walk_in, info = map_annotations.reads_step(_reads_db(points), "Lu", walk, [])
    assert walk_in[50, 120] and walk_in[50, 124]  # le joueur lu en x = 0,60 (colonne 120) : sol ajouté
    assert not walk_in[10, 190] and not walk_in[80, 120] and info["lectures_ajout_pixels"] > 0  # lecture isolée ou peu sûre : rien
    line = {"from": [0.55, 0.5], "to": [0.65, 0.5], "kind": "fenetre", "glass": False, "side": 0}
    blocked, _ = map_annotations.reads_step(_reads_db(points), "Lu", walk, [line])
    assert not blocked[50, 120]  # sous une fenêtre tracée à la main, une lecture ne rend rien praticable
    assert map_annotations.reads_step(_reads_db([]), "Lu", walk, []) == (walk, {})  # aucune lecture : rien ne change
    assert map_annotations.reads_step(sqlite3.connect(":memory:"), "Lu", walk, []) == (walk, {})  # pas de table de lectures


def test_a_line_or_zone_marked_passable_below_keeps_the_floor_walkable_but_keeps_its_class():
    """Atlantis : le bord d'un étage où l'on tire par-dessus bloque l'étage, pas le niveau du dessous (le joueur 2 de la game 31 le longe à 0:05)."""
    floor = np.zeros((60, 120), bool)
    floor[10:50, 10:110] = True
    labels = np.zeros((60, 120), np.uint8)
    labels[floor] = map_annotations.CODES["sol"]
    line = {"from": [0.2, 0.5], "to": [0.8, 0.5], "kind": "tir", "glass": False, "side": 0, "under": True}
    blocked = {**line, "under": False, "from": [0.2, 0.3], "to": [0.8, 0.3]}
    got = map_annotations.validate({"doors": [line, blocked], "overrides": [{"polygon": [[0.1, 0.8], [0.9, 0.8], [0.9, 0.9], [0.1, 0.9]], "from": "any", "to": "mur", "under": True}]})
    assert got["doors"][0]["under"] is True and got["doors"][1]["under"] is False and got["overrides"][0]["under"] is True
    walk = map_annotations.walkable_from_classes(labels)
    map_annotations.burn_shapes(labels, got["doors"], [])
    map_annotations.apply_overrides(labels, got["overrides"])
    assert labels[round(0.5 * 59), 60] == map_annotations.CODES["tir"]  # la classe reste « tir par-dessus » dans l'aperçu des classes
    cut = map_annotations.walkable_from_classes(labels)
    cut &= ~map_annotations._line_layer(cut.shape, map_annotations.blocking_lines(got["doors"]))
    keep = map_annotations.under_layer(cut.shape, got["doors"], got["overrides"], walk)
    final = cut | keep
    assert not cut[round(0.5 * 59), 60] and final[round(0.5 * 59), 60]  # passage possible en dessous : le sol reste praticable
    assert not final[round(0.3 * 59), 60]  # un trait sans « dessous » bloque toujours
    assert not final[round(0.85 * 59), 60]  # ce qui n'était pas du sol (le mur) le reste : la zone ne crée pas de sol
    assert map_annotations.validate({"doors": [{**line, "kind": "porte"}]})["doors"][0]["under"] is False  # une porte n'a pas de dessous


def test_apply_writes_the_below_layer_only_when_something_passes_below(tmp_path, monkeypatch):
    monkeypatch.setattr(map_annotations, "MASK_DIR", tmp_path)
    for name in ("TELEPORTS", "SPAWNS", "INSETS", "DOORS", "STATIONS", "CAPTURE"):
        monkeypatch.setattr(map_annotations, name, tmp_path / f"{name}.json")
    img = np.zeros((50, 50, 3), np.uint8)
    img[10:40, 10:40] = (90, 90, 90)
    cv2.imwrite(str(tmp_path / "Test_mediane.png"), img)
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE map_annotations (map TEXT PRIMARY KEY, data TEXT NOT NULL, updated TEXT)")
    line = {"from": [0.2, 0.5], "to": [0.8, 0.5], "kind": "tir", "glass": False, "side": 0, "under": True}
    data = {"colors": [{"rgb": [90, 90, 90], "tol": 5, "cls": "sol"}], "doors": [line]}
    conn.execute("INSERT INTO map_annotations VALUES ('Test', ?, NULL)", (json.dumps(data),))
    map_annotations.apply(conn, "Test")
    below = cv2.imread(str(tmp_path / "Test_dessous.png"), cv2.IMREAD_GRAYSCALE)
    assert below is not None and below[round(0.5 * 49), 25] == 255 and below[5, 5] == 0  # le trait sur du sol : gardé ; hors du sol : rien
    data["doors"] = [{**line, "under": False}]
    conn.execute("UPDATE map_annotations SET data = ? WHERE map = 'Test'", (json.dumps(data),))
    map_annotations.apply(conn, "Test")
    assert not (tmp_path / "Test_dessous.png").exists()  # plus rien en dessous : l'ancien fichier est retiré


def test_outputs_can_be_redirected_so_that_a_test_never_touches_the_users_maps(tmp_path, monkeypatch):
    for name in ("MASK_DIR", "TELEPORTS", "SPAWNS", "INSETS", "DOORS", "CAPTURE", "STATIONS"):
        monkeypatch.setattr(map_annotations, name, getattr(map_annotations, name))  # restaure la valeur d'origine à la fin du test
    monkeypatch.setattr(plan_mask, "INSETS", plan_mask.INSETS)
    original_masks, original_insets = map_annotations.MASK_DIR, map_annotations.INSETS
    map_annotations.redirect_outputs(tmp_path)
    assert map_annotations.MASK_DIR == tmp_path / "map_masks" and (tmp_path / "map_masks" / "Polaris_mediane.png").exists()  # les médianes sont copiées : on peut appliquer
    assert map_annotations.INSETS == tmp_path / "map_plan_insets.json" and (tmp_path / "map_plan_insets.json").exists()
    assert plan_mask.INSETS == map_annotations.INSETS  # le cadre lu par le recoupement avec le plan suit
    assert map_annotations.MASK_DIR != original_masks and map_annotations.INSETS != original_insets


# --- classe « hors map » et chemins épais de tyrolienne (Outlaw) ---

def test_hors_map_is_a_zone_class_never_a_pixel_colour():
    data = map_annotations.validate({"colors": [{"rgb": [1, 2, 3], "tol": 10, "cls": "hors"}, {"rgb": [4, 5, 6], "tol": 10, "cls": "sol"}],
                                     "overrides": [{"polygon": [[0, 0], [1, 0], [1, 1], [0, 1]], "from": "any", "to": "hors"}]})
    assert [c["cls"] for c in data["colors"]] == ["sol"]  # une couleur « hors » (ancien format) est écartée
    assert data["overrides"][0]["to"] == "hors"
    labels = np.full((10, 10), map_annotations.CODES["sol"], np.uint8)
    map_annotations.apply_overrides(labels, [{"polygon": [[0.0, 0.0], [0.5, 0.0], [0.5, 1.0], [0.0, 1.0]], "from": "any", "to": "hors"}])
    assert labels[5, 1] == map_annotations.CODES["hors"] and labels[5, 8] == map_annotations.CODES["sol"]  # seule la zone est retirée
    assert not map_annotations.walkable_from_classes(labels)[5, 1]  # hors map n'est pas praticable


def test_apply_removes_hors_map_pixels_even_where_the_plan_or_the_reads_would_add_floor(tmp_path, monkeypatch):
    monkeypatch.setattr(map_annotations, "MASK_DIR", tmp_path)
    for name in ("TELEPORTS", "SPAWNS", "INSETS", "DOORS", "STATIONS", "CAPTURE"):
        monkeypatch.setattr(map_annotations, name, tmp_path / f"{name}.json")
    img = np.zeros((50, 50, 3), np.uint8)
    img[:, :] = (30, 30, 30)  # fond
    img[10:40, 10:40] = (90, 90, 90)  # sol
    img[10:40, 40:50] = (88, 90, 90)  # à côté : une couleur de fond très proche du sol, hors de la carte
    cv2.imwrite(str(tmp_path / "Test_mediane.png"), img)
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE map_annotations (map TEXT PRIMARY KEY, data TEXT NOT NULL, updated TEXT)")
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY, map TEXT)")
    conn.execute("CREATE TABLE samples (game_id INTEGER, alive INTEGER, confidence REAL, x REAL, y REAL)")
    conn.execute("INSERT INTO games VALUES (1, 'Test')")
    conn.executemany("INSERT INTO samples VALUES (1, 1, 0.9, ?, ?)", [(0.3 + 0.0003 * k, 0.5) for k in range(1000)])  # des lectures sûres sur le sol
    conn.executemany("INSERT INTO samples VALUES (1, 1, 0.9, ?, ?)", [(0.9 + 0.004 * k, 0.5) for k in range(6)])  # et quelques-unes dans la zone hors map (0,6 % : le masque n'est pas refusé)
    zone = [[0.8, 0.2], [1.0, 0.2], [1.0, 0.8], [0.8, 0.8]]  # la bande de droite, de la couleur du sol à 2 niveaux près : aucune couleur ne peut la séparer, la zone le fait
    data = {"colors": [{"rgb": [90, 90, 90], "tol": 4, "cls": "sol"}], "overrides": [{"polygon": zone, "from": "any", "to": "hors"}]}
    conn.execute("INSERT INTO map_annotations VALUES ('Test', ?, NULL)", (json.dumps(data),))
    summary = map_annotations.apply(conn, "Test")
    mask = cv2.imread(str(tmp_path / "Test.png"), cv2.IMREAD_GRAYSCALE)
    assert mask[200, 160] == 255 and mask[200, 380] == 0  # sol gardé, hors map retiré (la zone de droite, malgré les lectures)
    data["usePlan"] = True
    conn.execute("UPDATE map_annotations SET data = ? WHERE map = 'Test'", (json.dumps(data),))
    map_annotations.apply(conn, "Test")
    assert cv2.imread(str(tmp_path / "Test.png"), cv2.IMREAD_GRAYSCALE)[200, 380] == 0  # les lectures ne le remplissent pas non plus
    assert "praticable" in summary


def test_a_thick_tp_path_of_wall_colour_becomes_floor_but_a_thin_wall_under_a_thin_path_stays_a_wall():
    median = np.full((100, 100, 3), 60, np.uint8)
    median[10:90, 46:54] = (150, 150, 150)  # chemin épais (8 pixels) de la couleur des murs, vertical
    tps = [{"from": [0.5, 0.1], "to": [0.5, 0.9]}]
    paths = map_annotations.measure_paths(median, tps)
    assert 7 <= paths[0]["width"] <= 9 and abs(paths[0]["shift"][0]) < 1.5
    labels = np.full((100, 100), map_annotations.CODES["sol"], np.uint8)
    labels[median[:, :, 0] == 150] = map_annotations.CODES["mur"]  # la sélection des couleurs en a fait un mur
    walk = map_annotations.walkable_from_classes(labels)
    assert not walk[50, 50]
    map_annotations.open_tp_paths(walk, tps, paths)
    assert walk[50, 47] and walk[50, 52] and walk[20, 50]  # toute la bande du chemin est du sol
    off = [{"from": [0.44, 0.1], "to": [0.44, 0.9]}]  # centres posés 6 pixels à côté du chemin : l'axe est retrouvé
    paths_off = map_annotations.measure_paths(median, off)
    assert 5 <= abs(paths_off[0]["shift"][0]) <= 7 and 7 <= paths_off[0]["width"] <= 9
    walk_off = map_annotations.walkable_from_classes(labels)
    map_annotations.open_tp_paths(walk_off, off, paths_off)
    assert walk_off[50, 47] and walk_off[50, 52]
    void = np.full((100, 100), map_annotations.CODES["mur"], np.uint8)  # un chemin épais qui traverse du vide (aucun sol autour) n'ouvre rien
    nothing = map_annotations.walkable_from_classes(void)
    map_annotations.open_tp_paths(nothing, tps, paths)
    assert not nothing.any()
    thin = np.full((100, 100, 3), 60, np.uint8)
    thin[10:90, 49:51] = (150, 150, 150)  # chemin fin (2 pixels)
    assert map_annotations.measure_paths(thin, tps)[0]["width"] <= map_annotations.TP_BAND_PX
