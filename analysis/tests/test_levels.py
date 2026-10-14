"""Niveau des joueurs d'Atlantis et de The Cliff (levels.py) : géométrie et base en mémoire, cas synthétiques."""

import sqlite3
from pathlib import Path

import numpy as np

import levels

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8")
START = 100.0  # début de la game en temps de vidéo
END = 400.0

# Carte synthétique de 200 x 100 cases : une plate-forme en x 0,54 à 0,75, y 0,4 à 0,7. Paire : station basse loin (0,30 ; 0,55), station haute près du bord (0,52 ; 0,55).
LOW, HIGH = (0.30, 0.55), (0.52, 0.55)


def make_core():
    core = np.zeros((100, 200), bool)
    core[40:70, 108:150] = True
    return core


GEOM = levels.Geometry([(LOW, HIGH)], make_core())


def make_conn(map_name="The Cliff"):
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'v.mp4', 600, 30, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, ?, ?, ?)", (START, END, map_name))
    return conn


def add_rows(conn, slot, points):
    """Lignes de samples : points = [(t de la game, x, y, confiance, vivant)] (une toutes les 0,1 s au plus : les tests les donnent déjà espacées)."""
    for t, x, y, conf, alive in points:
        frame = round((START + t) * 10)
        conn.execute("INSERT INTO samples (game_id, frame, t, slot, team, x, y, alive, confidence) VALUES (1, ?, ?, ?, 'A', ?, ?, ?, ?)", (frame, frame / 10, slot, x, y, alive, conf))


def hold(t0, t1, p, conf=1.0):
    """Le joueur reste en p de t0 à t1 (une ligne toutes les 0,1 s)."""
    n = round((t1 - t0) * 10)
    return [(round(t0 + i / 10, 1), p[0], p[1], conf, 1) for i in range(n + 1)]


def segs_of(conn, slot=1):
    return [(r[0], r[1], r[2], r[3]) for r in conn.execute("SELECT t0, t1, level, source FROM player_levels WHERE game_id = 1 AND slot = ? ORDER BY t0", (slot,))]


def test_depart_sans_tyrolienne_tout_en_dessous_par_defaut(monkeypatch):
    monkeypatch.setattr(levels, "load_geometry", lambda m: GEOM)
    conn = make_conn()
    add_rows(conn, 1, hold(0.0, 20.0, LOW))
    assert levels.compute(conn, 1) == 1
    assert segs_of(conn) == [(0.0, 20.0, "dessous", "default")]


def test_tyrolienne_vers_le_haut_donne_etage_a_l_arrivee(monkeypatch):
    monkeypatch.setattr(levels, "load_geometry", lambda m: GEOM)
    conn = make_conn()
    add_rows(conn, 1, hold(0.0, 10.0, LOW) + hold(10.1, 20.0, HIGH))
    levels.compute(conn, 1)
    assert segs_of(conn) == [(0.0, 10.1, "dessous", "default"), (10.1, 20.0, "etage", "tp")]


def test_tyrolienne_vers_le_bas_ramene_en_dessous(monkeypatch):
    monkeypatch.setattr(levels, "load_geometry", lambda m: GEOM)
    conn = make_conn()
    add_rows(conn, 1, hold(0.0, 5.0, LOW) + hold(5.1, 15.0, HIGH) + hold(15.1, 25.0, LOW))
    levels.compute(conn, 1)
    assert segs_of(conn) == [(0.0, 5.1, "dessous", "default"), (5.1, 15.1, "etage", "tp"), (15.1, 25.0, "dessous", "tp")]


def test_la_mort_remet_dessous_a_la_reapparition(monkeypatch):
    monkeypatch.setattr(levels, "load_geometry", lambda m: GEOM)
    conn = make_conn()
    first = hold(0.0, 5.0, LOW) + hold(5.1, 20.0, HIGH)
    cross = [(round(20.1 + i / 10, 1), HIGH[0], HIGH[1], 1.0, 0) for i in range(20)]  # croix de mort de 2 s
    add_rows(conn, 1, first + cross + hold(40.0, 50.0, LOW))  # réapparition 20 s après
    assert levels.compute(conn, 1) == 3
    segs = segs_of(conn)
    assert segs[1][2:] == ("etage", "tp") and segs[2] == (40.0, 50.0, "dessous", "default")
    assert segs[1][1] <= 20.0  # le niveau s'arrête avec la vie


def test_sortie_durable_de_l_emprise_donne_dessous_par_la_zone(monkeypatch):
    monkeypatch.setattr(levels, "load_geometry", lambda m: GEOM)
    conn = make_conn()
    away = (0.45, 0.55)  # loin de l'emprise : rez-de-chaussée seulement
    add_rows(conn, 1, hold(0.0, 5.0, LOW) + hold(5.1, 10.0, HIGH) + hold(10.1, 12.0, away))
    levels.compute(conn, 1)
    segs = segs_of(conn)
    assert segs[-1][2:] == ("dessous", "zone") and abs(segs[-1][0] - 10.1) < 1e-6


def test_une_courte_sortie_de_l_emprise_ne_change_pas_le_niveau(monkeypatch):
    monkeypatch.setattr(levels, "load_geometry", lambda m: GEOM)
    conn = make_conn()
    away = (0.45, 0.55)
    add_rows(conn, 1, hold(0.0, 5.0, LOW) + hold(5.1, 10.0, HIGH) + hold(10.1, 10.3, away) + hold(10.4, 15.0, HIGH))
    levels.compute(conn, 1)
    assert [s[2] for s in segs_of(conn)] == ["dessous", "etage"]


def test_une_position_devinee_ne_fait_pas_sortir_de_l_emprise(monkeypatch):
    monkeypatch.setattr(levels, "load_geometry", lambda m: GEOM)
    conn = make_conn()
    add_rows(conn, 1, hold(0.0, 5.0, LOW) + hold(5.1, 10.0, HIGH) + hold(10.1, 14.0, (0.45, 0.55), conf=0.3))
    levels.compute(conn, 1)
    assert [s[2] for s in segs_of(conn)] == ["dessous", "etage"]


def test_saut_de_position_devinee_n_est_pas_une_tyrolienne(monkeypatch):
    monkeypatch.setattr(levels, "load_geometry", lambda m: GEOM)
    conn = make_conn()
    add_rows(conn, 1, hold(0.0, 10.0, LOW, conf=0.3) + hold(10.1, 20.0, HIGH, conf=0.3))
    levels.compute(conn, 1)
    assert [s[2] for s in segs_of(conn)] == ["dessous"]


def test_aller_retour_en_moins_de_3_s_s_annule(monkeypatch):
    monkeypatch.setattr(levels, "load_geometry", lambda m: GEOM)
    conn = make_conn()
    add_rows(conn, 1, hold(0.0, 10.0, LOW) + hold(10.1, 11.0, HIGH) + hold(11.1, 20.0, LOW))
    levels.compute(conn, 1)
    assert [s[2] for s in segs_of(conn)] == ["dessous"]


def test_marche_rapide_entre_deux_points_n_est_pas_une_tyrolienne():
    rows = [(i / 10, 0.30 + i * 0.01, 0.55, 1.0) for i in range(30)]  # 0,01 par ligne : trop lent pour un saut
    assert levels.detect_rides(rows, GEOM) == []


def test_carte_a_un_seul_niveau_sans_ligne():
    conn = make_conn("Polaris")
    add_rows(conn, 1, hold(0.0, 10.0, LOW))
    assert levels.compute(conn, 1) == 0
    assert conn.execute("SELECT COUNT(*) FROM player_levels").fetchone()[0] == 0
    assert conn.execute("SELECT revision FROM stats_meta WHERE game_id = 1 AND module = 'levels'").fetchone()[0] == levels.REVISION


def test_calcul_idempotent_et_stats_meta(monkeypatch):
    monkeypatch.setattr(levels, "load_geometry", lambda m: GEOM)
    conn = make_conn()
    add_rows(conn, 1, hold(0.0, 5.0, LOW) + hold(5.1, 15.0, HIGH))
    a = levels.compute(conn, 1)
    first = segs_of(conn)
    assert levels.compute(conn, 1) == a and segs_of(conn) == first
    assert conn.execute("SELECT revision FROM stats_meta WHERE game_id = 1 AND module = 'levels'").fetchone()[0] == levels.REVISION


def test_extremite_haute_la_plus_proche_de_l_emprise():
    assert GEOM.upper == [1]
    assert GEOM.dist(HIGH) < levels.ZONE_MARGIN < GEOM.dist(LOW)


def test_paire_ambigue_prend_le_symetrique_d_une_paire_franche():
    core = np.zeros((100, 200), bool)
    core[10:30, 10:30] = True  # plate-forme de gauche (x 0,05 à 0,15)
    core[10:30, 170:190] = True  # plate-forme de droite (x 0,85 à 0,95)
    right = ((0.60, 0.5), (0.80, 0.25))  # franche : l'extrémité 1 est à 0,05 de l'emprise, l'autre à 0,25
    left = ((0.18, 0.25), (0.20, 0.25))  # écarts 0,034 et 0,054 : ambiguë (la plus proche serait l'extrémité 0) ; le symétrique de (0,80 ; 0,25) est (0,20 ; 0,25) : extrémité 1
    geom = levels.Geometry([right, left], core)
    assert geom.upper == [1, 1]


def test_footprint_ferme_et_bouche_les_trous():
    layer = np.zeros((40, 60), np.uint8)
    layer[5:35, 5:55] = 255
    layer[15:25, 20:40] = 0  # trou intérieur
    assert levels.footprint(layer)[20, 30]


def test_level_at_frontiere_et_hors_vie():
    segs = [[(0.0, 5.0, "dessous", "default"), (5.0, 9.0, "etage", "tp")]]
    assert levels.level_at(segs, 5.0) == "etage" and levels.level_at(segs, 4.9) == "dessous" and levels.level_at(segs, 9.0) == "etage"
    assert levels.level_at(segs, 20.0) is None


def test_geometrie_reelle_des_deux_cartes():
    """Fichiers de cartes du dépôt (indépendant de l'ordre des paires) : extrémités hautes d'Atlantis = les stations intérieures (x 0,26 et 0,72), de The Cliff = les extérieures (y 0,24 à 0,25)."""
    atlantis, cliff = levels.load_geometry("Atlantis"), levels.load_geometry("The Cliff")
    assert sorted(round(p[k][0], 1) for p, k in zip(atlantis.pairs, atlantis.upper)) == [0.3, 0.7]
    assert all(p[k][1] < 0.26 for p, k in zip(cliff.pairs, cliff.upper))
    assert levels.load_geometry("Polaris") is None
