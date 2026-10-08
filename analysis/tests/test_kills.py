import cv2
import numpy as np

import db
import killfeed
import minimap
import tracking
import weapons

STEP = 0.2


def det(team, x, y, number=None, alive=True):
    return {"team": team, "x": x, "y": y, "number": number, "slot": minimap.slot_of(number) if number else None,
            "angle": 0.0, "axis": 0.0, "skew": 1.0, "alive": alive, "spectated": False}


def frames_of(seq):
    return [(i, round(i * STEP, 2), dets) for i, dets in enumerate(seq)]


def test_kill_without_a_cross_on_the_minimap_still_marks_the_victim_dead():
    seq = [[det("B", 0.8, 0.3, number=8)] for _ in range(15)] + [[] for _ in range(15)]  # le joueur disparaît sans croix lue
    rows = tracking.solve(frames_of(seq), STEP, deaths=[(15 * STEP, 7)])
    dead = [r for r in rows if r[2] == 7 and not r[7]]
    assert dead and all(abs(r[4] - 0.8) < 1e-6 for r in dead)  # morts à leur dernière position connue
    assert len(dead) <= round(tracking.DEATH_SHOWN_S / STEP) + 2


def test_death_does_not_overwrite_a_player_who_is_clearly_alive():
    seq = [[det("B", 0.8, 0.3, number=8)] for _ in range(30)]
    rows = tracking.solve(frames_of(seq), STEP, deaths=[(15 * STEP, 7)])  # lecture erronée : il continue à courir
    assert all(r[7] == 1 for r in rows if r[2] == 7 and r[0] > 20)


def test_cross_goes_to_the_victim_named_by_the_killfeed():
    seq = [[det("A", 0.2, 0.2, number=1), det("A", 0.25, 0.22, number=2)] for _ in range(10)]
    seq += [[det("A", 0.2, 0.2, number=1), det("A", 0.25, 0.22, alive=False)] for _ in range(8)]
    rows = tracking.solve(frames_of(seq), STEP, deaths=[(10 * STEP, 2)])
    assert {r[2] for r in rows if not r[7]} == {2}


def test_kills_are_stored_and_the_game_is_marked_as_read(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s) VALUES (?, 10, 200)", (vid,))
    gid = conn.execute("SELECT id FROM games").fetchone()["id"]
    assert db.games_without_kills(conn, vid) == []  # sans pseudos, le killfeed ne peut pas être lu
    db.replace_players(conn, gid, {1: "SHADYJ4Y", 5: "ORXPAPY"})
    assert [g["id"] for g in db.games_without_kills(conn, vid)] == [gid]
    db.replace_kills(conn, gid, [{"t": 42.5, "killer": 1, "victim": 5, "weapon": "W1"}])
    assert db.games_without_kills(conn, vid) == []
    assert db.kills_of(conn, gid) == [{"t": 42.5, "killer_slot": 1, "victim_slot": 5, "weapon": "W1"}]
    db.replace_kills(conn, gid, [])  # aucun kill : la game reste « lue »
    assert db.games_without_kills(conn, vid) == []


def test_positions_are_read_again_once_the_killfeed_is_known(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s) VALUES (?, 10, 200)", (vid,))
    gid = conn.execute("SELECT id FROM games").fetchone()["id"]
    db.replace_samples(conn, gid, [(0, 10.0, 1, "A", 0.1, 0.2, None, 1, 1.0), (1, 10.2, 1, "A", 0.1, 0.2, None, 1, 1.0)], 0, with_kills=False)
    assert db.games_without_samples(conn, vid, 0.2, 0, use_kills=True) == []
    db.replace_players(conn, gid, {1: "SHADYJ4Y"})
    db.replace_kills(conn, gid, [])
    assert [g["id"] for g in db.games_without_samples(conn, vid, 0.2, 0, use_kills=True)] == [gid]
    db.replace_samples(conn, gid, [(0, 10.0, 1, "A", 0.1, 0.2, None, 1, 1.0), (1, 10.2, 1, "A", 0.1, 0.2, None, 1, 1.0)], 0, with_kills=True)
    assert db.games_without_samples(conn, vid, 0.2, 0, use_kills=True) == []


def _icon(kind):
    img = np.zeros((14, 40), np.uint8)
    if kind == "long":
        cv2.rectangle(img, (2, 5), (36, 9), 255, -1)
        cv2.rectangle(img, (30, 3), (36, 12), 255, -1)
    else:
        cv2.circle(img, (20, 7), 5, 255, -1)
    return img


def test_weapon_icons_get_stable_ids_and_new_ones_a_new_id(tmp_path):
    a = weapons.identify(_icon("long"), folder=tmp_path)
    b = weapons.identify(_icon("round"), folder=tmp_path)
    assert a == "W1" and b == "W2"
    assert weapons.identify(_icon("long"), folder=tmp_path) == "W1"
    assert weapons.identify(np.zeros((14, 40), np.uint8), folder=tmp_path) is None  # icône vide


def test_find_rows_splits_a_killfeed_line_into_killer_icon_victim():
    img = np.zeros((120, 340, 3), np.uint8)
    img[20:34, 40:130] = (110, 110, 110)  # pastille grise du tueur
    cv2.putText(img, "ORANGE", (45, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 150, 255), 2)  # texte orange (BGR)
    cv2.rectangle(img, (150, 22), (185, 32), (230, 230, 230), -1)  # icône d'arme blanche
    cv2.putText(img, "BLEUX", (205, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 140, 60), 2)  # texte bleu
    rows = killfeed.find_rows(img)
    assert len(rows) == 1
    teams = [s["team"] for s in rows[0]["segments"]]
    assert teams[0] == "A" and teams[-1] == "B"
