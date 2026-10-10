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


def test_games_in_order_are_left_alone_when_keep_ok(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 1000.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s, status, map, checked) VALUES (?, 100, 200, 'confirmed', 'Silva', 1)", (vid,))
    conn.execute("INSERT INTO games (video_id, start_s, end_s, status, map, checked) VALUES (?, 300, 400, 'confirmed', 'Ceres', 0)", (vid,))
    found = [{"start_s": 310, "end_s": 400, "doubts": []}]  # la détection n'a lu que la zone de la 2e
    db.replace_detected_games(conn, vid, found, keep_ok=True)
    rows = conn.execute("SELECT start_s, doubts, checked FROM games ORDER BY start_s").fetchall()
    assert rows[0]["doubts"] is None and rows[0]["checked"] == 1  # pas de faux « aucun chrono lu »
    assert "Début posé trop tôt" in rows[1]["doubts"] and rows[1]["checked"] == 1


def test_old_calibrations_table_is_rebuilt_to_accept_new_zones(tmp_path):
    import sqlite3

    path = tmp_path / "old.db"
    old = sqlite3.connect(path)
    old.executescript(
        """
        CREATE TABLE calibrations (
          map TEXT NOT NULL,
          zone TEXT NOT NULL CHECK (zone IN ('minimap', 'capture_points', 'team_a_bar', 'team_b_bar', 'timer')),
          x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
          PRIMARY KEY (map, zone)
        );
        INSERT INTO calibrations VALUES ('Silva', 'minimap', 0.1, 0.2, 0.3, 0.4);
        """
    )
    old.commit()
    old.close()
    conn = db.connect(path)
    assert conn.execute("SELECT x FROM calibrations WHERE map = 'Silva' AND zone = 'minimap'").fetchone()["x"] == 0.1
    conn.execute("INSERT INTO calibrations VALUES ('Silva', 'capture_pct_a', 0.4, 0.06, 0.05, 0.03)")  # refusée avant la migration
    conn.commit()
    assert conn.execute("SELECT COUNT(*) AS n FROM calibrations").fetchone()["n"] == 2


def test_positions_are_read_again_when_the_minimap_zone_is_recalibrated(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s, map) VALUES (?, 10, 200, 'Polaris')", (vid,))
    gid = conn.execute("SELECT id FROM games").fetchone()["id"]
    rows = [(0, 10.0, 1, "A", 0.5, 0.5, 0.0, 1, 1.0), (1, 10.2, 1, "A", 0.5, 0.5, 0.0, 1, 1.0)]
    db.replace_samples(conn, gid, rows, 4, with_kills=False)
    assert db.games_without_samples(conn, vid, 0.2, 4) == []  # rien n'a changé
    conn.execute("INSERT INTO calibrations (map, zone, x, y, w, h) VALUES ('Polaris', 'minimap', 0.004, 0.75, 0.23, 0.25)")
    conn.commit()
    assert [g["id"] for g in db.games_without_samples(conn, vid, 0.2, 4)] == [gid]  # recalibrée depuis la lecture : à relire
    db.replace_samples(conn, gid, rows, 4, with_kills=False)
    assert db.games_without_samples(conn, vid, 0.2, 4) == []  # relue avec la nouvelle zone


def test_old_readings_without_a_zone_key_are_only_redone_for_maps_with_a_calibration(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    for name in ("Ceres", "Silva"):
        conn.execute("INSERT INTO games (video_id, start_s, end_s, map) VALUES (?, 10, 200, ?)", (vid, name))
    conn.execute("INSERT INTO calibrations (map, zone, x, y, w, h) VALUES ('Silva', 'minimap', 0.003, 0.74, 0.19, 0.25)")
    rows = [(0, 10.0, 1, "A", 0.5, 0.5, 0.0, 1, 1.0), (1, 10.2, 1, "A", 0.5, 0.5, 0.0, 1, 1.0)]
    for r in conn.execute("SELECT id FROM games").fetchall():
        db.replace_samples(conn, r["id"], rows, 4, with_kills=False)
    conn.execute("UPDATE samples_meta SET zone_key = NULL")  # lectures d'avant l'empreinte de zone
    conn.commit()
    stale = [conn.execute("SELECT map FROM games WHERE id = ?", (g["id"],)).fetchone()["map"] for g in db.games_without_samples(conn, vid, 0.2, 4)]
    assert stale == ["Silva"]


def test_zone_priority_is_user_calibration_then_known_map_then_default(tmp_path):
    conn = make_conn(tmp_path)
    default = db.zone_for(conn, None, "minimap")
    known = db.zone_for(conn, "Outlaw", "minimap")
    assert known != default and known["y"] < default["y"]  # Outlaw est haute : sa minimap commence plus haut que la zone par défaut
    assert db.zone_for(conn, "Carte inconnue", "minimap") == default
    conn.execute("INSERT INTO calibrations (map, zone, x, y, w, h) VALUES ('Outlaw', 'minimap', 0.1, 0.2, 0.3, 0.4)")
    assert db.zone_for(conn, "Outlaw", "minimap") == {"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4}
