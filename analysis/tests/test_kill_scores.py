"""Note des kills et des morts (kill_scores.py, REVISION 2) : parties synthétiques de Polaris (montage de test_waves.py et test_retakes.py, un seul point A au centre).
Règles du 17 octobre 2026 : base +1, +1 si le kill crée ou étend une supériorité numérique locale, +1 premier kill de la vague, +1 capture seulement avec supériorité, aucun malus ; mort : -1, échange -0,5, bouclier humain +2."""

import json

import kill_scores
from test_kill_series import FAR_A, at
from test_retakes import dying, leave, players_for
from test_waves import A_SPAWN, B_SPAWN, MID, make_conn, stay

LOIN = (0.95, 0.05)  # à plus de 10 m du point central et des deux spawns


def notes(conn):
    """{(t, victime): (impact, note de la mort, raisons)} de la game 1."""
    return {(r[0], r[1]): (r[2], r[3], json.loads(r[4])) for r in conn.execute("SELECT t, victim_slot, impact, death_impact, reasons FROM kill_scores WHERE game_id = 1")}


def run(players, kills, owners=()):
    conn = make_conn(players, kills=kills, owners=owners)
    kill_scores.compute(conn, 1)
    return conn, notes(conn)


def has(reasons, text):
    return any(text in r for r in reasons)


# ---------------------------------------------------------------- note du kill

def test_kill_isole_vaut_une_menace_plus_une_superiorite_creee():
    players = {1: at(FAR_A), 5: dying(5, 40.0, stay(FAR_A))}
    _conn, n = run(players, [(40.0, 1, 5)])
    impact, death, reasons = n[(40.0, 5)]
    assert (impact, death) == (2.0, -1.0)
    assert reasons[0] == "une menace éliminée" and has(reasons, "crée une supériorité numérique locale (1 contre 1 avant le kill, 1 contre 0 après)")


def test_un_echange_n_a_ni_malus_ni_superiorite_et_la_mort_vaut_moins():
    players = {1: dying(1, 40.5, stay(FAR_A)), 5: dying(5, 40.0, stay(FAR_A))}
    _conn, n = run(players, [(40.0, 1, 5), (40.5, 5, 1)])
    for key in ((40.0, 5), (40.5, 1)):
        impact, death, reasons = n[key]
        assert impact == 1.0 and death == kill_scores.DEATH_TRADE  # aucun malus : le travail individuel est fait
        assert has(reasons, "aucun malus sur le kill") and has(reasons, "pas de supériorité numérique après l'échange")


def test_quatre_contre_quatre_devient_quatre_contre_trois_mais_pas_trois_contre_trois():
    ici = {s: at(MID) for s in range(1, 9)}  # 4 contre 4 au même endroit
    seul = {**ici, 5: dying(5, 40.0, stay(MID))}
    _c, n = run(seul, [(40.0, 1, 5)])
    assert n[(40.0, 5)][0] == 2.0 and has(n[(40.0, 5)][2], "4 contre 4 avant le kill, 4 contre 3 après")
    echange = {**ici, 5: dying(5, 40.0, stay(MID)), 1: dying(1, 40.4, stay(MID))}
    _c, n = run(echange, [(40.0, 1, 5), (40.4, 5, 1)])
    assert n[(40.0, 5)][0] == 1.0 and has(n[(40.0, 5)][2], "4 contre 4 avant le kill, 3 contre 3 après")


def test_kill_dans_une_equipe_deja_en_superiorite_l_etend_d_un_cran():
    players = {1: at(FAR_A), 2: at(FAR_A), 3: at(FAR_A), 5: dying(5, 40.0, stay(FAR_A)), 6: at(FAR_A)}
    _c, n = run(players, [(40.0, 1, 5)])
    assert n[(40.0, 5)][0] == 2.0 and has(n[(40.0, 5)][2], "étend une supériorité numérique locale (3 contre 2 avant le kill, 3 contre 1 après)")


def test_equipe_en_infériorité_apres_le_kill_n_a_pas_de_bonus_de_superiorite():
    # 1 contre 4 près du kill : après le kill, 1 contre 3
    players = {1: at(FAR_A), 5: dying(5, 40.0, stay(FAR_A)), 6: at(FAR_A), 7: at(FAR_A), 8: at(FAR_A)}
    _c, n = run(players, [(40.0, 1, 5)])
    assert n[(40.0, 5)][0] == 1.0 and not has(n[(40.0, 5)][2], "supériorité numérique")


def scene(extra=None):
    """Vague de A (1, 2, 3) sur le point que tiennent 5, 6, 7 ; le 8 reste loin. Kills : 1 tue 5, 2 tue 6, 7 tue 3, 1 tue 7 ; le point passe à A à 45 s."""
    owners = [(0, 5, "none"), (5, 45, "B"), (45, 100, "A")]
    kills = [(31.0, 1, 5), (33.0, 2, 6), (34.0, 7, 3), (36.0, 1, 7)]
    base = {3: dying(3, 34.0, leave(A_SPAWN, 24.0, 32.0)), 5: dying(5, 31.0, stay(MID)), 6: dying(6, 33.0, stay(MID)), 7: dying(7, 36.0, stay(MID)), 8: at(LOIN)}
    return players_for({**base, **(extra or {})}), kills, owners


def test_premier_kill_de_la_vague_et_prise_du_point_sans_superiorite_ne_donnent_pas_le_bonus_de_capture():
    players, kills, owners = scene({8: at(B_SPAWN)})  # le 8 au spawn est à 9,8 m du point : 3 contre 4 au premier kill, pas de supériorité
    _conn, n = run(players, kills, owners)
    impact, _death, reasons = n[(31.0, 5)]
    assert impact == 2.0 and has(reasons, "premier kill de la vague") and has(reasons, "prend le point A") and has(reasons, "pas de bonus de capture")
    assert has(reasons, "contexte d'équipe, sans effet sur la note du kill : teamfight de 0:31 gagné par son équipe")


def test_premier_kill_de_la_vague_avec_superiorite_et_prise_du_point_font_quatre_bornes_a_trois():
    players, kills, owners = scene()  # 3 contre 3 avant le kill, 3 contre 2 après
    _conn, n = run(players, kills, owners)
    impact, _death, reasons = n[(31.0, 5)]
    assert has(reasons, "supériorité numérique locale") and has(reasons, "premier kill de la vague") and has(reasons, "prend le point A")
    assert impact == kill_scores.SCORE_MAX == 3.0  # 1 + 1 + 1 + 1 = 4 borné à l'échelle documentée


def test_teamfight_perdu_ne_change_pas_la_note_individuelle_du_kill():
    players, kills, owners = scene()
    _conn, n = run(players, kills, owners)
    impact, _death, reasons = n[(34.0, 3)]  # le 7 tue le 3 : son équipe (B) perd le teamfight, il garde son point de base et sa supériorité
    assert impact >= 1.0 and not any(r.startswith("-") for r in reasons)
    assert has(reasons, "contexte d'équipe, sans effet sur la note du kill : teamfight de 0:31 perdu par son équipe")


def test_bonus_de_capture_seulement_avec_une_superiorite_numerique():
    owners = [(0, 100, "B")]
    # kill de 6 sur 2 au point que B tient, mais B est en infériorité autour : pas de bonus de capture
    inferieur = {1: at(MID), 3: at(MID), 4: at(MID), 2: dying(2, 40.0, stay(MID)), 5: at(LOIN), 7: at(LOIN), 8: at(LOIN), 6: at(MID)}
    _c, n = run(inferieur, [(40.0, 6, 2)], owners)
    assert n[(40.0, 2)][0] == 1.0 and has(n[(40.0, 2)][2], "tient le point A") and has(n[(40.0, 2)][2], "pas de bonus de capture")
    superieur = {1: at(LOIN), 3: at(LOIN), 4: at(LOIN), 2: dying(2, 40.0, stay(MID)), 5: at(MID), 7: at(MID), 8: at(MID), 6: at(MID)}
    _c, n = run(superieur, [(40.0, 6, 2)], owners)
    assert n[(40.0, 2)][0] == 3.0 and has(n[(40.0, 2)][2], "tient le point A")
    loin = {2: dying(2, 40.0, stay(A_SPAWN)), 6: at(A_SPAWN)}  # le spawn est à 10,4 m du cadre : pas de bonus de capture même en supériorité
    _c, n = run(loin, [(40.0, 6, 2)], owners)
    assert not has(n[(40.0, 2)][2], "tient le point")


def test_kill_sans_tueur_adverse_n_a_pas_de_note():
    conn = make_conn({2: dying(2, 40.0, stay(FAR_A))}, kills=[(40.0, None, 2)])
    assert kill_scores.compute(conn, 1) == 0
    assert notes(conn) == {}


def test_ligne_de_killfeed_sans_mort_correspondante_n_evalue_ni_superiorite_ni_bouclier():
    players = {1: at(FAR_A), 5: dying(5, 40.0, stay(FAR_A))}
    _c, n = run(players, [(40.0, 1, 5), (46.0, 1, 5)])  # la deuxième ligne est une répétition : la victime est déjà morte
    impact, death, reasons = n[(46.0, 5)]
    assert impact == 1.0 and death == -1.0 and has(reasons, "aucune mort de la victime")


# ---------------------------------------------------------------- note de la mort

def test_mort_simple_vaut_moins_un():
    players = {1: at(FAR_A), 5: dying(5, 40.0, stay(FAR_A))}
    _c, n = run(players, [(40.0, 1, 5)])
    assert n[(40.0, 5)][1] == -1.0


def test_bouclier_humain_pression_puis_superiorite_et_teamfight_gagne_donnent_plus_un():
    players, kills, owners = scene()
    _conn, n = run(players, kills, owners)
    impact, death, reasons = n[(34.0, 3)]  # le 3 meurt entouré des 5, 6, 7 ; ses coéquipiers 1 et 2 sont ensuite 2 contre 1 et A gagne (pertes 1 contre 3)
    assert death == 1.0 == kill_scores.DEATH_BASE + kill_scores.SHIELD_BONUS
    assert has(reasons, "mort : bouclier humain") and has(reasons, "son équipe en supériorité (2 contre 1)")
    assert n[(31.0, 5)][1] == -1.0  # un mort sans pression ni suite n'a pas de bonus


def test_pas_de_bouclier_sans_deux_ennemis_sur_lui():
    players = {1: at(FAR_A), 5: dying(5, 40.0, stay(FAR_A))}  # un seul ennemi près : pas de pression à deux
    _c, n = run(players, [(40.0, 1, 5)])
    assert n[(40.0, 5)][1] == -1.0 and not has(n[(40.0, 5)][2], "bouclier")


# ---------------------------------------------------------------- calcul

def test_notes_bornees_idempotent_stats_meta_et_colonne_ajoutee_aux_anciennes_bases():
    players, kills, owners = scene()
    conn = make_conn(players, kills=kills, owners=owners)
    conn.execute("ALTER TABLE kill_scores DROP COLUMN death_impact")  # base d'avant la note de la mort
    assert kill_scores.compute(conn, 1) == 4 and kill_scores.compute(conn, 1) == 4
    assert conn.execute("SELECT COUNT(*) FROM kill_scores").fetchone()[0] == 4
    assert all(kill_scores.SCORE_MIN <= v[0] <= kill_scores.SCORE_MAX and v[1] is not None for v in notes(conn).values())
    assert conn.execute("SELECT revision FROM stats_meta WHERE game_id = 1 AND module = 'kill_scores'").fetchone()[0] == kill_scores.REVISION


def test_measure_donne_les_deux_distributions_et_les_boucliers():
    players, kills, owners = scene()
    conn = make_conn(players, kills=kills, owners=owners)
    m = kill_scores.measure(conn, 1)
    assert m["notes"] == 4 and m["boucliers_humains"] == 1 and sum(m["distribution_mort"].values()) == 4 and m["mort_non_retrouvee"] == 0
