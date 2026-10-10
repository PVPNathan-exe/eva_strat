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


BATCH = 48  # images décodées d'avance et lues en parallèle
_templates = None


def _detect_one(crop):
    """Pastilles d'une image (exécuté dans un processus de travail : les modèles de chiffres sont chargés une fois par processus)."""
    global _templates
    if _templates is None:
        _templates = minimap.load_digit_templates()
    return [{k: v for k, v in m.items() if k != "glyph"} for m in minimap.find_markers(crop, _templates)]


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
    """Détections brutes de la minimap à cadence régulière : [(indice, t, [pastilles])], sans suivi.
    Les images sont décodées par ffmpeg puis lues par plusieurs processus (une game de 4 minutes passe de quelques minutes à moins d'une)."""
    workers = _workers() if workers is None else workers
    frames = []
    start, end = game["start_s"], game["end_s"]
    crops = timer.iter_crops(video, zone, width, height, step_s=step_s, t0=start, t1=end)

    def finish(batch, results):
        for (t, _), detections in zip(batch, results):
            frames.append((len(frames), t, detections))
        if emit and batch:
            emit(min(100, 100 * (batch[-1][0] - start) / max(end - start, 1)))

    if workers <= 1:
        for t, crop in crops:
            if wait:
                wait()
            finish([(t, crop)], [_detect_one(crop)])
        return frames
    from concurrent.futures import ProcessPoolExecutor

    with ProcessPoolExecutor(max_workers=workers, initializer=_low_priority) as pool:
        batch = []
        for t, crop in crops:
            batch.append((t, crop))
            if len(batch) >= BATCH:
                if wait:
                    wait()
                finish(batch, list(pool.map(_detect_one, [c for _, c in batch])))
                batch = []
        if batch:
            finish(batch, list(pool.map(_detect_one, [c for _, c in batch])))
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


def read_game(video, game, zone, width, height, emit=None, wait=None, step_s=STEP_S, deaths=None, bars=None, teleports=None, walk_points=None):
    """Échantillons d'une game : liste de lignes (frame, t, slot, team, x, y, angle, alive, confiance).
    deaths : [(t, slot)] morts connues par le killfeed. bars : (zone du bandeau gauche, zone du bandeau droit) pour guider le suivi."""
    states = detect_states(video, game, bars[0], bars[1], width, height, wait, step_s) if bars else None
    return tracking.solve(detect_frames(video, game, zone, width, height, emit, wait, step_s), step_s, deaths, states, teleports, walk_points)
