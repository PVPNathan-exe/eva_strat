"""Découpage en games à partir des lectures du chrono (une lecture par seconde environ).

Une game est une suite de lectures dont le chrono ne fait que descendre. Le chrono reste figé à sa valeur de départ
pendant le compte à rebours, puis décroît d'une seconde par seconde : le début de la game est l'instant où il quitte
cette valeur (qui varie selon la carte et le mode, d'où l'absence de valeur codée en dur).
Tout ce qui est estimé plutôt que mesuré devient une « zone à vérifier » que l'utilisateur peut corriger.
"""

from statistics import median

PRE_ROLL_S = 3.0  # secondes gardées avant le départ du chrono (compte à rebours)
POST_ROLL_S = 1.0  # secondes gardées après la dernière lecture du chrono (écran de victoire)
MIN_GAME_S = 20.0
MIN_READINGS = 5
JUMP_UP_S = 5  # le chrono remonte de plus que ça : nouvelle game
UNREADABLE_DOUBT_S = 5.0
FROZEN_DOUBT_READINGS = 5
EARLY_END_S = 5  # chrono restant au-delà duquel la fin est à vérifier


def fmt(seconds):
    s = int(max(0, seconds))
    return f"{s // 60}:{s % 60:02d}"


def _drop_outliers(readings):
    """Retire les lectures isolées incohérentes avec leurs deux voisines (chiffre mal lu)."""
    kept = []
    for i, (t, v) in enumerate(readings):
        if 0 < i < len(readings) - 1:
            before, after = readings[i - 1][1], readings[i + 1][1]
            if before >= after and not (after - 2 <= v <= before + 2):
                continue
        kept.append((t, v))
    return kept


def _split(readings, gap_s):
    groups, gap_doubts = [], []
    current, doubts = [], []
    for t, v in readings:
        if current:
            pt, pv = current[-1]
            gap = t - pt
            jump_up = v > pv + JUMP_UP_S
            long_gap = gap > gap_s
            consistent = abs((pv - v) - gap) <= 3
            if jump_up or (long_gap and not consistent):
                groups.append((current, doubts))
                current, doubts = [], []
            elif gap >= UNREADABLE_DOUBT_S + 1:
                doubts.append({"start_s": pt, "end_s": t, "label": "Chrono illisible sur cette zone"})
        current.append((t, v))
    if current:
        groups.append((current, doubts))
    return groups


def _build_game(group, doubts, duration, pre_roll, post_roll):
    t_first, v_first = group[0]
    t_last, v_last = group[-1]
    doubts = list(doubts)

    plateau = 0
    while plateau < len(group) and group[plateau][1] == v_first:
        plateau += 1
    if plateau >= 2 and plateau < len(group):
        # Compte à rebours vu : on retrouve l'instant où le chrono a quitté sa valeur de départ.
        starts = [t - (v_first - v) for t, v in group[plateau : plateau + 10]]
        origin = median(starts) - 0.5
        start = max(0.0, origin - pre_roll)
    else:
        start = max(0.0, t_first - pre_roll)
        doubts.append(
            {
                "start_s": max(0.0, t_first - 30),
                "end_s": t_first + 5,
                "label": f"Début estimé : le chrono était déjà à {fmt(v_first)} quand la game est apparue",
            }
        )

    # Chrono figé en pleine game (pause ?).
    run_start = None
    for i in range(plateau, len(group) + 1):
        same = i < len(group) and i > 0 and group[i][1] == group[i - 1][1]
        if same and run_start is None:
            run_start = i - 1
        if not same and run_start is not None:
            if i - run_start >= FROZEN_DOUBT_READINGS:
                doubts.append(
                    {"start_s": group[run_start][0], "end_s": group[i - 1][0], "label": f"Chrono figé à {fmt(group[run_start][1])} (pause ?)"}
                )
            run_start = None

    end = min(duration, t_last + 1 + post_roll)
    if t_last + 2 >= duration and v_last > EARLY_END_S:
        doubts.append({"start_s": max(start, t_last - 10), "end_s": end, "label": f"La vidéo s'arrête avant la fin de la game (chrono à {fmt(v_last)})"})
    elif v_last > EARLY_END_S:
        doubts.append({"start_s": max(start, t_last - 5), "end_s": end, "label": f"Fin à vérifier : chrono arrêté à {fmt(v_last)}"})
    return {"start_s": start, "end_s": end, "doubts": doubts}


def detect_games(samples, duration, pre_roll=PRE_ROLL_S, post_roll=POST_ROLL_S, gap_s=30.0):
    """samples : liste de (t, secondes restantes ou None), triée par t. Renvoie les games détectées avec leurs doutes."""
    readings = _drop_outliers([(t, v) for t, v in samples if v is not None])
    games = []
    for group, doubts in _split(readings, gap_s):
        if len(group) < MIN_READINGS or group[-1][0] - group[0][0] < MIN_GAME_S:
            continue
        games.append(_build_game(group, doubts, duration, pre_roll, post_roll))
    return games
