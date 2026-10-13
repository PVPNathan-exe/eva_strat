"""Joueur observé au cours d'une game."""

import observed_name


def test_observed_segments_ignore_frames_without_a_time():
    states = {0: {1: {"spectated": True}}, 1: {1: {"spectated": True}}, 2: {1: {"spectated": True}}, 3: {1: {"spectated": True}}}
    times = {0: 0.0, 1: 0.1, 3: 0.3}  # l'image 2 n'a aucune ligne de suivi : pas de temps
    assert observed_name.observed_segments(states, times, min_s=0.0) == [(1, 0.0, 0.3)]
