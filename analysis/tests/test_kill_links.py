"""Trade kills et revenges (kill_links.py) : base en mémoire, cas synthétiques."""

import sqlite3
from pathlib import Path

import kill_links

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8")
START = 100.0


def make_conn(places=None):
    """Game de 100 s. `places` : {slot: (x, y)}, joueur immobile pendant toute la game (par défaut tous au même endroit)."""
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'v.mp4', 300, 30, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, ?, ?, 'The Cliff')", (START, START + 100))
    for slot in range(1, 9):
        x, y = (places or {}).get(slot, (0.5, 0.5))
        for i in range(0, 1000, 5):
            conn.execute("INSERT INTO samples (game_id, frame, t, slot, team, x, y, alive) VALUES (1, ?, ?, ?, 'A', ?, ?, 1)", (i, START + i / 10, slot, x, y))
    return conn


def kill(conn, t, killer, victim, kind="kill"):
    conn.execute("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon, kind) VALUES (1, ?, ?, ?, 'B26', ?)", (START + t, killer, victim, kind))


def links(conn, kind):
    return conn.execute("SELECT t, victim_slot, other_slot, dt, dist_m FROM kill_links WHERE game_id = 1 AND kind = ? ORDER BY t, victim_slot", (kind,)).fetchall()


def test_deux_morts_croisees_sont_un_trade_une_ligne_par_victime():
    conn = make_conn({1: (0.2, 0.5), 6: (0.3, 0.5)})
    kill(conn, 40.0, 1, 6)
    kill(conn, 40.5, 6, 1)
    kill_links.compute(conn, 1)
    assert [(t, v, o, dt) for t, v, o, dt, _d in links(conn, "trade")] == [(40.0, 6, 1, 0.5), (40.5, 1, 6, 0.5)]
    assert abs(links(conn, "trade")[0][4] - 3.1) < 0.01  # 0,1 de largeur de minimap = 3,1 m
    assert links(conn, "revenge") == []


def test_morts_croisees_trop_espacees_ne_sont_pas_un_trade():
    conn = make_conn()
    kill(conn, 40.0, 1, 6)
    kill(conn, 41.5, 6, 1)
    kill_links.compute(conn, 1)
    assert links(conn, "trade") == []


def test_revenge_un_coequipier_tue_le_tueur_dans_le_delai():
    conn = make_conn({6: (0.5, 0.5), 2: (0.52, 0.5)})
    kill(conn, 40.0, 6, 1)  # le 6 tue le 1
    kill(conn, 43.0, 2, 6)  # le 2, coéquipier du 1, tue le 6
    kill_links.compute(conn, 1)
    [(t, victim, other, dt, dist)] = links(conn, "revenge")
    assert (t, victim, other, dt) == (43.0, 6, 1, 3.0) and dist == 0.0


def test_revenge_hors_delai():
    conn = make_conn()
    kill(conn, 40.0, 6, 1)
    kill(conn, 45.5, 2, 6)  # 5,5 s plus tard : trop tard
    kill_links.compute(conn, 1)
    assert links(conn, "revenge") == []
    kill(conn, 80.0, 6, 3)
    kill(conn, 85.0, 2, 6)  # exactement 5,0 s : encore dans le délai
    kill_links.compute(conn, 1)
    assert [r[0] for r in links(conn, "revenge")] == [85.0]


def test_la_victime_ne_se_venge_pas_elle_meme():
    conn = make_conn()
    kill(conn, 40.0, 6, 1)
    kill(conn, 41.0, 1, 6)  # le 1 tue le 6 : c'est un trade (écart 1,0 s), pas un revenge
    kill_links.compute(conn, 1)
    assert links(conn, "revenge") == [] and len(links(conn, "trade")) == 2


def test_revenge_hors_distance():
    conn = make_conn({1: (0.1, 0.5), 6: (0.9, 0.5)})
    kill(conn, 40.0, 6, 1)
    kill(conn, 42.0, 2, 6)
    kill_links.compute(conn, 1)
    assert links(conn, "revenge") == []


def test_les_kills_sans_tueur_ou_dans_la_meme_equipe_ne_font_aucun_lien():
    conn = make_conn()
    kill(conn, 40.0, 6, 1, kind="unknown")
    kill(conn, 41.0, None, 6, kind="unknown")
    kill(conn, 42.0, 3, 6)
    kill(conn, 50.0, 2, 1)  # tir ami : même équipe
    kill(conn, 51.0, 3, 2)
    kill_links.compute(conn, 1)
    assert links(conn, "trade") == [] and links(conn, "revenge") == []


def test_compute_est_idempotent_et_ecrit_stats_meta():
    conn = make_conn()
    kill(conn, 40.0, 1, 6)
    kill(conn, 40.5, 6, 1)
    assert kill_links.compute(conn, 1) == 2
    assert kill_links.compute(conn, 1) == 2
    assert conn.execute("SELECT module, revision FROM stats_meta").fetchall() == [("kill_links", kill_links.REVISION)]


def test_game_sans_kill():
    conn = make_conn()
    assert kill_links.compute(conn, 1) == 0
