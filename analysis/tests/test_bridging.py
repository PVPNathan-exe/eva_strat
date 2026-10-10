"""Aucun joueur vivant ne disparaît : périodes vivantes (bandeaux), comblement des trous, pastilles inutilisées, morts confirmées."""

import pytest

import tracking

STEP = 0.1


@pytest.fixture(autouse=True)
def _no_walk_map():
    """La carte des passages est un état global posé par solve : chaque test repart sans carte."""
    tracking._WALK.clear()
    yield
    tracking._WALK.clear()


def states(alive_by_slot, n):
    """{image: {slot: {"alive", "spectated"}}} : alive_by_slot = {slot: [(début, fin), ...]} (périodes vivantes, fin comprise)."""
    out = {}
    for k in range(n):
        out[k] = {slot: {"alive": any(a <= k <= b for a, b in spans), "spectated": False} for slot, spans in alive_by_slot.items()}
    return out


def row(fi, slot, x, y, conf=1.0, alive=1):
    return (fi, fi * STEP, slot, "A", x, y, 90.0, alive, conf)


def make_put(rows):
    def put(fi, slot, team, x, y, angle, alive, conf):
        rows[(fi, slot)] = (fi, fi * STEP, slot, team, x, y, angle, int(alive), conf)

    return put


def test_alive_runs_follow_the_banner_and_ignore_blinks():
    s = states({1: [(0, 39), (80, 119)]}, 120)
    dead = tracking.dead_frames(s, STEP)
    assert tracking.alive_runs(s, dead) == {1: [(0, 39), (80, 119)]}


def test_gap_between_two_readings_is_bridged_in_a_straight_line():
    rows = {(k, 1): row(k, 1, 0.1, 0.1) for k in range(0, 6)}
    rows.update({(k, 1): row(k, 1, 0.5, 0.1) for k in range(16, 21)})
    tracking.bridge_gaps(rows, {1: [(0, 20)]}, STEP, make_put(rows))
    xs = [rows[(k, 1)][4] for k in range(0, 21)]
    assert all(rows.get((k, 1)) for k in range(0, 21))  # plus aucun trou
    assert xs == sorted(xs) and 0.1 < xs[10] < 0.5  # il avance régulièrement d'un point à l'autre
    assert rows[(10, 1)][8] < 0.7  # reconstruit : confiance plus basse qu'une lecture


def test_respawn_and_last_seconds_before_death_keep_the_nearest_known_position():
    rows = {(k, 2): row(k, 2, 0.3, 0.7) for k in range(10, 20)}
    tracking.bridge_gaps(rows, {2: [(0, 29)]}, STEP, make_put(rows))
    assert all((k, 2) in rows for k in range(0, 30))
    assert rows[(0, 2)][4:6] == (0.3, 0.7) and rows[(29, 2)][4:6] == (0.3, 0.7)


def test_a_dead_period_is_never_filled():
    rows = {(k, 1): row(k, 1, 0.2, 0.2) for k in (0, 1, 2, 60, 61, 62)}
    tracking.bridge_gaps(rows, {1: [(0, 5), (58, 70)]}, STEP, make_put(rows))
    assert not any((k, 1) in rows for k in range(6, 58))  # mort : aucune position vivante
    assert all((k, 1) in rows for k in range(0, 6)) and all((k, 1) in rows for k in range(58, 71))


def det(team, x, y, number=None, spectated=False):
    return {"team": team, "x": x, "y": y, "number": number, "alive": True, "spectated": spectated, "angle": 10.0}


def test_an_unused_marker_near_the_expected_place_fills_a_hole():
    rows = {(0, 1): row(0, 1, 0.50, 0.50), (2, 1): row(2, 1, 0.54, 0.50)}
    frames = [(k, k * STEP, []) for k in range(3)]
    frames[1] = (1, STEP, [det("A", 0.52, 0.51)])
    tracking.recover_from_unused(rows, {1: [(0, 2)]}, frames, states({1: [(0, 2)]}, 3), STEP, make_put(rows))
    assert rows[(1, 1)][4:6] == (0.52, 0.51)


def test_a_white_marker_is_taken_only_for_the_observed_player():
    rows = {(0, 1): row(0, 1, 0.50, 0.50), (2, 1): row(2, 1, 0.50, 0.50)}
    white = det("A", 0.50, 0.50, spectated=True)  # disque blanc : joueur observé, ou station de tyrolienne
    frames = [(0, 0.0, []), (1, STEP, [white]), (2, 2 * STEP, [])]
    st = states({1: [(0, 2)]}, 3)
    tracking.recover_from_unused(rows, {1: [(0, 2)]}, frames, st, STEP, make_put(rows))
    assert (1, 1) not in rows  # le bandeau ne dit pas que le joueur 1 est observé
    st[1][1]["spectated"] = True
    tracking.recover_from_unused(rows, {1: [(0, 2)]}, frames, st, STEP, make_put(rows))
    assert (1, 1) in rows


def test_a_marker_read_as_another_player_is_not_taken():
    rows = {(0, 1): row(0, 1, 0.50, 0.50), (2, 1): row(2, 1, 0.50, 0.50)}
    frames = [(0, 0.0, []), (1, STEP, [det("A", 0.50, 0.52, number=3)]), (2, 2 * STEP, [])]
    tracking.recover_from_unused(rows, {1: [(0, 2)]}, frames, states({1: [(0, 2)]}, 3), STEP, make_put(rows))
    assert (1, 1) not in rows  # le numéro 3 est le joueur 3, pas le 1


def test_killfeed_death_is_kept_only_if_the_banner_confirms_it():
    s = states({1: [(0, 59), (150, 199)], 2: [(0, 199)]}, 200)  # le joueur 1 meurt à l'image 60 (6 s) ; le joueur 2 ne meurt jamais
    dead = tracking.dead_frames(s, STEP)
    times = {k: k * STEP for k in range(200)}
    kept = tracking.confirmed_deaths([(6.0, 1), (6.0, 2), (6.0, 5)], dead, times, STEP)
    assert (6.0, 1) in kept  # le bandeau se grise juste après
    assert (6.0, 2) not in kept  # ligne du killfeed mal lue : le bandeau reste vivant
    assert (6.0, 5) in kept  # pas de bandeau exploitable pour ce joueur : on garde l'information du killfeed


def _track(first, last, x, y):
    t = tracking.Track("A", first, {"x": x, "y": y, "alive": True, "slot": None})
    for k in range(first + 1, last + 1):
        t.add(k, {"x": x, "y": y, "alive": True, "slot": None})
    return t


def test_an_unnumbered_short_track_far_from_the_player_is_not_given_by_elimination():
    known = _track(0, 50, 0.85, 0.57)  # le joueur était là
    noise = _track(52, 60, 0.36, 0.20)  # 0,2 s plus tard, à l'autre bout de la carte : reflet bleu de l'eau, pas lui
    near = _track(52, 60, 0.87, 0.58)
    assert not tracking._elimination_ok(noise, [known], STEP)
    assert tracking._elimination_ok(near, [known], STEP)
    assert tracking._elimination_ok(_track(52, 100, 0.36, 0.20), [known], STEP)  # une trajectoire longue est fiable
    assert tracking._elimination_ok(noise, [], STEP)  # aucune position connue de ce joueur : rien ne la contredit


def test_a_white_marker_that_never_moves_and_comes_back_all_game_is_a_zipline_station():
    # 1 image sur 10 pendant 200 s : une station de tyrolienne lue comme « joueur observé » ; un joueur observé immobile 3 s ne l'est pas
    frames = [(k, k * 1.0, [det("B", 0.61, 0.66, number=9, spectated=True)] if k % 10 == 0 else []) for k in range(200)]
    frames += [(200 + k, 200.0 + k, [det("A", 0.30, 0.30, number=1, spectated=True)] if k < 3 else []) for k in range(60)]
    kept = tracking.drop_static_spectated(frames)
    assert not any(d for _, _, dets in kept for d in dets if d["team"] == "B")  # la station est retirée
    assert sum(1 for _, _, dets in kept for d in dets if d["team"] == "A") == 3  # le joueur immobile 3 s reste


def _white(team, x, y, number=None, waiting=False):
    d = det(team, x, y, number=number, spectated=True)
    d["waiting"] = waiting
    return d


def _watch(slot, dead=()):
    return {s: {"alive": s not in dead, "spectated": s == slot} for s in range(1, 9)}


def test_observed_player_still_in_his_spawn_is_the_extra_white_disc():
    frame = [(0, 0.0, [_white("A", 0.10, 0.60, waiting=True)])]
    out = tracking.anchor_spectated(frame, {0: _watch(2)})
    assert [(d["slot"], d["number"]) for d in out[0][2]] == [(2, 2)]  # tous vivants : l'unique disque blanc de la zone de départ est le joueur observé


def test_waiting_discs_of_dead_players_are_never_taken_for_the_observed_player():
    frame = [(0, 0.0, [_white("A", 0.10, 0.60, waiting=True)])]
    assert tracking.anchor_spectated(frame, {0: _watch(2, dead=(3,))})[0][2] == []  # un mort attend : le disque est peut-être le sien, on ne devine pas
    assert tracking.anchor_spectated(frame, None)[0][2] == []  # sans bandeau, les disques d'attente ne sont pas des joueurs en jeu
    elsewhere = [(0, 0.0, [_white("A", 0.50, 0.30), _white("A", 0.10, 0.60, waiting=True)])]
    kept = tracking.anchor_spectated(elsewhere, {0: _watch(2)})[0][2]
    assert [(d["slot"], round(d["x"], 2)) for d in kept] == [(2, 0.5)]  # la pastille hors zone de départ est le joueur observé, le disque d'attente disparaît


def test_a_numbered_white_marker_on_a_zipline_station_is_kept_for_the_observed_player_only():
    station = (0.22, 0.62)
    frames = [(k, k * 1.0, [det("A", *station, number=2, spectated=True)] if k % 6 == 0 else []) for k in range(200)]  # revient toute la game : « station »
    states = {k: _watch(2) for k in range(200)}
    kept = tracking.drop_static_spectated(frames, states)
    assert sum(1 for _, _, dets in kept for d in dets) == 34  # le numéro 2 est bien celui du joueur observé (joueur 2) : conservée
    other = {k: _watch(3) for k in range(200)}
    assert not any(d for _, _, dets in tracking.drop_static_spectated(frames, other) for d in dets)  # joueur 3 observé : ce « 2 » est la station


STATIONS = [((0.36, 0.06), (0.36, 0.71))]


def _with_stations(fn):
    def wrapper():
        tracking._TELEPORTS[:] = STATIONS
        try:
            fn()
        finally:
            tracking._TELEPORTS[:] = []

    return wrapper


@_with_stations
def test_a_station_links_its_entrance_and_its_exit_only():
    assert tracking._tp_linked((0.37, 0.70), (0.36, 0.07))  # entrée vers sortie
    assert tracking._tp_linked((0.36, 0.06), (0.37, 0.72))  # et dans l'autre sens
    assert not tracking._tp_linked((0.37, 0.70), (0.60, 0.07))  # une autre station n'est pas sa sortie
    assert not tracking._tp_linked((0.20, 0.40), (0.36, 0.07))  # loin de toute station


@_with_stations
def test_a_player_who_vanishes_at_a_station_is_the_one_who_appears_at_its_exit():
    a = _track(0, 20, 0.36, 0.70)
    b = _track(24, 40, 0.36, 0.07)  # 0,4 s plus tard à l'autre bout de la carte
    far = _track(24, 40, 0.80, 0.30)
    assert tracking._gap_cost(a, b, STEP) is not None
    assert tracking._gap_cost(a, far, STEP) is None


@_with_stations
def test_a_gap_across_a_station_waits_at_the_entrance_then_is_at_the_exit():
    rows = {(k, 1): row(k, 1, 0.36, 0.70) for k in range(0, 5)}
    rows.update({(k, 1): row(k, 1, 0.36, 0.06) for k in range(15, 20)})
    tracking.bridge_gaps(rows, {1: [(0, 19)]}, STEP, make_put(rows))
    ys = [rows[(k, 1)][5] for k in range(5, 15)]
    assert all(y in (0.70, 0.06) for y in ys)  # jamais un point au milieu de la carte
    assert ys[:5] == [0.70] * 5 and ys[5:] == [0.06] * 5  # entrée jusqu'au milieu du trou, puis sortie


def _with_walk(cells, fn):
    tracking._WALK.clear()
    tracking._WALK.update(cells)
    try:
        fn()
    finally:
        tracking._WALK.clear()


def test_a_gap_follows_the_known_corridors_instead_of_crossing_a_wall():
    # couloir en L : de (0.1, 0.1) à (0.1, 0.5) puis à (0.5, 0.5) ; la droite directe traverserait la zone vide au milieu
    points = [(0.1, y / 100) for y in range(10, 51)] * 3 + [(x / 100, 0.5) for x in range(10, 51)] * 3
    cells = tracking.walk_grid(points)

    def check():
        path = tracking.route((0.1, 0.1), (0.5, 0.5))
        assert len(path) >= 3  # il contourne par le coin
        assert all(tracking._cell(p) in cells | {tracking._cell((0.1, 0.1)), tracking._cell((0.5, 0.5))} for p in path)
        x, y = tracking._along(path, 0.5)
        assert (x, y) != (0.3, 0.3)  # le milieu du trajet n'est pas au milieu de la zone vide

    _with_walk(cells, check)


def test_without_known_corridors_or_with_a_walkable_straight_line_the_route_is_straight():
    assert tracking.route((0.1, 0.1), (0.5, 0.5)) == [(0.1, 0.1), (0.5, 0.5)]  # aucune carte des passages
    open_cells = tracking.walk_grid([(x / 100, y / 100) for x in range(5, 60) for y in range(5, 60)] * 3)
    _with_walk(open_cells, lambda: [None for _ in [0]] and None)
    tracking._WALK.update(open_cells)
    try:
        assert tracking.route((0.1, 0.1), (0.5, 0.5)) == [(0.1, 0.1), (0.5, 0.5)]  # la ligne droite est praticable
    finally:
        tracking._WALK.clear()


def test_a_blob_outside_every_known_passage_is_not_recovered_as_a_player():
    tracking._WALK.clear()
    tracking._WALK.update(tracking.walk_grid([(0.50 + 0.001 * i, 0.50) for i in range(6)] * 2))
    try:
        assert tracking.on_walkable((0.50, 0.50))
        assert not tracking.on_walkable((0.89, 0.61))  # reflet de lumière loin des galeries
    finally:
        tracking._WALK.clear()
    assert tracking.on_walkable((0.89, 0.61))  # sans carte des passages on ne tranche pas


def test_the_observed_player_waiting_in_the_spawn_zone_is_not_replaced_by_a_station_disc():
    # le joueur observé est le 7 (numéro 8) : son disque attend dans la zone de départ ; le disque blanc d'une station de tyrolienne est lu « 9 » (un autre joueur)
    waiting = {**det("B", 0.47, 0.58, number=8, spectated=True), "waiting": True, "verified": True}
    station = det("B", 0.74, 0.85, number=9, spectated=True)
    st = {0: {7: {"alive": True, "spectated": True}}}
    out = tracking.anchor_spectated([(0, 0.0, [waiting, station])], st)
    anchored = [d for d in out[0][2] if d.get("slot") == 7]
    assert len(anchored) == 1 and (anchored[0]["x"], anchored[0]["y"]) == (0.47, 0.58)
    assert all(d.get("slot") != 7 for d in out[0][2] if d["x"] == 0.74)
