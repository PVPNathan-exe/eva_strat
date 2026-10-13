"""Points de capture mobiles (Outlaw), zones de départ neutres et « Hors map » en zone."""

import json
import sqlite3

import cv2
import numpy as np

import capture_points
import db
import map_annotations
import tracking


def _scene(box_at=None, size=380):
    """Minimap synthétique : fond uni (la médiane) et, si `box_at` (x, y en pixels, coin haut gauche), une boîte de capture grise de 46 sur 46."""
    median = np.full((size, size, 3), 70, np.uint8)
    frame = median.copy()
    if box_at:
        x, y = box_at
        frame[y : y + 46, x : x + 46] = (170, 170, 170)
    return frame, median


def test_an_active_capture_box_is_found_and_its_owner_read():
    frame, median = _scene((100, 200))
    boxes = capture_points.detect_boxes(frame, median)
    assert len(boxes) == 1 and abs(boxes[0]["x"] - 123 / 380) < 0.01 and abs(boxes[0]["y"] - 223 / 380) < 0.01
    assert boxes[0]["owner"] == "neutre"
    frame[200:246, 100:146] = (200, 120, 60)  # BGR : bleu
    assert capture_points.detect_boxes(frame, median)[0]["owner"] == "bleu"


def test_a_player_dot_or_a_thin_line_is_not_a_capture_box():
    frame, median = _scene()
    cv2.circle(frame, (100, 100), 8, (255, 255, 255), -1)  # pastille de joueur
    frame[300:304, 20:300] = (255, 255, 255)  # trait de mur
    assert capture_points.detect_boxes(frame, median) == []


def _box(x, y):
    return {"x": x, "y": y, "fw": 0.12, "fh": 0.12, "owner": "neutre"}


def test_segments_keep_boxes_that_stay_and_drop_short_flashes():
    samples = [(2.0 * k, [_box(0.3, 0.4)]) for k in range(30)]  # 58 s au même endroit
    samples += [(2.0 * k, [_box(0.8, 0.8)]) for k in range(30, 33)]  # 6 s : une zone de départ qui passe
    samples += [(2.0 * k, [_box(0.31, 0.4)]) for k in range(33, 45)]  # la boîte revient 8 s plus tard (plus que MAX_GAP_S) : un nouveau segment
    segs = capture_points.segments(samples)
    assert [(s["t0"], s["t1"]) for s in segs] == [(0.0, 58.0), (66.0, 88.0)]  # le passage de 6 s (zone de départ) n'est pas gardé


def test_a_lost_box_for_a_few_seconds_is_still_the_same_segment():
    samples = [(2.0 * k, [_box(0.3, 0.4)] if k not in (5, 6) else []) for k in range(30)]
    assert len(capture_points.segments(samples)) == 1


def test_points_are_named_from_the_indications_and_unseen_ones_stay_indications():
    hints = {"A": (0.2, 0.2), "B": (0.7, 0.3), "E": (0.5, 0.9)}
    segs = [
        {"t0": 0, "t1": 80, "x": 0.21, "y": 0.19, "w": 0.12, "h": 0.12},
        {"t0": 90, "t1": 170, "x": 0.69, "y": 0.31, "w": 0.1, "h": 0.15},
        {"t0": 180, "t1": 260, "x": 0.5, "y": 0.5, "w": 0.1, "h": 0.1},  # loin de toute indication
    ]
    points = capture_points.build_points("Test", segs, hints)
    assert points["A"]["vu"] and points["B"]["vu"] and not points["E"]["vu"]
    assert points["E"] == {"x": 0.5, "y": 0.9, "vu": False}
    assert [s[2] for s in capture_points.sequence("Test", segs, hints)] == ["A", "B", None]
    again = capture_points.build_points("Test", segs[:1], hints, previous=points)
    assert again["B"]["vu"]  # un point vu sur une autre game reste vu


def test_boxes_drawn_on_the_plan_place_the_points_never_seen(tmp_path, monkeypatch):
    import plan_mask

    plan = np.full((400, 400, 3), 40, np.uint8)
    plan[100:160, 60:140] = (120, 120, 120)  # boîte du point A (grise, unie)
    plan[300:350, 250:340] = (120, 120, 120)  # boîte du point E
    plan[200:210, 20:380] = (120, 120, 120)  # un trait gris long et fin : pas une boîte
    cv2.imwrite(str(tmp_path / "Test.png"), plan)
    monkeypatch.setattr(plan_mask, "plan_file", lambda name: tmp_path / "Test.png")
    inset = {"l": 0.0, "t": 0.0, "r": 0.0, "b": 0.0}
    boxes = capture_points.plan_boxes("Test", inset)
    assert len(boxes) == 2
    hints = {"A": (0.25, 0.32), "E": (0.74, 0.81)}
    seen = {"A": {"x": 0.25, "y": 0.32, "w": 0.24, "h": 0.18}}  # vu sur la minimap : la boîte y est 20 % plus large que sur le plan (0,20)
    points = capture_points.points_from_plan(boxes, hints, seen)
    assert list(points) == ["E"] and points["E"]["plan"] and not points["E"]["vu"]
    assert abs(points["E"]["x"] - 0.7375) < 0.01 and abs(points["E"]["y"] - 0.8125) < 0.01
    assert abs(points["E"]["w"] - 0.225 * 1.2) < 0.02  # taille du plan multipliée par le rapport mesuré sur A


def test_boxes_are_stored_and_read_back_per_game(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    conn.execute("PRAGMA foreign_keys=OFF")
    segs = [{"t0": 35.0, "t1": 120.0, "x": 0.3, "y": 0.4, "w": 0.12, "h": 0.12}, {"t0": 125.0, "t1": 210.0, "x": 0.7, "y": 0.2, "w": 0.1, "h": 0.1}]
    db.replace_capture_boxes(conn, 1, segs, lambda x, y: "C" if x < 0.5 else "B")
    got = db.capture_boxes_of(conn, 1)
    assert [g["point"] for g in got] == ["C", "B"] and got[0]["t0"] == 35.0
    db.replace_capture_boxes(conn, 1, segs[:1], lambda x, y: "C")
    assert len(db.capture_boxes_of(conn, 1)) == 1 and db.capture_boxes_of(conn, 2) == []  # remplacé, pas cumulé


def _connection(data):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE map_annotations (map TEXT PRIMARY KEY, data TEXT NOT NULL, updated TEXT)")
    conn.execute("CREATE TABLE games (id INTEGER PRIMARY KEY, map TEXT)")
    conn.execute("CREATE TABLE samples (game_id INTEGER, alive INTEGER, confidence REAL, x REAL, y REAL)")
    conn.execute("INSERT INTO games VALUES (1, 'Test')")
    conn.execute("INSERT INTO map_annotations VALUES ('Test', ?, NULL)", (json.dumps(data),))
    return conn


def _redirect(tmp_path, monkeypatch):
    monkeypatch.setattr(map_annotations, "MASK_DIR", tmp_path)
    for name in ("TELEPORTS", "SPAWNS", "INSETS", "DOORS", "STATIONS", "CAPTURE"):
        monkeypatch.setattr(map_annotations, name, tmp_path / f"{name}.json")
    cv2.imwrite(str(tmp_path / "Test_mediane.png"), np.full((50, 50, 3), 30, np.uint8))


def test_apply_burns_the_capture_boxes_found_and_not_the_polygons_drawn_as_indications(tmp_path, monkeypatch):
    _redirect(tmp_path, monkeypatch)
    points = tmp_path / "points.json"
    points.write_text(json.dumps({"Test": {"points": {"A": {"x": 0.7, "y": 0.7, "w": 0.2, "h": 0.2, "vu": True}, "E": {"x": 0.2, "y": 0.2, "vu": False}}}}), encoding="utf-8")
    monkeypatch.setattr(capture_points, "POINTS", points)
    drawn = [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]  # polygone tracé à la main sur le point E (jamais vu)
    summary = map_annotations.apply(_connection({"capture": [drawn]}), "Test")
    mask = cv2.imread(str(tmp_path / "Test.png"), cv2.IMREAD_GRAYSCALE)
    assert mask[280, 280] == 255  # la boîte vue
    assert mask[80, 80] == 0  # l'indication seule ne fait pas du sol
    assert summary["points_de_capture_vus"] == ["A"] and summary["points_de_capture_indiques_seulement"] == ["E"]


def test_neutral_spawn_zones_count_for_both_teams(tmp_path, monkeypatch):
    _redirect(tmp_path, monkeypatch)
    monkeypatch.setattr(capture_points, "POINTS", tmp_path / "absent.json")
    data = {"spawns": {"any": [[0.1, 0.1, 0.2, 0.2], [0.8, 0.8, 0.9, 0.9]]}}
    assert map_annotations.validate(data)["spawns"]["any"][1] == [0.8, 0.8, 0.9, 0.9]
    map_annotations.apply(_connection(data), "Test")
    written = json.loads((tmp_path / "SPAWNS.json").read_text(encoding="utf-8"))["Test"]
    assert written["A"] == written["B"] == [[0.1, 0.1, 0.2, 0.2], [0.8, 0.8, 0.9, 0.9]]


def test_at_most_four_neutral_zones():
    five = {"spawns": {"any": [[0.1 * k, 0.1, 0.1 * k + 0.05, 0.2] for k in range(5)]}}
    try:
        map_annotations.validate(five)
    except ValueError:
        return
    raise AssertionError("cinq zones neutres auraient dû être refusées")


def test_no_enemy_camp_when_both_teams_share_the_same_zones():
    shared = {"A": [[0.1, 0.1, 0.2, 0.2], [0.8, 0.8, 0.9, 0.9]], "B": [[0.1, 0.1, 0.2, 0.2], [0.8, 0.8, 0.9, 0.9]]}
    assert tracking._enemy_headings(shared) == {}
    split = {"A": [[0.1, 0.4, 0.2, 0.5]], "B": [[0.8, 0.4, 0.9, 0.5]]}
    assert tracking._enemy_headings(split)["A"] < 10 or tracking._enemy_headings(split)["A"] > 350  # A regarde vers la droite
