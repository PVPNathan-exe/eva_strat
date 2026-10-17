"""Duels (duels.py) : parties synthétiques de Polaris (montage de test_waves.py), points de vie injectés par un HpTrack (le vrai cache des bandeaux n'est lu que par `load_hp`, testé à part)."""

import json

import duels
from test_kill_series import FAR_A, FAR_B, at
from test_retakes import dying
from test_waves import DURATION, MID, make_conn, stay

STEP = 0.1


def hp_track(curves=None):
    """HpTrack de 0 à DURATION, un point toutes les 0,1 s. curves : {slot: [(t, hp)]} (interpolation linéaire, constant avant et après), pleine forme (1,0) par défaut."""
    times = [round(i * STEP, 3) for i in range(int(DURATION / STEP) + 1)]

    def value(points, t):
        if t <= points[0][0]:
            return points[0][1]
        for (t0, v0), (t1, v1) in zip(points, points[1:]):
            if t <= t1:
                return v0 + (v1 - v0) * (t - t0) / (t1 - t0)
        return points[-1][1]

    return duels.HpTrack(times, {s: [value((curves or {}).get(s, [(0.0, 1.0)]), t) for t in times] for s in range(1, 9)})


def rows(conn):
    return [dict(zip(("t0", "t1", "slot_a", "slot_b", "winner", "outcome", "data"), r[:6] + (json.loads(r[6]),)))
            for r in conn.execute("SELECT t0, t1, slot_a, slot_b, winner_slot, outcome, data FROM duels WHERE game_id = 1 ORDER BY t0, slot_a")]


def run(players, kills, hp):
    conn = make_conn(players, kills=kills)
    duels.compute(conn, 1, hp=hp)
    return conn, rows(conn)


ISOLES = {1: at(FAR_A), 6: at(FAR_A)}  # deux ennemis seuls loin de tout le monde


# ---------------------------------------------------------------- duels avec kill

def test_un_kill_isole_est_gagne_par_le_tueur_avec_les_points_de_vie_perdus():
    players = {1: at(FAR_A), 5: dying(5, 40.0, stay(FAR_A))}
    hp = hp_track({5: [(37.0, 1.0), (40.0, 0.0)], 1: [(38.0, 1.0), (39.0, 0.6)]})
    _conn, [d] = run(players, [(40.0, 1, 5)], hp)
    assert (d["slot_a"], d["slot_b"], d["winner"], d["outcome"]) == (1, 5, 1, "kill")
    assert abs(d["t0"] - 37.0) < 0.6 and d["t1"] == 40.0
    assert d["data"]["hp_lost"]["5"] == 1.0 and abs(d["data"]["hp_lost"]["1"] - 0.4) < 0.05
    assert d["data"]["source"] == "kill" and d["data"]["hp_source"] == "cache"


def test_deux_kills_croises_sont_un_trade_sans_gagnant():
    players = {1: dying(1, 40.5, stay(FAR_A)), 5: dying(5, 40.0, stay(FAR_A))}
    _conn, [d] = run(players, [(40.0, 1, 5), (40.5, 5, 1)], hp_track())
    assert d["outcome"] == "trade" and d["winner"] is None and (d["slot_a"], d["slot_b"]) == (1, 5)


def test_un_teamfight_n_est_pas_un_duel():
    players = {s: at(MID) for s in (1, 2, 3, 5, 6, 7)}
    _conn, found = run(players, [(40.0, 1, 5), (42.0, 2, 6), (44.0, 7, 3), (46.0, 2, 7)], hp_track())
    assert found == []


def test_un_kill_seul_avec_de_l_aide_des_deux_cotes_n_est_pas_un_duel_sauf_reglage(monkeypatch):
    players = {1: at(MID), 2: at(MID), 5: dying(5, 40.0, stay(MID)), 6: at(MID)}
    _conn, found = run(players, [(40.0, 1, 5)], hp_track())
    assert found == []
    monkeypatch.setattr(duels, "KEEP_HELPED_SINGLE_KILLS", True)
    _conn, found = run(players, [(40.0, 1, 5)], hp_track())
    assert [d["winner"] for d in found] == [1]


def test_sans_points_de_vie_le_duel_avec_kill_existe_sans_pourcentages():
    players = {1: at(FAR_A), 5: dying(5, 40.0, stay(FAR_A))}
    _conn, [d] = run(players, [(40.0, 1, 5)], None)
    assert d["winner"] == 1 and d["data"]["hp_source"] == "aucun" and d["data"]["hp_lost"] == {"1": None, "5": None}


# ---------------------------------------------------------------- duels aux points de vie

def test_duel_sans_kill_gagne_par_le_plus_de_points_de_vie_restants():
    hp = hp_track({1: [(30.0, 1.0), (31.0, 0.5)], 6: [(31.0, 1.0), (32.0, 0.8)]})
    _conn, [d] = run(ISOLES, [], hp)
    assert (d["slot_a"], d["slot_b"], d["winner"], d["outcome"]) == (1, 6, 6, "points_de_vie")
    assert d["data"]["source"] == "hp" and abs(d["data"]["hp_end"]["1"] - 0.5) < 0.05 and abs(d["data"]["hp_end"]["6"] - 0.8) < 0.05


def test_ecart_de_points_de_vie_sous_la_marge_est_indecis():
    hp = hp_track({1: [(30.0, 1.0), (31.0, 0.5)], 6: [(31.0, 1.0), (32.0, 0.55)]})
    _conn, [d] = run(ISOLES, [], hp)
    assert d["winner"] is None and d["outcome"] == "indecis"


def test_petits_degats_ou_trop_loin_ou_sans_chevauchement_ne_sont_pas_un_duel():
    petit = hp_track({1: [(30.0, 1.0), (31.0, 0.92)], 6: [(30.0, 1.0), (31.0, 0.5)]})
    assert run(ISOLES, [], petit)[1] == []
    loin = {1: at(FAR_A), 6: at(FAR_B)}  # plus de 14 m
    assert run(loin, [], hp_track({1: [(30.0, 1.0), (31.0, 0.5)], 6: [(30.0, 1.0), (31.0, 0.5)]}))[1] == []
    decale = hp_track({1: [(30.0, 1.0), (31.0, 0.5)], 6: [(60.0, 1.0), (61.0, 0.5)]})
    assert run(ISOLES, [], decale)[1] == []


# ---------------------------------------------------------------- régénération, interruption par un tiers (règles du 17 octobre 2026)

def test_duel_sans_mort_finit_a_la_regeneration_mesuree_quand_la_remontee_n_est_pas_lue():
    hp = hp_track({1: [(30.0, 1.0), (31.0, 0.5)], 6: [(31.0, 1.0), (32.0, 0.8)]})
    _conn, [d] = run(ISOLES, [], hp)
    assert d["data"]["ended_by"] == "regeneration" and {v["source"] for v in d["data"]["regen"].values()} == {"mesure"}
    assert abs(d["t0"] - 30.0) < 0.6 and abs(d["t1"] - (31.0 + duels.REGEN_DELAY_S)) < 0.4  # la régénération du premier des deux (dernière perte du 1 à 31 s + délai mesuré)


def test_duel_sans_mort_finit_au_debut_de_la_remontee_quand_elle_est_lue():
    hp = hp_track({1: [(30.0, 1.0), (31.0, 0.5), (36.0, 0.5), (37.0, 1.0)], 6: [(31.0, 1.0), (32.0, 0.8)]})
    _conn, [d] = run(ISOLES, [], hp)
    assert abs(d["t1"] - 36.0) < 0.3 and d["data"]["regen"]["1"]["source"] == "lu"
    assert d["winner"] == 6 and abs(d["data"]["hp_end"]["1"] - 0.5) < 0.05  # les points de vie restants sont lus avant la remontée


def test_kill_d_un_coequipier_interrompt_le_duel_et_il_n_est_pas_credite():
    players = {1: at(FAR_A), 2: at(FAR_A), 6: dying(6, 33.0, stay(FAR_A))}
    hp = hp_track({1: [(30.0, 1.0), (31.0, 0.5)], 6: [(30.0, 1.0), (33.0, 0.0)]})
    _conn, found = run(players, [(33.0, 2, 6)], hp)
    assert [(d["slot_a"], d["slot_b"], d["winner"], d["outcome"]) for d in found] == [(1, 6, None, "interrompu")]  # le kill du 2 n'est plus un duel avec kill
    assert found[0]["data"]["interrupted_by"] == {"slot": 2, "victim": 6, "t": 33.0} and found[0]["data"]["ended_by"] == "kill_tiers"
    assert abs(found[0]["t1"] - 33.0) < 0.6


def test_le_coequipier_qui_a_aussi_perdu_de_la_vie_face_a_la_victime_garde_son_duel_avec_kill():
    players = {1: at(FAR_A), 2: at(FAR_A), 6: dying(6, 33.0, stay(FAR_A))}
    hp = hp_track({1: [(30.0, 1.0), (31.0, 0.5)], 2: [(31.0, 1.0), (32.0, 0.6)], 6: [(30.0, 1.0), (33.0, 0.0)]})
    _conn, found = run(players, [(33.0, 2, 6)], hp)
    assert sorted((d["slot_a"], d["slot_b"], d["outcome"], d["winner"]) for d in found) == [(1, 6, "interrompu", None), (2, 6, "kill", 2)]


def test_mort_sans_kill_lu_pendant_un_duel_est_indecise():
    players = {1: at(FAR_A), 6: dying(6, 33.0, stay(FAR_A))}
    hp = hp_track({1: [(30.0, 1.0), (31.0, 0.5)], 6: [(30.0, 1.0), (33.0, 0.0)]})
    _conn, [d] = run(players, [], hp)
    assert d["outcome"] == "indecis" and d["winner"] is None and d["data"]["ended_by"] == "mort_sans_kill"


def test_kill_de_l_autre_duelliste_reste_un_duel_avec_kill_sans_doublon():
    players = {1: at(FAR_A), 6: dying(6, 33.0, stay(FAR_A))}
    hp = hp_track({1: [(30.0, 1.0), (31.0, 0.5)], 6: [(30.0, 1.0), (33.0, 0.0)]})
    _conn, found = run(players, [(33.0, 1, 6)], hp)
    assert [(d["slot_a"], d["slot_b"], d["outcome"], d["winner"]) for d in found] == [(1, 6, "kill", 1)]


def test_la_fin_de_game_borne_la_regeneration():
    hp = hp_track({1: [(194.0, 1.0), (195.0, 0.5)], 6: [(194.0, 1.0), (195.0, 0.6)]})
    _conn, [d] = run(ISOLES, [], hp)
    assert d["t1"] <= 200.0 - duels.END_BLANK_S + 1e-6 and d["data"]["hp_end"]["1"] is not None


# ---------------------------------------------------------------- cache des bandeaux

def write_cache(tmp_path, fills, n=300):
    """Cache minimal eval_1.json : n images à 0,1 s depuis le début de la game (temps de vidéo START = 100) ; fills : {slot: fonction image -> remplissage}."""
    from test_waves import START

    frames = [[i, START + i * STEP, []] for i in range(n)]
    states = {str(i): {str(s): {"alive": True, "spectated": False, "fill": f(i)} for s, f in fills.items()} for i in range(n)}
    (tmp_path / "eval_1.json").write_text(json.dumps({"frames": frames, "states": states}), encoding="utf-8")


def test_lecture_du_cache_normalise_le_remplissage_et_ecarte_les_morts_et_la_fin(tmp_path):
    import episode_common as ec

    n = int(DURATION / STEP) + 1
    write_cache(tmp_path, {1: lambda i: 0.83 if i < 100 else 0.415, 5: lambda i: 0.1}, n)
    conn = make_conn({5: [(0.0, 10.0, "death", stay(FAR_A))]})  # le 5 est mort après 10 s : son 0,1 de décompte n'est pas un point de vie
    game = ec.load_game(conn, 1)
    track = duels.load_hp(game, cache_dir=tmp_path)
    assert track.at(1, 5.0) == 1.0 and abs(track.at(1, 20.0) - 0.5) < 0.01
    assert track.at(5, 5.0) is not None and track.at(5, 20.0) is None
    assert track.at(1, DURATION - 0.5) is None  # écran noir de fin de game ignoré
    assert duels.load_hp(game, cache_dir=tmp_path / "absent") is None


def test_chute_des_bandeaux_a_la_fin_de_la_game_n_est_pas_un_duel(tmp_path):
    n = int(DURATION / STEP) + 1
    chute = lambda i: 0.83 if i < n - 16 else 0.0  # les bandeaux s'éteignent 1,6 s avant la fin
    write_cache(tmp_path, {s: chute for s in range(1, 9)}, n)
    conn = make_conn(ISOLES)
    assert duels.compute(conn, 1, cache_dir=tmp_path) == 0


def test_compute_est_idempotent_et_ecrit_stats_meta():
    players = {1: at(FAR_A), 5: dying(5, 40.0, stay(FAR_A))}
    conn = make_conn(players, kills=[(40.0, 1, 5)])
    assert duels.compute(conn, 1, hp=hp_track()) == 1
    assert duels.compute(conn, 1, hp=hp_track()) == 1
    assert conn.execute("SELECT COUNT(*) FROM duels").fetchone()[0] == 1
    assert conn.execute("SELECT revision FROM stats_meta WHERE game_id = 1 AND module = 'duels'").fetchone()[0] == duels.REVISION
