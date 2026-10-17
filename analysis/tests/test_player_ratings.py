"""Note sur 20 d'un joueur (player_ratings.py, REVISION 1) : échelle et conversion en points, notes absentes, assistances (repli et tableau de fin de game), aggro, prise de fight, présence, base en mémoire
(montage de test_waves.py : Polaris, joueurs 1 à 4 au spawn A, 5 à 8 au spawn B)."""

import json

import player_ratings as P
from test_kill_series import FAR_A, at
from test_waves import A_SPAWN, B_SPAWN, DURATION, MID, game_of, leave, make_conn, stay

SC = {"p05": 0.0, "p50": 1.0, "p95": 3.0}


def uniform_scale(source="repli"):
    """Échelle de test : toutes les composantes de 0 (note 0) à 1 (note 10) et 3 (note 20)."""
    return {P.scale_key(c[0], source): dict(SC) for c in P.COMPONENTS}


def run(conn, scale=None):
    P.compute(conn, 1, uniform_scale() if scale is None else scale)
    return {r["slot"]: r for r in rows_of(conn)}


def rows_of(conn):
    cur = conn.execute("SELECT slot, individual, teamplay, overall, assists, assist_source, data FROM player_ratings WHERE game_id = 1 ORDER BY slot")
    return [dict(zip(("slot", "individual", "teamplay", "overall", "assists", "assist_source", "data"), r[:6] + (json.loads(r[6]),))) for r in cur]


def duel_game(extra=None):
    """Le joueur 1 tue le joueur 5 à 40 s à FAR_A ; 2 est tout près de la mort, 3 est au spawn ; 6 à 8 au spawn B."""
    players = {1: at(FAR_A), 5: at(FAR_A, 0.0, 40.0, "death"), 2: at((FAR_A[0] + 0.03, FAR_A[1]))}
    players[5].append((57.0, DURATION, "end", stay(B_SPAWN)))
    players.update(extra or {})
    return make_conn(players, kills=[(40.0, 1, 5)])


# ---------------------------------------------------------------- échelle

def test_la_note_vaut_10_a_la_mediane_0_au_5e_et_20_au_95e_centile():
    assert P.note_of(1.0, SC) == 10.0 and P.note_of(0.0, SC) == 0.0 and P.note_of(3.0, SC) == 20.0
    assert P.note_of(0.5, SC) == 5.0 and P.note_of(2.0, SC) == 15.0


def test_la_note_est_plafonnee_entre_0_et_20():
    assert P.note_of(-5.0, SC) == 0.0 and P.note_of(99.0, SC) == 20.0


def test_moins_c_est_mieux_inverse_la_note():
    assert P.note_of(0.0, SC, down=True) == 20.0 and P.note_of(1.0, SC, down=True) == 10.0 and P.note_of(3.0, SC, down=True) == 0.0


def test_echelle_sans_etendue_une_valeur_egale_a_la_mediane_vaut_10():
    flat = {"p05": 0.0, "p50": 0.0, "p95": 0.4}  # valeurs de la base en grande partie nulles
    assert P.note_of(0.0, flat) == 10.0 and P.note_of(0.4, flat) == 20.0 and P.note_of(0.2, flat) == 15.0


def test_une_sous_note_sans_assez_de_composantes_est_absente_avec_sa_raison():
    raws = {"kills_per_min": 1.0}  # 3 points de poids sur 10
    detail, note, why = P.rate_group("individual", raws, uniform_scale(), "repli")
    assert note is None and "30 %" in why
    assert detail["deaths_per_min"]["reason"] == "donnée absente" and detail["deaths_per_min"]["note"] is None


def test_une_composante_absente_est_ignoree_de_la_moyenne_ponderee():
    raws = {"kills_per_min": 2.0, "deaths_per_min": 1.0, "assists_per_min": (None, "pas d'assistance"), "kill_quality": 1.0, "death_quality": 1.0}
    detail, note, _why = P.rate_group("individual", raws, uniform_scale(), "repli")
    # kills 15 (poids 3), morts 10 inversée (3), qualités 10 (1 et 1) : (45 + 30 + 10 + 10) / 8
    assert abs(note - 95 / 8) < 0.01
    assert detail["assists_per_min"]["reason"] == "pas d'assistance"


def test_composante_sans_echelle_n_est_pas_notee():
    raws = {"kills_per_min": 1.0, "deaths_per_min": 1.0, "assists_per_min": 1.0, "kill_quality": 1.0, "death_quality": 1.0}
    scale = uniform_scale("tableau")  # l'échelle des assistances existe pour le tableau seulement
    detail, note, _why = P.rate_group("individual", raws, scale, "repli")
    assert detail["assists_per_min"]["note"] is None and "échelle absente" in detail["assists_per_min"]["reason"]
    assert note is not None  # les 8 autres points de poids sur 10 suffisent


def test_la_note_globale_est_la_moyenne_et_manque_si_une_sous_note_manque():
    assert P.overall_of(10.0, 14.0) == 12.0
    assert P.overall_of(None, 14.0) is None and P.overall_of(10.0, None) is None


def test_le_regard_n_est_pas_utilise_pour_l_aggro():
    assert P.AGGRO_USES_GAZE is False


# ---------------------------------------------------------------- assistances (repli)

def test_un_coequipier_pres_de_la_victime_avant_sa_mort_est_un_assistant():
    conn = duel_game()
    r = P.raw_components(conn, 1)
    assert r[1]["assists"] == 0 and r[2]["assists"] == 1  # 2 est à 0,03 x 31 = 0,93 m de la victime
    assert r[3]["assists"] == 0 and r[1]["meta"]["kills_with_assist"] == 1 and r[1]["meta"]["kills_total"] == 1


def test_un_coequipier_loin_ou_trop_ancien_n_est_pas_un_assistant():
    far = (FAR_A[0] + 0.2, FAR_A[1])  # à plus de 6 m
    conn = make_conn({1: at(FAR_A), 5: at(FAR_A, 0.0, 40.0, "death"), 2: at(far),
                      3: at((FAR_A[0] + 0.03, FAR_A[1]), 0.0, 30.0, "death")}, kills=[(40.0, 1, 5)])  # 3 est mort 10 s avant : hors fenêtre
    r = P.raw_components(conn, 1)
    assert all(r[s]["assists"] == 0 for s in (1, 2, 3)) and r[1]["meta"]["kills_with_assist"] == 0


def test_le_tueur_n_est_pas_son_propre_assistant_et_l_ennemi_non_plus():
    conn = duel_game({6: at((FAR_A[0] + 0.02, FAR_A[1]))})  # un autre ennemi tout près : pas un assistant du tueur
    r = P.raw_components(conn, 1)
    assert r[1]["assists"] == 0 and r[6]["assists"] == 0 and r[5]["assists"] == 0


def test_les_parts_d_equipe_utilisent_le_total_de_l_equipe():
    conn = duel_game()
    raw = P.raw_components(conn, 1)
    assert raw[1]["raw"]["share_kills"] == 1.0 and raw[2]["raw"]["share_kills"] == 0.0
    assert raw[2]["raw"]["share_assists"] == 1.0 and raw[5]["raw"]["share_deaths"] == 1.0 and raw[1]["raw"]["share_deaths"] == (None, "équipe sans mort")


def test_une_equipe_sans_kill_n_a_pas_de_part_de_kills():
    raw = P.raw_components(duel_game(), 1)
    assert raw[5]["raw"]["share_kills"] == (None, "équipe sans kill")
    assert raw[5]["raw"]["share_assists"] == (None, "équipe sans assistance")


def test_un_joueur_sans_mort_a_zero_mort_par_minute_et_pas_de_qualite_de_mort():
    raw = P.raw_components(duel_game(), 1)[1]["raw"]
    assert raw["deaths_per_min"] == 0.0 and raw["death_quality"] == (None, "aucune mort notée")
    rows = run(duel_game())
    assert rows[1]["data"]["individual"]["components"]["deaths_per_min"]["note"] == 20.0  # moins c'est mieux : 0 mort donne la meilleure note


# ---------------------------------------------------------------- tableau de fin de game

def scoreboard(conn, rows):
    """Remplit la table `scoreboard` (créée par schema.sql ; l'autre module `scoreboard.py` l'écrit) : [(slot, assistances)]."""
    for slot, assists in rows:
        conn.execute("INSERT INTO scoreboard (game_id, slot, assists) VALUES (1, ?, ?)", (slot, assists))
    conn.commit()


def test_sans_table_scoreboard_le_repli_sert():
    conn = duel_game()
    conn.execute("DROP TABLE scoreboard")  # base ancienne sans la table
    assert P.scoreboard_assists(conn, 1, [1, 2]) is None
    assert P.raw_components(conn, 1)[2]["assist_source"] == "repli"


def test_table_vide_le_repli_sert_sans_erreur():
    conn = duel_game()
    r = P.raw_components(conn, 1)
    assert r[2]["assist_source"] == "repli" and r[2]["assists"] == 1


def test_tableau_complet_les_assistances_viennent_du_tableau():
    conn = duel_game()
    scoreboard(conn, [(s, s) for s in range(1, 9)])  # n assistances pour le joueur n
    r = P.raw_components(conn, 1)
    assert r[3]["assist_source"] == "tableau" and r[3]["assists"] == 3 and r[8]["assists"] == 8
    assert r[1]["meta"]["assists_fallback"] == 0 and r[2]["meta"]["assists_fallback"] == 1  # le repli reste visible
    assert abs(r[1]["raw"]["share_assists"] - 1 / 10) < 1e-9  # 1 sur 1+2+3+4
    scale = uniform_scale("tableau")
    P.compute(conn, 1, scale)
    assert {x["assist_source"] for x in rows_of(conn)} == {"tableau"}


def test_tableau_partiel_le_repli_sert_pour_toute_la_game():
    conn = duel_game()
    scoreboard(conn, [(s, 1) for s in range(1, 8)])  # le joueur 8 n'a pas de ligne
    r = P.raw_components(conn, 1)
    assert {v["assist_source"] for v in r.values()} == {"repli"} and r[2]["assists"] == 1


def test_une_ligne_du_tableau_sans_assistances_compte_comme_partielle():
    conn = duel_game()
    scoreboard(conn, [(s, None if s == 3 else 1) for s in range(1, 9)])
    assert P.scoreboard_assists(conn, 1, list(range(1, 9))) is None


# ---------------------------------------------------------------- présence, espace, fight, aggro

def test_un_joueur_qui_reste_au_spawn_a_une_presence_nulle():
    conn = make_conn({1: [(0.0, DURATION, "end", leave(A_SPAWN, 100.0, 110.0, MID))]})
    raw = P.raw_components(conn, 1)
    assert raw[2]["raw"]["presence"] == 0.0
    assert 0.3 < raw[1]["raw"]["presence"] < 0.6  # sorti à 100 s sur 200


def test_la_prise_d_espace_est_la_position_sur_l_axe_des_departs():
    conn = make_conn({1: at(MID), 5: at(MID)})
    raw = P.raw_components(conn, 1)
    assert 0.3 < raw[1]["raw"]["space"] < 0.7 and 0.3 < raw[5]["raw"]["space"] < 0.7
    assert abs(raw[1]["raw"]["space"] + raw[5]["raw"]["space"] - 1.0) < 0.05  # le milieu vu des deux départs


def test_outlaw_depart_neutre_pas_d_axe():
    game = game_of(make_conn({}, map_name="Outlaw"))
    _spawns, axis = P.spawn_info(game)
    assert axis is None
    raw = P.raw_components(make_conn({}, map_name="Outlaw"), 1)
    assert raw[1]["raw"]["space"][0] is None and "neutres" in raw[1]["raw"]["space"][1]


def test_le_premier_kill_de_chaque_combat_est_credite_a_son_tueur():
    kills = [(30.0, 1, 5), (31.0, 2, 6), (80.0, 7, 3)]  # deux combats : 1 puis 7
    raw = P.raw_components(make_conn({}, kills=kills), 1)
    assert raw[1]["raw"]["fight_first_kill"] == 0.5 and raw[7]["raw"]["fight_first_kill"] == 0.5 and raw[2]["raw"]["fight_first_kill"] == 0.0


def test_le_plus_avance_au_contact_prend_le_fight():
    players = {1: at(MID), 2: at((MID[0] - 0.12, MID[1])), 5: at((MID[0] + 0.04, MID[1]))}  # 1 est le plus près de l'ennemi 5
    raw = P.raw_components(make_conn(players, kills=[(40.0, 1, 5)]), 1)
    assert raw[1]["raw"]["fight_front"] == 1.0 and raw[2]["raw"]["fight_front"] == 0.0


def pushed_game(mate_near=False, dies_at=None):
    """Le joueur 1 est seul à FAR_A ; l'ennemi 5 vient sur lui de 6 m à 2 m pendant 8 s. `mate_near` : le coéquipier 2 est collé à l'ennemi. `dies_at` : mort de 1 (tué par 5)."""
    x0 = FAR_A[0]
    path = leave((x0 + 0.2, FAR_A[1]), 10.0, 18.0, (x0 + 0.06, FAR_A[1]))
    players = {5: [(0.0, DURATION, "end", path)]}
    players[1] = at(FAR_A, 0.0, dies_at, "death") if dies_at else at(FAR_A)
    if mate_near:
        players[2] = [(0.0, DURATION, "end", path)]
    kills = [(dies_at, 5, 1)] if dies_at else []
    return make_conn(players, kills=kills)


def test_un_ennemi_qui_vient_sur_un_joueur_isole_donne_de_l_aggro():
    raw = P.raw_components(pushed_game(), 1)
    assert raw[1]["raw"]["aggro"] > 0.5  # secondes par minute de game


def test_un_coequipier_a_cote_de_l_ennemi_annule_l_aggro():
    raw = P.raw_components(pushed_game(mate_near=True), 1)
    assert raw[1]["raw"]["aggro"] == 0.0


def test_une_mort_non_vengee_apres_l_aggro_ne_vaut_que_la_moitie():
    alive = P.raw_components(pushed_game(), 1)[1]["raw"]["aggro"]
    dead = P.raw_components(pushed_game(dies_at=20.0), 1)[1]["raw"]["aggro"]
    assert 0.3 * alive < dead < 0.8 * alive


# ---------------------------------------------------------------- calcul et écriture

def test_compute_ecrit_une_ligne_par_joueur_et_est_idempotent():
    conn = duel_game()
    n1 = P.compute(conn, 1, uniform_scale())
    first = rows_of(conn)
    n2 = P.compute(conn, 1, uniform_scale())
    assert n1 == n2 == 8 and rows_of(conn) == first
    assert conn.execute("SELECT revision FROM stats_meta WHERE game_id = 1 AND module = 'player_ratings'").fetchone()[0] == P.REVISION


def test_les_notes_sont_entre_0_et_20_et_la_globale_est_la_moyenne():
    for r in run(duel_game()).values():
        for key in ("individual", "teamplay", "overall"):
            assert r[key] is None or 0.0 <= r[key] <= 20.0
        if r["overall"] is not None:
            assert abs(r["overall"] - (r["individual"] + r["teamplay"]) / 2) < 0.02


def test_sans_echelle_aucune_note_n_est_inventee():
    r = run(duel_game(), scale={})[1]
    assert r["individual"] is None and r["teamplay"] is None and r["overall"] is None
    assert "échelle absente" in json.dumps(r["data"], ensure_ascii=False) and r["data"]["overall_reason"]


def test_le_meilleur_a_une_meilleure_note_que_le_moins_bon():
    conn = make_conn({s: at(MID) for s in (1, 2, 3, 5, 6, 7)}, kills=[(40.0, 1, 5), (44.0, 1, 6), (60.0, 1, 7), (70.0, 5, 3)])
    rows = run(conn, scale=None)
    assert rows[1]["overall"] > rows[3]["overall"]  # 1 : trois kills sans mort, 3 : une mort sans kill


def test_une_game_sans_position_n_a_pas_de_note():
    conn = make_conn({})
    conn.execute("DELETE FROM samples")
    assert P.raw_components(conn, 1) == {} and P.compute(conn, 1, uniform_scale()) == 0


def test_le_detail_garde_chaque_composante_avec_valeur_note_et_poids():
    data = run(duel_game())[2]["data"]
    comp = data["teamplay"]["components"]["share_assists"]
    assert comp["raw"] == 1.0 and comp["weight"] == 1 and comp["note"] is not None and data["assist_source"] == "repli"
    assert data["gaze_excluded"] is True and "aggro" in data["teamplay"]["components"]


def test_calibrate_donne_5e_mediane_95e_centile():
    assert P.percentile([0.0, 1.0, 2.0, 3.0, 4.0], 50) == 2.0
    assert abs(P.percentile(list(range(101)), 5) - 5.0) < 1e-9 and abs(P.percentile(list(range(101)), 95) - 95.0) < 1e-9
    conn = duel_game()
    sc = P.calibrate(conn, [1])
    assert sc["kills_per_min"]["n"] == 8 and sc["assists_per_min:repli"]["p95"] >= sc["assists_per_min:repli"]["p50"]
