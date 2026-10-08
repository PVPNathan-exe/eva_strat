"""Positions des joueurs d'une game : lecture de la minimap à cadence régulière, puis suivi global (tracking.py).

Chaque lecture donne des pastilles (équipe, position, numéro lu quand il est lisible, direction, vivant). Le suivi relie
ensuite ces pastilles dans le temps et attribue les slots 1 à 8 à l'ensemble de la game, ce qui corrige les numéros
illisibles, les croisements et les disparitions passagères.
"""

import minimap
import timer
import tracking

EVERY_FRAMES = 6  # une lecture de la minimap toutes les 6 images (5 par seconde à 30 i/s) : animation fluide
STEP_S = 0.2  # valeur de repli quand la cadence de la vidéo est inconnue


def read_game(video, game, zone, width, height, emit=None, wait=None, step_s=STEP_S):
    """Échantillons d'une game : liste de lignes (frame, t, slot, team, x, y, angle, alive, confiance)."""
    templates = minimap.load_digit_templates()
    frames = []
    start, end = game["start_s"], game["end_s"]
    for i, (t, crop) in enumerate(timer.iter_crops(video, zone, width, height, step_s=step_s, t0=start, t1=end)):
        if wait:
            wait()
        detections = [{k: v for k, v in m.items() if k != "glyph"} for m in minimap.find_markers(crop, templates)]
        frames.append((i, t, detections))
        if emit:
            emit(min(100, 100 * (t - start) / max(end - start, 1)))
    return tracking.solve(frames, step_s)
