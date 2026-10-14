"""Outils communs aux épisodes de retake et de rotation (retakes.py, rotations.py) : chargement d'une game, positions, vivants, distances au point, fenêtres.

Temps : secondes depuis le début de la game (les `samples`, `kills` et `capture_state` sont en temps de vidéo : on retranche `games.start_s`). Positions en fractions de la minimap,
distances en mètres (`ARENA_M`). Un point est un cadre (x0, y0, x1, y1) en fractions de la minimap ; la distance à un point est la distance au cadre (0 dedans).
- Cartes à un seul point : le cadre vient de `map_capture.json` (point `A`, toute la game) ;
- Outlaw : une boîte active à la fois (`capture_boxes`), chaque boîte vue est une « instance » de son point (le même point revient plusieurs fois dans une game) ;
- Atlantis et Engine : pas de `point_owner` (voir CLAUDE.md), donc aucun épisode.
Les `lives` sont lues dans la table ; si la table est vide pour cette game, elles sont reconstruites en mémoire par `lives.build` (même règle)."""

import bisect
import math

ARENA_M = (31.0, 16.5)  # largeur et hauteur de la minimap en mètres
POS_GAP_S = 1.5  # une position est lue sur la ligne vivante la plus proche, à 1,5 s au plus
TEAMS = ("A", "B")
VERDICT_MATCH_S = 3.0  # un épisode recalculé reprend le verdict d'un ancien du même point et de la même équipe dont le début est à 3 s au plus


def team_of(slot):
    return "A" if slot <= 4 else "B"


def other_team(team):
    return "B" if team == "A" else "A"


def team_slots(team):
    return range(1, 5) if team == "A" else range(5, 9)


def mmss(t):
    """Texte m:ss d'un instant en secondes."""
    t = max(0, int(round(t)))
    return f"{t // 60}:{t % 60:02d}"


# ---------------------------------------------------------------- distances

def dist_m(p, q):
    """Distance en mètres entre deux positions (fractions), None si l'une manque."""
    if p is None or q is None:
        return None
    return math.hypot((p[0] - q[0]) * ARENA_M[0], (p[1] - q[1]) * ARENA_M[1])


def dist_rect_m(p, rect):
    """Distance en mètres d'une position au cadre d'un point (0 à l'intérieur), None si la position manque."""
    if p is None:
        return None
    dx = max(rect[0] - p[0], 0.0, p[0] - rect[2]) * ARENA_M[0]
    dy = max(rect[1] - p[1], 0.0, p[1] - rect[3]) * ARENA_M[1]
    return math.hypot(dx, dy)


def rect_center(rect):
    return ((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2)


# ---------------------------------------------------------------- chargement

def _rect_of_box(b):
    """Cadre (x0, y0, x1, y1) d'une boîte lue (t0, t1, centre x, y, taille w, h, point)."""
    return (b[2] - b[4] / 2, b[3] - b[5] / 2, b[2] + b[4] / 2, b[3] + b[5] / 2)


def load_instances(conn, game_id, map_name, duration):
    """Instances de points : [{point, t0, t1, rect}] triées. Une seule pour une carte à un point (toute la game), une par boîte vue pour Outlaw, aucune pour les autres cartes."""
    import point_owner

    if map_name == point_owner.OUTLAW:
        boxes = conn.execute("SELECT t0, t1, x, y, w, h, point FROM capture_boxes WHERE game_id = ? ORDER BY t0", (game_id,)).fetchall()
        return [{"point": b[6], "t0": b[0], "t1": b[1], "rect": _rect_of_box(b)} for b in boxes if b[6]]
    if map_name in point_owner.MULTI_POINT_MAPS:
        return []
    rects = point_owner.point_rects(map_name)
    if len(rects) != 1:
        return []
    (letter, rect), = rects.items()
    return [{"point": letter, "t0": 0.0, "t1": duration, "rect": rect}]


def load_owners(conn, game_id):
    """Segments de `point_owner` : {point: [(t0, t1, owner)]} triés par temps."""
    out = {}
    for r in conn.execute("SELECT point, t0, t1, owner FROM point_owner WHERE game_id = ? ORDER BY point, t0", (game_id,)):
        out.setdefault(r[0], []).append((r[1], r[2], r[3]))
    return out


def load_lives(conn, game_id, rows, kills, duration):
    """{slot: [{t0, t1, x0, y0, x1, y1, ended, killer_slot}]} depuis la table `lives`, sinon reconstruites en mémoire."""
    out = {}
    for r in conn.execute("SELECT slot, t0, t1, x0, y0, x1, y1, ended, killer_slot FROM lives WHERE game_id = ? ORDER BY slot, idx", (game_id,)):
        out.setdefault(r[0], []).append({"t0": r[1], "t1": r[2], "x0": r[3], "y0": r[4], "x1": r[5], "y1": r[6], "ended": r[7], "killer_slot": r[8]})
    if out:
        return out
    import lives

    return lives.build(rows, kills, duration)[0]


def load_game(conn, game_id):
    """Tout ce qu'il faut pour chercher des épisodes dans une game : None si la game n'existe pas. Clés : id, map, start, duration, tracks, lives, kills, instances, owners.
    tracks : {slot: (temps, positions)} des lignes vivantes avec une position ; kills : [(t, tueur, victime)] avec un tueur d'une autre équipe."""
    import lives as lives_mod

    g = conn.execute("SELECT map, start_s, end_s FROM games WHERE id = ?", (game_id,)).fetchone()
    if g is None:
        return None
    start, duration, rows, kills = lives_mod.read_rows(conn, game_id)
    tracks = {}
    for slot, items in rows.items():
        pts = [r for r in items if r[1] and r[2] is not None]
        tracks[slot] = ([r[0] for r in pts], [(r[2], r[3]) for r in pts])
    return {
        "id": game_id, "map": g[0], "start": start, "duration": duration, "tracks": tracks,
        "lives": load_lives(conn, game_id, rows, kills, duration),
        "kills": [k for k in kills if k[1] is not None and k[1] != k[2] and team_of(k[1]) != team_of(k[2])],
        "instances": load_instances(conn, game_id, g[0], duration),
        "owners": load_owners(conn, game_id),
    }


# ---------------------------------------------------------------- positions et vivants

def pos_at(game, slot, t, max_gap=POS_GAP_S):
    """Position du joueur à l'instant t (ligne vivante la plus proche, à max_gap au plus), sinon None."""
    times, pos = game["tracks"].get(slot, ([], []))
    if not times:
        return None
    i = bisect.bisect_left(times, t)
    best = min((j for j in (i - 1, i) if 0 <= j < len(times)), key=lambda j: abs(times[j] - t))
    return pos[best] if abs(times[best] - t) <= max_gap else None


def life_at(game, slot, t):
    """Vie du joueur qui contient l'instant t (de son apparition à sa mort), sinon None."""
    for v in game["lives"].get(slot, []):
        if v["t0"] - 1e-6 <= t <= v["t1"] + 1e-6:
            return v
    return None


def alive_at(game, slot, t):
    return life_at(game, slot, t) is not None


def death_time(game, slot, t, within):
    """Instant de la mort du joueur si une vie qui se termine par une mort finit entre t et t + within, sinon None."""
    for v in game["lives"].get(slot, []):
        if v["ended"] == "death" and t - 1e-6 <= v["t1"] <= t + within + 1e-6:
            return v["t1"]
    return None


def team_near(game, team, rect, t, radius):
    """Joueurs vivants de l'équipe à moins de `radius` mètres du cadre à l'instant t : [(slot, distance)] triés par distance."""
    out = []
    for slot in team_slots(team):
        if not alive_at(game, slot, t):
            continue
        d = dist_rect_m(pos_at(game, slot, t), rect)
        if d is not None and d <= radius:
            out.append((slot, d))
    return sorted(out, key=lambda s: s[1])


# ---------------------------------------------------------------- fenêtres

def clip_window(t_change, before, after, others, duration):
    """Fenêtre [t_change - before, t_change + after] coupée aux autres instants de changement (le plus proche avant, le plus proche après) et aux bornes de la game."""
    lo, hi = max(0.0, t_change - before), min(duration, t_change + after)
    for o in others:
        if o < t_change - 1e-6:
            lo = max(lo, o)
        elif o > t_change + 1e-6:
            hi = min(hi, o)
    return round(lo, 2), round(hi, 2)


# ---------------------------------------------------------------- écriture

def write_episodes(conn, game_id, kind, episodes, module, revision):
    """Efface les épisodes de ce type pour cette game puis écrit les nouveaux ; écrit stats_meta. Renvoie le nombre d'épisodes.
    Les verdicts posés par l'utilisateur sont conservés : un nouvel épisode du même point et de la même équipe, dont le début est à VERDICT_MATCH_S d'un ancien, reprend son verdict."""
    import json

    old = [(r[0], r[1], r[2], r[3]) for r in conn.execute("SELECT point, team, t0, verdict FROM episodes WHERE game_id = ? AND kind = ? AND verdict IS NOT NULL", (game_id, kind))]
    conn.execute("DELETE FROM episodes WHERE game_id = ? AND kind = ?", (game_id, kind))
    for e in episodes:
        verdict = next((v for p, team, t0, v in old if p == e["point"] and team == e["team"] and abs(t0 - e["t0"]) <= VERDICT_MATCH_S), None)
        conn.execute(
            "INSERT INTO episodes (game_id, kind, point, point_to, team, t0, t1, outcome, data, verdict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (game_id, kind, e["point"], e.get("point_to"), e["team"], e["t0"], e["t1"], e["outcome"], json.dumps(e["data"], ensure_ascii=False), verdict),
        )
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, module, revision))
    conn.commit()
    return len(episodes)
