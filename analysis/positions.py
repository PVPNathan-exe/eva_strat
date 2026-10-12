"""Positions des joueurs d'une game : lecture de la minimap à cadence régulière, puis suivi global (tracking.py).

Chaque lecture donne des pastilles (équipe, position, numéro lu quand il est lisible, direction, vivant). Le suivi relie
ensuite ces pastilles dans le temps et attribue les slots 1 à 8 à l'ensemble de la game, ce qui corrige les numéros
illisibles, les croisements et les disparitions passagères.
"""

import numpy as np

import banners
import frame_noise
import minimap
import observed_name
import timer
import tracking

EVERY_FRAMES = 6  # une lecture de la minimap toutes les 6 images (5 par seconde à 30 i/s) : animation fluide
STEP_S = 0.2  # valeur de repli quand la cadence de la vidéo est inconnue


BATCH = 48  # images décodées d'avance et lues en parallèle
_templates = None
_walls = None  # traits de murs de la carte lue, posés une fois par processus de travail


def _init_worker(walls):
    global _walls
    _walls = walls
    _low_priority()


def _detect_one(args):
    """Pastilles d'une image (exécuté dans un processus de travail : les modèles de chiffres sont chargés une fois par processus).
    args = (image, indice du joueur observé d'après les bandeaux ou None)."""
    global _templates
    crop, hint = args
    if _templates is None:
        _templates = minimap.load_digit_templates()
    return [{k: v for k, v in m.items() if k != "glyph"} for m in minimap.find_markers(crop, _templates, hint, _walls)], minimap.coarse_colour_map(crop)


def hints_from_states(states):
    """[(équipe, numéro) du joueur observé, ou None] pour chaque image, d'après les bandeaux : une seule personne observée par image."""
    out = []
    for i in range(len(states)):
        watched = [s for s, v in states.get(i, {}).items() if v["spectated"]]
        out.append(("A" if watched[0] <= 4 else "B", tracking._number_of(watched[0])) if len(watched) == 1 else None)
    return out


MAX_WORKERS = 3  # volontairement bas : le PC reste utilisable pendant une analyse
WORKER_RAM_MB = 700  # mémoire comptée par processus de travail (Python + OpenCV + images en cours)
KEEP_FREE_RAM_MB = 3000  # mémoire laissée libre au système et aux autres applications


def _free_ram_mb():
    """Mémoire vive disponible en Mo (Windows), ou None si on ne peut pas la lire."""
    try:
        import ctypes

        class Status(ctypes.Structure):
            _fields_ = [(n, ctypes.c_ulonglong) for n in ("length_and_load", "total", "avail", "tpf", "apf", "tv", "av", "ave")]

        class Raw(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong),
                        ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong), ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]

        raw = Raw()
        raw.dwLength = ctypes.sizeof(Raw)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(raw))
        return raw.ullAvailPhys // (1024 * 1024)
    except Exception:  # noqa: BLE001 - lecture facultative
        return None


def _workers():
    """Nombre de processus de lecture : au plus MAX_WORKERS (ou EVA_WORKERS), jamais plus que la moitié des cœurs, et moins si la mémoire libre est juste."""
    import os

    wanted = int(os.environ.get("EVA_WORKERS", MAX_WORKERS))
    n = max(1, min(wanted, (os.cpu_count() or 2) // 2))
    free = _free_ram_mb()
    if free is not None:
        n = max(1, min(n, int((free - KEEP_FREE_RAM_MB) // WORKER_RAM_MB)))
    return n


def _low_priority():
    """Les processus de lecture passent après les autres applications."""
    try:
        import ctypes

        ctypes.windll.kernel32.SetPriorityClass(ctypes.windll.kernel32.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL_PRIORITY_CLASS
    except Exception:  # noqa: BLE001 - facultatif
        pass


def detect_frames(video, game, zone, width, height, emit=None, wait=None, step_s=STEP_S, workers=None):
    """Détections brutes de la minimap à cadence régulière : [(indice, t, [pastilles])], sans suivi (voir detect_frames_and_noise)."""
    return detect_frames_and_noise(video, game, zone, width, height, emit, wait, step_s, workers)[0]


def detect_frames_and_noise(video, game, zone, width, height, emit=None, wait=None, step_s=STEP_S, workers=None, hints=None, walls=None):
    """Détections brutes de la minimap à cadence régulière et contamination de couleur de chaque image : ([(indice, t, [pastilles])], [bruit par image]).
    Les images sont décodées par ffmpeg puis lues par plusieurs processus (une game de 4 minutes passe de quelques minutes à moins d'une)."""
    workers = _workers() if workers is None else workers
    global _walls
    _walls = walls
    frames, coarse = [], []
    hint_at = lambda t: (hints[min(int(round((t - game["start_s"]) / step_s)), len(hints) - 1)] if hints else None)  # indice d'image selon l'instant
    start, end = game["start_s"], game["end_s"]
    crops = timer.iter_crops(video, zone, width, height, step_s=step_s, t0=start, t1=end)

    def finish(batch, results):
        for (t, _), (detections, grid) in zip(batch, results):
            frames.append((len(frames), t, detections))
            coarse.append(grid)
        if emit and batch:
            emit(min(100, 100 * (batch[-1][0] - start) / max(end - start, 1)))

    if workers <= 1:
        for t, crop in crops:
            if wait:
                wait()
            finish([(t, crop)], [_detect_one((crop, hint_at(t)))])
        return frames, frame_noise.frame_noise(np.array(coarse), frames)
    from concurrent.futures import ProcessPoolExecutor

    with ProcessPoolExecutor(max_workers=workers, initializer=_init_worker, initargs=(walls,)) as pool:
        batch = []
        for t, crop in crops:
            batch.append((t, crop))
            if len(batch) >= BATCH:
                if wait:
                    wait()
                finish(batch, list(pool.map(_detect_one, [(c, hint_at(t)) for t, c in batch])))
                batch = []
        if batch:
            finish(batch, list(pool.map(_detect_one, [(c, hint_at(t)) for t, c in batch])))
    return frames, frame_noise.frame_noise(np.array(coarse), frames)


def detect_states(video, game, zone_a, zone_b, width, height, wait=None, step_s=STEP_S, players=None):
    """État des 8 joueurs lu sur les bandeaux à la même cadence que la minimap : {indice d'image: {slot: {"alive", "spectated"}}}.
    players ({slot: pseudo}, facultatif) : le pseudo affiché en bas à droite complète le cadre blanc quand il ne désigne personne (observed_name.py)."""
    states = {}
    start, end = game["start_s"], game["end_s"]
    crops_a = timer.iter_crops(video, zone_a, width, height, step_s=step_s, t0=start, t1=end)
    crops_b = timer.iter_crops(video, zone_b, width, height, step_s=step_s, t0=start, t1=end)
    for i, ((_, ca), (_, cb)) in enumerate(zip(crops_a, crops_b)):
        if wait:
            wait()
        states[i] = banners.read_states(ca, cb)
    if players:
        states, _ = observed_name.fuse_observed(states, observed_name.read_slots(video, game, players, width, height, step_s, wait))
    return states


def read_game(video, game, zone, width, height, emit=None, wait=None, step_s=STEP_S, deaths=None, bars=None, teleports=None, walk_points=None, walk_mask=None, spawns=None, walls=None, players=None, reliability=None, states_out=None, coherence_out=None):
    """Échantillons d'une game : liste de lignes (frame, t, slot, team, x, y, angle, alive, confiance).
    deaths : [(t, slot)] morts connues par le killfeed. bars : (zone du bandeau gauche, zone du bandeau droit) pour guider le suivi."""
    states = detect_states(video, game, bars[0], bars[1], width, height, wait, step_s, players) if bars else None
    if states_out is not None and states:
        states_out.update(states)  # l'appelant s'en sert pour le joueur observé et le contrôle à la minimap
    hints = hints_from_states(states) if states else None
    frames, noise = detect_frames_and_noise(video, game, zone, width, height, emit, wait, step_s, hints=hints, walls=walls)
    return tracking.solve(frames, step_s, deaths, states, teleports, walk_points, walk_mask, dict(enumerate(noise)), spawns, reliability, coherence_out)
