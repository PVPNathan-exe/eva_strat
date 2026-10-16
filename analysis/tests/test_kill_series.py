"""Séries de kills, teamfight ou duel (kill_series.py) : mêmes parties synthétiques que test_waves.py."""

import episode_common as ec
import kill_series
from test_waves import A_SPAWN, B_SPAWN, DURATION, MID, game_of, make_conn, stay

FAR_A = (0.45, 0.05)  # deux endroits de l'arène à plus de 10 m l'un de l'autre et des deux spawns (Polaris : le spawn est à 9,8 m du point central)
FAR_B = (0.50, 0.97)


def at(p, t0=0.0, t1=DURATION, ended="end"):
    return [(t0, t1, ended, stay(p))]


def test_serie_suite_de_kills_a_moins_de_dix_secondes():
    game = game_of(make_conn({}, kills=[(10.0, 1, 5), (18.0, 2, 6), (35.0, 1, 7)]))
    assert kill_series.chain_end(game["kills"], 0) == 1
    assert kill_series.chain_start(game["kills"], 1) == 0
    assert kill_series.chain_end(game["kills"], 2) == 2


def test_gagnant_moins_de_pertes_puis_plus_de_survivants():
    assert kill_series.winner_of({"A": 1, "B": 3}, {"A": 3, "B": 1}) == "A"
    assert kill_series.winner_of({"A": 2, "B": 2}, {"A": 1, "B": 2}) == "B"
    assert kill_series.winner_of({"A": 2, "B": 2}, {"A": 2, "B": 2}) is None


def test_un_contre_un_isole_est_un_duel():
    players = {1: at(FAR_A), 5: at(FAR_A)}  # les autres sont au spawn, à plus de 10 m
    game = game_of(make_conn(players, kills=[(40.0, 1, 5)]))
    f = kill_series.fight_from(game, 0)
    assert f["kind"] == "duel" and f["engaged"] == {"A": 1, "B": 1} and f["foyers"] == 1


def test_quatre_kills_avec_des_coequipiers_a_cote_sont_un_teamfight():
    players = {s: at(MID) for s in (1, 2, 3, 5, 6, 7)}
    kills = [(40.0, 1, 5), (42.0, 2, 6), (44.0, 7, 3), (46.0, 2, 7)]
    f = kill_series.fight_from(game_of(make_conn(players, kills=kills)), 0)
    assert f["kind"] == "teamfight" and f["n_kills"] == 4
    assert f["losses"] == {"A": 1, "B": 3} and f["winner"] == "A"


def test_teamfight_lourd_quand_les_deux_equipes_perdent_au_moins_trois_joueurs():
    players = {s: at(MID) for s in range(1, 9)}
    kills = [(40.0, 5, 1), (41.0, 6, 2), (42.0, 7, 3), (44.0, 4, 5), (45.0, 4, 6), (46.0, 4, 7)]
    f = kill_series.fight_from(game_of(make_conn(players, kills=kills)), 0)
    assert f["kind"] == "teamfight" and f["losses"] == {"A": 3, "B": 3} and f["heavy"] is True
    assert kill_series.HEAVY_MIN_LOSSES == 3


def test_teamfight_a_sens_unique_ou_duel_nest_pas_lourd():
    players = {s: at(MID) for s in (1, 2, 3, 5, 6, 7)}
    kills = [(40.0, 1, 5), (42.0, 2, 6), (44.0, 7, 3), (46.0, 2, 7)]  # A perd 1, B perd 3 : teamfight non lourd, le gagnant ne change pas
    f = kill_series.fight_from(game_of(make_conn(players, kills=kills)), 0)
    assert f["kind"] == "teamfight" and f["heavy"] is False and f["winner"] == "A"
    one = kill_series.fight_from(game_of(make_conn({1: at(FAR_A), 5: at(FAR_A)}, kills=[(40.0, 1, 5)])), 0)
    assert one["kind"] == "duel" and one["heavy"] is False


def test_is_heavy_seuil_et_nature():
    assert kill_series.is_heavy("teamfight", {"A": 3, "B": 4}) and not kill_series.is_heavy("teamfight", {"A": 2, "B": 4})
    assert not kill_series.is_heavy("duel", {"A": 3, "B": 3})


def test_aide_a_moins_de_dix_metres_fait_un_teamfight_meme_avec_un_seul_kill_par_equipe():
    # le 2 et le 6 ne tuent ni ne meurent mais sont à côté du combat : engagés
    players = {1: at(MID), 5: at(MID), 2: at((MID[0] - 0.05, MID[1])), 6: at((MID[0] + 0.05, MID[1]))}
    kills = [(40.0, 1, 5), (43.0, 6, 1)]
    f = kill_series.fight_from(game_of(make_conn(players, kills=kills)), 0)
    assert f["kind"] == "teamfight" and f["engaged"]["A"] >= 2 and f["engaged"]["B"] >= 2


def test_aide_trop_loin_laisse_un_duel_a_deux_kills():
    players = {1: at(FAR_A), 5: at(FAR_A)}  # coéquipiers au spawn
    f = kill_series.fight_from(game_of(make_conn(players, kills=[(40.0, 1, 5), (43.0, 5, 1)])), 0)
    assert f["kind"] == "duel" and f["n_kills"] == 2


def test_autre_combat_ailleurs_en_meme_temps_fait_un_teamfight():
    players = {1: at(FAR_A), 5: at(FAR_A), 2: at(FAR_B), 6: at(FAR_B)}  # deux duels à plus de 10 m l'un de l'autre
    two = game_of(make_conn(players, kills=[(40.0, 1, 5), (43.0, 6, 2)]))
    f = kill_series.fight_from(two, 0)
    assert f["foyers"] == 2 and f["kind"] == "teamfight"
    one = game_of(make_conn(players, kills=[(40.0, 1, 5), (60.0, 6, 2)]))  # séparés de 20 s : deux séries, deux duels
    assert [kill_series.fight_from(one, i)["kind"] for i in (0, 1)] == ["duel", "duel"]


def test_un_seul_kill_nest_jamais_un_teamfight():
    players = {s: at(MID) for s in (1, 2, 3, 5, 6, 7)}
    f = kill_series.fight_from(game_of(make_conn(players, kills=[(40.0, 1, 5)])), 0)
    assert f["kind"] == "duel"


def test_fraction_de_laxe_entre_les_deux_spawns():
    game = game_of(make_conn({}))
    mid = ((A_SPAWN[0] + B_SPAWN[0]) / 2, A_SPAWN[1])
    assert kill_series.axis_frac(game, mid, "A") == 0.5
    assert kill_series.axis_frac(game, A_SPAWN, "A") == 0.0
    assert kill_series.axis_frac(game, B_SPAWN, "A") == 1.0
    assert kill_series.axis_frac(game, mid, "B") == 0.5 and kill_series.axis_frac(game, A_SPAWN, "B") == 1.0
    assert kill_series.axis_frac(game, None, "A") is None


def test_part_des_morts_pres_du_point():
    players = {5: at(MID), 1: at(MID), 6: at((0.2, 0.2))}
    kills = [(40.0, 1, 5), (42.0, 1, 6)]
    game = game_of(make_conn(players, kills=kills))
    f = kill_series.fight_from(game, 0)
    assert kill_series.victims_near_share(game, f, game["instances"][0]["rect"]) is not None
    assert ec.team_of(f["kills"][0]["victim"]) == "B"
