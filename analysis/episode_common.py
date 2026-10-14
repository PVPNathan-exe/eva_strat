"""Outils communs aux épisodes de retake, de série de kills et de rotation (retakes.py, kill_series.py, rotations.py) : chargement d'une game, positions, vivants, distances au point, fenêtres, photos d'équipe.

Temps : secondes depuis le début de la game (les `samples`, `kills` et `capture_state` sont en temps de vidéo : on retranche `games.start_s`). Positions en fractions de la minimap,
distances en mètres (`ARENA_M`). Un point est un cadre (x0, y0, x1, y1) en fractions de la minimap ; la distance à un point est la distance au cadre (0 dedans).
- Cartes à un seul point : le cadre vient de `map_capture.json` (point `A`, toute la game) ;
- Outlaw : un seul point actif à la fois. Calendrier (`load_schedule`) : table `point_active` si elle a des lignes pour la game (lue par le HUD), sinon les boîtes vues (`capture_boxes`) ;
  chaque segment est une « instance » de son point (le même point revient plusieurs fois dans une game) ;
- Atlantis et Engine : un épisode seulement si `point_owner` a des lignes pour la game (instances : un point par lettre, toute la game), un calendrier seulement si `point_active` en a ;
  sinon aucun épisode.
Les `lives` sont lues dans la table ; si la table est vide pour cette game, elles sont reconstruites en mémoire par `lives.build` (même règle)."""

import bisect
import json
import math
import sqlite3
from pathlib import Path

ARENA_M = (31.0, 16.5)  # largeur et hauteur de la minimap en mètres
POS_GAP_S = 1.5  # une position est lue sur la ligne vivante la plus proche, à 1,5 s au plus
TEAMS = ("A", "B")
VERDICT_MATCH_S = 3.0  # un épisode recalculé reprend le verdict d'un ancien du même point et de la même équipe dont le début est à 3 s au plus
STEP_S = 0.5  # pas de balayage des positions
MERGE_GAP_S = 6.0  # deux segments du même point séparés de moins de 6 s sont un seul segment (boîte perdue un instant, clignotement du HUD)
POINTS_FILE = Path(__file__).resolve().parent / "map_capture_points.json"  # cadres des 5 points d'Outlaw (boîtes vues)


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


def map_point_rects(map_name):
    """Cadres des points d'une carte : {lettre: cadre}. Outlaw : boîtes vues (map_capture_points.json), les autres : polygones tracés (map_capture.json)."""
    import point_owner

    if map_name == point_owner.OUTLAW:
        pts = json.loads(POINTS_FILE.read_text(encoding="utf-8")).get(map_name, {}).get("points", {})
        return {k: (v["x"] - v["w"] / 2, v["y"] - v["h"] / 2, v["x"] + v["w"] / 2, v["y"] + v["h"] / 2) for k, v in pts.items()}
    return point_owner.point_rects(map_name)


def _merge_segments(segs):
    """Segments triés [{point, t0, t1, rect, source}] : deux segments consécutifs du même point à moins de MERGE_GAP_S sont fondus."""
    out = []
    for s in sorted(segs, key=lambda x: x["t0"]):
        if out and out[-1]["point"] == s["point"] and s["t0"] - out[-1]["t1"] <= MERGE_GAP_S:
            out[-1]["t1"] = max(out[-1]["t1"], s["t1"])
        else:
            out.append(dict(s))
    return out


def load_schedule(conn, game_id, map_name, duration):
    """Calendrier du point actif : [{point, t0, t1, rect, source}] triés. `point_active` d'abord (source hud, box ou schedule), sinon, sur Outlaw, les boîtes de `capture_boxes` (source box).
    Le cadre vient de la boîte vue du même point qui recouvre le segment, sinon du cadre de la carte. Une carte sans calendrier (un seul point, ou à plusieurs points sans lecture) : liste vide."""
    import point_owner

    boxes = [b for b in conn.execute("SELECT t0, t1, x, y, w, h, point FROM capture_boxes WHERE game_id = ? ORDER BY t0", (game_id,)).fetchall() if b[6]]
    try:
        active = conn.execute("SELECT point, t0, t1, source FROM point_active WHERE game_id = ? ORDER BY t0", (game_id,)).fetchall()
    except sqlite3.OperationalError:  # base sans la table (très ancienne copie)
        active = []
    rects = map_point_rects(map_name)
    if active:
        segs = []
        for point, t0, t1, source in active:
            seen = [b for b in boxes if b[6] == point and b[0] < t1 and b[1] > t0]
            rect = _rect_of_box(max(seen, key=lambda b: min(b[1], t1) - max(b[0], t0))) if seen else rects.get(point)
            if rect is not None:
                segs.append({"point": point, "t0": t0, "t1": t1, "rect": rect, "source": source or "hud"})
        return _merge_segments(segs)
    if map_name == point_owner.OUTLAW:
        return _merge_segments([{"point": b[6], "t0": b[0], "t1": b[1], "rect": _rect_of_box(b), "source": "box"} for b in boxes])
    return []


def load_instances(conn, game_id, map_name, duration):
    """Instances de points pour les retakes : [{point, t0, t1, rect}] triées. Une seule pour une carte à un point (toute la game), une par segment du calendrier pour Outlaw,
    un point par lettre (toute la game) pour Atlantis et Engine si `point_owner` a des lignes pour la game, sinon aucune."""
    import point_owner

    if map_name == point_owner.OUTLAW:
        return [{"point": s["point"], "t0": s["t0"], "t1": s["t1"], "rect": s["rect"]} for s in load_schedule(conn, game_id, map_name, duration)]
    rects = point_owner.point_rects(map_name)
    if map_name in point_owner.MULTI_POINT_MAPS:
        letters = sorted({r[0] for r in conn.execute("SELECT point FROM point_owner WHERE game_id = ?", (game_id,))})
        return [{"point": p, "t0": 0.0, "t1": duration, "rect": rects[p]} for p in letters if p in rects]
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
    """Tout ce qu'il faut pour chercher des épisodes dans une game : None si la game n'existe pas. Clés : id, map, start, duration, tracks, lives, kills, instances, schedule, owners.
    tracks : {slot: (temps, positions)} des lignes vivantes avec une position ; kills : [(t, tueur, victime, arme, genre)] avec un tueur d'une autre équipe ;
    schedule : calendrier du point actif (load_schedule, vide hors Outlaw sans `point_active`)."""
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
        "schedule": load_schedule(conn, game_id, g[0], duration),
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


def centroid(game, team, t):
    """Centre des positions des joueurs vivants de l'équipe à l'instant t (fractions), None si aucune position."""
    pts = [p for s in team_slots(team) if alive_at(game, s, t) for p in [pos_at(game, s, t)] if p is not None]
    if not pts:
        return None
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def snapshot(game, team, t, rects, radius):
    """Photo d'une équipe à l'instant t : {alive, centroid, players: [{slot, pos, d: {nom: distance en m}}], near: {nom: joueurs à moins de `radius` m}}.
    `rects` : {nom: cadre} (par exemple l'ancien et le nouveau point d'une rotation)."""
    players, near = [], {name: 0 for name in rects}
    alive = 0
    for slot in team_slots(team):
        if not alive_at(game, slot, t):
            continue
        alive += 1
        p = pos_at(game, slot, t)
        if p is None:
            continue
        d = {name: dist_rect_m(p, r) for name, r in rects.items()}
        for name, v in d.items():
            if v is not None and v <= radius:
                near[name] += 1
        players.append({"slot": slot, "pos": [round(p[0], 4), round(p[1], 4)], "d": {name: round(v, 1) for name, v in d.items()}})
    c = centroid(game, team, t)
    return {"alive": alive, "centroid": None if c is None else [round(c[0], 4), round(c[1], 4)], "players": players, "near": near}


def presence_series(game, team, rect, lo, hi, radius, step=STEP_S):
    """[(t, nombre de joueurs vivants de l'équipe à moins de `radius` m du cadre)] de lo à hi."""
    out, t = [], lo
    while t <= hi + 1e-9:
        out.append((round(t, 3), len(team_near(game, team, rect, t, radius))))
        t += step
    return out


def sustained_runs(series, min_n, min_s, step=STEP_S):
    """Périodes [(début, fin)] où la présence est d'au moins `min_n` joueurs pendant au moins `min_s` secondes de suite (fin = dernier instant vrai)."""
    runs, start, prev = [], None, None
    for t, n in series + [(None, 0)]:
        if n >= min_n:
            start = t if start is None else start
            prev = t
        elif start is not None:
            if prev - start + step >= min_s:
                runs.append((start, prev))
            start = None
    return runs


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

def _family(outcome):
    """Les épisodes de série de kills (outcome `series_...`) ne reprennent que le verdict d'une série, jamais celui d'un retake de changement de propriétaire."""
    return "series" if (outcome or "").startswith("series_") else "other"


def write_episodes(conn, game_id, kind, episodes, module, revision):
    """Efface les épisodes de ce type pour cette game puis écrit les nouveaux ; écrit stats_meta. Renvoie le nombre d'épisodes.
    Les verdicts posés par l'utilisateur sont conservés : un nouvel épisode du même point et de la même équipe (et de la même famille), dont le début est à VERDICT_MATCH_S d'un ancien, reprend son verdict."""
    old = [tuple(r) for r in conn.execute("SELECT point, team, t0, verdict, outcome FROM episodes WHERE game_id = ? AND kind = ? AND verdict IS NOT NULL", (game_id, kind))]
    conn.execute("DELETE FROM episodes WHERE game_id = ? AND kind = ?", (game_id, kind))
    for e in episodes:
        verdict = next((v for p, team, t0, v, o in old if p == e["point"] and team == e["team"] and abs(t0 - e["t0"]) <= VERDICT_MATCH_S and _family(o) == _family(e["outcome"])), None)
        conn.execute(
            "INSERT INTO episodes (game_id, kind, point, point_to, team, t0, t1, outcome, data, verdict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (game_id, kind, e["point"], e.get("point_to"), e["team"], e["t0"], e["t1"], e["outcome"], json.dumps(e["data"], ensure_ascii=False), verdict),
        )
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, module, revision))
    conn.commit()
    return len(episodes)
