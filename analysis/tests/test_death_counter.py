"""Garde-fou du compteur de morts."""

import cv2
import numpy as np

import death_counter
import names


def _crop(digit, background=(0, 140, 255), index=1, others=None):
    """Barre de quatre bandeaux de 100 x 80 pixels : le chiffre `digit` est écrit sous la tête de mort du bandeau `index` (`others` : {bandeau: chiffre} pour d'autres bandeaux)."""
    crop = np.full((80, 400, 3), background, np.uint8)
    for i, d in {index: digit, **(others or {})}.items():
        cv2.putText(crop, str(d), (int(i * 100 + 0.64 * 100), int(0.84 * 80)), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 0), 2)
    return crop


def test_the_same_digit_is_unchanged_on_a_different_background_and_a_new_digit_is_not():
    assert death_counter.counter_unchanged(_crop(2), _crop(2, background=(255, 128, 0)), 1) is True
    assert death_counter.counter_unchanged(_crop(2), _crop(3), 1) is False
    assert death_counter.counter_unchanged(_crop(1), _crop(2), 1) is False


def test_a_flat_area_is_unreadable():
    flat = np.full((80, 400, 3), 120, np.uint8)
    assert death_counter.counter_unchanged(flat, _crop(2), 1) is None
    assert death_counter.counter_unchanged(None, _crop(2), 1) is None


def test_a_grey_banner_period_is_vetoed_only_when_the_counter_is_unchanged_and_no_kill_confirms_it(monkeypatch):
    step = 0.2
    game = {"path": "x.mp4", "width": 1920, "height": 1080, "start_s": 100.0, "end_s": 160.0, "map": "Test"}
    alive = lambda k: {s: {"alive": True, "spectated": False, "fill": 0.5} for s in (1, 2, 3, 4)}
    states = {k: alive(k) for k in range(300)}
    for k in range(100, 160):  # 12 s de bandeau « mort » pour le joueur 2 et pour le joueur 3, de 20 s à 32 s
        states[k][2] = {"alive": False, "spectated": False, "fill": 0.0}
        states[k][3] = {"alive": False, "spectated": False, "fill": 0.0}
    monkeypatch.setattr(death_counter.db, "zone_for", lambda conn, m, k: {"x": 0, "y": 0, "w": 1, "h": 1})
    # joueur 2 (bandeau 1) : compteur 2 avant et après ; joueur 3 (bandeau 2) : 1 avant, 1 après
    monkeypatch.setattr(names, "_grab", lambda video, t, zone, w, h: _crop(2, index=1, others={2: 1}))
    out, vetoed = death_counter.veto_states(None, game, {k: dict(v) for k, v in states.items()}, [], step)
    assert {v[0] for v in vetoed} == {2, 3} and all(out[120][s]["alive"] for s in (2, 3))
    # un kill annoncé pour le joueur 2 à 20 s de game : c'est une mort, elle reste
    out, vetoed = death_counter.veto_states(None, game, {k: dict(v) for k, v in states.items()}, [(120.5, 2)], step)
    assert {v[0] for v in vetoed} == {3} and not out[120][2]["alive"]
    # le compteur du joueur 2 passe de 2 à 3 pendant la période : pas de veto pour lui, le 3 reste vetoé
    monkeypatch.setattr(names, "_grab", lambda video, t, zone, w, h: _crop(2 if t < 125 else 3, index=1, others={2: 1}))
    out, vetoed = death_counter.veto_states(None, game, {k: dict(v) for k, v in states.items()}, [], step)
    assert {v[0] for v in vetoed} == {3} and not out[120][2]["alive"]


def test_a_death_announced_by_the_killfeed_up_to_18_seconds_earlier_confirms_a_late_grey_banner(monkeypatch):
    step = 0.2
    game = {"path": "x.mp4", "width": 1920, "height": 1080, "start_s": 100.0, "end_s": 200.0, "map": "Test"}
    states = {k: {s: {"alive": True, "spectated": False, "fill": 0.5} for s in (1, 2, 3, 4)} for k in range(500)}
    for k in range(230, 280):  # bandeau grisé de 46 s à 56 s, alors que le killfeed annonce la mort du joueur 2 à 38 s (le bandeau paraissait vivant pendant le compte à rebours)
        states[k][2] = {"alive": False, "spectated": False, "fill": 0.0}
    monkeypatch.setattr(death_counter.db, "zone_for", lambda conn, m, k: {"x": 0, "y": 0, "w": 1, "h": 1})
    monkeypatch.setattr(names, "_grab", lambda video, t, zone, w, h: _crop(2, index=1))  # le compteur est déjà à 2 avant la période : même chiffre avant et après
    out, vetoed = death_counter.veto_states(None, game, states, [(138.0, 2)], step)
    assert vetoed == [] and not out[250][2]["alive"]
