"""Passes finales du suivi : aller-retour inventé, lecture isolée, pas impossible, lissage, séparation des joueurs, mort lue sur le bandeau."""

import math

import pytest

import tracking

STEP = 0.1


@pytest.fixture(autouse=True)
def _no_walk_map():
    for state in (tracking._WALK, tracking._NEAR, tracking._ROUTES, tracking._JUMPS):
        state.clear()
    tracking._TELEPORTS[:] = []
    yield
    for state in (tracking._WALK, tracking._NEAR, tracking._ROUTES, tracking._JUMPS):
        state.clear()
    tracking._TELEPORTS[:] = []


def row(k, slot, x, y, conf=1.0, alive=1, angle=None):
    return (k, round(k * STEP, 2), slot, "A" if slot <= 4 else "B", x, y, angle, alive, conf)


def table(*rows):
    return {(r[0], r[2]): r for r in rows}


def test_excursion_without_sure_read_is_closed():
    rows = table(row(0, 1, 0.5, 0.5), *[row(k, 1, 0.5 + 0.02 * k, 0.5, conf=0.3) for k in range(1, 5)], *[row(k, 1, 0.5 + 0.02 * (9 - k), 0.5, conf=0.3) for k in range(5, 9)], row(9, 1, 0.52, 0.5))
    assert tracking.remove_excursions(rows, STEP) == 1
    assert max(abs(r[4] - 0.5) for r in rows.values()) <= 0.03


def test_real_trip_is_not_an_excursion():
    rows = table(row(0, 1, 0.2, 0.5), *[row(k, 1, 0.2 + 0.04 * k, 0.5, conf=0.3) for k in range(1, 9)], row(9, 1, 0.56, 0.5))
    assert tracking.remove_excursions(rows, STEP) == 0


def test_isolated_read_forcing_a_round_trip_is_dropped():
    rows = table(*[row(k, 4, 0.45, 0.44) for k in range(0, 10)], row(20, 4, 0.16, 0.38), *[row(k, 4, 0.48, 0.59) for k in range(30, 40)])
    assert tracking.drop_isolated_reads(rows) == 1
    assert (20, 4) not in rows


def test_isolated_read_on_the_way_is_kept():
    rows = table(*[row(k, 4, 0.40, 0.5) for k in range(0, 10)], row(20, 4, 0.50, 0.5), *[row(k, 4, 0.60, 0.5) for k in range(30, 40)])
    assert tracking.drop_isolated_reads(rows) == 0


def test_impossible_step_drops_the_weak_block_not_the_sure_read():
    rows = table(*[row(k, 4, 0.36, 0.61, conf=0.6) for k in range(0, 5)], *[row(k, 4, 0.48, 0.58, conf=0.4) for k in range(5, 8)], *[row(k, 4, 0.36, 0.60) for k in range(8, 12)])
    assert tracking.drop_impossible_moves(rows, STEP) > 0
    assert all(rows[key][4] < 0.4 for key in rows)
    assert (8, 4) in rows


def test_two_sure_reads_are_never_touched():
    rows = table(row(0, 4, 0.2, 0.5), row(1, 4, 0.6, 0.5))
    assert tracking.drop_impossible_moves(rows, STEP) == 0
    assert len(rows) == 2


def test_stacked_players_are_separated_but_sure_reads_stay():
    rows = table(row(0, 1, 0.5, 0.5, conf=1.0), row(0, 2, 0.5, 0.5, conf=0.6))
    assert tracking.separate_players(rows) == 1
    assert (rows[(0, 1)][4], rows[(0, 1)][5]) == (0.5, 0.5)
    assert math.hypot(rows[(0, 2)][4] - 0.5, rows[(0, 2)][5] - 0.5) >= tracking.MIN_SEPARATION - 1e-3


def test_two_sure_reads_close_together_are_left_alone():
    rows = table(row(0, 1, 0.5, 0.5), row(0, 2, 0.51, 0.5))
    assert tracking.separate_players(rows) == 0


def test_separation_keeps_the_same_side_from_one_frame_to_the_next():
    rows = table(*[r for k in range(6) for r in (row(k, 1, 0.5, 0.5), row(k, 2, 0.5 + 0.001 * (-1) ** k, 0.5, conf=0.5))])
    tracking.separate_players(rows)
    xs = [rows[(k, 2)][4] for k in range(6)]
    assert max(xs) - min(xs) < 1e-3


def test_median_smoothing_removes_wobble_of_unsure_positions_only():
    rows = table(*[row(k, 1, 0.5 + (0.03 if k == 3 else 0.0), 0.5, conf=0.3) for k in range(7)], row(7, 1, 0.5, 0.5, conf=1.0))
    tracking.smooth_unsure(rows)
    assert abs(rows[(3, 1)][4] - 0.5) < 1e-3
    assert rows[(7, 1)][4] == 0.5


def test_banner_death_is_drawn_from_the_first_grey_frame():
    rows = table(*[row(k, 4, 0.38, 0.39) for k in range(0, 5)])
    dead = {4: {5, 6, 7, 8}}
    times = {k: k * STEP for k in range(12)}
    added = {}

    def put(fi, slot, team, x, y, angle, alive, conf):
        rows[(fi, slot)] = (fi, 0.0, slot, team, x, y, angle, int(alive), conf)
        added[fi] = alive

    tracking._add_banner_deaths(rows, dead, times, STEP, put)
    assert set(added) == {5, 6, 7, 8} and not any(added.values())


def test_banner_death_hands_over_to_the_map_cross():
    rows = table(*[row(k, 4, 0.38, 0.39) for k in range(0, 5)], row(7, 4, 0.38, 0.39, alive=0, conf=0.9))
    dead = {4: {5, 6, 7, 8}}
    times = {k: k * STEP for k in range(12)}
    tracking._add_banner_deaths(rows, dead, times, STEP, lambda fi, slot, team, x, y, angle, alive, conf: rows.__setitem__((fi, slot), row(fi, slot, x, y, conf, int(alive))))
    assert (5, 4) in rows and (6, 4) in rows and (8, 4) not in rows


def test_steady_positions_remove_the_jitter_of_a_stopped_player_but_keep_a_walk():
    jitter = table(*[row(k, 1, 0.5, 0.443 if (k // 6) % 2 == 0 else 0.42) for k in range(60)])
    tracking.steady_positions(jitter)
    ys = [jitter[(k, 1)][5] for k in range(10, 50)]
    assert max(abs(b - a) for a, b in zip(ys, ys[1:])) < 0.005  # plus de saut de 0,023 d'un coup : une dérive lente
    walk = table(*[row(k, 2, 0.2 + 0.01 * k, 0.5) for k in range(60)])
    tracking.steady_positions(walk)
    assert all(abs(walk[(k, 2)][4] - (0.2 + 0.01 * k)) < 1e-3 for k in range(60))


def test_gaze_of_unsure_rows_does_not_spin_between_sure_readings():
    rows = table(row(0, 1, 0.5, 0.5, conf=1.0, angle=150.0), *[row(k, 1, 0.5, 0.5, conf=0.4, angle=(337.0 if k % 2 else 98.0)) for k in range(1, 9)], row(9, 1, 0.5, 0.5, conf=1.0, angle=140.0))
    tracking.steady_gaze(rows, STEP)
    assert all(abs(((rows[(k, 1)][6] - 145 + 180) % 360) - 180) < 15 for k in range(1, 9))
    assert rows[(0, 1)][6] == 150.0 and rows[(9, 1)][6] == 140.0


def test_still_player_gaze_ignores_isolated_half_turns():
    rows = table(*[row(k, 1, 0.5, 0.5, angle=(270.0 if k == 9 else 90.0)) for k in range(20)])
    tracking.steady_still_gaze(rows)
    assert rows[(9, 1)][6] == 90.0


def test_merged_tail_is_cut_so_the_real_continuation_gets_the_number():
    def track(first, last, points, votes_slot):
        t = tracking.Track("B", first, {"x": points[0][0], "y": points[0][1], "slot": votes_slot})
        for k, (x, y) in zip(range(first + 1, last + 1), points[1:]):
            t.add(k, {"x": x, "y": y, "slot": votes_slot})
        return t

    six_before = track(0, 9, [(0.8 - 0.01 * k, 0.6) for k in range(10)], 5)  # le 6 arrive de la droite
    eight = track(0, 30, [(0.64, 0.6)] * 31, 7)  # le 8 posé, avec des lectures aux images 0 à 9 puis 20 à 30
    for k in range(10, 20):
        del eight.pts[k]
    eight.first, eight.last = 0, 30
    tail = {k: {"x": 0.64, "y": 0.6, "slot": 5} for k in range(10, 14)}  # la fin du 6 collée au 8 caché
    for k, d in tail.items():
        six_before.add(k, d)
    six_after = track(10, 25, [(0.64, 0.6 - 0.03 * k) for k in range(16)], 5)  # la vraie suite du 6 repart vers le haut
    assert tracking.trim_merged_tails([six_before, eight, six_after]) == 1
    assert six_before.last == 9


def test_isolated_station_read_and_its_fill_rows_are_removed_together():
    # le 9 lu avec certitude sur une icône de station (une image), reliée à ses voisines par des lignes reconstituées
    sure = [row(k, 8, 0.50, 0.54) for k in range(0, 8)]
    fill = [row(k, 8, 0.50 + 0.01 * (k - 8), 0.55 + 0.012 * (k - 8), conf=0.5) for k in range(8, 12)]
    icon = [row(12, 8, 0.605, 0.696)]
    fill2 = [row(k, 8, 0.58, 0.65, conf=0.5) for k in range(13, 20)]
    after = [row(k, 8, 0.49, 0.595) for k in range(20, 32)]
    rows = table(*sure, *fill, *icon, *fill2, *after)
    assert tracking.drop_isolated_reads(rows) > 0
    assert (12, 8) not in rows and (15, 8) not in rows and (9, 8) not in rows
    assert (7, 8) in rows and (20, 8) in rows


def test_isolated_read_across_a_death_and_respawn_is_not_judged():
    # la lecture isolée et ses voisines sûres sont séparées de plus de 6 s : le joueur est mort puis réapparu, aucun aller-retour à craindre
    rows = table(*[row(k, 8, 0.7, 0.6) for k in range(0, 10)], *[row(k, 8, 0.58, 0.61) for k in range(100, 103)], *[row(k, 8, 0.2, 0.4) for k in range(300, 320)])
    assert tracking.drop_isolated_reads(rows, 0.1) == 0


def test_a_single_unsure_row_off_the_line_between_its_neighbours_is_a_spike():
    rows = table(*[row(k, 8, 0.50 + 0.01 * k, 0.60, conf=0.4 if k == 5 else 1.0) for k in range(11)])
    old = rows[(5, 8)]
    rows[(5, 8)] = old[:4] + (0.55, 0.64) + old[6:]
    assert tracking.despike(rows) == 1
    assert abs(rows[(5, 8)][5] - 0.60) < 1e-3
    assert rows[(4, 8)][5] == 0.60  # une lecture sûre n'est jamais touchée


def test_three_players_in_a_start_zone_all_end_up_apart():
    rows = table(row(0, 1, 0.18, 0.60, conf=1.0), row(0, 2, 0.18, 0.60, conf=0.3), row(0, 3, 0.181, 0.601, conf=0.3), row(0, 4, 0.179, 0.599, conf=0.3))
    tracking.separate_players(rows)
    pts = [(r[4], r[5]) for r in rows.values()]
    assert all(math.hypot(a[0] - b[0], a[1] - b[1]) >= tracking.MIN_SEPARATION - 0.002 for i, a in enumerate(pts) for b in pts[i + 1 :])
    assert tracking.separate_players(rows) == 0  # stable : une seconde passe ne déplace plus personne


def test_gaze_coherence_is_high_for_steady_readings_and_low_for_contradicting_ones():
    steady = tracking.gaze_coherence({k: 90.0 + (k % 3) for k in range(20)})
    assert min(steady.values()) > 0.95
    flipping = tracking.gaze_coherence({k: (90.0 if k % 2 else 270.0) for k in range(20)})
    assert max(flipping.values()) < 0.3
    sparse = tracking.gaze_coherence({0: 10.0, 1: None, 2: None, 20: 10.0})
    assert sparse[0] == 0.0  # trop peu de lectures dans la fenêtre : indice inconnu


def _track(first, points, slot, team="B"):
    t = tracking.Track(team, first, {"x": points[0][0], "y": points[0][1], "slot": slot})
    for k, (x, y) in enumerate(points[1:], start=first + 1):
        t.add(k, {"x": x, "y": y, "slot": slot})
    return t


def test_two_tracks_of_the_same_number_hand_over_instead_of_one_being_discarded():
    real = _track(0, [(0.5 + 0.005 * k, 0.6 - 0.01 * k) for k in range(30)], 7)  # le disque du joueur observé
    nxt = _track(28, [(0.65 + 0.001 * k, 0.31) for k in range(40)], 7)  # la suite : même numéro, chevauche deux images
    nxt.pts[28] = {"x": 0.60, "y": 0.35, "slot": 7}
    nxt.pts[29] = {"x": 0.60, "y": 0.34, "slot": 7}
    assert tracking.trim_same_slot_overlaps([real, nxt]) == 1
    assert real.last == 27


def test_a_track_with_the_same_number_but_far_away_is_not_a_hand_over():
    real = _track(0, [(0.7, 0.6)] * 30, 8)
    other = _track(28, [(0.8, 0.9)] * 40, 8)  # un autre joueur dont le numéro a été mal lu : on ne coupe pas la vraie trajectoire
    assert tracking.trim_same_slot_overlaps([real, other]) == 0
    assert real.last == 29


def test_a_single_frame_observed_disc_far_from_both_neighbours_is_dropped():
    def frame(i, x, y):
        return (i, i * 0.1, [{"team": "B", "x": x, "y": y, "anchored": True, "spectated": True}])

    out = tracking._drop_pick_spikes([frame(0, 0.51, 0.47), frame(1, 0.48, 0.41), frame(2, 0.513, 0.47)])
    assert [bool(d) for _, _, d in out] == [True, False, True]
    kept = tracking._drop_pick_spikes([frame(0, 0.51, 0.47), frame(1, 0.52, 0.45), frame(2, 0.53, 0.43)])
    assert all(d for _, _, d in kept)  # un vrai déplacement n'est pas un parasite


def test_a_cross_needs_the_grey_banner_or_the_killfeed():
    dead = {3: {50, 51, 52}}
    times = {k: k * 0.1 for k in range(100)}
    assert not tracking._death_backed(25, 3, dead, [], times)  # bandeau plein, aucun kill : tache de lumière en forme de croix
    assert tracking._death_backed(51, 3, dead, [], times)  # bandeau grisé
    assert tracking._death_backed(25, 3, dead, [(2.3, 3)], times)  # kill du killfeed à 0,2 s
    assert not tracking._death_backed(25, 3, dead, [(2.3, 4)], times)  # le kill d'un autre joueur ne compte pas
    assert tracking._death_backed(25, 7, dead, [], times)  # pas de bandeau exploitable pour ce joueur : croix gardée


def test_a_hand_placed_mark_anchors_the_player_and_clears_contradicting_rows():
    times = {k: k * 0.1 for k in range(60)}
    rows = table(*[row(k, 5, 0.3 if k < 25 else 0.7, 0.5, conf=0.5) for k in range(60)])  # le suivi est parti de l'autre côté de la carte
    put = lambda fi, slot, team, x, y, angle, alive, conf: rows.__setitem__((fi, slot), (fi, round(fi * 0.1, 2), slot, team, x, y, angle, int(alive), conf))
    assert tracking.apply_marks(rows, [(3.0 + tracking.FRAME_LAG_S, 5, 0.3, 0.5, 40.0)], times, 0.1, put) == 1
    assert rows[(30, 5)][4:7] == (0.3, 0.5, 40.0) and rows[(30, 5)][8] == 1.0
    assert (35, 5) not in rows and (27, 5) not in rows  # les lignes à 0,7 dans la seconde voisine sont retirées, à refaire à partir de la vérité
    assert (20, 5) in rows  # le reste du suivi n'est pas touché
    coherence = {}
    tracking.apply_marks(rows, [(3.0 + tracking.FRAME_LAG_S, 5, 0.31, 0.5, 40.0)], times, 0.1, put, final=True, coherence_out=coherence)
    assert rows[(30, 5)][4] == 0.31 and coherence[(30, 5)] == 1.0


def test_position_only_mark_keeps_the_computed_gaze():
    times = {k: k * 0.1 for k in range(10)}
    rows = table(row(5, 2, 0.4, 0.4, conf=0.5, angle=123.0))
    put = lambda fi, slot, team, x, y, angle, alive, conf: rows.__setitem__((fi, slot), (fi, 0.0, slot, team, x, y, angle, int(alive), conf))
    tracking.apply_marks(rows, [(0.5 + tracking.FRAME_LAG_S, 2, 0.45, 0.4, None)], times, 0.1, put)
    assert rows[(5, 2)][6] == 123.0 and rows[(5, 2)][4] == 0.45


def test_marks_error_measures_position_in_metres_and_gaze_in_degrees():
    import marks_eval

    rows = [(10, 1.0, 3, "A", 0.5, 0.5, 100.0, 1, 1.0)]
    errs = marks_eval.errors(rows, [(1.0, 3, 0.5 + 1 / 31, 0.5, 130.0), (1.0, 4, 0.1, 0.1, None)], {10: 1.0})
    assert abs(errs[0][2] - 1.0) < 1e-9 and errs[0][3] == 30.0
    assert errs[1][2] is None  # joueur absent du suivi
    assert marks_eval.summary(errs)["position_sup_1m"] == 0


def test_a_hand_placed_gaze_holds_for_a_second_around_its_instant():
    times = {k: k * 0.1 for k in range(60)}
    rows = table(*[row(k, 2, 0.4, 0.4, conf=1.0, angle=90.0) for k in range(60)])
    put = lambda fi, slot, team, x, y, angle, alive, conf: rows.__setitem__((fi, slot), (fi, round(fi * 0.1, 2), slot, team, x, y, angle, int(alive), conf))
    coherence = {}
    tracking.apply_marks(rows, [(3.0 + tracking.FRAME_LAG_S, 2, 0.4, 0.4, 200.0), (4.4 + tracking.FRAME_LAG_S, 2, 0.4, 0.4, 20.0)], times, 0.1, put, final=True, coherence_out=coherence)
    assert rows[(26, 2)][6] == 200.0 and rows[(31, 2)][6] == 200.0  # dans la seconde de la première correction
    assert rows[(38, 2)][6] == 20.0  # plus près de la seconde correction
    assert rows[(56, 2)][6] == 90.0  # plus loin que la seconde voisine : inchangé
    assert coherence[(30, 2)] == 1.0 and coherence[(26, 2)] >= 0.8


def _duel_states(n=40):
    """Le joueur 1 (orange) et le joueur 8 (bleu) perdent des points de vie entre les images 10 et 14 ; le 2 non."""
    out = {}
    for k in range(n):
        hp = 0.8 if k < 10 else max(0.2, 0.8 - 0.15 * (k - 9)) if k < 14 else 0.2
        out[k] = {1: {"fill": hp}, 8: {"fill": hp}, 2: {"fill": 0.8}}
    return out


def test_a_player_losing_hp_is_under_fire_only_around_the_loss():
    fire = tracking.under_fire(_duel_states(), 0.1)
    assert 12 in fire[1] and 12 in fire[8]
    assert 30 not in fire[1] and not fire[2]


def test_two_enemies_losing_hp_together_look_at_each_other():
    rows = table(*[row(k, 1, 0.50, 0.50, angle=100.0) for k in range(40)], *[row(k, 8, 0.55, 0.50, angle=300.0) for k in range(40)], *[row(k, 2, 0.51, 0.50, angle=100.0) for k in range(40)])
    coherence = {}
    assert tracking.duel_gaze(rows, _duel_states(), 0.1, coherence) > 0
    assert abs(rows[(12, 1)][6] - 0.0) < 1.0  # le 1 regarde vers la droite, où est le 8
    assert abs(rows[(12, 8)][6] - 180.0) < 1.0  # le 8 regarde vers la gauche
    assert rows[(30, 1)][6] == 100.0  # hors du duel, rien ne change
    assert rows[(12, 2)][6] == 100.0  # un coéquipier qui ne perd rien n'est pas en duel
    assert coherence[(12, 1)] >= tracking.DUEL_COHERENCE


def test_a_gaze_already_turned_towards_the_opponent_is_kept():
    rows = table(*[row(k, 1, 0.50, 0.50, angle=15.0) for k in range(40)], *[row(k, 8, 0.55, 0.50, angle=180.0) for k in range(40)])
    tracking.duel_gaze(rows, _duel_states(), 0.1)
    assert rows[(12, 1)][6] == 15.0 and rows[(12, 8)][6] == 180.0


def test_enemies_too_far_apart_are_not_in_a_duel():
    rows = table(*[row(k, 1, 0.10, 0.50, angle=30.0) for k in range(40)], *[row(k, 8, 0.90, 0.50, angle=154.0) for k in range(40)])
    assert tracking.duel_gaze(rows, _duel_states(), 0.1) == 0


def test_the_killer_looks_at_the_victim_around_the_kill_but_not_for_a_gadget():
    times = {k: k * 0.1 for k in range(60)}
    def world():
        return table(*[row(k, 1, 0.30, 0.50, angle=100.0) for k in range(60)], *[row(k, 8, 0.45, 0.50, angle=100.0) for k in range(60)])
    rows = world()
    coherence = {}
    assert tracking.kill_gaze(rows, [(3.0, 1, 8, "SPECTRE")], times, 0.1, coherence) > 0
    assert abs(rows[(30, 1)][6] - 0.0) < 1.0  # le 1 regarde vers la droite, où est sa victime
    assert abs(rows[(24, 1)][6] - 0.0) < 1.0 and abs(rows[(35, 1)][6] - 0.0) < 1.0
    assert rows[(10, 1)][6] == 100.0 and rows[(40, 1)][6] == 100.0  # hors de la fenêtre
    assert rows[(30, 8)][6] == 100.0  # la victime n'est pas concernée
    assert coherence[(30, 1)] >= tracking.DUEL_COHERENCE
    rows = world()
    assert tracking.kill_gaze(rows, [(3.0, 1, 8, "DX3")], times, 0.1) == 0  # grenade : le regard ne dit rien
    rows = world()
    assert tracking.kill_gaze(rows, [(3.0, None, 8, "SPECTRE")], times, 0.1) == 0  # tueur inconnu


def test_the_killer_keeps_a_gaze_already_turned_towards_the_victim():
    times = {k: k * 0.1 for k in range(60)}
    rows = table(*[row(k, 1, 0.30, 0.50, angle=20.0) for k in range(60)], *[row(k, 8, 0.45, 0.50, angle=100.0) for k in range(60)])
    assert tracking.kill_gaze(rows, [(3.0, 1, 8, "SPECTRE")], times, 0.1) == 0


def test_lateral_move_costs_less_than_backwards_and_the_crab_allowance_lowers_it():
    assert tracking._move_cost(0) == 0 and abs(tracking._move_cost(180) - 1.0) < 1e-9
    old = tracking.LATERAL_ALLOW
    try:
        tracking.LATERAL_ALLOW = 0.0
        cos_only = tracking._move_cost(90)
        tracking.LATERAL_ALLOW = 1.0
        quad_only = tracking._move_cost(90)
    finally:
        tracking.LATERAL_ALLOW = old
    assert abs(cos_only - 0.5) < 1e-9 and abs(quad_only - 0.25) < 1e-9  # un regard à 90 degrés du cap coûte un quart au lieu de la moitié


def test_lag_of_the_tracking_is_measured_from_the_moving_corrections():
    import marks_eval

    step = 0.1
    times = {k: k * step for k in range(60)}
    # joueur qui avance de 0,01 par image ; le suivi anticipe de deux images : sa ligne k est à la position vraie de l'image k + 2
    rows = [(k, k * step, 1, "A", 0.2 + 0.01 * (k + 2), 0.5, None, 1, 1.0) for k in range(60)]
    marks = [(30 * step + tracking.FRAME_LAG_S, 1, 0.2 + 0.01 * 30, 0.5, None)]
    lg = marks_eval.lags(rows, marks, times)
    assert len(lg) == 1 and lg[0][2] == -2  # la position posée est dans la ligne deux images plus tôt : le suivi anticipe
    assert marks_eval.lag_summary(lg)["anticipe"] == 1


def test_marks_are_attached_to_the_nearest_analysis_frame(tmp_path):
    import db

    conn = db.connect(str(tmp_path / "t.db"))
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'v.mp4', 600, 60, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map, status) VALUES (1, 1, 0, 300, 'Polaris', 'confirmed')")
    db.replace_samples(conn, 1, [(k, k * 0.1, 1, "A", 0.5, 0.5, None, 1, 1.0) for k in range(20)])
    conn.execute("INSERT INTO user_marks (game_id, slot, t, x, y, angle) VALUES (1, 1, 0.74, 0.5, 0.5, 10)")
    conn.commit()
    assert db.index_marks(conn, 1) == 1
    assert tuple(conn.execute("SELECT frame, round(frame_t, 2) FROM user_marks").fetchone()) == (7, 0.7)


def _tp_world(monkeypatch=None):
    """Un joueur marche vers la station A (0.20, 0.50), prend la tyrolienne et ressort à la station B (0.80, 0.50). Station A : sortie vers 90 degrés (le bas), B : vers 270 (le haut)."""
    tracking._TELEPORTS[:] = [((0.20, 0.50), (0.80, 0.50))]
    tracking._STATIONS[:] = [(0.20, 0.50, 90.0), (0.80, 0.50, 270.0)]
    rows = table(
        *[row(k, 1, 0.20, 0.50, angle=0.0) for k in range(0, 10)],  # avant l'entrée : regard vers la droite
        *[row(k, 1, 0.80, 0.50, angle=0.0) for k in range(10, 20)],  # après la sortie : regard vers la droite
    )
    return rows


def test_the_gaze_at_a_tp_entry_and_exit_follows_the_station_directions():
    rows = _tp_world()
    coherence = {}
    try:
        assert tracking.tp_gaze(rows, 0.1, coherence) > 0
        # entrée : opposé de la direction de sortie de la station A (90 degrés), soit 270, pendant les 3 dernières images
        assert [rows[(k, 1)][6] for k in (7, 8, 9)] == [270.0] * 3
        assert rows[(5, 1)][6] == 0.0  # plus tôt, rien ne change
        # sortie : direction de la station B (270), pendant les 3 premières images
        assert [rows[(k, 1)][6] for k in (10, 11, 12)] == [270.0] * 3
        assert rows[(14, 1)][6] == 0.0
        assert coherence[(10, 1)] >= tracking.DUEL_COHERENCE
    finally:
        tracking._TELEPORTS[:] = []
        tracking._STATIONS[:] = []


def test_a_gaze_already_close_to_the_station_direction_is_kept_and_a_station_without_direction_changes_nothing():
    rows = _tp_world()
    try:
        rows = table(*[row(k, 1, 0.20, 0.50, angle=250.0) for k in range(0, 10)], *[row(k, 1, 0.80, 0.50, angle=300.0) for k in range(10, 20)])
        tracking.tp_gaze(rows, 0.1)
        assert rows[(9, 1)][6] == 250.0 and rows[(10, 1)][6] == 300.0  # à moins de 40 degrés de la règle : gardé
        rows = _tp_world()
        tracking._STATIONS[:] = []  # aucune direction donnée
        assert tracking.tp_gaze(rows, 0.1) == 0
    finally:
        tracking._TELEPORTS[:] = []
        tracking._STATIONS[:] = []


def test_a_player_walking_past_a_station_without_riding_is_not_touched():
    tracking._TELEPORTS[:] = [((0.20, 0.50), (0.80, 0.50))]
    tracking._STATIONS[:] = [(0.20, 0.50, 90.0), (0.80, 0.50, 270.0)]
    try:
        rows = table(*[row(k, 1, 0.20 + 0.001 * k, 0.50, angle=0.0) for k in range(20)])
        assert tracking.tp_gaze(rows, 0.1) == 0
    finally:
        tracking._TELEPORTS[:] = []
        tracking._STATIONS[:] = []


def test_a_kill_marked_libanaise_keeps_the_gaze_that_was_read():
    """La libanaise : le tueur collé à un mur décale son arme dans l'ouverture et tire à l'aveugle, son regard ne vise pas la victime (marquage à la main)."""
    times = {k: k * 0.1 for k in range(60)}
    def world():
        return table(*[row(k, 1, 0.30, 0.50, angle=100.0) for k in range(60)], *[row(k, 8, 0.45, 0.50, angle=100.0) for k in range(60)])
    rows = world()
    assert tracking.kill_gaze(rows, [(3.0, 1, 8, "SPECTRE", True)], times, 0.1) == 0 and rows[(30, 1)][6] == 100.0  # marqué : regard lu gardé
    rows = world()
    assert tracking.kill_gaze(rows, [(3.0, 1, 8, "SPECTRE", False)], times, 0.1) > 0 and abs(rows[(30, 1)][6] - 0.0) < 1.0  # non marqué : règle du kill
    rows = world()
    assert tracking.kill_gaze(rows, [(3.0, 1, 8, "SPECTRE")], times, 0.1) > 0  # ancien format sans drapeau : règle du kill


# --- un mur entre deux joueurs : la règle du duel et du kill ne s'applique pas ---

def _wall_world():
    """Carte des passages : deux couloirs séparés par un mur plein (colonne de cases non praticables) entre x = 0,45 et 0,55."""
    cells = {tracking._cell((0.1 + 0.01 * i, 0.50 + 0.01 * j)) for i in range(80) for j in range(-30, 31)}
    wall = {tracking._cell((x, 0.5 + 0.01 * j)) for x in (0.45, 0.47, 0.49, 0.51, 0.53, 0.55) for j in range(-30, 31)}
    tracking._WALK.clear()
    tracking._WALK.update(cells - wall)


def _no_wall():
    tracking._WALK.clear()
    tracking._ROTORS.clear()
    tracking._DOORS.clear()


def test_a_wall_between_two_players_is_seen_and_an_open_line_is_not():
    a = row(0, 1, 0.30, 0.50)
    b = row(0, 8, 0.70, 0.50)
    try:
        assert tracking.sight_blocked(a, b) is False  # sans carte des passages : rien ne sépare personne
        _wall_world()
        assert tracking.sight_blocked(a, b) is True
        assert tracking.sight_blocked(a, row(0, 8, 0.40, 0.50)) is False  # du même côté du mur
        assert tracking.sight_blocked(row(0, 1, 0.44, 0.50), row(0, 8, 0.56, 0.50)) is True  # collés au mur de chaque côté : le mur compte quand même
    finally:
        _no_wall()


def test_a_button_door_between_two_players_separates_them_for_sight_but_not_for_walking():
    a, b = row(0, 1, 0.30, 0.50), row(0, 8, 0.70, 0.50)
    cells = {tracking._cell((0.1 + 0.01 * i, 0.50 + 0.01 * j)) for i in range(80) for j in range(-30, 31)}
    try:
        tracking._WALK.update(cells)  # la porte est praticable : aucune case n'est un mur
        assert tracking.sight_blocked(a, b) is False
        tracking._DOORS[:] = [((0.5, 0.4), (0.5, 0.6))]  # une porte à bouton sur la ligne
        assert tracking.sight_blocked(a, b) is True
        assert tracking.sight_blocked(a, row(0, 8, 0.40, 0.50)) is False  # du même côté de la porte
        assert tracking._cell((0.5, 0.5)) in tracking._WALK  # et on la franchit
    finally:
        _no_wall()


def test_only_the_maps_with_button_doors_get_them(tmp_path):
    import db

    assert db.button_doors_for("Polaris") == []
    reef = db.button_doors_for("Reef Point")
    assert reef and all(len(seg) == 2 for seg in reef)  # les portes opaques tracées par l'utilisateur (3 au dernier « Appliquer »)


def test_two_gazes_cross_only_when_the_rays_meet_in_front_of_both_players():
    a = row(0, 1, 0.30, 0.50, angle=0.0)  # regarde vers la droite
    assert tracking.gazes_cross(a, row(0, 8, 0.70, 0.30, angle=90.0)) is True  # l'autre regarde vers le bas : les rayons se coupent en (0,70 ; 0,50)
    assert tracking.gazes_cross(a, row(0, 8, 0.70, 0.30, angle=270.0)) is False  # l'autre regarde vers le haut : le croisement est derrière lui
    assert tracking.gazes_cross(a, row(0, 8, 0.70, 0.50, angle=0.0)) is False  # parallèles
    assert tracking.gazes_cross(a, row(0, 8, 0.70, 0.30, angle=None)) is True  # regard inconnu : on ne tranche pas


def test_the_duel_rule_keeps_the_read_gazes_when_a_wall_separates_the_duelists_and_their_gazes_do_not_cross():
    def world(angle_1, angle_8):
        return table(*[row(k, 1, 0.30, 0.50, angle=angle_1) for k in range(40)], *[row(k, 8, 0.70, 0.50, angle=angle_8) for k in range(40)])
    try:
        _wall_world()
        rows = world(100.0, 80.0)  # chacun regarde vers le bas : les rayons sont presque parallèles et ne se croisent pas
        assert tracking.duel_gaze(rows, _duel_states(), 0.1) == 0 and rows[(12, 1)][6] == 100.0 and rows[(12, 8)][6] == 80.0
        rows = world(45.0, 135.0)  # regards qui se croisent devant les deux joueurs (en bas, entre eux) : le mur n'y change rien, la règle s'applique
        assert tracking.duel_gaze(rows, _duel_states(), 0.1) > 0
        _no_wall()
        rows = world(100.0, 80.0)
        assert tracking.duel_gaze(rows, _duel_states(), 0.1) > 0  # sans mur : règle du duel
    finally:
        _no_wall()


def test_the_kill_rule_applies_through_a_wall_unless_the_option_is_on():
    times = {k: k * 0.1 for k in range(60)}
    def world():
        return table(*[row(k, 1, 0.30, 0.50, angle=100.0) for k in range(60)], *[row(k, 8, 0.70, 0.50, angle=100.0) for k in range(60)])
    try:
        _wall_world()
        assert tracking.SIGHT_KILL is False  # par défaut : le tueur regarde sa victime même à travers un mur (mesuré)
        rows = world()
        assert tracking.kill_gaze(rows, [(3.0, 1, 8, "SPECTRE")], times, 0.1) > 0
        tracking.SIGHT_KILL = True
        rows = world()
        assert tracking.kill_gaze(rows, [(3.0, 1, 8, "SPECTRE")], times, 0.1) == 0 and rows[(30, 1)][6] == 100.0  # option : pas de règle du kill à travers un mur
    finally:
        tracking.SIGHT_KILL = False
        _no_wall()
