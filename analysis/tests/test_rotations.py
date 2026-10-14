"""Épisodes de rotation (rotations.py) : base en mémoire, game d'Outlaw synthétique avec deux boîtes de point actif (C puis B)."""

import json
import sqlite3
from pathlib import Path

import rotations

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8")
START = 200.0  # début de la game dans la vidéo
DURATION = 200.0
AT_C = (0.5, 0.82)  # centre de la boîte C
AT_B = (0.25, 0.37)  # centre de la boîte B (à 10,6 m de C)
FAR = (0.05, 0.05)
BOXES = [  # (t0, t1, x, y, w, h, lettre) en secondes de game
    (0.0, 88.0, 0.5, 0.82, 0.12, 0.10, "C"),
    (90.0, 178.0, 0.25, 0.37, 0.12, 0.09, "B"),
]


def make_conn(tracks, lives=None, map_name="Outlaw", boxes=BOXES):
    """tracks : {slot: fonction t -> (x, y)} (défaut : loin de tout) ; lives : {slot: [(t0, t1, ended, killer)]} (défaut : vivant toute la game)."""
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'v.mp4', 500, 30, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, ?, ?, ?)", (START, START + DURATION, map_name))
    for b in boxes:
        conn.execute("INSERT INTO capture_boxes (game_id, t0, t1, x, y, w, h, point) VALUES (1, ?, ?, ?, ?, ?, ?, ?)", b)
    frame = 0
    for slot in range(1, 9):
        for idx, (t0, t1, ended, killer) in enumerate((lives or {}).get(slot, [(0.0, DURATION, "end", None)])):
            conn.execute("INSERT INTO lives (game_id, slot, idx, t0, t1, ended, killer_slot) VALUES (1, ?, ?, ?, ?, ?, ?)", (slot, idx, t0, t1, ended, killer))
            t = t0
            while t <= t1 + 1e-9:
                x, y = tracks.get(slot, lambda _t: FAR)(t)
                conn.execute("INSERT INTO samples (game_id, frame, t, slot, team, x, y, alive) VALUES (1, ?, ?, ?, 'A', ?, ?, 1)", (frame, START + t, slot, x, y))
                frame += 1
                t += 0.5
    return conn


def rotates(leave_t, arrive_t):
    """Joueur au point C jusqu'à leave_t, en route, puis au point B à partir de arrive_t."""
    return lambda t: AT_C if t < leave_t else (AT_B if t >= arrive_t else (0.4, 0.6))


def stays_on_c(t):
    return AT_C


def episodes(conn):
    return [{"point": r[0], "point_to": r[1], "team": r[2], "outcome": r[3], "data": json.loads(r[4])}
            for r in conn.execute("SELECT point, point_to, team, outcome, data FROM episodes WHERE game_id = 1 AND kind = 'rotation' ORDER BY team")]


def test_equipe_qui_quitte_c_pour_b_est_une_rotation_arrivee():
    tracks = {1: rotates(92, 100), 2: rotates(93, 104), 3: rotates(95, 108), 5: stays_on_c, 6: stays_on_c}
    conn = make_conn(tracks)
    assert rotations.compute(conn, 1) == 2
    a, b = episodes(conn)
    assert (a["point"], a["point_to"], a["team"], a["outcome"]) == ("C", "B", "A", "arrived")
    assert [x["slot"] for x in a["data"]["start_players"]] == [1, 2, 3]
    assert [x["slot"] for x in a["data"]["arrivals"]] == [1, 2, 3] and a["data"]["second_arrival_s"] == 14.0
    assert a["data"]["switch_t"] == 90.0 and abs(a["data"]["distance_points_m"] - 10.6) < 0.2
    assert b["team"] == "B" and b["outcome"] == "not_arrived"  # l'autre équipe reste sur C


def test_un_seul_arrive_est_partiel():
    tracks = {1: rotates(92, 100), 2: rotates(93, 1e9), 3: stays_on_c}
    conn = make_conn(tracks)
    rotations.compute(conn, 1)
    [a] = episodes(conn)
    assert a["outcome"] == "partial" and a["data"]["second_arrival_s"] is None


def test_mort_en_route_est_notee():
    tracks = {1: rotates(92, 100), 2: rotates(93, 1e9), 3: stays_on_c}
    lives = {2: [(0.0, 95.0, "death", 6), (150.0, 200.0, "end", None)]}
    conn = make_conn(tracks, lives)
    rotations.compute(conn, 1)
    [a] = episodes(conn)
    assert a["data"]["deaths_en_route"] == [{"slot": 2, "t": 95.0, "killer": 6}]


def test_un_seul_joueur_concerne_ne_fait_pas_une_rotation():
    conn = make_conn({1: rotates(92, 100)})
    assert rotations.compute(conn, 1) == 0


def test_carte_autre_quoutlaw_aucun_episode():
    conn = make_conn({1: rotates(92, 100), 2: rotates(92, 100)}, map_name="Polaris")
    assert rotations.compute(conn, 1) == 0


def test_meme_point_deux_fois_de_suite_nest_pas_une_rotation():
    boxes = [(0.0, 88.0, 0.5, 0.82, 0.12, 0.10, "C"), (90.0, 178.0, 0.5, 0.82, 0.12, 0.10, "C")]
    conn = make_conn({1: stays_on_c, 2: stays_on_c}, boxes=boxes)
    assert rotations.compute(conn, 1) == 0


def test_idempotent_et_ne_touche_pas_aux_retakes():
    tracks = {1: rotates(92, 100), 2: rotates(93, 104)}
    conn = make_conn(tracks)
    conn.execute("INSERT INTO episodes (game_id, kind, point, team, t0, t1, outcome, data) VALUES (1, 'retake', 'A', 'B', 1, 2, 'success', '{}')")
    assert rotations.compute(conn, 1) == rotations.compute(conn, 1)
    assert conn.execute("SELECT COUNT(*) FROM episodes WHERE kind = 'retake'").fetchone()[0] == 1
    assert conn.execute("SELECT revision FROM stats_meta WHERE game_id = 1 AND module = 'rotations'").fetchone()[0] == rotations.REVISION
