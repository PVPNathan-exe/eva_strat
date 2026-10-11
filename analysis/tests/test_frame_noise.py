"""Contamination de couleur : stries de lumière qui ressemblent à des joueurs."""

import numpy as np

import frame_noise
import minimap
import tracking


def grid(n=20):
    return np.zeros((n, 36, 64, 2), np.uint8)


def test_a_clean_game_has_no_noise_and_an_explained_marker_is_not_noise():
    coarse = grid()
    coarse[:, 10, 10, 0] = 255  # zone de départ : toujours de la couleur orange (fond)
    coarse[5, 20:22, 30:32, 0] = 255  # une pastille orange à une image
    frames = [(i, i * 0.1, [{"team": "A", "x": 30.5 / 64, "y": 20.5 / 36}] if i == 5 else []) for i in range(20)]
    assert frame_noise.frame_noise(coarse, frames) == [0.0] * 20


def test_colour_with_no_marker_is_noise_in_marker_equivalents():
    coarse = grid()
    coarse[7, 5:9, 40:50, 0] = 255  # strie orange de 40 cases, aucune pastille trouvée
    frames = [(i, i * 0.1, []) for i in range(20)]
    noise = frame_noise.frame_noise(coarse, frames)
    assert noise[7] == 10.0 and sum(noise) == 10.0  # 40 cases / 4 cases par pastille, seulement à l'image touchée


def test_coarse_colour_map_sees_the_team_colours():
    crop = np.zeros((254, 460, 3), np.uint8)
    crop[:, :230] = (0, 140, 255)  # orange (BGR)
    crop[:, 230:] = (255, 120, 20)  # bleu
    grid_ = minimap.coarse_colour_map(crop)
    assert grid_.shape == (36, 64, 2)
    assert grid_[:, :32, 0].mean() > 200 and grid_[:, 32:, 1].mean() > 200 and grid_[:, :32, 1].max() < 10


def test_a_contaminated_frame_does_not_start_a_track_without_a_number():
    frames = [(i, i * 0.1, [{"team": "A", "x": 0.5, "y": 0.5, "number": None, "slot": None, "angle": 0.0, "alive": True, "spectated": False}]) for i in range(10)]
    tracks, _ = tracking._link(frames, 0.1, contaminated=set(range(10)))
    assert tracks == []
    tracks, _ = tracking._link(frames, 0.1, contaminated=set())
    assert len(tracks) == 1


def test_an_unnumbered_track_unreachable_without_a_zipline_is_not_given_by_elimination():
    tracking._WALK.update({(i, j) for i in range(2, 12) for j in range(20, 26)} | {(i, j) for i in range(38, 48) for j in range(20, 26)})  # deux îlots
    tracking._TELEPORTS[:] = [((0.20, 0.5), (0.90, 0.5))]
    try:
        known = tracking.Track("A", 0, {"x": 0.20, "y": 0.50, "number": 1, "slot": 1, "alive": True})
        known.add(10, {"x": 0.20, "y": 0.50, "number": 1, "slot": 1, "alive": True})
        blob = tracking.Track("A", 50, {"x": 0.80, "y": 0.50, "number": None, "slot": None, "alive": True})
        for k in range(51, 80):
            blob.add(k, {"x": 0.80, "y": 0.50, "number": None, "slot": None, "alive": True})
        assert not tracking._elimination_ok(blob, [known], 0.1)  # pastille sans numéro de l'autre îlot : seule une tyrolienne y mènerait
    finally:
        tracking._WALK.clear()
        tracking._TELEPORTS[:] = []
        tracking._ROUTES.clear()
