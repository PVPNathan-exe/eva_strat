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


def test_confirmed_games_are_checked_not_modified(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 100, 200, 'confirmed')", (vid,))  # bien posée
    conn.execute("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 300, 400, 'confirmed')", (vid,))  # début 10 s trop tôt
    conn.execute("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 500, 560, 'confirmed')", (vid,))  # rien détecté
    found = [
        {"start_s": 101, "end_s": 199, "doubts": []},
        {"start_s": 310, "end_s": 400, "doubts": []},
    ]
    assert db.replace_detected_games(conn, vid, found) == 0
    rows = conn.execute("SELECT start_s, end_s, doubts FROM games ORDER BY start_s").fetchall()
    assert [(r["start_s"], r["end_s"]) for r in rows] == [(100, 200), (300, 400), (500, 560)]
    assert rows[0]["doubts"] is None
    assert "trop tôt de 10 s" in rows[1]["doubts"]
    assert "Aucun chrono" in rows[2]["doubts"]


def test_all_verified_requires_every_game_checked_confirmed_with_map(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    assert not db.all_verified(conn, vid)  # aucune game
    conn.execute("INSERT INTO games (video_id, start_s, end_s, status, map) VALUES (?, 100, 200, 'confirmed', 'Silva')", (vid,))
    assert not db.all_verified(conn, vid)  # jamais comparée à la détection
    db.replace_detected_games(conn, vid, [{"start_s": 100, "end_s": 200, "doubts": []}])
    assert db.all_verified(conn, vid)
    conn.execute("UPDATE games SET map = NULL")
    assert not db.all_verified(conn, vid)
