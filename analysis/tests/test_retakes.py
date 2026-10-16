"""Épisodes de retake par vagues (retakes.py, REVISION 4) : parties synthétiques de Polaris (un seul point, cadre de map_capture.json), voir test_waves.py pour le montage."""

import json

import episode_common as ec
import retakes
from test_waves import A_SPAWN, B_SPAWN, DURATION, MID, game_of, leave, make_conn, stay, team_a_leaves

B_HOLDS = [(0, 5, "none"), (5, 100, "B")]  # B tient le point depuis la 5e seconde
WAVE_A = team_a_leaves([20.0, 22.0, 24.0], arrive_after=8.0)  # 1, 2, 3 quittent le spawn et arrivent au point vers 30 s
WAVE_B_AT_POINT = {s: [(0.0, DURATION, "end", stay(MID))] for s in (5, 6, 7)}  # les défenseurs sont au point


def dying(slot, t_death, path, then=None):
    """Vies d'un joueur : mort à t_death (chemin donné), puis réapparition au spawn de son équipe 17 s plus tard."""
    spawn = A_SPAWN if slot <= 4 else B_SPAWN
    out = [(0.0, t_death, "death", path)]
    out.append((t_death + 17.0, DURATION, "end", then or stay(spawn)))
    return out


def episodes(conn, kind="retake"):
    return [dict(zip(("point", "team", "t0", "t1", "outcome", "data", "verdict"), r[:5] + (json.loads(r[5]), r[6])))
            for r in conn.execute("SELECT point, team, t0, t1, outcome, data, verdict FROM episodes WHERE game_id = 1 AND kind = ? ORDER BY t0", (kind,))]


def run(players, kills, owners):
    conn = make_conn(players, kills, owners)
    retakes.compute(conn, 1)
    return conn, episodes(conn)


def players_for(extra):
    base = dict(WAVE_A)
    base.update(WAVE_B_AT_POINT)
    base.update(extra)
    return base


# ---------------------------------------------------------------- issues

def test_retake_reussi_teamfight_gagne_puis_prise_du_point():
    owners = [(0, 5, "none"), (5, 45, "B"), (45, 100, "A")]
    kills = [(31.0, 1, 5), (33.0, 2, 6), (34.0, 7, 3), (36.0, 1, 7)]
    players = players_for({3: dying(3, 34.0, leave(A_SPAWN, 24.0, 32.0)), 5: dying(5, 31.0, stay(MID)), 6: dying(6, 33.0, stay(MID)), 7: dying(7, 36.0, stay(MID))})
    _conn, eps = run(players, kills, owners)
    [e] = [x for x in eps if x["team"] == "A"]
    assert (e["point"], e["outcome"]) == ("A", "success")
    w = e["data"]["wave"]
    assert w["size"] == 3 and w["kind"] == "teamfight" and w["tf_result"] == "won"
    assert w["holder_before"] == "B" and w["holder_after"] == "A" and w["captured_t"] == 45.0 and w["capture_from"] == "B"
    assert w["t_start"] <= 26.0 and w["t_contact"] == 31.0 and w["t_end"] == 45.0 and w["duration_s"] > 15
    assert e["t0"] == w["t_start"] and e["t1"] == w["t_end"] and e["data"]["change_t"] == 45.0 and e["data"]["push_t"] == w["t_start"]
    assert w["fight"]["losses"] == {"A": 1, "B": 3} and w["fight"]["winner"] == "A" and w["axis_frac"] is not None
    assert w["fight"]["heavy"] is False  # B perd 3 mais A seulement 1 : pas un teamfight lourd
    assert [d["slot"] for d in e["data"]["deaths"]] == [5, 6, 3, 7]
    assert {m["slot"] for m in w["members"]} == {1, 2, 3} and w["members"][2]["t_death"] == 34.0


def test_retake_rate_teamfight_perdu_sans_prise():
    kills = [(31.0, 5, 1), (33.0, 6, 2), (35.0, 5, 3)]
    players = players_for({s: dying(s, t, leave(A_SPAWN, 20.0 + 2 * (s - 1), 28.0 + 2 * (s - 1))) for s, t in ((1, 31.0), (2, 33.0), (3, 35.0))})
    _conn, eps = run(players, kills, B_HOLDS)
    [e] = [x for x in eps if x["team"] == "A"]
    assert e["outcome"] == "fail" and e["data"]["wave"]["tf_result"] == "lost" and e["data"]["wave"]["captured_t"] is None
    assert e["data"]["wave"]["fight"]["losses"]["A"] == 3 and e["data"]["from_team"] == "B"
    assert e["t1"] == 35.0  # fin = dernier kill du teamfight


def test_teamfight_lourd_est_enregistre_sans_changer_l_issue():
    kills = [(31.0, 5, 1), (33.0, 6, 2), (35.0, 5, 3), (36.0, 4, 5), (37.0, 4, 6), (38.0, 4, 7)]
    extra = {s: dying(s, t, leave(A_SPAWN, 20.0 + 2 * (s - 1), 28.0 + 2 * (s - 1))) for s, t in ((1, 31.0), (2, 33.0), (3, 35.0))}
    extra.update({s: dying(s, t, stay(MID)) for s, t in ((5, 36.0), (6, 37.0), (7, 38.0))})
    _conn, eps = run(players_for(extra), kills, B_HOLDS)
    [e] = [x for x in eps if x["team"] == "A"]
    f = e["data"]["wave"]["fight"]
    assert f["losses"] == {"A": 3, "B": 3} and f["heavy"] is True and f["kind"] == "teamfight"
    assert e["data"]["wave"]["tf_result"] in ("lost", "draw")  # l'issue vient du gagnant, pas de heavy
    assert retakes.REVISION == 4


def test_prise_initiale_sur_point_neutre_nest_pas_un_retake():
    owners = [(0, 30, "none"), (30, 100, "A")]
    kills = [(31.0, 1, 5), (33.0, 2, 6), (34.0, 1, 7)]
    players = players_for({5: dying(5, 31.0, stay(MID)), 6: dying(6, 33.0, stay(MID)), 7: dying(7, 34.0, stay(MID))})
    _conn, eps = run(players, kills, owners)
    [e] = [x for x in eps if x["team"] == "A"]
    assert e["outcome"] == "initial" and e["data"]["wave"]["holder_before"] is None and e["data"]["wave"]["opening"] is True


def test_teamfight_perdu_sur_point_neutre_est_initial_lost():
    kills = [(31.0, 5, 1), (33.0, 6, 2), (35.0, 5, 3)]
    players = players_for({s: dying(s, t, leave(A_SPAWN, 20.0 + 2 * (s - 1), 28.0 + 2 * (s - 1))) for s, t in ((1, 31.0), (2, 33.0), (3, 35.0))})
    _conn, eps = run(players, kills, [(0, 60, "none"), (60, 100, "B")])
    [e] = [x for x in eps if x["team"] == "A"]
    assert e["outcome"] == "initial_lost" and e["data"]["from_team"] is None


def test_teamfight_gagne_sans_prise_est_won_no_capture():
    kills = [(31.0, 1, 5), (33.0, 2, 6), (34.0, 7, 3), (36.0, 1, 7)]
    players = players_for({3: dying(3, 34.0, leave(A_SPAWN, 24.0, 32.0)), 5: dying(5, 31.0, stay(MID)), 6: dying(6, 33.0, stay(MID)), 7: dying(7, 36.0, stay(MID))})
    _conn, eps = run(players, kills, B_HOLDS)
    [e] = [x for x in eps if x["team"] == "A"]
    assert e["outcome"] == "won_no_capture" and e["data"]["wave"]["tf_result"] == "won"


def test_vague_sans_kill_est_no_contact():
    _conn, eps = run(team_a_leaves([20.0, 22.0]), [], B_HOLDS)
    [e] = eps
    assert e["outcome"] == "no_contact" and e["data"]["wave"]["speed"] is None and e["data"]["wave"]["fight"] is None
    assert e["t1"] > e["t0"]


def test_un_seul_kill_isole_est_un_duel_jamais_un_retake():
    players = {1: [(0.0, DURATION, "end", leave(A_SPAWN, 20.0, 28.0, (0.45, 0.05)))], 2: [(0.0, DURATION, "end", leave(A_SPAWN, 22.0, 30.0, (0.45, 0.05)))],
               5: [(0.0, DURATION, "end", stay((0.45, 0.05)))]}
    _conn, eps = run(players, [(35.0, 1, 5)], B_HOLDS)
    [e] = [x for x in eps if x["team"] == "A"]
    assert e["outcome"] == "duel" and e["data"]["wave"]["kind"] == "duel" and e["data"]["wave"]["tf_result"] == "duel"


def test_vague_de_lequipe_qui_tient_le_point_est_une_defense_non_ecrite():
    owners = [(0, 5, "none"), (5, 100, "A")]
    kills = [(31.0, 1, 5), (33.0, 2, 6), (36.0, 1, 7)]
    players = players_for({5: dying(5, 31.0, stay(MID)), 6: dying(6, 33.0, stay(MID)), 7: dying(7, 36.0, stay(MID))})
    game = game_of(make_conn(players, kills, owners))
    stats = {}
    assert retakes.find_episodes(game, stats) == []
    assert stats == {"defense": 1}


def test_point_dont_le_proprietaire_nest_jamais_lu_donne_zero_episode():
    owners = [(0, 100, "none")]
    kills = [(31.0, 1, 5), (33.0, 2, 6)]
    conn = make_conn(players_for({}), kills, owners)
    assert retakes.compute(conn, 1) == 0


def test_carte_sans_zone_de_depart_donne_zero_episode():
    conn = make_conn(WAVE_A, [], B_HOLDS, map_name="Carte inconnue")
    assert retakes.compute(conn, 1) == 0


def test_prise_donnee_a_une_seule_vague():
    owners = [(0, 5, "none"), (5, 45, "B"), (45, 100, "A")]
    players = team_a_leaves([20.0, 22.0, 30.0, 33.0], arrive_after=8.0)  # deux vagues de A, la prise de 45 s revient à la première
    kills = [(26.0, 1, 5), (28.0, 2, 6), (29.0, 1, 7)]
    game = game_of(make_conn(players, kills, owners))
    outcomes = [(w["t_start"] < 28, o) for w, o, _e in retakes.classified_waves(game) if w["team"] == "A"]
    assert sum(1 for _, o in outcomes if o == "success") == 1


# ---------------------------------------------------------------- contrat

def test_compute_est_idempotent_garde_les_verdicts_et_ne_touche_pas_aux_rotations():
    owners = [(0, 5, "none"), (5, 45, "B"), (45, 100, "A")]
    kills = [(31.0, 1, 5), (33.0, 2, 6), (36.0, 1, 7)]
    players = players_for({5: dying(5, 31.0, stay(MID)), 6: dying(6, 33.0, stay(MID)), 7: dying(7, 36.0, stay(MID))})
    conn = make_conn(players, kills, owners)
    conn.execute("INSERT INTO episodes (game_id, kind, point, team, t0, t1, outcome, data) VALUES (1, 'rotation', 'A', 'A', 10, 20, 'arrived', '{}')")
    n = retakes.compute(conn, 1)
    assert n >= 1
    conn.execute("UPDATE episodes SET verdict = 'ok' WHERE game_id = 1 AND kind = 'retake' AND team = 'A'")
    assert retakes.compute(conn, 1) == n
    assert conn.execute("SELECT COUNT(*), COUNT(verdict) FROM episodes WHERE game_id = 1 AND kind = 'retake'").fetchone() == (n, 1)
    assert conn.execute("SELECT COUNT(*) FROM episodes WHERE game_id = 1 AND kind = 'rotation'").fetchone()[0] == 1
    assert conn.execute("SELECT revision FROM stats_meta WHERE game_id = 1 AND module = 'retakes'").fetchone()[0] == retakes.REVISION == 4


def test_verdict_repris_si_le_depart_bouge_de_moins_de_cinq_secondes():
    owners = [(0, 5, "none"), (5, 45, "B"), (45, 100, "A")]
    kills = [(31.0, 1, 5), (33.0, 2, 6), (36.0, 1, 7)]
    base = {5: dying(5, 31.0, stay(MID)), 6: dying(6, 33.0, stay(MID)), 7: dying(7, 36.0, stay(MID))}
    conn = make_conn(players_for(base), kills, owners)
    retakes.compute(conn, 1)
    conn.execute("UPDATE episodes SET verdict = 'ko' WHERE game_id = 1 AND team = 'A'")
    shifted = dict(base)
    shifted.update(team_a_leaves([23.0, 25.0, 27.0], arrive_after=8.0))
    ec.write_episodes(conn, 1, "retake", retakes.find_episodes(game_of(make_conn(players_for(shifted), kills, owners))), "retakes", 3, retakes.MATCH_S)
    assert conn.execute("SELECT verdict FROM episodes WHERE game_id = 1 AND team = 'A'").fetchone()[0] == "ko"


def test_fonctions_de_proprietaire_restent_disponibles_pour_rotations():
    tl = retakes.holder_timeline([(0, 5, "none"), (5, 40, "A"), (40, 100, "B")])
    assert retakes.holder_at(tl, 10) == "A" and retakes.holder_at(tl, 50) == "B"
    assert retakes.owner_changes(tl) == [(40, "A", "B")]
    assert ec.captures(tl) == [(5, None, "A"), (40, "A", "B")]
    assert ec.captures(ec.holder_timeline([(30, 60, "A")])) == []  # première lecture sans période grise avant : pas une prise
    assert ec.known_at(tl, 10) and not ec.known_at(tl, 500)
