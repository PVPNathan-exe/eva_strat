import cv2
import numpy as np

import db
import minimap
import tracking

STEP = 0.2


def det(team, x, y, number=None, angle=0.0, alive=True):
    return {"team": team, "x": x, "y": y, "number": number, "slot": minimap.slot_of(number) if number else None,
            "angle": angle if alive else None, "alive": alive, "spectated": False}


def frames_of(per_frame):
    return [(i, round(i * STEP, 2), dets) for i, dets in enumerate(per_frame)]


def by_slot(rows):
    out = {}
    for r in rows:
        out.setdefault(r[2], {})[r[0]] = r
    return out


def test_number_read_now_and_then_names_the_whole_trajectory():
    seq = []
    for i in range(30):
        seq.append([det("A", 0.1 + 0.01 * i, 0.5, number=3 if i % 7 == 0 else None)])
    rows = by_slot(tracking.solve(frames_of(seq), STEP))
    assert set(rows) == {3}
    assert len(rows[3]) == 30  # aucune lecture perdue, même sans numéro


def test_two_players_crossing_do_not_swap_identities():
    seq = []
    for i in range(40):
        a = (0.2 + 0.015 * i, 0.4 + 0.004 * i)  # va vers la droite
        b = (0.8 - 0.015 * i, 0.4 + 0.004 * i)  # va vers la gauche : ils se croisent vers i = 20
        seq.append([det("A", *a, number=1 if i < 5 else None), det("A", *b, number=2 if i < 5 else None)])
    rows = by_slot(tracking.solve(frames_of(seq), STEP))
    assert rows[1][39][4] > 0.5 and rows[2][39][4] < 0.5  # chacun a gardé sa route


def test_dead_marker_goes_to_the_player_who_just_disappeared_there():
    seq = [[det("B", 0.7, 0.3, number=7), det("B", 0.2, 0.8, number=8)] for _ in range(10)]
    seq += [[det("B", 0.2, 0.8, number=8), det("B", 0.7, 0.3, alive=False)] for _ in range(6)]
    rows = by_slot(tracking.solve(frames_of(seq), STEP))
    assert [rows[6][i][7] for i in range(10, 16)] == [0] * 6  # le joueur 7 (slot 6) est mort
    assert all(rows[7][i][7] == 1 for i in range(16))  # le joueur 8 (slot 7) reste vivant


def test_short_hidden_gap_is_interpolated():
    seq = []
    for i in range(30):
        seq.append([] if 10 <= i < 13 else [det("A", 0.1 + 0.01 * i, 0.5, number=4)])
    rows = by_slot(tracking.solve(frames_of(seq), STEP))
    assert len(rows[4]) == 30
    assert rows[4][11][8] == tracking.CONF_FILL  # point comblé, confiance réduite


def test_isolated_wrong_direction_is_smoothed_away():
    seq = [[det("A", 0.3 + 0.002 * i, 0.5, number=1, angle=90.0 if i != 10 else 270.0)] for i in range(20)]
    rows = by_slot(tracking.solve(frames_of(seq), STEP))
    assert abs(rows[1][10][6] - 90.0) < 5


def test_two_trajectories_never_share_a_player_at_the_same_time():
    seq = [[det("A", 0.2, 0.2, number=1), det("A", 0.7, 0.7, number=1)] for _ in range(12)]  # deux « 1 » : une erreur de lecture
    rows = tracking.solve(frames_of(seq), STEP)
    assert rows  # au moins l'une des deux est gardée
    assert all(len({r[2] for r in rows if r[0] == i}) == len([r for r in rows if r[0] == i]) for i in range(12))


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


def test_cross_means_dead_but_a_clipped_or_ring_shaped_marker_stays_alive():
    img = np.full((225, 440, 3), 53, np.uint8)
    cv2.line(img, (93, 73), (107, 87), (0, 130, 255), 5)  # croix orange (BGR)
    cv2.line(img, (107, 73), (93, 87), (0, 130, 255), 5)
    cv2.circle(img, (300, 150), 11, (230, 150, 70), -1)  # pastille bleue ronde
    cv2.circle(img, (200, 3), 11, (0, 130, 255), -1)  # pastille orange coupée par le bord haut
    found = {(m["team"], round(m["x"] * 440 / 100)): m["alive"] for m in minimap.find_markers(img, {})}
    assert found[("A", 1)] is False  # x ≈ 100 / 440
    assert found[("B", 3)] is True
    assert found[("A", 2)] is True  # coupée par le bord : jamais prise pour une croix


def test_facing_follows_the_movement_when_the_shape_gives_no_reliable_side():
    # Pastille presque ronde : l'axe est connu (horizontal) mais le sens (asymétrie ~ 0) est ambigu ; le joueur court vers la droite.
    seq = [[{**det("A", 0.2 + 0.02 * i, 0.5, number=1), "axis": 0.0, "skew": 0.01, "angle": 180.0}] for i in range(30)]
    rows = by_slot(tracking.solve(frames_of(seq), STEP))
    angles = [rows[1][i][6] for i in range(5, 25)]
    assert all(min(a, 360 - a) < 30 for a in angles)  # il regarde vers la droite (0°), pas vers la gauche (180°)


def test_a_player_standing_still_keeps_the_side_given_by_the_shape():
    seq = [[{**det("A", 0.5, 0.5, number=1), "axis": 90.0, "skew": -0.6, "angle": 270.0}] for _ in range(20)]
    rows = by_slot(tracking.solve(frames_of(seq), STEP))
    assert all(abs(rows[1][i][6] - 270.0) < 10 for i in range(20))  # à l'arrêt, le déplacement n'impose rien
