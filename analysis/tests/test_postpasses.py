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
