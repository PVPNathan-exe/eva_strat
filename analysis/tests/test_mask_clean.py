"""Nettoyage des masques praticables."""

import numpy as np

import mask_clean


def _floor():
    walk = np.zeros((100, 100), bool)
    walk[20:80, 20:80] = True  # un grand sol
    return walk


def test_tiny_specks_and_tiny_holes_are_removed_but_big_shapes_stay():
    walk = _floor()
    walk[5:8, 5:8] = True  # tache de 9 pixels hors du sol : retirée
    walk[40:43, 40:43] = False  # trou de 9 pixels dans le sol : rebouché
    walk[50:60, 50:60] = False  # vrai obstacle de 100 pixels : gardé
    walk[90:95, 90:98] = True  # tache de 40 pixels : gardée (seuil atteint)
    out = mask_clean.clean(walk)
    assert not out[6, 6] and out[41, 41] and not out[55, 55] and out[92, 93]


def test_a_thin_wall_line_and_a_thin_corridor_survive():
    walk = _floor()
    walk[30:70, 49:51] = False  # mur de 2 pixels de large
    walk[10:20, 30:33] = True  # couloir de 3 pixels qui touche le sol
    out = mask_clean.clean(walk)
    assert not out[50, 49] and not out[50, 50] and out[15, 31]


def test_a_small_patch_that_holds_sure_reads_is_kept():
    walk = _floor()
    walk[5:8, 5:8] = True
    reads = np.array([[0.06, 0.06], [0.065, 0.06], [0.06, 0.065]])  # 3 lectures sûres sur la tache
    assert mask_clean.clean(walk, reads=reads)[6, 6]
    assert not mask_clean.clean(walk, reads=reads[:2])[6, 6]  # deux ne suffisent pas


def test_protected_pixels_are_left_as_they_were():
    walk = _floor()
    walk[40:43, 40:43] = False
    protect = np.zeros_like(walk)
    protect[40:43, 40:43] = True
    assert not mask_clean.clean(walk, protect=protect)[41, 41]


def test_refused_share_counts_reads_outside_the_walkable_area():
    walk = _floor()
    reads = np.array([[0.5, 0.5], [0.05, 0.05], [0.6, 0.6], [0.95, 0.95]])
    assert mask_clean.refused_share(walk, reads) == 0.5
    assert mask_clean.refused_share(walk, np.zeros((0, 2))) == 0.0
