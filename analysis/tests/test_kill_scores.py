"""Note des kills (kill_scores.py) : parties synthétiques de Polaris (montage de test_waves.py et test_retakes.py, un seul point A au centre)."""

import json

import kill_scores
from test_kill_series import FAR_A, at
from test_retakes import dying, leave, players_for
from test_waves import A_SPAWN, MID, make_conn, stay


def notes(conn):
    """{(t, victime): (impact, raisons)} de la game 1."""
    return {(r[0], r[1]): (r[2], json.loads(r[3])) for r in conn.execute("SELECT t, victim_slot, impact, reasons FROM kill_scores WHERE game_id = 1")}


def run(players, kills, owners=()):
    conn = make_conn(players, kills=kills, owners=owners)
    kill_scores.compute(conn, 1)
    return conn, notes(conn)


def test_premier_kill_de_la_vague_teamfight_gagne_et_prise_du_point_font_trois():
    owners = [(0, 5, "none"), (5, 45, "B"), (45, 100, "A")]
    kills = [(31.0, 1, 5), (33.0, 2, 6), (34.0, 7, 3), (36.0, 1, 7)]
    players = players_for({3: dying(3, 34.0, leave(A_SPAWN, 24.0, 32.0)), 5: dying(5, 31.0, stay(MID)), 6: dying(6, 33.0, stay(MID)), 7: dying(7, 36.0, stay(MID))})
    _conn, n = run(players, kills, owners)
    assert n[(31.0, 5)][0] == 3.0
    assert any("premier kill de la vague" in r for r in n[(31.0, 5)][1]) and any("gagner le teamfight" in r for r in n[(31.0, 5)][1]) and any("prend le point A" in r for r in n[(31.0, 5)][1])
    assert n[(33.0, 6)][0] == 2.0 and n[(36.0, 7)][0] == 2.0  # teamfight gagné et prise, mais pas le premier kill
    assert n[(34.0, 3)][0] == -2.0 and any("perd le teamfight" in r for r in n[(34.0, 3)][1])  # le tueur 7 meurt 2 s après : le teamfight perdu ne cumule pas le malus d'échange


def test_tueur_qui_meurt_dans_les_cinq_secondes_sans_suite_perd_un_point():
    players = {1: dying(1, 42.0, stay(FAR_A)), 5: dying(5, 40.0, stay(FAR_A)), 6: at(FAR_A)}
    _conn, n = run(players, [(40.0, 1, 5), (42.0, 6, 1)])
    assert n[(40.0, 5)][0] == -1.0 and "sans suite" in n[(40.0, 5)][1][0]
    assert n[(42.0, 1)] == (0.0, [])


def test_egalite_des_pertes_dans_un_teamfight_ne_donne_ni_bonus_ni_malus():
    players = {s: at(MID) for s in (1, 2, 3, 5, 6, 7)}
    _conn, n = run(players, [(40.0, 1, 5), (42.0, 6, 2)])
    assert n == {(40.0, 5): (0.0, []), (42.0, 2): (0.0, [])}


def test_tenir_le_point_pres_du_cadre_compte_mais_pas_loin_du_point():
    owners = [(0, 100, "B")]
    pres = {2: dying(2, 40.0, stay(MID)), 6: at(MID)}
    _c, n = run(pres, [(40.0, 6, 2)], owners)
    assert n[(40.0, 2)][0] == 1.0 and "tient le point A" in n[(40.0, 2)][1][0]
    loin = {2: dying(2, 40.0, stay(A_SPAWN)), 6: at(A_SPAWN)}  # le spawn est à 9 m du cadre
    _c, n = run(loin, [(40.0, 6, 2)], owners)
    assert n[(40.0, 2)] == (0.0, [])


def test_kill_sans_tueur_adverse_n_a_pas_de_note():
    conn = make_conn({2: dying(2, 40.0, stay(FAR_A))}, kills=[(40.0, None, 2)])
    assert kill_scores.compute(conn, 1) == 0
    assert notes(conn) == {}


def test_notes_bornees_idempotent_et_stats_meta():
    owners = [(0, 5, "none"), (5, 45, "B"), (45, 100, "A")]
    kills = [(31.0, 1, 5), (33.0, 2, 6), (34.0, 7, 3), (36.0, 1, 7)]
    players = players_for({3: dying(3, 34.0, leave(A_SPAWN, 24.0, 32.0)), 5: dying(5, 31.0, stay(MID)), 6: dying(6, 33.0, stay(MID)), 7: dying(7, 36.0, stay(MID))})
    conn = make_conn(players, kills=kills, owners=owners)
    assert kill_scores.compute(conn, 1) == 4 and kill_scores.compute(conn, 1) == 4
    assert conn.execute("SELECT COUNT(*) FROM kill_scores").fetchone()[0] == 4
    assert all(kill_scores.SCORE_MIN <= v[0] <= kill_scores.SCORE_MAX for v in notes(conn).values())
    assert conn.execute("SELECT revision FROM stats_meta WHERE game_id = 1 AND module = 'kill_scores'").fetchone()[0] == kill_scores.REVISION
