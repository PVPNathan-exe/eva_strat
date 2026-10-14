"""Épisodes de rotation (rotations.py) : base en mémoire, game d'Outlaw synthétique avec deux boîtes de point actif (C puis B)."""

import json
import sqlite3
from pathlib import Path

import episode_common as ec
import rotations

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8")
START = 200.0  # début de la game dans la vidéo
DURATION = 200.0
AT_C = (0.5, 0.82)  # centre de la boîte C
AT_B = (0.25, 0.37)  # centre de la boîte B (à 10,6 m de C)
FAR = (0.05, 0.05)
EN_ROUTE = (0.08, 0.65)  # en route : à plus de 4 m des deux points
BOXES = [  # (t0, t1, x, y, w, h, lettre) en secondes de game
    (0.0, 88.0, 0.5, 0.82, 0.12, 0.10, "C"),
    (90.0, 178.0, 0.25, 0.37, 0.12, 0.09, "B"),
]


def make_conn(tracks, lives=None, map_name="Outlaw", boxes=BOXES, active=None, owners=()):
    """tracks : {slot: fonction t -> (x, y)} (défaut : loin de tout) ; lives : {slot: [(t0, t1, ended, killer)]} (défaut : vivant toute la game) ;
    active : [(point, t0, t1)] lignes de point_active (source hud) ; owners : [(point, t0, t1, 'A'|'B'|'none')] lignes de point_owner."""
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'v.mp4', 500, 30, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, ?, ?, ?)", (START, START + DURATION, map_name))
    for b in boxes:
        conn.execute("INSERT INTO capture_boxes (game_id, t0, t1, x, y, w, h, point) VALUES (1, ?, ?, ?, ?, ?, ?, ?)", b)
    for a in active or []:
        conn.execute("INSERT INTO point_active (game_id, point, t0, t1, source) VALUES (1, ?, ?, ?, 'hud')", a)
    for o in owners:
        conn.execute("INSERT INTO point_owner (game_id, point, t0, t1, owner, source) VALUES (1, ?, ?, ?, ?, 'box')", o)
    frame = 0
    for slot in range(1, 9):
        for idx, (t0, t1, ended, killer) in enumerate((lives or {}).get(slot, [(0.0, DURATION, "end", None)])):
            conn.execute("INSERT INTO lives (game_id, slot, idx, t0, t1, ended, killer_slot) VALUES (1, ?, ?, ?, ?, ?, ?)", (slot, idx, t0, t1, ended, killer))
            t = t0
            while t <= t1 + 1e-9:
                x, y = tracks.get(slot, lambda _t: FAR)(t)
                conn.execute("INSERT INTO samples (game_id, frame, t, slot, team, x, y, alive) VALUES (1, ?, ?, ?, ?, ?, ?, 1)", (frame, START + t, slot, ec.team_of(slot), x, y))
                frame += 1
                t += 0.5
    return conn


def rotates(leave_t, arrive_t):
    """Joueur au point C jusqu'à leave_t, en route, puis au point B à partir de arrive_t."""
    return lambda t: AT_C if t < leave_t else (AT_B if t >= arrive_t else EN_ROUTE)


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


# ---------------------------------------------------------------- comportement 20 s avant et après (révision 2)

def test_depart_de_lancien_point_et_concentration_sur_le_nouveau():
    tracks = {1: rotates(92, 100), 2: rotates(93, 104), 3: rotates(95, 108), 5: stays_on_c, 6: stays_on_c}
    conn = make_conn(tracks)
    rotations.compute(conn, 1)
    a, b = episodes(conn)
    f = a["data"]["flow"]
    assert f["was_on_old"] and not f["stays_on_old"] and f["leave_old_offset_s"] == 3.0 and f["leave_phase"] == "au_changement"  # dernier instant à 2 joueurs : 92,5 s
    assert f["concentrate_new_offset_s"] == 14.0 and f["first_arrival_s"] == 10.0 and f["second_arrival_s"] == 14.0
    assert [k["t"] for k in f["keys"]] == [-20.0, -10.0, 0.0, 10.0, 20.0] and f["keys"][2]["near"] == {"old": 3, "new": 0}
    assert b["data"]["flow"]["stays_on_old"] and b["data"]["flow"]["leave_phase"] == "reste" and b["data"]["flow"]["leave_old_offset_s"] is None
    assert a["data"]["opponent"]["team"] == "B" and b["data"]["opponent"]["team"] == "A"


def test_equipe_partie_avant_le_changement_est_dite_en_avance():
    conn = make_conn({1: rotates(80, 100), 2: rotates(81, 100), 3: stays_on_c})
    rotations.compute(conn, 1)
    [a] = episodes(conn)
    assert a["data"]["flow"]["leave_phase"] == "avant" and a["data"]["flow"]["leave_old_offset_s"] == -9.0


def test_gagnant_est_le_tenant_du_nouveau_point_20_s_apres():
    owners = [("B", 91, 100, "none"), ("B", 100, 178, "A")]
    tracks = {1: rotates(92, 100), 2: rotates(93, 104), 5: stays_on_c, 6: stays_on_c}
    conn = make_conn(tracks, owners=owners)
    rotations.compute(conn, 1)
    a, b = episodes(conn)
    assert a["data"]["result"]["winner"] == "A" and a["data"]["result"]["value"] == "won" and b["data"]["result"]["value"] == "lost"
    assert a["data"]["result"]["first_team"] == "A"  # seule l'équipe A arrive sur B


def test_sans_tenant_connu_le_resultat_est_indecis():
    conn = make_conn({1: rotates(92, 100), 2: rotates(93, 104)})
    rotations.compute(conn, 1)
    [a] = episodes(conn)
    assert a["data"]["result"]["value"] == "undecided"


# ---------------------------------------------------------------- calendrier du point actif

def test_point_active_prime_sur_les_boites():
    tracks = {1: rotates(92, 105), 2: rotates(93, 106)}
    conn = make_conn(tracks, active=[("C", 0.0, 98.0), ("B", 100.0, 178.0)])
    rotations.compute(conn, 1)
    [a] = episodes(conn)
    assert a["data"]["switch_t"] == 100.0 and a["data"]["source"] == "hud" and (a["point"], a["point_to"]) == ("C", "B")


def test_point_active_sans_boite_prend_les_cadres_de_la_carte():
    conn = make_conn({1: rotates(92, 100), 2: rotates(93, 104)}, boxes=[], active=[("C", 0.0, 88.0), ("B", 90.0, 178.0)])
    assert rotations.compute(conn, 1) == 1


def test_calendrier_sans_boite_ni_point_active_aucune_rotation():
    conn = make_conn({1: rotates(92, 100), 2: rotates(93, 104)}, boxes=[])
    assert rotations.compute(conn, 1) == 0


def test_carte_a_plusieurs_points_avec_point_active():
    rects = ec.map_point_rects("Atlantis")
    a_c, b_c = ec.rect_center(rects["A"]), ec.rect_center(rects["B"])
    go = lambda t_out, t_in: (lambda t: a_c if t < t_out else (b_c if t >= t_in else (0.5, 0.5)))
    conn = make_conn({1: go(92, 100), 2: go(93, 104)}, map_name="Atlantis", boxes=[], active=[("A", 0.0, 88.0), ("B", 90.0, 178.0)])
    assert rotations.compute(conn, 1) == 1
    [a] = episodes(conn)
    assert (a["point"], a["point_to"], a["outcome"]) == ("A", "B", "arrived")


def test_changement_apres_un_trou_trop_long_nest_pas_une_rotation():
    boxes = [(0.0, 60.0, 0.5, 0.82, 0.12, 0.10, "C"), (100.0, 178.0, 0.25, 0.37, 0.12, 0.09, "B")]
    conn = make_conn({1: rotates(92, 100), 2: rotates(93, 104)}, boxes=boxes)
    assert rotations.compute(conn, 1) == 0
