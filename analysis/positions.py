"""Positions des joueurs d'une game : lecture de la minimap à cadence régulière, puis suivi global (tracking.py).

Chaque lecture donne des pastilles (équipe, position, numéro lu quand il est lisible, direction, vivant). Le suivi relie
ensuite ces pastilles dans le temps et attribue les slots 1 à 8 à l'ensemble de la game, ce qui corrige les numéros
illisibles, les croisements et les disparitions passagères.
"""

import banners
import minimap
import timer
import tracking

EVERY_FRAMES = 6  # une lecture de la minimap toutes les 6 images (5 par seconde à 30 i/s) : animation fluide
STEP_S = 0.2  # valeur de repli quand la cadence de la vidéo est inconnue


def detect_frames(video, game, zone, width, height, emit=None, wait=None, step_s=STEP_S):
    """Détections brutes de la minimap à cadence régulière : [(indice, t, [pastilles])], sans suivi."""
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
    return frames


def detect_states(video, game, zone_a, zone_b, width, height, wait=None, step_s=STEP_S):
    """État des 8 joueurs lu sur les bandeaux à la même cadence que la minimap : {indice d'image: {slot: {"alive", "spectated"}}}."""
    states = {}
    start, end = game["start_s"], game["end_s"]
    crops_a = timer.iter_crops(video, zone_a, width, height, step_s=step_s, t0=start, t1=end)
    crops_b = timer.iter_crops(video, zone_b, width, height, step_s=step_s, t0=start, t1=end)
    for i, ((_, ca), (_, cb)) in enumerate(zip(crops_a, crops_b)):
        if wait:
            wait()
        states[i] = banners.read_states(ca, cb)
    return states


def read_game(video, game, zone, width, height, emit=None, wait=None, step_s=STEP_S, deaths=None, bars=None):
    """Échantillons d'une game : liste de lignes (frame, t, slot, team, x, y, angle, alive, confiance).
    deaths : [(t, slot)] morts connues par le killfeed. bars : (zone du bandeau gauche, zone du bandeau droit) pour guider le suivi."""
    states = detect_states(video, game, bars[0], bars[1], width, height, wait, step_s) if bars else None
    return tracking.solve(detect_frames(video, game, zone, width, height, emit, wait, step_s), step_s, deaths, states)
