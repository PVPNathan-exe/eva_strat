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



def test_replace_detected_games_keeps_confirmed(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 100, 200, 'confirmed')", (vid,))
    conn.execute("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 300, 400, 'detected')", (vid,))
    new = [
        {"start_s": 90, "end_s": 210, "doubts": []},  # chevauche la confirmée : ignorée
        {"start_s": 250, "end_s": 350, "doubts": [{"start_s": 340, "end_s": 350, "label": "x"}]},
    ]
    assert db.replace_detected_games(conn, vid, new) == 1
    rows = conn.execute("SELECT start_s, status, doubts FROM games ORDER BY start_s").fetchall()
    assert [(r["start_s"], r["status"]) for r in rows] == [(100, "confirmed"), (250, "detected")]
    assert "label" in rows[1]["doubts"]
