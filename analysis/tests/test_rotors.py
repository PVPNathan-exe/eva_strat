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


def test_the_ring_holes_cover_the_whole_graphic_band_of_each_ring():
    model = {**MODEL, "anneaux": [{**r, "trou_min": r["r_min"] - 0.02, "trou_max": r["r_max"] + 0.02} for r in MODEL["anneaux"]]}
    holes = rotors.hole_mask(model, (100, 200))
    assert holes[50 + int(0.20 * 100), 100] and holes[50, 100 + int(0.33 * 200 / 2)]  # sous le centre à 0,20 de hauteur (anneau intérieur) ; à droite à 0,33 (extérieur, largeur / aspect)
    assert not holes[50, 100] and not holes[50 + int(0.26 * 100), 100]  # centre et espace entre les anneaux : pas des trous
    assert holes.mean() < 0.4


def test_filling_steps_leave_the_holes_alone():
    import map_annotations
    plan = np.full((100, 200, 3), 40, np.uint8)
    plan[0:8, :] = 255
    plan[92:100, :] = 255
    plan[:, 0:8] = 255
    plan[:, 192:200] = 255
    labels = np.zeros((100, 200), np.uint8)
    labels[10:90, 10:60] = map_annotations.CODES["sol"]
    import plan_mask
    holes = np.zeros((100, 200), bool)
    holes[:, 100:140] = True  # un anneau : bande laissée en trou
    fill, _, _ = plan_mask.corrections(labels, map_annotations.CODES["sol"], plan, {"l": 0.0, "t": 0.0, "r": 0.0, "b": 0.0}, holes)
    assert fill[50, 80] and fill[50, 150] and not fill[50, 120]  # le sol manquant est ajouté, sauf dans le trou


def test_windows_let_the_sight_through_but_a_solid_arc_does_not():
    ring = {**MODEL["anneaux"][0], "fenetres": [[200.0, 10.0]]}  # fenêtre au milieu de l'arc plein 140 à 280 (à t_ref)
    model = {**MODEL, "anneaux": [ring, MODEL["anneaux"][1]]}
    t = 15.0
    assert rotors.blocks_sight(model, *point(0.20, 170.0), t) is True  # arc plein, hors fenêtre
    assert rotors.blocks_sight(model, *point(0.20, 200.0), t) is False  # dans la fenêtre : on voit à travers
    assert rotors.blocks_sight(model, *point(0.20, 120.0), t) is False  # dans une ouverture
    assert rotors.blocks_sight(model, *point(0.26, 170.0), t) is False  # entre les anneaux
    assert rotors.blocks_sight(model, *point(0.20, 200.0 + 3.0 * 10), 25.0) is True  # 10 s plus tard la fenêtre a tourné de -30 (anti-horaire) : 200 n'y est plus
    assert rotors.blocks_sight(model, *point(0.20, 170.0), 25.0) is False  # et 170 y est


def test_windows_are_read_from_the_lines_drawn_at_the_start_and_brought_back_to_t_ref():
    lines = [{"from": point(0.335, 40.0), "to": point(0.335, 50.0)}]  # trait de fenêtre de l'anneau extérieur : 40 à 50 degrés, dessiné 10 s avant t_ref
    got = rotors.windows_from_lines(MODEL, lines, 5.0)
    assert got["interieur"] == [] and len(got["exterieur"]) == 1
    centre, half = got["exterieur"][0]
    assert abs(centre - (45.0 + 3.0 * 10)) < 0.5 and abs(half - 5.0) < 0.5  # tourné de 3 degrés par seconde dans le sens horaire pendant 10 s
