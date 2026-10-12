"""Joueur observé, positions non confirmées enregistrées et carte de fiabilité."""

import db
import observed_name
import reliability


def _conn(tmp_path):
    conn = db.connect(str(tmp_path / "t.db"))
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'v.mp4', 600, 30, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map, status) VALUES (1, 1, 0, 300, 'Polaris', 'confirmed')")
    conn.commit()
    return conn


def test_observed_segments_merge_flicker_and_skip_unknown_periods():
    states = {}
    plan = [8] * 30 + [None] * 3 + [8] * 20 + [3] * 4 + [8] * 20 + [1] * 30  # 8, trou, 8, clignotement du 3, 8, puis le 1
    for k, who in enumerate(plan):
        states[k] = {s: {"spectated": s == who} for s in (1, 3, 8)}
    times = {k: k * 0.1 for k in states}
    segs = observed_name.observed_segments(states, times)
    assert [s for s, _, _ in segs] == [8, 1]
    assert segs[0][1] == 0.0 and abs(segs[0][2] - 7.6) < 0.15


def test_flags_and_observed_round_trip_and_are_cleared_with_the_samples(tmp_path):
    conn = _conn(tmp_path)
    db.replace_flags(conn, 1, "unconfirmed", [(12, 3), (13, 3)])
    db.replace_observed(conn, 1, [(8, 14.6, 66.1)])
    assert db.flags_of(conn, 1, "unconfirmed") == [(12, 3), (13, 3)]
    assert [tuple(r) for r in conn.execute("SELECT slot, t0, t1 FROM observed_segments")] == [(8, 14.6, 66.1)]
    db.replace_samples(conn, 1, [(0, 0.0, 1, "A", 0.5, 0.5, None, 1, 1.0)])  # nouvelles positions : les contrôles sont périmés
    assert db.flags_of(conn, 1, "unconfirmed") == []


def test_a_cell_is_doubtful_only_with_enough_rows_and_twice_the_map_rate():
    cells = {(0, 0): {"n": 100, "pos_bad": 30, "gaze_n": 50, "gaze_bad": 40},  # très mauvaise
             (1, 0): {"n": 1000, "pos_bad": 10, "gaze_n": 500, "gaze_bad": 25},  # bonne, et la plus grande part de la carte
             (2, 0): {"n": 5, "pos_bad": 0, "gaze_n": 3, "gaze_bad": 0}}  # trop peu de lignes pour juger
    report = reliability.summarize(cells)
    flags = {(c["i"], c["j"]): (c["pos_flag"], c["gaze_flag"]) for c in report["cells"]}
    assert flags[(0, 0)] == (True, True)
    assert flags[(1, 0)] == (False, False)
    assert flags[(2, 0)] == (False, False)
    assert reliability.flagged_cells(report, "pos") == {(0, 0)}
    assert reliability.flagged_cells(None, "gaze") == set()
