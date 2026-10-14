"""Propriétaire de chaque point de capture au cours d'une game (table point_owner) : `python analysis/point_owner.py --game N [--db chemin]`.

Sur la minimap, le point de capture est une boîte : grise tant que personne ne l'a prise (`none`), orange (équipe A) ou bleue (équipe B) une fois prise. On la lit environ une fois par seconde
(une image de la minimap par seconde, `timer.iter_crops`) en comptant les pixels de chaque couleur dans le cadre de la boîte ; les pastilles de joueurs qui passent dessus ne couvrent qu'une
petite part du cadre, la couleur majoritaire l'emporte. Où est le cadre :
- cartes à un seul point (`map_capture.json`, un polygone) : le rectangle englobant du polygone, point nommé `A` ;
- Outlaw (un point actif à la fois, qui change toutes les 1 min 30) : la boîte vue sur la minimap par `capture_points.py` (table `capture_boxes`, lecture seule), point nommé par sa lettre (A à E) ;
- Atlantis et Engine (trois points) : non calculés (voir MULTI_POINT_MAPS), la faisabilité est mesurée mais pas branchée.

La pente des scores (`capture_state`, `score_A` et `score_B`) sert de deuxième témoin : l'équipe dont le score monte tient le point. Elle comble les secondes où la boîte n'est pas lisible
(source `score`) et se compare à la boîte (`agreement`). Elle ne sait pas dire « personne » (un score qui ne monte pas peut aussi être à 100 % ou en pause) et retarde de 2 s environ sur la couleur.

Temps : secondes depuis le début de la game (la table capture_state est en secondes de la vidéo, on retranche `start_s`). Un segment [t0, t1[ garde le même propriétaire.
Contrat commun des modules Stats : `compute(conn, game_id) -> int` (idempotent, renvoie le nombre de segments) et `stats_meta` (module `point_owner`, révision REVISION)."""

import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import paths

MODULE = "point_owner"
REVISION = 1
HERE = Path(__file__).parent
CAPTURE = HERE / "map_capture.json"  # zones des points de capture tracées à la main (polygones, fractions de la minimap), une par point
MULTI_POINT_MAPS = {"Atlantis", "Engine"}  # trois points : faisabilité mesurée (docstring), non branchée tant que le chef de chantier n'a pas décidé
OUTLAW = "Outlaw"
STEP_S = 1.0  # une image de la minimap par seconde
SHRINK = 0.12  # part du cadre retirée de chaque côté (liseré de la boîte et fond de la minimap autour)
MIN_SHARE = 0.35  # part du cadre qu'une couleur doit couvrir pour être retenue
DOMINANCE = 2.0  # et rapport minimal à la deuxième couleur (une pastille de joueur sur la boîte ne la change pas)
NEUTRAL_SHARE = 0.45  # part de gris à partir de laquelle la boîte est dite grise même avec des pastilles dessus (une boîte orange ou bleue n'a que 0 à 10 % de gris)
MAX_GAP_S = 3.0  # secondes illisibles comblées quand les deux bords ont la même couleur
MIN_RUN_S = 2.0  # une couleur lue moins longtemps que cela entre deux fois la même autre est un accident (pastille, éclair)
SLOPE_W_S = 3.0  # demi-fenêtre de la pente des scores
MIN_RISE = 1.5  # montée minimale du score (points de pourcentage) sur la fenêtre pour dire que l'équipe tient le point
SCORE_FILL_GAP_S = 6.0  # trou de pente comblé quand les deux bords ont la même équipe (score à l'arrêt un instant)
TRANSITION_S = 4.0  # autour d'un changement de couleur la pente retarde : ces secondes sont comptées à part dans l'accord


# ---------------------------------------------------------------- lecture de la couleur de la boîte

def point_rects(map_name):
    """Cadres des points de capture d'une carte à partir des polygones tracés : {lettre: (x0, y0, x1, y1)} en fractions de la minimap (une lettre par polygone dans l'ordre du fichier)."""
    polys = json.loads(CAPTURE.read_text(encoding="utf-8")).get(map_name, [])
    out = {}
    for k, poly in enumerate(polys):
        xs, ys = [p[0] for p in poly], [p[1] for p in poly]
        out[chr(ord("A") + k)] = (min(xs), min(ys), max(xs), max(ys))
    return out


def box_rect(box):
    """Cadre d'une boîte lue par capture_points (centre x, y et taille w, h en fractions) : (x0, y0, x1, y1)."""
    return (box["x"] - box["w"] / 2, box["y"] - box["h"] / 2, box["x"] + box["w"] / 2, box["y"] + box["h"] / 2)


def pixel_shares(frame, rect):
    """Part du cadre (rétréci de SHRINK) en orange, en bleu et en gris : {"A", "B", "none"}. Orange : rouge nettement au-dessus du bleu ; bleu : l'inverse ; gris : peu saturé et ni sombre ni éclatant
    (le fond sombre de la minimap et les traits blancs des murs ne comptent pour rien)."""
    h, w = frame.shape[:2]
    fw, fh = rect[2] - rect[0], rect[3] - rect[1]
    x0, x1 = int(round((rect[0] + SHRINK * fw) * w)), int(round((rect[2] - SHRINK * fw) * w))
    y0, y1 = int(round((rect[1] + SHRINK * fh) * h)), int(round((rect[3] - SHRINK * fh) * h))
    patch = frame[max(y0, 0):max(y1, 1), max(x0, 0):max(x1, 1)].reshape(-1, 3).astype(np.int16)
    if len(patch) == 0:
        return {"A": 0.0, "B": 0.0, "none": 0.0}
    b, g, r = patch[:, 0], patch[:, 1], patch[:, 2]
    spread = patch.max(axis=1) - patch.min(axis=1)
    mean = patch.mean(axis=1)
    n = len(patch)
    return {
        "A": float(((r - b > 45) & (r > 90)).sum()) / n,
        "B": float(((b - r > 35) & (b > 90)).sum()) / n,
        "none": float(((spread < 28) & (mean >= 85) & (mean <= 200)).sum()) / n,
    }


def read_color(frame, rect):
    """Propriétaire lu sur la boîte : « A » (orange), « B » (bleu), « none » (grise) ou None (pas de boîte lisible : écran noir, cadre vide, deux couleurs qui se disputent)."""
    shares = pixel_shares(frame, rect)
    ranked = sorted(shares.items(), key=lambda kv: -kv[1])
    (best, top), (_, second) = ranked[0], ranked[1]
    if top >= MIN_SHARE and top >= DOMINANCE * second:
        return best
    if shares["none"] >= NEUTRAL_SHARE and shares["none"] > max(shares["A"], shares["B"]):
        return "none"  # boîte grise avec des pastilles de joueurs dessus (leurs pixels orange ou bleus ne l'emportent pas sur le gris)
    return None


# ---------------------------------------------------------------- nettoyage des lectures

def _runs(labels):
    """Plages de même valeur : [(début, fin exclue, valeur)]."""
    out, start = [], 0
    for i in range(1, len(labels) + 1):
        if i == len(labels) or labels[i] != labels[start]:
            out.append((start, i, labels[start]))
            start = i
    return out


def clean_labels(labels, step_s=STEP_S):
    """Comble les trous illisibles courts entre deux lectures identiques, puis efface les accidents d'une couleur lue trop brièvement entre deux fois la même autre. Renvoie une nouvelle liste."""
    out = list(labels)
    for _ in range(2):
        runs = _runs(out)
        for k, (a, b, v) in enumerate(runs):
            if 0 < k < len(runs) - 1 and runs[k - 1][2] == runs[k + 1][2] and runs[k - 1][2] is not None:
                short = (b - a) * step_s
                if (v is None and short <= MAX_GAP_S) or (v is not None and short < MIN_RUN_S):
                    out[a:b] = [runs[k - 1][2]] * (b - a)
    return out


# ---------------------------------------------------------------- pente des scores

def _interp(series, t):
    """Valeur du score à l'instant t (interpolation), ou None si la série est vide ou trop loin."""
    if not series:
        return None
    ts = [p[0] for p in series]
    if t < ts[0] - 2 or t > ts[-1] + 2:
        return None
    return float(np.interp(t, ts, [p[1] for p in series]))


def score_labels(capture, times):
    """Équipe qui tient le point à chaque instant d'après la montée de son score sur ±SLOPE_W_S : « A », « B » ou None (aucune ne monte, les deux montent, pas de lecture).
    `capture` : {"A": [(t, pct)], "B": [(t, pct)]}, t en secondes depuis le début de la game."""
    out = []
    for t in times:
        rise = {}
        for team in ("A", "B"):
            lo, hi = _interp(capture.get(team, []), t - SLOPE_W_S), _interp(capture.get(team, []), t + SLOPE_W_S)
            rise[team] = None if lo is None or hi is None else hi - lo
        a, b = rise["A"], rise["B"]
        if a is not None and a >= MIN_RISE and (b is None or b < MIN_RISE):
            out.append("A")
        elif b is not None and b >= MIN_RISE and (a is None or a < MIN_RISE):
            out.append("B")
        else:
            out.append(None)
    # un score qui s'arrête une seconde ou deux (lecture manquée) ne rend pas le point à personne
    filled = list(out)
    runs = _runs(out)
    for k, (a, b, v) in enumerate(runs):
        if v is None and 0 < k < len(runs) - 1 and runs[k - 1][2] == runs[k + 1][2] and (b - a) * STEP_S <= SCORE_FILL_GAP_S:
            filled[a:b] = [runs[k - 1][2]] * (b - a)
    return filled


def merge(box, score):
    """Étiquette finale par seconde : la boîte l'emporte, la pente comble les secondes sans boîte lisible. Renvoie (étiquettes, sources) (source « box », « score » ou None)."""
    labels, sources = [], []
    for b, s in zip(box, score):
        if b is not None:
            labels.append(b)
            sources.append("box")
        elif s is not None:
            labels.append(s)
            sources.append("score")
        else:
            labels.append(None)
            sources.append(None)
    return labels, sources


def agreement(box, score, times):
    """Accord de la boîte avec la pente des scores sur les secondes où les deux lisent quelque chose : {"compared", "agree", "compared_calm", "agree_calm"}. Une boîte « none » face à un
    score qui monte est un désaccord. « calm » : hors de TRANSITION_S autour d'un changement de couleur de la boîte (la pente retarde de 2 s environ)."""
    changes = [times[i] for i in range(1, len(box)) if box[i] is not None and box[i - 1] is not None and box[i] != box[i - 1]]
    out = {"compared": 0, "agree": 0, "compared_calm": 0, "agree_calm": 0}
    for t, b, s in zip(times, box, score):
        if b is None or s is None:
            continue
        ok = b == s
        out["compared"] += 1
        out["agree"] += ok
        if all(abs(t - c) > TRANSITION_S for c in changes):
            out["compared_calm"] += 1
            out["agree_calm"] += ok
    return out


# ---------------------------------------------------------------- segments

def to_segments(point, times, labels, sources, step_s=STEP_S):
    """Segments {point, t0, t1, owner, source} d'après les étiquettes par seconde : même propriétaire de suite (les secondes sans étiquette coupent). t1 = instant de la première seconde
    d'après. La source est « box » si au moins la moitié des secondes du segment viennent de la boîte, sinon « score »."""
    out = []
    for a, b, v in _runs(labels):
        if v is None:
            continue
        box_n = sum(1 for s in sources[a:b] if s == "box")
        out.append({"point": point, "t0": round(float(times[a]), 2), "t1": round(float(times[b - 1]) + step_s, 2), "owner": v, "source": "box" if 2 * box_n >= b - a else "score"})
    return out


# ---------------------------------------------------------------- lecture d'une game

def _game(conn, game_id):
    row = conn.execute(
        "SELECT g.id, g.map, g.start_s, g.end_s, v.path, v.width, v.height FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (game_id,)
    ).fetchone()
    return dict(row) if row else None


def _video_frames(conn, game):
    """Images de la minimap (t en secondes depuis le début de la game, image BGR) ; rien si la vidéo est absente."""
    import db
    import timer

    if not game["path"] or not os.path.exists(game["path"]):
        return
    zone = db.zone_for(conn, game["map"], "minimap")
    for t, im in timer.iter_crops(game["path"], zone, game["width"], game["height"], step_s=STEP_S, t0=game["start_s"], t1=game["end_s"]):
        yield t - game["start_s"], im


def _capture(conn, game):
    """Séries de score {"A": [(t, %)], "B": [(t, %)]} avec t en secondes depuis le début de la game."""
    import db

    series = db.capture_of(conn, game["id"])
    return {team: [(t - game["start_s"], v) for t, v in pts] for team, pts in series.items()}


def _plan(conn, game):
    """Où lire à chaque instant : [(point, t0, t1, cadre)] (Outlaw : une plage par boîte vue ; autres cartes : toute la game). Liste vide si la carte n'est pas prise en charge ou sans boîtes."""
    import db

    if game["map"] == OUTLAW:
        return [(b["point"], b["t0"], b["t1"] + STEP_S, box_rect(b)) for b in db.capture_boxes_of(conn, game["id"]) if b["point"]]
    if game["map"] in MULTI_POINT_MAPS:
        return []
    rects = point_rects(game["map"])
    if len(rects) != 1:
        return []
    (letter, rect), = rects.items()
    return [(letter, 0.0, game["end_s"] - game["start_s"], rect)]


def _read_plan_entry(entry, frames, capture):
    """Étiquettes d'un point sur sa plage : (secondes, lecture de la boîte nettoyée, pente, étiquettes finales, sources). Sans image, la grille est celle de la plage et la boîte est illisible partout."""
    _, t0, t1, rect = entry
    if frames:
        mine = [(t, im) for t, im in frames if t0 - 1e-6 <= t < t1]
        times = [t for t, _ in mine]
        box = clean_labels([read_color(im, rect) for _, im in mine])
    else:
        times = [t0 + k * STEP_S for k in range(int(max(t1 - t0, 0) / STEP_S))]
        box = [None] * len(times)
    score = score_labels(capture, times)
    labels, sources = merge(box, score)
    return times, box, score, labels, sources


def analyse(conn, game_id, frames=None):
    """Lit les propriétaires des points d'une game. `frames` : images [(t en secondes de game, image)] à la place de la vidéo (tests). Renvoie {"segments": [...], "stats": {...}}.
    Sans vidéo (fichier absent) la pente des scores seule donne les segments (source « score », jamais « none »)."""
    game = _game(conn, game_id)
    plan = _plan(conn, game) if game else []
    if not plan:
        return {"segments": [], "stats": {"seconds": 0}}
    capture = _capture(conn, game)
    frames = list(frames) if frames is not None else list(_video_frames(conn, game))
    segments, stats = [], {"seconds": 0, "unreadable_box": 0, "unreadable_final": 0, "compared": 0, "agree": 0, "compared_calm": 0, "agree_calm": 0}
    for entry in plan:
        times, box, score, labels, sources = _read_plan_entry(entry, frames, capture)
        segments += to_segments(entry[0], times, labels, sources)
        acc = agreement(box, score, times)
        stats["seconds"] += len(times)
        stats["unreadable_box"] += sum(1 for b in box if b is None)
        stats["unreadable_final"] += sum(1 for lab in labels if lab is None)
        for k in ("compared", "agree", "compared_calm", "agree_calm"):
            stats[k] += acc[k]
    return {"segments": segments, "stats": stats}


def _write(conn, game_id, segments):
    """Efface puis réécrit les segments de la game et la révision du module. Renvoie le nombre de segments."""
    with conn:
        conn.execute("DELETE FROM point_owner WHERE game_id = ?", (game_id,))
        conn.executemany(
            "INSERT INTO point_owner (game_id, point, t0, t1, owner, source) VALUES (?, ?, ?, ?, ?, ?)",
            [(game_id, s["point"], s["t0"], s["t1"], s["owner"], s["source"]) for s in segments],
        )
        conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, MODULE, REVISION))
    return len(segments)


def compute(conn, game_id, frames=None):
    """Contrat des modules Stats : efface puis réécrit les segments de la game (table point_owner) et la révision (stats_meta). Renvoie le nombre de segments écrits.
    `frames` : voir analyse() (tests)."""
    return _write(conn, game_id, analyse(conn, game_id, frames)["segments"])


def main(argv=None):
    parser = argparse.ArgumentParser(description="Calcule le propriétaire de chaque point de capture d'une game (table point_owner).")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--dry-run", action="store_true", help="lit et affiche sans écrire dans la base")
    args = parser.parse_args(argv)
    import db

    conn = db.connect(args.db)
    result = analyse(conn, args.game)
    if not args.dry_run:
        _write(conn, args.game, result["segments"])
    s = result["stats"]
    for seg in result["segments"]:
        print(f"  point {seg['point']} {seg['t0']:6.1f} s à {seg['t1']:6.1f} s : {seg['owner']} ({seg['source']})")
    if s.get("seconds"):
        print(f"{len(result['segments'])} segments, {s['seconds']} secondes lues, sans couleur lisible : {s['unreadable_box']} (boîte), {s['unreadable_final']} (après la pente des scores)")
        if s["compared"]:
            print(f"accord avec la pente des scores : {s['agree']}/{s['compared']}, hors transitions {s['agree_calm']}/{s['compared_calm']}")
    else:
        print("carte non prise en charge ou sans point lisible : aucun segment")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
