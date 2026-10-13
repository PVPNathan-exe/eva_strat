"""Anneaux tournants d'Engine : vitesse mesurée sur des profils, arcs pleins à chaque instant, déplacement des positions peu sûres."""

import math

import numpy as np

import rotors
import tracking

MODEL = {
    "aspect": 2.0,
    "centre": [0.5, 0.5],
    "t_ref": 15.0,
    "t0": 1000.0,  # début de la game dans la vidéo
    "anneaux": [
        {"nom": "interieur", "r_min": 0.19, "r_max": 0.21, "omega": -3.0, "ouvertures": [[100.0, 140.0], [280.0, 320.0]]},
        {"nom": "exterieur", "r_min": 0.32, "r_max": 0.35, "omega": 3.0, "ouvertures": [[40.0, 75.0], [130.0, 165.0], [220.0, 255.0], [310.0, 345.0]]},
    ],
}


def point(ring_radius, angle):
    a = math.radians(angle)
    return 0.5 + ring_radius * math.cos(a) / MODEL["aspect"], 0.5 + ring_radius * math.sin(a)


def test_the_best_speed_aligns_rotating_profiles_and_gives_the_direction():
    base = np.zeros(rotors.BINS)
    base[100:180] = 10.0  # un arc plein et une ouverture
    base[400:430] = 10.0
    for omega in (3.0, -3.0, 0.0):
        profs = [rotors.rolled(base, omega * k / 5) for k in range(40)]  # 5 images par seconde
        speed, accord = rotors.best_speed(profs, 1 / 5)
        assert abs(speed - omega) < 0.1 and accord > 0.95


def test_a_point_is_in_a_solid_arc_only_inside_the_band_and_outside_the_openings():
    t = 15.0  # instant de référence
    assert rotors.solid_ring_at(MODEL, *point(0.20, 200.0), t) == "interieur"  # dans la bande, entre deux ouvertures
    assert rotors.solid_ring_at(MODEL, *point(0.20, 120.0), t) is None  # dans une ouverture
    assert rotors.solid_ring_at(MODEL, *point(0.26, 200.0), t) is None  # entre les deux anneaux
    assert rotors.solid_ring_at(MODEL, *point(0.335, 90.0), t) == "exterieur"  # entre deux ouvertures de l'extérieur
    assert rotors.solid_ring_at(MODEL, *point(0.335, 360.0 - 30.0), t) is None  # 330 : ouverture 310 à 345


def test_the_rings_turn_in_opposite_directions():
    # l'ouverture de l'anneau intérieur (100 à 140 degrés à t_ref) tourne dans le sens anti-horaire : 10 s plus tard elle est à 70 à 110 degrés
    assert rotors.solid_ring_at(MODEL, *point(0.20, 120.0), 25.0) == "interieur"  # 120 est maintenant hors de l'ouverture 70 à 110 (marge 4 : 114)
    assert rotors.solid_ring_at(MODEL, *point(0.20, 90.0), 25.0) is None
    # l'ouverture 40 à 75 de l'extérieur tourne dans le sens horaire : 10 s plus tard elle est à 70 à 105 degrés
    assert rotors.solid_ring_at(MODEL, *point(0.335, 90.0), 25.0) is None
    assert rotors.solid_ring_at(MODEL, *point(0.335, 50.0), 25.0) == "exterieur"


def test_a_point_in_a_wall_is_moved_to_the_nearest_opening_edge_at_the_same_radius():
    t = 15.0
    x, y = point(0.20, 200.0)  # arc plein de l'intérieur : l'ouverture la plus proche est 280 à 320 (bord 280, à 80 degrés) ou 100 à 140 (bord 140, à 60 degrés)
    nx, ny = rotors.snap_point(MODEL, x, y, t)
    angle, dist = rotors.angle_deg(MODEL, nx, ny)
    assert abs(dist - 0.20) < 1e-6 and abs(angle - 139.0) < 0.01  # bord 140, 1 degré à l'intérieur
    assert rotors.solid_ring_at(MODEL, nx, ny, t) is None
    assert rotors.snap_point(MODEL, *point(0.20, 120.0), t) is None  # déjà dans une ouverture : rien à faire


def row(frame, slot, x, y, conf, t):
    return (frame, t, slot, "A", x, y, 0.0, 1, conf)


def test_the_tracking_moves_only_unsure_positions_out_of_the_walls():
    t = 1000.0 + 15.0  # début de game 1000 s, t_ref 15 s
    wall = point(0.20, 200.0)
    rows = {(0, 1): row(0, 1, *wall, 0.3, t), (0, 2): row(0, 2, *wall, 0.9, t), (0, 3): row(0, 3, *point(0.20, 120.0), 0.3, t)}
    assert tracking.rotor_snap(rows, MODEL) == 1
    assert rows[(0, 2)][4:6] == wall  # une lecture sûre ne bouge pas
    assert rows[(0, 3)][4:6] == point(0.20, 120.0)  # une position dans une ouverture est gardée
    assert rows[(0, 1)][4:6] != wall
    assert tracking.rotor_snap({(0, 1): row(0, 1, *wall, 0.3, t)}, None) == 0  # sans anneaux (autre carte) : rien
