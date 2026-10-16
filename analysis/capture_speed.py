"""Vitesse de capture d'un point selon le nombre de joueurs dessus : `python analysis/capture_speed.py --game N [--db chemin] [--out fichier] [--settle S]`. Ne lit que la base (copie conseillée) et la vidéo, n'écrit rien dans la base.

Méthode (mesure, pas une règle du jeu) :
1. Passe grossière du HUD (hud_points, une image par seconde, la même que l'analyse) : les secondes où un hexagone est à moitié rempli ou change de propriétaire donnent des FENÊTRES (15 s avant, 3 s après).
2. Relecture de chaque fenêtre à 5 images par seconde (`timer.iter_crops`, ffmpeg limité à la fenêtre) : NIVEAU de remplissage de l'hexagone = part de sa hauteur remplie depuis le bas de la couleur de l'équipe qui capture
   (lignes de pixels dans deux bandes latérales, hors lettre ; 0 vide, 1 plein ; le bas de l'hexagone donne l'équipe qui capture, le haut est l'ancien propriétaire).
3. À chaque image : joueurs vivants de chaque équipe (lecture de confiance 0,5 ou plus) dans le cadre du point (`samples`, temps de vidéo moins `games.start_s`). Cadres : boîtes de `map_capture_points.json` (Outlaw),
   sinon rectangle englobant des polygones de `map_capture.json` (lettre = ordre des polygones, comme `point_owner.point_rects` ; la correspondance lettre du HUD et polygone est contrôlée à part).
4. Un épisode est une montée du remplissage d'une couleur ; il est coupé en PLAGES où le nombre de joueurs de l'équipe qui capture est constant. Une plage compte si elle dure 0,8 s ou plus, après retrait des premières
   `SETTLE_S` secondes (le remplissage réagit un peu après l'arrivée d'un joueur), avec le niveau entre 0,05 et 0,95 (hors butée) et sans image douteuse. Pente = droite des moindres carrés (fraction par seconde),
   durée de capture = 1 / pente. Plage avec des joueurs des deux équipes dans le cadre : rangée à part (contestée), jamais mêlée aux autres.
Image douteuse : un joueur vivant de confiance basse (moins de 0,5) ou sans position tout près du cadre (marge `MARGIN`), ou aucune ligne de suivi à moins de 0,12 s."""

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np
import paths

HERE = Path(__file__).parent
FINE_STEP_S = 0.2  # 5 images par seconde dans les fenêtres
PRE_S, POST_S, MERGE_GAP_S = 15.0, 3.0, 2.0  # fenêtre autour d'une seconde de capture en cours
V_LO, V_HI = -0.95, 1.05  # haut et bas de l'hexagone en unités de demi-hauteur autour du centre du layout (mesuré sur Polaris : lignes colorées de -0,91 à +1,01)
BAND_U = (0.3, 0.5)  # bandes latérales (|u|), hors lettre
ROW_MIN = 0.5  # part d'une bande qui doit avoir la couleur pour dire « ligne remplie »
PROBE_V = 0.55  # le bas de l'hexagone (v de 0,55 à V_HI) donne la couleur de l'équipe qui capture
MIN_CONF, MARGIN, SAMPLE_TOL_S = 0.5, 0.04, 0.12
SETTLE_S, MIN_RUN_S, LEVEL_RANGE = 0.3, 0.8, (0.05, 0.95)
MAX_PRESENT = 4
# lettre de l'hexagone du HUD -> lettre du polygone de map_capture.json (ordre des polygones), MESURÉ par le contrôle `mapping` (secondes de montée où l'équipe qui capture est dans chaque polygone) :
# Engine game 30 : B vers C 5,2 s contre 0 ailleurs, C vers B 11,0 s contre 0,2, A vers A 33,6 s ; Atlantis game 31 : B vers A 8,4 s (0,8 vers B), A vers B 16,6 s, C vers C 8,8 s. Cartes à un point et Outlaw : identité.
HUD_TO_POLYGON = {"Engine": {"A": "A", "B": "C", "C": "B"}, "Atlantis": {"A": "B", "B": "A", "C": "C"}}
FEW_EPISODES = 5  # en dessous : valeur marquée « peu d'épisodes »
FEW_SECONDS = 10.0  # en dessous : valeur marquée « peu de secondes »
FLAT_SLOPE = 0.02  # pente (fraction par seconde) sous laquelle le remplissage est dit figé


# ---------------------------------------------------------------- niveau de remplissage d'un hexagone

def band_rows(shape, cx, cy, hw, hh):
    """Lignes de pixels de l'hexagone (layout en fractions de l'image) : [(v, y, colonnes des bandes latérales)], v en demi-hauteurs depuis le centre (négatif en haut)."""
    h, w = shape[:2]
    u = np.abs(((np.arange(w) + 0.5) / w - cx) / hw)
    cols = np.nonzero((u >= BAND_U[0]) & (u <= BAND_U[1]))[0]
    rows = []
    for y in range(h):
        v = ((y + 0.5) / h - cy) / hh
        if V_LO - 0.1 <= v <= V_HI + 0.1:
            rows.append((v, y, cols))
    return rows


def row_shares(orange, blue, rows):
    """Part de chaque ligne en orange et en bleu (tableaux v, orange, bleu)."""
    v = np.array([r[0] for r in rows])
    so = np.array([float(orange[y, cols].mean()) for _, y, cols in rows])
    sb = np.array([float(blue[y, cols].mean()) for _, y, cols in rows])
    return v, so, sb


def fill_level(v, so, sb):
    """(équipe « A » ou « B » ou None, niveau 0 à 1) : équipe = couleur du bas de l'hexagone ; niveau = hauteur remplie depuis le bas de cette couleur (ligne du haut : deux lignes pleines de suite
    et au moins 80 % de lignes pleines en dessous, ce qui pardonne un trou de lettre)."""
    probe = (v >= PROBE_V) & (v <= V_HI)
    if not probe.any():
        return None, 0.0
    mo, mb = so[probe].mean(), sb[probe].mean()
    if max(mo, mb) < ROW_MIN:
        return None, 0.0
    team = "A" if mo >= mb else "B"
    full = (so if team == "A" else sb) >= ROW_MIN
    idx = np.nonzero((v >= V_LO) & (v <= V_HI))[0]
    dv = float(np.median(np.diff(v))) if len(v) > 1 else 0.1
    for k, r in enumerate(idx[:-1]):
        if full[r] and full[idx[k + 1]] and full[idx[k:]].mean() >= 0.8:
            return team, float(np.clip((V_HI - (v[r] - dv / 2)) / (V_HI - V_LO), 0.0, 1.0))
    return team, 0.0


def smooth_levels(level, team):
    """Médiane glissante de 3 images sur le niveau (un parasite d'une image, décor qui traverse l'hexagone, disparaît ; une rampe reste intacte) ; les bords d'un changement d'équipe ne sont pas touchés."""
    out = list(level)
    for i in range(1, len(level) - 1):
        if team[i - 1] == team[i] == team[i + 1]:
            out[i] = sorted((level[i - 1], level[i], level[i + 1]))[1]
    return out


# ---------------------------------------------------------------- joueurs dans le cadre

def count_in_rect(xs, ys, alive, conf, teams, rect, min_conf=MIN_CONF, margin=MARGIN):
    """Joueurs d'une image du suivi : {"A": n, "B": n, "unsure": bool}. Compté : vivant, confiance `min_conf` ou plus, position dans `rect` (x0, y0, x1, y1). Douteux : un joueur vivant de confiance
    basse ou sans position (x NaN) dans le cadre élargi de `margin` (sa vraie place peut être dans le cadre) ; un vivant sans position est douteux partout."""
    x0, y0, x1, y1 = rect
    out = {"A": 0, "B": 0, "unsure": False}
    for x, y, a, c, team in zip(xs, ys, alive, conf, teams):
        if not a:
            continue
        if x != x or y != y:
            out["unsure"] = True
            continue
        if x0 <= x <= x1 and y0 <= y <= y1 and c >= min_conf:
            out[team] += 1
        elif c < min_conf and x0 - margin <= x <= x1 + margin and y0 - margin <= y <= y1 + margin:
            out["unsure"] = True
    return out


# ---------------------------------------------------------------- épisodes et plages

def build_runs(t, level, team, n_own, n_enemy, unsure, settle_s=SETTLE_S, min_run_s=MIN_RUN_S, level_range=LEVEL_RANGE, gap_s=0.6):
    """Plages de capture d'une lettre. Entrées : séries de même longueur (temps, niveau, équipe qui capture ou None, joueurs de cette équipe et de l'autre dans le cadre, image douteuse).
    Épisode : suite d'images de même équipe et de niveau d'au moins 0,03 (coupée par un trou de plus de `gap_s`). Plage : suite d'images sans doute, hors butée du niveau, avec le même (n_own, n_enemy)
    (n_own : joueurs de l'équipe qui capture, calculé sur l'équipe de l'image par l'appelant). Renvoie [{episode, team, n, enemy, t0, t1, slope, t_zero (instant où la droite coupe le niveau 0), r2, seconds, dlevel}] (pente en fraction par seconde)."""
    runs, ep = [], -1
    prev_t, prev_team, cur = None, None, None

    def close(cur_run):
        if cur_run is None:
            return
        ts, ls = np.array(cur_run["t"]), np.array(cur_run["l"])
        keep = ts >= ts[0] + settle_s
        ts, ls = ts[keep], ls[keep]
        if len(ts) < 3 or ts[-1] - ts[0] < min_run_s:
            return
        slope, icpt = np.polyfit(ts, ls, 1)
        resid = ls - (slope * ts + icpt)
        var = float(((ls - ls.mean()) ** 2).sum())
        r2 = 1.0 - float((resid ** 2).sum()) / var if var > 1e-9 else 0.0
        runs.append({"episode": cur_run["ep"], "team": cur_run["team"], "n": cur_run["n"], "enemy": cur_run["enemy"], "t0": float(ts[0]), "t1": float(ts[-1]),
                     "slope": float(slope), "t_zero": float(-icpt / slope) if slope > 0.005 else None, "r2": r2, "seconds": float(ts[-1] - ts[0]), "dlevel": float(ls[-1] - ls[0])})

    for i in range(len(t)):
        active = team[i] is not None and level[i] >= 0.03
        new_ep = active and (prev_team != team[i] or prev_t is None or t[i] - prev_t > gap_s)
        if not active:
            close(cur)
            cur = None
            continue
        if new_ep:
            close(cur)
            cur = None
            ep += 1
        prev_t, prev_team = t[i], team[i]
        usable = (not unsure[i]) and level_range[0] <= level[i] <= level_range[1] and n_own[i] is not None
        if not usable:
            close(cur)
            cur = None
            continue
        if cur is not None and (cur["n"], cur["enemy"]) != (n_own[i], n_enemy[i]):
            close(cur)
            cur = None
        if cur is None:
            cur = {"ep": ep, "team": team[i], "n": n_own[i], "enemy": n_enemy[i], "t": [], "l": []}
        cur["t"].append(t[i])
        cur["l"].append(level[i])
    close(cur)
    return runs


def pair_slopes(t, level, team, n_own, n_enemy, unsure, settle_s=SETTLE_S, level_range=LEVEL_RANGE, step_max=0.35):
    """Variations de niveau entre deux images voisines (deuxième méthode, qui garde aussi les plages trop courtes pour la droite) : {(épisode, n, ennemis): [somme des dniveau, somme des dt, nombre de paires]}.
    Une paire compte si les deux images sont sans doute, hors butée, de même équipe, même (n, ennemis), à moins de `step_max` l'une de l'autre, et si cet état dure depuis `settle_s` ou plus. Le niveau est quantifié
    (1/24) : l'erreur d'une paire est grande, la somme sur beaucoup de paires est celle de la pente moyenne (les erreurs de bord se compensent)."""
    out, ep, prev, state_t0, last_key = {}, -1, None, None, None
    for i in range(len(t)):
        active = team[i] is not None and level[i] >= 0.03
        if not active:
            prev, last_key = None, None
            continue
        if prev is None or team[prev] != team[i] or t[i] - t[prev] > 0.6:
            ep += 1
            state_t0 = None
        usable = (not unsure[i]) and level_range[0] <= level[i] <= level_range[1] and n_own[i] is not None
        key = (team[i], n_own[i], n_enemy[i]) if usable else None
        if usable and prev is not None and key == last_key and t[i] - t[prev] <= step_max:
            if state_t0 is None:
                state_t0 = t[prev]
            if t[i] - state_t0 >= settle_s:
                acc = out.setdefault((ep, n_own[i], n_enemy[i]), [0.0, 0.0, 0])
                acc[0] += level[i] - level[prev]
                acc[1] += t[i] - t[prev]
                acc[2] += 1
        else:
            state_t0 = None
        last_key = key
        prev = i
    return out


def summarize(runs, pairs=(), max_present=MAX_PRESENT):
    """Résumé par nombre de joueurs de l'équipe qui capture (sans ennemi dans le cadre) : {n: {...}} avec pente médiane, extrêmes, durée de capture (1 / pente, plages qui montent seulement), pente pondérée
    par le temps, nombre d'épisodes, de plages, secondes de mesure ; `paires` : pente par somme des variations (voir pair_slopes, toutes les plages même courtes). À part : `contestees` (ennemi dans le cadre,
    par (n, ennemis)). `pairs` : liste de {"game", "point", "episode", "n", "enemy", "dl", "dt", "pairs"}."""
    clean = defaultdict(list)
    contested = defaultdict(list)
    for r in runs:
        if r["enemy"] == 0:
            clean[min(r["n"], max_present)].append(r)
        else:
            contested[(min(r["n"], max_present), min(r["enemy"], max_present))].append(r)
    pair_acc = defaultdict(lambda: [0.0, 0.0, set()])
    for p in pairs:
        if p["enemy"] == 0:
            a = pair_acc[min(p["n"], max_present)]
            a[0] += p["dl"]
            a[1] += p["dt"]
            a[2].add((p["game"], p["point"], p["episode"]))
    out = {"par_joueurs": {}, "contestees": {}}
    for n in sorted(set(clean) | set(pair_acc)):
        entry = _stats(clean[n]) if clean[n] else {}
        if n in pair_acc and pair_acc[n][1] > 0:
            dl, dt, eps = pair_acc[n]
            entry["paires"] = {"episodes": len(eps), "secondes": round(dt, 1), "pente": round(dl / dt, 4), "duree_s": round(dt / dl, 2) if dl > 0.001 else None,
                               "peu_d_episodes": len(eps) < FEW_EPISODES, "peu_de_secondes": dt < FEW_SECONDS}
        out["par_joueurs"][str(n)] = entry
    for (n, e) in sorted(contested):
        out["contestees"][f"{n}_contre_{e}"] = _stats(contested[(n, e)])
    return out


def _stats(rs):
    slopes = np.array([r["slope"] for r in rs])
    secs = np.array([r["seconds"] for r in rs])
    rising = slopes > 0.005
    res = {"episodes": len({(r.get("game"), r.get("point"), r["episode"]) for r in rs}), "plages": len(rs), "secondes": round(float(secs.sum()), 1), "plages_montantes": int(rising.sum()),
           "plages_figees": int((np.abs(slopes) < FLAT_SLOPE).sum()), "plages_en_baisse": int((slopes <= -FLAT_SLOPE).sum()),
           "pente_mediane": round(float(np.median(slopes)), 4), "pente_min": round(float(slopes.min()), 4), "pente_max": round(float(slopes.max()), 4),
           "pente_ponderee": round(float((slopes * secs).sum() / secs.sum()), 4)}
    if rising.any():
        d = 1.0 / slopes[rising]
        res.update({"duree_mediane_s": round(float(np.median(d)), 2), "duree_min_s": round(float(d.min()), 2), "duree_max_s": round(float(d.max()), 2)})
        sr, wr = slopes[rising], secs[rising]
        res["duree_ponderee_s"] = round(float(wr.sum() / (sr * wr).sum()), 2)
    res["peu_d_episodes"] = res["episodes"] < FEW_EPISODES
    res["peu_de_secondes"] = res["secondes"] < FEW_SECONDS
    return res


# ---------------------------------------------------------------- fenêtres

def candidate_windows(times, readings, letters, end_s, pre=PRE_S, post=POST_S, merge_gap=MERGE_GAP_S):
    """Fenêtres [(t0, t1)] (secondes de game) autour des secondes où un hexagone est en cours de remplissage (`contested`) ou change de propriétaire ; fenêtres voisines fusionnées."""
    marks = []
    for k in letters:
        prev = None
        for t, states in zip(times, readings):
            s = states[k]
            owner = s["owner"]
            if s["contested"] or (prev is not None and owner is not None and owner != prev):
                marks.append(t)
            if owner is not None:
                prev = owner
    wins = []
    for t in sorted(marks):
        a, b = max(0.0, t - pre), min(end_s, t + post)
        if wins and a <= wins[-1][1] + merge_gap:
            wins[-1][1] = max(wins[-1][1], b)
        else:
            wins.append([a, b])
    return [(a, b) for a, b in wins]


# ---------------------------------------------------------------- données

def point_frames(map_name):
    """Cadres des points {lettre: (x0, y0, x1, y1)} : boîtes vues (Outlaw) ou rectangle englobant des polygones tracés."""
    import point_owner as po

    seen = json.loads((HERE / "map_capture_points.json").read_text(encoding="utf-8")).get(map_name, {}).get("points")
    if seen:
        return {k: po.box_rect(b) for k, b in seen.items()}
    return po.point_rects(map_name)


def polygons_for(map_name):
    """Polygones tracés {lettre: [(x, y)]} (un par point, ordre du fichier) ; vide si la carte n'en a pas."""
    polys = json.loads((HERE / "map_capture.json").read_text(encoding="utf-8")).get(map_name, [])
    return {chr(ord("A") + k): [tuple(p) for p in poly] for k, poly in enumerate(polys)}


def load_presence(conn, game):
    """Suivi de la game : (temps de game, x, y, vivant, confiance, équipes) en tableaux (images, 8 joueurs) ; équipes : liste des 8 lettres « A » ou « B » dans l'ordre des slots."""
    rows = conn.execute("SELECT frame, t, slot, team, x, y, alive, confidence FROM samples WHERE game_id = ? ORDER BY frame, slot", (game["id"],)).fetchall()
    frames = sorted({r["frame"] for r in rows})
    index = {f: i for i, f in enumerate(frames)}
    n = len(frames)
    t = np.full(n, np.nan)
    x, y = np.full((n, 8), np.nan), np.full((n, 8), np.nan)
    alive, conf = np.zeros((n, 8), bool), np.zeros((n, 8))
    teams = ["A"] * 4 + ["B"] * 4
    for r in rows:
        i, s = index[r["frame"]], r["slot"] - 1
        t[i] = r["t"] - game["start_s"]
        if r["x"] is not None:
            x[i, s], y[i, s] = r["x"], r["y"]
        alive[i, s] = bool(r["alive"])
        conf[i, s] = r["confidence"] or 0.0
        teams[s] = r["team"]
    return t, x, y, alive, conf, teams


def presence_at(pres, rect, times):
    """Joueurs dans `rect` aux instants `times` (image du suivi la plus proche, à SAMPLE_TOL_S près ; sinon douteux sans comptage) : liste de {"A", "B", "unsure"} ou None."""
    t, x, y, alive, conf, teams = pres
    out = []
    for q in times:
        i = int(np.searchsorted(t, q))
        i = min(max(i, 0), len(t) - 1)
        if i > 0 and abs(t[i - 1] - q) < abs(t[i] - q):
            i -= 1
        if abs(t[i] - q) > SAMPLE_TOL_S:
            out.append(None)
            continue
        out.append(count_in_rect(x[i], y[i], alive[i], conf[i], teams, rect))
    return out


def fine_levels(game, zone, layout, windows, step_s=FINE_STEP_S):
    """Relit chaque fenêtre à `step_s` : {lettre: [(t de game, équipe, niveau)]} (une ligne par image). Un seul ffmpeg à la fois."""
    import hud_points as hp
    import timer

    cache, out = {}, {k: [] for k in layout}
    for a, b in windows:
        for t, im in timer.iter_crops(game["path"], zone, game["width"], game["height"], step_s=step_s, t0=game["start_s"] + a, t1=game["start_s"] + b):
            planes = hp.color_planes(im)
            for k, (cx, cy, hw, hh) in layout.items():
                key = (im.shape[:2], k)
                if key not in cache:
                    cache[key] = band_rows(im.shape, cx, cy, hw, hh)
                team, lvl = fill_level(*row_shares(planes[0], planes[1], cache[key]))
                out[k].append((t - game["start_s"], team, lvl))
    return out


def analyse_game(conn, game_id, settle_s=SETTLE_S, log=print):
    """Mesure une game : {"game", "map", "runs", "frames", "unsure_share", "mapping", "first_rise_s", "windows"} ou None (game, vidéo, suivi ou hexagones absents)."""
    import db
    import hud_points as hp
    import point_owner as po

    game = po._game(conn, game_id)
    if not game or not game["path"] or not os.path.exists(game["path"]):
        return None
    zone = db.zone_for(conn, game["map"], "capture_points")
    mode, layout = hp.layout_for(game["map"], zone)
    pres = load_presence(conn, game)
    frames = point_frames(game["map"])
    if not layout or len(pres[0]) == 0 or not frames:
        return None
    coarse = list(hp.video_frames(conn, game))
    _, letters, times, readings = hp.read_series([(t, im) for t, im in coarse], game["map"], zone)
    windows = candidate_windows(times, readings, letters, game["end_s"] - game["start_s"])
    log(f"game {game_id} {game['map']} : {len(windows)} fenêtres, {sum(b - a for a, b in windows):.0f} s relues à {1 / FINE_STEP_S:.0f} images par seconde")
    series = fine_levels(game, zone, layout, windows)
    runs, pairs, n_frames, n_unsure, mapping, first_rise, detail = [], [], 0, 0, defaultdict(lambda: defaultdict(float)), None, {}
    for k, rows in series.items():
        frame_letter = HUD_TO_POLYGON.get(game["map"], {}).get(k, k)
        if frame_letter not in frames or not rows:
            continue
        t = [r[0] for r in rows]
        team = [r[1] for r in rows]
        level = smooth_levels([r[2] for r in rows], team)
        counts = presence_at(pres, frames[frame_letter], t)
        n_own = [None if c is None or tm is None else c[tm] for c, tm in zip(counts, team)]
        n_enemy = [None if c is None or tm is None else c["B" if tm == "A" else "A"] for c, tm in zip(counts, team)]
        unsure = [c is None or c["unsure"] for c in counts]
        detail[k] = list(zip(t, team, level, n_own, n_enemy, unsure))
        n_frames += len(t)
        n_unsure += sum(unsure)
        for r in build_runs(t, level, team, n_own, n_enemy, unsure, settle_s):
            r.update({"game": game_id, "point": k, "map": game["map"]})
            runs.append(r)
        for (e, n, en), (dl, dt, cnt) in pair_slopes(t, level, team, n_own, n_enemy, unsure, settle_s).items():
            pairs.append({"game": game_id, "point": k, "map": game["map"], "episode": e, "n": n, "enemy": en, "dl": dl, "dt": dt, "pairs": cnt})
        _map_letters(game["map"], k, t, team, level, pres, mapping)
        rise = [ti for ti, tm, lv in rows if tm is not None and 0.05 <= lv < 0.95]
        if rise and (first_rise is None or rise[0] < first_rise):
            first_rise = rise[0]
    t_, x_, y_, alive_, conf_, _ = pres
    low_conf = float(((conf_ < MIN_CONF) & alive_).sum() / max(alive_.sum(), 1))
    return {"game": game_id, "map": game["map"], "lignes_vivantes_confiance_basse": low_conf, "runs": runs, "pairs": pairs, "frames": n_frames, "unsure_share": (n_unsure / n_frames) if n_frames else None,
            "mapping": {k: dict(v) for k, v in mapping.items()}, "first_rise_s": first_rise, "windows": [(round(a, 1), round(b, 1)) for a, b in windows], "series": detail}


def _map_letters(map_name, letter, t, team, level, pres, mapping):
    """Contrôle lettre du HUD et polygone : secondes de montée où l'équipe qui capture a au moins un joueur dans chaque polygone, ajoutées à mapping[lettre du HUD][lettre du polygone]."""
    polys = point_frames(map_name)
    rising = [(ti, tm) for ti, tm, lv in zip(t, team, level) if tm is not None and 0.05 <= lv < 0.95]
    if not rising:
        return
    for pk, rect in polys.items():
        counts = presence_at(pres, rect, [r[0] for r in rising])
        mapping[letter][pk] += FINE_STEP_S * sum(1 for c, (_, tm) in zip(counts, rising) if c and not c["unsure"] and c[tm] >= 1)


def aggregate(results, max_present=MAX_PRESENT):
    """Résumé par carte et pour toutes les cartes à partir des résultats de `analyse_game`."""
    runs, pairs = defaultdict(list), defaultdict(list)
    for res in results:
        runs[res["map"]] += res["runs"]
        pairs[res["map"]] += res.get("pairs", [])
    out = {"toutes_cartes": summarize(sum(runs.values(), []), sum(pairs.values(), []), max_present)}
    rest = [m for m in runs if m != "Outlaw"]  # Outlaw (point actif unique, hardpoint) a une autre vitesse : la mesure des cartes de domination est donnée sans elle
    out["sans_outlaw"] = summarize(sum((runs[m] for m in rest), []), sum((pairs[m] for m in rest), []), max_present)
    out["cartes"] = {m: summarize(runs[m], pairs[m], max_present) for m in sorted(runs)}
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description="Mesure la vitesse de capture d'un point selon le nombre de joueurs dessus (lecture de la vidéo, rien d'écrit dans la base).")
    parser.add_argument("--game", type=int, action="append", required=True, help="numéro de game (répétable : une game à la fois, dans l'ordre)")
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--out", default=None, help="fichier JSON de résultat (sinon affichage seul)")
    parser.add_argument("--settle", type=float, default=SETTLE_S)
    args = parser.parse_args(argv)
    import db

    conn = db.connect(args.db)
    results = []
    for g in args.game:
        res = analyse_game(conn, g, args.settle)
        if res is None:
            print(f"game {g} : rien à mesurer (vidéo, suivi ou hexagone absent)")
            continue
        results.append(res)
        print(f"  {len(res['runs'])} plages, images douteuses {res['unsure_share']:.1%}, lignes vivantes de confiance basse {res['lignes_vivantes_confiance_basse']:.1%}, première montée {res['first_rise_s']}")
    summary = aggregate(results)
    print(json.dumps(summary, indent=1, ensure_ascii=False))
    if args.out:
        params = {k: v for k, v in globals().items() if k.isupper() and isinstance(v, (int, float, tuple, dict))}
        meta = {"date": "2026-10-16", "base": "copie de la base (lecture seule)", "methode": __doc__.split(chr(10) * 2)[1][:1500]}
        Path(args.out).write_text(json.dumps({"meta": meta, "parametres": params, "resume": summary, "games": [{k: v for k, v in r.items() if k not in ("runs", "pairs", "series")} for r in results], "plages": [p for r in results for p in r["runs"]], "paires": [p for r in results for p in r["pairs"]]},
                                             indent=1, ensure_ascii=False), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
