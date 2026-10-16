import recheck_doubts as rd


def game(*doubts):
    return {"id": 1, "doubts": list(doubts)}


ILLISIBLE = {"start_s": 100.0, "end_s": 107.0, "label": rd.LABEL}
FIN = {"start_s": 300.0, "end_s": 307.0, "label": "Fin à vérifier : chrono arrêté à 4:26"}


def test_a_consistent_clock_removes_the_warning():
    # Le chrono lit 500 puis 493 pour 7 s écoulées : déterminé
    kept, dropped = rd.recheck_game(game(ILLISIBLE), {}, None, None, reader=lambda t: 500 if t == 100.0 else 493)
    assert kept == [] and len(dropped) == 1 and dropped[0]["before"] == 500 and dropped[0]["after"] == 493


def test_a_clock_that_does_not_match_keeps_the_warning():
    # 500 puis 497 pour 7 s écoulées : le chrono s'est arrêté 4 s, c'est un vrai doute
    kept, dropped = rd.recheck_game(game(ILLISIBLE), {}, None, None, reader=lambda t: 500 if t == 100.0 else 497)
    assert kept == [ILLISIBLE] and dropped == []


def test_an_unreadable_edge_keeps_the_warning():
    kept, dropped = rd.recheck_game(game(ILLISIBLE), {}, None, None, reader=lambda t: None)
    assert kept == [ILLISIBLE] and dropped == []


def test_other_warnings_are_never_touched():
    kept, dropped = rd.recheck_game(game(FIN, ILLISIBLE), {}, None, None, reader=lambda t: 500 if t == 100.0 else 493)
    assert kept == [FIN] and len(dropped) == 1


def test_one_second_of_rounding_is_tolerated():
    assert rd.is_determined(500, 492, 7.0)  # 8 s lues pour 7 s écoulées : arrondi de lecture
    assert not rd.is_determined(500, 490, 7.0)  # 10 s pour 7 s
