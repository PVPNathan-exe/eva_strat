import cv2
import numpy as np

import db
import minimap
import positions


def marker(team, x, y, number=None, alive=True):
    slot = minimap.slot_of(number) if number else None
    return {"team": team, "x": x, "y": y, "number": number, "slot": slot, "angle": 0.0, "alive": alive, "spectated": False}


def test_number_read_gives_the_slot_and_full_confidence():
    out = positions.Tracker().assign([marker("A", 0.2, 0.3, 3), marker("B", 0.8, 0.5, 9)])
    assert sorted((slot, conf) for slot, _, conf in out) == [(3, 1.0), (8, 1.0)]


def test_unreadable_marker_follows_the_nearest_known_player():
    tr = positions.Tracker()
    tr.assign([marker("A", 0.20, 0.30, 1), marker("A", 0.60, 0.60, 2)])
    out = tr.assign([marker("A", 0.22, 0.31), marker("A", 0.58, 0.62)])
    assert sorted((slot, conf) for slot, _, conf in out) == [(1, 0.6), (2, 0.6)]
    assert {slot: m["x"] for slot, m, _ in out} == {1: 0.22, 2: 0.58}


def test_far_unreadable_marker_is_not_attached_by_distance():
    tr = positions.Tracker()
    tr.assign([marker("A", 0.05, 0.05, 1), marker("A", 0.1, 0.1, 2), marker("A", 0.2, 0.1, 3)])
    out = tr.assign([marker("A", 0.9, 0.9)])  # trop loin de tout le monde ; trois joueurs libres : pas d'élimination
    assert out == []


def test_elimination_when_one_player_and_one_marker_remain():
    tr = positions.Tracker()
    out = tr.assign([marker("A", 0.1, 0.1, 1), marker("A", 0.2, 0.2, 2), marker("A", 0.3, 0.3, 3), marker("A", 0.9, 0.9)])
    assert (4, 0.4) in [(slot, conf) for slot, _, conf in out]


def test_duplicate_numbers_in_one_reading_are_treated_as_unreliable():
    out = positions.Tracker().assign([marker("A", 0.1, 0.1, 2), marker("A", 0.8, 0.8, 2)])
    assert all(conf < 1.0 for _, _, conf in out)


def test_dead_marker_keeps_the_players_slot():
    tr = positions.Tracker()
    tr.assign([marker("B", 0.5, 0.5, 7)])
    out = tr.assign([marker("B", 0.5, 0.52, alive=False)])
    assert [(slot, m["alive"]) for slot, m, _ in out] == [(6, False)]


def test_find_markers_on_a_synthetic_minimap():
    img = np.full((225, 440, 3), 53, np.uint8)
    cv2.circle(img, (100, 80), 11, (0, 130, 255), -1)  # pastille orange (BGR)
    cv2.circle(img, (300, 150), 11, (230, 150, 70), -1)  # pastille bleue
    cv2.rectangle(img, (0, 60), (60, 160), (30, 70, 130), -1)  # zone d'apparition sombre : ignorée
    found = minimap.find_markers(img, {})
    assert sorted(m["team"] for m in found) == ["A", "B"]
    a = next(m for m in found if m["team"] == "A")
    assert abs(a["x"] - 100 / 440) < 0.01 and abs(a["y"] - 80 / 225) < 0.01


def test_samples_are_stored_per_game_and_replaced(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s) VALUES (?, 10, 100)", (vid,))
    gid = conn.execute("SELECT id FROM games").fetchone()["id"]
    assert [g["id"] for g in db.games_without_samples(conn, vid)] == [gid]
    db.replace_samples(conn, gid, [(0, 10.0, 1, "A", 0.1, 0.2, 90.0, 1, 1.0), (0, 10.0, 5, "B", 0.8, 0.2, None, 0, 0.6)])
    assert db.games_without_samples(conn, vid) == []
    db.replace_samples(conn, gid, [(0, 10.0, 1, "A", 0.3, 0.3, None, 1, 1.0)])
    assert conn.execute("SELECT COUNT(*) AS n FROM samples").fetchone()["n"] == 1


def test_zone_for_prefers_the_maps_calibration(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    default = db.zone_for(conn, None, "minimap")
    conn.execute("INSERT INTO calibrations (map, zone, x, y, w, h) VALUES ('Silva', 'minimap', 0.1, 0.2, 0.3, 0.4)")
    assert db.zone_for(conn, "Silva", "minimap") == {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}
    assert db.zone_for(conn, "Ceres", "minimap") == default
