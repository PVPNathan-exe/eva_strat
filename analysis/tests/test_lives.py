"""Vies des joueurs (lives.py) : base en mémoire, cas synthétiques."""

import sqlite3
from pathlib import Path

import lives

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8")
START = 100.0  # début de la game en temps de vidéo
END = 200.0


def make_conn():
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'v.mp4', 300, 30, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, ?, ?, 'The Cliff')", (START, END))
    return conn


def add_life(conn, slot, t0, t1, pos=(0.2, 0.3), cross_s=2.0):
    """Lignes vivantes de t0 à t1 (temps de la game, une toutes les 0,1 s), puis `cross_s` de croix morte au même endroit (0 : aucune)."""
    n = round((t1 - t0) * 10)
    first = round((START + t0) * 10)  # numéro d'image (10 par seconde) : évite les erreurs d'arrondi des flottants
    for i in range(n + 1):
        conn.execute("INSERT INTO samples (game_id, frame, t, slot, team, x, y, alive) VALUES (1, ?, ?, ?, 'A', ?, ?, 1)", (first + i, (first + i) / 10, slot, pos[0] + i * 1e-4, pos[1]))
    for i in range(1, round(cross_s * 10) + 1):
        conn.execute("INSERT INTO samples (game_id, frame, t, slot, team, x, y, alive) VALUES (1, ?, ?, ?, 'A', ?, ?, 0)", (first + n + i, (first + n + i) / 10, slot, pos[0] + n * 1e-4, pos[1]))


def add_kill(conn, t, killer, victim, weapon="B26", kind="kill"):
    conn.execute("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon, kind) VALUES (1, ?, ?, ?, ?, ?)", (START + t, killer, victim, weapon, kind))


def rows(conn, slot=1):
    return [dict(zip(("idx", "t0", "t1", "ended", "killer", "weapon", "kind"), r)) for r in conn.execute("SELECT idx, t0, t1, ended, killer_slot, weapon, kill_kind FROM lives WHERE game_id = 1 AND slot = ? ORDER BY idx", (slot,))]


def test_deux_vies_separees_par_une_attente_avec_kill_arme_et_temps_depuis_le_debut_de_la_game():
    conn = make_conn()
    add_life(conn, 1, 0.1, 30.0)
    add_life(conn, 1, 47.0, 99.0, cross_s=0)
    add_kill(conn, 30.0, 5, 1, "B13")
    assert lives.compute(conn, 1) == 2
    first, second = rows(conn)
    assert (first["t0"], first["t1"], first["ended"], first["killer"], first["weapon"], first["kind"]) == (0.1, 30.0, "death", 5, "B13", "kill")
    assert (second["t0"], second["t1"], second["ended"], second["killer"]) == (47.0, 99.0, "end", None)


def test_position_de_mort_est_la_croix():
    conn = make_conn()
    add_life(conn, 1, 0.1, 10.0, pos=(0.5, 0.5))
    # La croix est collée à la dernière ligne vivante : même lieu à moins de 0,001 près.
    lives.compute(conn, 1)
    x1, y1 = conn.execute("SELECT x1, y1 FROM lives WHERE slot = 1").fetchone()
    assert abs(x1 - 0.5099) < 0.001 and y1 == 0.5


def test_mort_sans_kill_tombe_quand_le_joueur_ne_revit_pas_avant_l_attente():
    conn = make_conn()
    add_life(conn, 2, 0.1, 20.0)
    add_life(conn, 2, 37.0, 60.0)
    lives.compute(conn, 1)
    first, second = rows(conn, 2)
    assert first["ended"] == "death" and first["killer"] is None and first["kind"] is None
    assert second["ended"] == "death"  # arrêtée à 40 s de la fin de la game : la vie ne finit pas avec la game


def test_kill_sans_mort_lue_ne_cree_pas_de_vie_et_ne_plante_pas():
    conn = make_conn()
    add_life(conn, 1, 0.1, 99.0, cross_s=0)
    add_kill(conn, 50.0, 6, 1)
    assert lives.compute(conn, 1) == 1
    only = rows(conn)[0]
    assert only["ended"] == "end" and only["killer"] is None


def test_ligne_vivante_pendant_l_attente_n_est_pas_une_vie():
    conn = make_conn()
    add_life(conn, 1, 0.1, 30.0)
    add_kill(conn, 30.0, 5, 1)
    add_life(conn, 1, 35.4, 36.8)  # le disque du joueur mort qui attend, vu 5,4 s après la mort
    add_life(conn, 1, 47.1, 99.0, cross_s=0)
    assert lives.compute(conn, 1) == 2
    assert [(r["t0"], r["ended"]) for r in rows(conn)] == [(0.1, "death"), (47.1, "end")]


def test_clignotement_sans_kill_de_moins_de_la_reapparition_garde_une_seule_vie():
    conn = make_conn()
    add_life(conn, 1, 0.1, 20.0, cross_s=0)
    add_life(conn, 1, 20.4, 60.0, cross_s=0)
    assert lives.compute(conn, 1) == 1
    assert (rows(conn)[0]["t0"], rows(conn)[0]["t1"]) == (0.1, 60.0)


def test_kill_a_plus_de_deux_secondes_n_est_pas_rapproche():
    conn = make_conn()
    add_life(conn, 1, 0.1, 30.0)
    add_kill(conn, 33.0, 5, 1)  # 3 s après la fin de la vie
    lives.compute(conn, 1)
    assert rows(conn)[0]["killer"] is None
    assert rows(conn)[0]["ended"] == "death"  # il reste des lignes mortes derrière


def test_un_kill_n_est_rapproche_que_d_une_seule_vie():
    conn = make_conn()
    add_life(conn, 1, 0.1, 30.0)
    add_life(conn, 1, 47.0, 80.0)
    add_kill(conn, 30.5, 5, 1)
    lives.compute(conn, 1)
    first, second = rows(conn)
    assert first["killer"] == 5 and second["killer"] is None


def test_compute_est_idempotent_et_ecrit_stats_meta():
    conn = make_conn()
    add_life(conn, 3, 0.1, 40.0)
    add_kill(conn, 40.0, 7, 3)
    assert lives.compute(conn, 1) == 1
    assert lives.compute(conn, 1) == 1
    assert conn.execute("SELECT COUNT(*) FROM lives").fetchone()[0] == 1
    assert conn.execute("SELECT module, revision FROM stats_meta WHERE game_id = 1").fetchall() == [("lives", lives.REVISION)]


def test_game_sans_aucune_ligne():
    conn = make_conn()
    assert lives.compute(conn, 1) == 0
