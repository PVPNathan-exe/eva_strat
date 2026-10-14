"""Épisodes de retake (retakes.py, episode_common.py) : base en mémoire, game de Polaris synthétique (un seul point, cadre de map_capture.json)."""

import json
import sqlite3
from pathlib import Path

import episode_common as ec
import point_owner
import retakes

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8")
START = 100.0  # début de la game dans la vidéo : les samples sont en temps de vidéo
DURATION = 100.0
AT_POINT = (0.485, 0.54)  # dans le cadre du point de Polaris
FAR = (0.2, 0.2)  # loin du point (plus de 7 m)


def make_conn(owners, tracks, lives, map_name="Polaris"):
    """owners : [(t0, t1, 'A'|'B'|'none')] ; tracks : {slot: fonction t -> (x, y)} (défaut : loin du point) ; lives : {slot: [(t0, t1, ended, killer)]} (défaut : vivant toute la game).
    Les lignes de samples sont posées toutes les 0,5 s pendant les vies, en temps de vidéo."""
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'v.mp4', 300, 30, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, ?, ?, ?)", (START, START + DURATION, map_name))
    for o in owners:
        conn.execute("INSERT INTO point_owner (game_id, point, t0, t1, owner, source) VALUES (1, 'A', ?, ?, ?, 'box')", o)
    frame = 0
    for slot in range(1, 9):
        spans = lives.get(slot, [(0.0, DURATION, "end", None)])
        for idx, (t0, t1, ended, killer) in enumerate(spans):
            conn.execute("INSERT INTO lives (game_id, slot, idx, t0, t1, ended, killer_slot) VALUES (1, ?, ?, ?, ?, ?, ?)", (slot, idx, t0, t1, ended, killer))
            t = t0
            while t <= t1 + 1e-9:
                x, y = tracks.get(slot, lambda _t: FAR)(t)
                conn.execute("INSERT INTO samples (game_id, frame, t, slot, team, x, y, alive) VALUES (1, ?, ?, ?, ?, ?, ?, 1)", (frame, START + t, slot, ec.team_of(slot), x, y))
                frame += 1
                t += 0.5
    return conn


def episodes(conn, kind="retake"):
    return [dict(zip(("point", "team", "t0", "t1", "outcome", "data", "verdict"), r[:6] + (r[6],))) | {"data": json.loads(r[5])}
            for r in conn.execute("SELECT point, team, t0, t1, outcome, data, verdict FROM episodes WHERE game_id = 1 AND kind = ? ORDER BY t0", (kind,))]


def arrive(t_in, t_out=1e9):
    """Joueur au point entre t_in et t_out, loin sinon."""
    return lambda t: AT_POINT if t_in <= t < t_out else FAR


# ---------------------------------------------------------------- succès

def test_succes_defenseurs_morts_ou_recules_depart_a_deux_attaquants():
    owners = [(0, 5, "none"), (5, 40, "A"), (40, 100, "B")]
    tracks = {1: arrive(5, 38), 2: arrive(5, 1e9), 5: arrive(30), 6: arrive(30), 7: arrive(35)}
    lives = {2: [(0.0, 36.0, "death", 5), (60.0, 100.0, "end", None)]}
    conn = make_conn(owners, tracks, lives)
    assert retakes.compute(conn, 1) == 1
    [e] = episodes(conn)
    assert (e["point"], e["team"], e["outcome"]) == ("A", "B", "success")
    d = e["data"]
    assert d["change_t"] == 40.0 and abs(d["push_t"] - 30.0) <= 0.5
    assert [a["slot"] for a in d["attackers"]] == [5, 6]  # engagés au départ (le 7 arrive 5 s plus tard)
    fates = {x["slot"]: x["fate"] for x in d["defenders"]}
    assert fates[2] == "mort" and fates[1] == "recule" and fates[3] == "recule"
    assert d["first_death"]["slot"] == 2 and d["first_death"]["cause"] == "tue_sur_le_point"  # le 5 tue depuis le point
    assert e["t0"] == 20.0 and e["t1"] == 50.0  # 20 s avant, 10 s après


def test_premiere_prise_dun_point_neutre_nest_pas_un_retake():
    conn = make_conn([(0, 5, "none"), (5, 100, "A")], {5: arrive(10), 6: arrive(10)}, {})
    assert retakes.compute(conn, 1) == 0


def test_point_gris_entre_deux_proprietaires_compte_comme_un_changement():
    owners = [(0, 5, "none"), (5, 40, "A"), (40, 50, "none"), (50, 100, "B")]
    conn = make_conn(owners, {5: arrive(38), 6: arrive(38)}, {})
    [e] = [x for x in episodes_of(conn) if x["outcome"] != "fail"]
    assert e["team"] == "B" and e["data"]["change_t"] == 50.0


def episodes_of(conn):
    retakes.compute(conn, 1)
    return episodes(conn)


def test_changement_sans_deux_attaquants_est_no_push():
    owners = [(0, 5, "none"), (5, 40, "A"), (40, 100, "B")]
    conn = make_conn(owners, {5: arrive(35)}, {})
    [e] = episodes_of(conn)
    assert e["outcome"] == "no_push" and e["data"]["push_t"] is None


def test_fenetre_coupee_au_changement_voisin():
    assert ec.clip_window(40.0, 20.0, 10.0, [30.0, 40.0, 47.0], 100.0) == (30.0, 47.0)
    assert ec.clip_window(5.0, 20.0, 10.0, [], 100.0) == (0.0, 15.0)
    assert ec.clip_window(95.0, 20.0, 10.0, [], 100.0) == (75.0, 100.0)


# ---------------------------------------------------------------- échec

def test_echec_trois_attaquants_morts_et_survivant_recule():
    owners = [(0, 5, "none"), (5, 100, "A")]
    tracks = {5: arrive(50, 53), 6: arrive(50, 55), 7: arrive(50, 56)}
    lives = {
        5: [(0.0, 53.0, "death", 1), (70.0, 100.0, "end", None)],
        6: [(0.0, 55.0, "death", 1), (70.0, 100.0, "end", None)],
        7: [(0.0, 56.0, "death", 2), (70.0, 100.0, "end", None)],
    }
    conn = make_conn(owners, tracks, lives)
    [e] = episodes_of(conn)
    assert (e["team"], e["outcome"]) == ("B", "fail")
    d = e["data"]
    assert [x["slot"] for x in d["deaths"]] == [5, 6, 7]
    assert d["first_death"]["slot"] == 5 and d["first_death"]["killer"] == 1
    assert abs(d["push_t"] - 50.0) <= 0.5 and d["stagger_s"] == 0.0


def test_poussee_repoussee_a_un_seul_mort_nest_pas_ecrite():
    owners = [(0, 5, "none"), (5, 100, "A")]
    tracks = {5: arrive(50, 53), 6: arrive(50, 70), 7: arrive(50, 70)}
    lives = {5: [(0.0, 53.0, "death", 1), (70.0, 100.0, "end", None)]}
    conn = make_conn(owners, tracks, lives)
    assert retakes.compute(conn, 1) == 0


def test_poussee_dont_les_survivants_restent_sur_le_point_nest_pas_un_echec():
    owners = [(0, 5, "none"), (5, 100, "A")]
    tracks = {5: arrive(50, 53), 6: arrive(50, 55), 7: arrive(50)}
    lives = {5: [(0.0, 53.0, "death", 1)], 6: [(0.0, 55.0, "death", 1)]}
    conn = make_conn(owners, tracks, lives)
    assert retakes.compute(conn, 1) == 0


def test_poussee_trop_courte_ne_compte_pas():
    owners = [(0, 5, "none"), (5, 100, "A")]
    tracks = {5: arrive(50, 50.5), 6: arrive(50, 50.5)}
    lives = {5: [(0.0, 51.0, "death", 1)], 6: [(0.0, 52.0, "death", 1)]}
    conn = make_conn(owners, tracks, lives)
    assert retakes.compute(conn, 1) == 0


# ---------------------------------------------------------------- contrat

def test_carte_sans_point_owner_ni_cadre_donne_zero_episode():
    conn = make_conn([], {}, {}, map_name="Atlantis")
    assert retakes.compute(conn, 1) == 0


def test_compute_est_idempotent_et_garde_les_verdicts():
    owners = [(0, 5, "none"), (5, 40, "A"), (40, 100, "B")]
    conn = make_conn(owners, {5: arrive(30), 6: arrive(30)}, {})
    assert retakes.compute(conn, 1) == 1
    conn.execute("UPDATE episodes SET verdict = 'ok' WHERE game_id = 1")
    assert retakes.compute(conn, 1) == 1
    assert conn.execute("SELECT COUNT(*), MAX(verdict) FROM episodes WHERE game_id = 1").fetchone() == (1, "ok")
    assert conn.execute("SELECT revision FROM stats_meta WHERE game_id = 1 AND module = 'retakes'").fetchone()[0] == retakes.REVISION


def test_ne_touche_pas_aux_rotations_de_la_game():
    owners = [(0, 5, "none"), (5, 40, "A"), (40, 100, "B")]
    conn = make_conn(owners, {5: arrive(30), 6: arrive(30)}, {})
    conn.execute("INSERT INTO episodes (game_id, kind, point, team, t0, t1, outcome, data) VALUES (1, 'rotation', 'C', 'A', 1, 2, 'arrived', '{}')")
    retakes.compute(conn, 1)
    assert conn.execute("SELECT COUNT(*) FROM episodes WHERE kind = 'rotation'").fetchone()[0] == 1


def test_distance_au_cadre():
    rect = point_owner.point_rects("Polaris")["A"]
    assert ec.dist_rect_m(AT_POINT, rect) == 0.0
    assert abs(ec.dist_rect_m((rect[2] + 0.1, 0.54), rect) - 3.1) < 0.01  # 0,1 de largeur de minimap = 3,1 m
    assert ec.dist_rect_m(None, rect) is None
