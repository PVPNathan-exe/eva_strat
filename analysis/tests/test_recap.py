import db
import recap


def _game(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s, map) VALUES (?, 10, 200, 'Silva')", (vid,))
    gid = conn.execute("SELECT id FROM games").fetchone()["id"]
    return conn, {"id": gid, "start_s": 10.0, "end_s": 200.0, "map": "Silva", "rank": 1}


def test_a_game_with_nothing_read_lists_every_missing_part(tmp_path):
    conn, g = _game(tmp_path)
    head, lines, problems = recap.game_report(conn, g, {}, 4)
    assert "Silva" in head
    text = " | ".join(problems)
    assert "aucune position lue" in text and "aucun kill lu" in text and "score de capture non lu" in text and "pseudos" in text


def test_frozen_jumpy_and_lost_players_are_flagged(tmp_path):
    conn, g = _game(tmp_path)
    db.replace_players(conn, g["id"], {s: f"P{s}" for s in range(1, 9)})
    rows = []
    for f in range(400):  # 400 images à 0,2 s : 80 s
        t = 10 + f * 0.2
        rows.append((f, t, 1, "A", 0.5, 0.5, 0.0, 1, 1.0))  # joueur 1 figé 80 s
        rows.append((f, t, 2, "A", 0.1 if f % 2 else 0.8, 0.5, 0.0, 1, 1.0))  # joueur 2 saute d'un bord à l'autre
        if f < 100:
            rows.append((f, t, 3, "A", 0.3 + f * 0.001, 0.3, 0.0, 1, 1.0))  # joueur 3 perdu après 100 images
    db.replace_samples(conn, g["id"], rows, 4, with_kills=False)
    _, lines, problems = recap.game_report(conn, g, {}, 4)
    text = " | ".join(problems)
    assert "figé" in text and "sauts de position" in text and "souvent perdus" in text
    assert "aucune position pour les joueurs" in text  # les joueurs 4 à 8 n'ont aucune ligne
