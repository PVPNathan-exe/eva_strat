import db


def make_conn(tmp_path):
    return db.connect(tmp_path / "eva.db")


def test_connect_creates_all_tables(tmp_path):
    conn = make_conn(tmp_path)
    names = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"videos", "games", "calibrations", "samples", "capture_state"} <= names


def test_upsert_video_returns_same_id_for_same_path(tmp_path):
    conn = make_conn(tmp_path)
    a = db.upsert_video(conn, "D:/rec/a.mp4", None, 600.0, 60.0, 1920, 1080)
    b = db.upsert_video(conn, "D:/rec/a.mp4", None, 650.0, 60.0, 1920, 1080)
    assert a == b
    row = conn.execute("SELECT duration_s FROM videos WHERE id=?", (a,)).fetchone()
    assert row["duration_s"] == 650.0


def test_replace_detected_games_replaces_only_detected(tmp_path):
    conn = make_conn(tmp_path)
    vid = db.upsert_video(conn, "D:/rec/a.mp4", None, 3000.0, 60.0, 1920, 1080)
    db.replace_detected_games(conn, vid, [(0.0, 100.0), (500.0, 700.0)])
    conn.execute("UPDATE games SET status='confirmed' WHERE start_s=500.0")
    conn.commit()
    db.replace_detected_games(conn, vid, [(10.0, 90.0), (1000.0, 1200.0)])
    rows = conn.execute("SELECT start_s, end_s, status FROM games WHERE video_id=? ORDER BY start_s", (vid,)).fetchall()
    assert [(r["start_s"], r["end_s"], r["status"]) for r in rows] == [
        (10.0, 90.0, "detected"),
        (500.0, 700.0, "confirmed"),
        (1000.0, 1200.0, "detected"),
    ]


def test_replace_detected_games_skips_segments_overlapping_confirmed(tmp_path):
    conn = make_conn(tmp_path)
    vid = db.upsert_video(conn, "D:/rec/a.mp4", None, 3000.0, 60.0, 1920, 1080)
    conn.execute("INSERT INTO games(video_id, start_s, end_s, status) VALUES (?, 500, 700, 'confirmed')", (vid,))
    conn.commit()
    db.replace_detected_games(conn, vid, [(480.0, 720.0), (800.0, 900.0)])
    rows = conn.execute("SELECT start_s FROM games WHERE video_id=? AND status='detected'", (vid,)).fetchall()
    assert [r["start_s"] for r in rows] == [800.0]
