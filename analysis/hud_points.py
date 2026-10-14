"""Lecture du HUD des points sous le chrono (hexagones des points de capture) : `python analysis/hud_points.py --game N [--db chemin] [--dry-run]`.

Sous le chrono le jeu dessine un hexagone par point, avec sa lettre (zone de calibration `capture_points`, une image par seconde, `timer.iter_crops`). Ce qui se lit (mesuré sur Atlantis, Engine, Outlaw, Polaris) :
- remplissage plein orange (équipe A) ou bleu (équipe B) : le point appartient à cette équipe, plus de liseré blanc ;
- liseré blanc et intérieur sombre : point neutre ; sa lettre est grise s'il est inactif et BLANCHE s'il est actif (Atlantis, Outlaw) ;
- remplissage partiel monté depuis le bas : capture en cours (la couleur du bas est celle de l'équipe qui capture). Règle prise ici : le propriétaire est la couleur du HAUT de l'hexagone (le
  propriétaire avant la fin de la capture, neutre si le haut est vide) ; l'intérieur est translucide (le décor se voit à travers un hexagone neutre), d'où des seuils de couleur serrés.
Selon la carte :
- Engine : trois hexagones « B A C » toujours colorés selon leur propriétaire (le propriétaire de CHAQUE point se lit ici, pas sur la minimap) ; tous les points sont toujours actifs ;
- Atlantis : trois hexagones « B A C », un seul est lumineux (coloré ou lettre blanche) à la fois : c'est le point ACTIF, les autres sont éteints (leur propriétaire ne se voit pas) ;
- Outlaw : cinq hexagones (« A B C » en haut, « D E » en bas), un seul lumineux à la fois (point actif, change toutes les 1 min 30) ; la zone calibrée de l'utilisateur (table `calibrations`) contient les deux rangées ;
- cartes à un point : un seul hexagone « A » (centre de la zone).
Les positions des hexagones sont écrites en fractions de l'ÉCRAN (pas de la zone) : une zone recalibrée ne les déplace pas, un hexagone hors de l'image n'est pas lu.

Lissage : trous illisibles courts comblés quand les deux bords sont identiques, accidents d'une seconde effacés (`point_owner.clean_labels`) ; le point actif se lit avec des seuils plus larges (trou de
MAX_ACTIVE_GAP_S entre deux lectures du même point, plage de moins de MIN_ACTIVE_RUN_S effacée) car la lettre blanche d'un point neutre est fine et se perd sur un décor clair.
Sorties : segments de `point_owner` (source `hud`) et de `point_active` (source `hud`), en secondes depuis le début de la game. Écrites par `point_owner.compute` (contrat commun des modules Stats)."""

import argparse
import os
import sys

import numpy as np
import paths

STEP_S = 1.0  # une image par seconde
# seuils de couleur (HSV d'OpenCV) mesurés sur les remplissages réels : orange H 13 à 15, S 220 et plus, V 250 ; bleu H 105, S 200, V 250 ; un décor bleu vif a H 100 à 103 et V 183 : refusé
ORANGE_HSV = ((10, 19), 180, 215)  # (plage de teinte), saturation min, valeur min
BLUE_HSV = ((103, 108), 150, 200)
WHITE_MIN = 205  # canal minimal d'un pixel « blanc » (lettre d'un point actif)
RING_WHITE_MIN = 190  # liseré blanc de l'hexagone d'un point neutre
STRIP_MIN = 0.5
CAP_MIN = 0.4  # part du bord du haut pour le liseré de l'ancien propriétaire  # part d'une bande de l'hexagone qui doit avoir la couleur pour la retenir
DARK_MIN = 0.75  # part des bandes de l'hexagone plus sombre que DARK_BELOW pour que la lettre blanche compte (sur un décor clair l'intérieur translucide est clair : lettre noyée)
DARK_BELOW = 70
WL_MIN = 0.03  # part de la boîte de la lettre en blanc pour dire « lettre blanche » (inactif : 0,00 ; actif 0,05 à 0,50 mesuré)
RING_MIN = 0.25  # part du liseré en blanc au-dessous de laquelle un hexagone sans couleur n'est pas un hexagone neutre (HUD absent, écran noir)
MAX_ACTIVE_GAP_S = 20.0  # point actif : trou de lecture comblé entre deux lectures du même point
MIN_COLOR_RUN_S = 3.0  # un point coloré moins longtemps que cela est un reflet du décor (mesuré : des éclairs d'une seconde sur un décor bleu vif)
MIN_ACTIVE_RUN_S = 6.0  # point actif : une plage plus courte n'est pas un changement de point (le point change au plus toutes les 90 s)

# zones de référence (x, y, w, h en fractions de l'écran) dans lesquelles les hexagones ont été mesurés
REF_ZONE = (0.47, 0.125, 0.06, 0.07)  # zone par défaut (une rangée)
REF_ZONE_OUTLAW = (0.47, 0.125, 0.06428816466552316, 0.09744425385934821)  # zone calibrée d'Outlaw (deux rangées)
# centres et demi-tailles (largeur, hauteur) des hexagones dans la zone de référence, fractions de la zone : médianes de 900 lectures de remplissage plein
THREE = {"B": (0.268, 0.492), "A": (0.520, 0.492), "C": (0.772, 0.492)}
THREE_HALF = (0.114, 0.158)
ONE = {"A": (0.521, 0.492)}
OUTLAW = {"A": (0.159, 0.361), "B": (0.486, 0.363), "C": (0.816, 0.364), "D": (0.306, 0.758), "E": (0.640, 0.758)}
OUTLAW_HALF = (0.147, 0.180)
ALWAYS, ACTIVE_ONLY = "always", "active_only"
MODES = {"Engine": ALWAYS, "Atlantis": ACTIVE_ONLY, "Outlaw": ACTIVE_ONLY}


# ---------------------------------------------------------------- disposition des hexagones

def _absolute(centres, half, ref):
    """Centres et demi-tailles passés des fractions de la zone de référence aux fractions de l'écran : {lettre: (cx, cy, hw, hh)}."""
    zx, zy, zw, zh = ref
    return {k: (zx + cx * zw, zy + cy * zh, half[0] * zw, half[1] * zh) for k, (cx, cy) in centres.items()}


LAYOUTS = {
    "Engine": _absolute(THREE, THREE_HALF, REF_ZONE),
    "Atlantis": _absolute(THREE, THREE_HALF, REF_ZONE),
    "Outlaw": _absolute(OUTLAW, OUTLAW_HALF, REF_ZONE_OUTLAW),
}
ONE_LAYOUT = _absolute(ONE, THREE_HALF, REF_ZONE)  # toutes les autres cartes (un point nommé A)


def layout_for(map_name, zone):
    """(mode, {lettre: (cx, cy, hw, hh)}) d'une carte, en fractions de l'IMAGE recadrée sur `zone` ({x, y, w, h}) ; les hexagones qui sortent de l'image sont retirés. Mode « always » (propriétaire
    toujours visible) ou « active_only » (un seul lumineux) ; les cartes à un point sont en « always »."""
    absolute = LAYOUTS.get(map_name, ONE_LAYOUT)
    out = {}
    for k, (cx, cy, hw, hh) in absolute.items():
        rel = ((cx - zone["x"]) / zone["w"], (cy - zone["y"]) / zone["h"], hw / zone["w"], hh / zone["h"])
        if rel[0] - rel[2] >= -0.02 and rel[0] + rel[2] <= 1.02 and rel[1] - rel[3] >= -0.02 and rel[1] + rel[3] <= 1.02:
            out[k] = rel
    return MODES.get(map_name, ALWAYS), out


def hex_masks(shape, cx, cy, hw, hh):
    """Masques d'un hexagone (côtés à gauche et à droite, dessus et dessous plats) sur une image de forme `shape` : bande du haut, bande du bas, boîte de la lettre, liseré."""
    h, w = shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    u, v = ((xs + 0.5) / w - cx) / hw, ((ys + 0.5) / h - cy) / hh
    au, av = np.abs(u), np.abs(v)
    dist = np.maximum(av, au + av / 2)  # 1 sur le bord de l'hexagone
    return {
        "top": (au < 0.45) & (v >= -0.7) & (v <= -0.35),
        "bot": (au < 0.45) & (v >= 0.35) & (v <= 0.7),
        "cap": (au < 0.4) & (v >= -0.95) & (v <= -0.7),  # bord du haut : le liseré fin de l'ancien propriétaire quand une capture a presque rempli l'hexagone
        "tb": (au < 0.45) & (av >= 0.35) & (av <= 0.7),  # les deux bandes ensemble
        "letter": (au < 0.4) & (av < 0.5),
        "ring": (dist >= 0.82) & (dist <= 1.1),
    }


# ---------------------------------------------------------------- lecture d'une image

def color_planes(frame):
    """Masques (orange, bleu, blanc) de toute l'image : pixels d'un remplissage plein de l'équipe A ou B, pixels presque blancs (lettre, liseré)."""
    import cv2

    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    hue, sat, val = hsv[..., 0].astype(np.int16), hsv[..., 1].astype(np.int16), hsv[..., 2].astype(np.int16)
    (o_lo, o_hi), o_sat, o_val = ORANGE_HSV
    (b_lo, b_hi), b_sat, b_val = BLUE_HSV
    orange = (hue >= o_lo) & (hue <= o_hi) & (sat >= o_sat) & (val >= o_val)
    blue = (hue >= b_lo) & (hue <= b_hi) & (sat >= b_sat) & (val >= b_val)
    return orange, blue, frame.min(axis=2)


def _strip(orange, blue, minimum=None):
    """Couleur d'une bande de l'hexagone : « A » (orange), « B » (bleu) ou None (ni l'un ni l'autre sur la part `minimum` de la bande, STRIP_MIN par défaut)."""
    minimum = STRIP_MIN if minimum is None else minimum
    if orange >= minimum and orange >= blue:
        return "A"
    if blue >= minimum:
        return "B"
    return None


def read_hexagon(planes, masks):
    """État d'un hexagone : {"owner": « A », « B », « none » ou None (hexagone absent ou illisible), "contested": bool (remplissage partiel), "lit": 0 à 1 (1 coloré, 0,5 lettre blanche, 0 éteint),
    "wl": part de lettre blanche}. Propriétaire : couleur du haut ; haut vide et bas coloré : capture d'un point neutre (propriétaire « none », contesté)."""
    orange, blue, minc = planes
    share = lambda mask, plane: float(plane[mask].mean()) if mask.any() else 0.0
    top = _strip(share(masks["top"], orange), share(masks["top"], blue))
    bot = _strip(share(masks["bot"], orange), share(masks["bot"], blue))
    if top or bot:  # remplissage monté presque jusqu'en haut : il reste un liseré de l'ancien propriétaire, qui l'emporte sur la bande du haut
        top = _strip(share(masks["cap"], orange), share(masks["cap"], blue), CAP_MIN) or top
    wl = share(masks["letter"], minc > WHITE_MIN)
    dark = share(masks["tb"], minc < DARK_BELOW)
    ring = share(masks["ring"], minc > RING_WHITE_MIN)
    if top or bot:
        owner = top or "none"
        return {"owner": owner, "contested": top != bot, "lit": 1.0, "wl": wl}
    if ring >= RING_MIN:
        return {"owner": "none", "contested": False, "lit": 0.5 if wl >= WL_MIN and dark >= DARK_MIN else 0.0, "wl": wl}
    return {"owner": None, "contested": False, "lit": 0.0, "wl": wl}


def read_frame(frame, layout, masks_cache):
    """États des hexagones d'une image : {lettre: état}. `masks_cache` : dict réutilisé d'une image à l'autre (les masques ne dépendent que de la forme)."""
    planes = color_planes(frame)
    out = {}
    for letter, (cx, cy, hw, hh) in layout.items():
        key = (frame.shape[:2], letter)
        if key not in masks_cache:
            masks_cache[key] = hex_masks(frame.shape, cx, cy, hw, hh)
        out[letter] = read_hexagon(planes, masks_cache[key])
    return out


# ---------------------------------------------------------------- point actif et propriétaires par seconde

def active_labels(readings, letters):
    """Point le plus lumineux de chaque seconde (lettre ou None) : coloré avant lettre blanche, à égalité la lettre la plus blanche."""
    out = []
    for states in readings:
        best, key = None, (0.0, 0.0)
        for k in letters:
            s = states[k]
            if s["lit"] > 0 and (s["lit"], s["wl"]) > key:
                best, key = k, (s["lit"], s["wl"])
        out.append(best)
    return out


def drop_short_runs(labels, min_s, step_s=STEP_S):
    """Efface (None) les plages de moins de `min_s` secondes (accidents d'un décor clair)."""
    import point_owner as po

    out = list(labels)
    for a, b, v in po._runs(labels):
        if v is not None and (b - a) * step_s < min_s:
            out[a:b] = [None] * (b - a)
    return out


def clean_active(labels, step_s=STEP_S):
    """Lissage d'une série de point actif : accidents comblés, plages trop courtes effacées, puis trous longs comblés entre deux lectures du même point."""
    import point_owner as po

    out = po.clean_labels(labels, step_s, max_gap_s=MAX_ACTIVE_GAP_S, min_run_s=MIN_ACTIVE_RUN_S)
    out = drop_short_runs(out, MIN_ACTIVE_RUN_S, step_s)
    return po.clean_labels(out, step_s, max_gap_s=MAX_ACTIVE_GAP_S, min_run_s=MIN_ACTIVE_RUN_S)


def decode(readings, mode, letters, step_s=STEP_S):
    """Séries par seconde : {"owner": {lettre: [A, B, none ou None]}, "active": [liste des lettres actives de chaque seconde], "contested": {lettre: [bool]}}.
    Mode « always » (Engine, cartes à un point) : propriétaire de chaque hexagone à chaque seconde, tous actifs tant que lisibles. Mode « active_only » : seuls les hexagones lumineux ont un propriétaire
    (les autres sont éteints). Le point le plus lumineux est toujours actif, les autres points colorés aussi : Atlantis allume ses trois points dans les dernières secondes, Outlaw garde le point précédent allumé
    pendant les dernières minutes (mesuré sur la game 32 : D reste allumé quand B s'allume à 3:55)."""
    import point_owner as po

    n = len(readings)
    if mode == ACTIVE_ONLY:
        best = clean_active(active_labels(readings, letters), step_s)  # le point le plus lumineux (lettre blanche ou couleur), un par seconde
        lit = {k: [b == k for b in best] for k in letters}
        for k in letters:  # d'autres points colorés en même temps (preuve solide, pas de lettre blanche fine) : actifs aussi (Atlantis final, Outlaw : le point précédent reste allumé)
            raw_colored = [k if s[k]["lit"] >= 1.0 else None for s in readings]
            colored = drop_short_runs(po.clean_labels(raw_colored, step_s, max_gap_s=MAX_ACTIVE_GAP_S, min_run_s=MIN_COLOR_RUN_S), MIN_COLOR_RUN_S, step_s)
            lit[k] = [a or c is not None for a, c in zip(lit[k], colored)]
        raw = {k: [s[k]["owner"] if lit[k][i] else None for i, s in enumerate(readings)] for k in letters}
        active = [[k for k in letters if lit[k][i]] for i in range(n)]
    else:
        raw = {k: [s[k]["owner"] for s in readings] for k in letters}
    owner = {k: po.clean_labels(v, step_s) for k, v in raw.items()}
    if mode != ACTIVE_ONLY:  # tous les points sont toujours actifs : « actif » = lisible
        active = [[k for k in letters if owner[k][i] is not None] for i in range(n)]
    contested = {k: [bool(s[k]["contested"]) for s in readings] for k in letters}
    return {"owner": owner, "active": active, "contested": contested}


# ---------------------------------------------------------------- segments

def owner_segments(times, owner, step_s=STEP_S):
    """Segments {point, t0, t1, owner, source « hud »} : un par plage de même propriétaire et par lettre (les secondes illisibles coupent)."""
    import point_owner as po

    out = []
    for letter, labels in owner.items():
        out += po.to_segments(letter, times, labels, ["hud"] * len(labels), step_s)
    return sorted(out, key=lambda s: (s["t0"], s["point"]))


def active_segments(times, active, letters, step_s=STEP_S):
    """Segments {point, t0, t1, source « hud »} du point actif : un par lettre et par plage où la lettre est active (`active` : liste des lettres actives de chaque seconde)."""
    import point_owner as po

    out = []
    for k in letters:
        for a, b, v in po._runs([k in act for act in active]):
            if v:
                out.append({"point": k, "t0": round(float(times[a]), 2), "t1": round(float(times[b - 1]) + step_s, 2), "source": "hud"})
    return sorted(out, key=lambda s: (s["t0"], s["point"]))


# ---------------------------------------------------------------- accords

def agreement_with_box(box, hud):
    """Accord de la boîte avec le HUD sur les secondes où les deux lisent quelque chose : {"compared", "agree", "box_only", "hud_only"} (box_only : lue par la boîte seule, hud_only : par le HUD seul)."""
    out = {"compared": 0, "agree": 0, "box_only": 0, "hud_only": 0}
    for b, h in zip(box, hud):
        if b is not None and h is not None:
            out["compared"] += 1
            out["agree"] += b == h
        elif b is not None:
            out["box_only"] += 1
        elif h is not None:
            out["hud_only"] += 1
    return out


def agreement_with_score(hud, capture):
    """Accord du HUD avec la pente des scores (trois points : Atlantis, Engine). `hud` : résultat de hud_points.analyse. Une seconde est comparée quand une seule équipe voit son score monter et que
    le HUD lit au moins un propriétaire : `agree` si cette équipe tient au moins un point (Atlantis : le point actif, ou l'un des points allumés). Engine (trois hexagones lisibles à la fois) :
    `compared_majority` / `agree_majority` sur les secondes où les trois sont lus et où une équipe en tient plus que l'autre : celle qui monte doit en tenir le plus (mesuré : c'est la règle du jeu).
    Clés `*_calm` : même mesure hors de po.TRANSITION_S autour d'un changement de propriétaire d'un hexagone (la pente retarde)."""
    import point_owner as po

    times, letters = hud["times"], hud["letters"]
    score = po.score_labels(capture, times)
    changes = []
    for k in letters:
        lab = hud["owner"][k]
        changes += [times[i] for i in range(1, len(lab)) if lab[i] is not None and lab[i - 1] is not None and lab[i] != lab[i - 1]]
    out = {"compared": 0, "agree": 0, "compared_calm": 0, "agree_calm": 0, "compared_majority": 0, "agree_majority": 0}
    for i, (t, team) in enumerate(zip(times, score)):
        owners = [hud["owner"][k][i] for k in letters]
        known = [o for o in owners if o is not None]
        if team is None or not known:
            continue
        ok = team in known
        calm = all(abs(t - c) > po.TRANSITION_S for c in changes)
        out["compared"] += 1
        out["agree"] += ok
        if calm:
            out["compared_calm"] += 1
            out["agree_calm"] += ok
        if hud["mode"] == "always" and len(known) == len(owners) and len(owners) > 1:
            a, b = owners.count("A"), owners.count("B")
            if a != b:
                out["compared_majority"] += 1
                out["agree_majority"] += (a > b) == (team == "A")
    return out


# ---------------------------------------------------------------- lecture d'une game

def video_frames(conn, game):
    """Images du HUD (t en secondes depuis le début de la game, image BGR recadrée sur la zone capture_points) ; rien si la vidéo est absente. `game` : ligne de point_owner._game."""
    import db
    import timer

    if not game["path"] or not os.path.exists(game["path"]):
        return
    zone = db.zone_for(conn, game["map"], "capture_points")
    for t, im in timer.iter_crops(game["path"], zone, game["width"], game["height"], step_s=STEP_S, t0=game["start_s"], t1=game["end_s"]):
        yield t - game["start_s"], im


def read_series(frames, map_name, zone):
    """Lit les images (liste [(t, image)]) : (mode, lettres, secondes, états par seconde). Aucune image ou aucun hexagone dans la zone : états vides."""
    mode, layout = layout_for(map_name, zone)
    cache = {}
    times = [t for t, _ in frames]
    readings = [read_frame(im, layout, cache) for _, im in frames] if layout else []
    return mode, list(layout), times, readings


def analyse(conn, game_id, frames=None):
    """Lit le HUD d'une game. `frames` : images [(t en secondes de game, image)] à la place de la vidéo (tests). Renvoie None si la game n'existe pas ou sans image, sinon
    {"mode", "letters", "times", "owner": {lettre: [étiquettes]}, "active": [...], "contested": {...}, "owner_segments", "active_segments", "stats"}."""
    import db
    import point_owner as po

    game = po._game(conn, game_id)
    if not game:
        return None
    frames = list(frames) if frames is not None else list(video_frames(conn, game))
    if not frames:
        return None
    zone = db.zone_for(conn, game["map"], "capture_points")
    mode, letters, times, readings = read_series(frames, game["map"], zone)
    if not letters:
        return None
    dec = decode(readings, mode, letters)
    n = len(times)
    seen = [any(dec["owner"][k][i] is not None for k in letters) for i in range(n)]
    stats = {
        "seconds": n, "readable": sum(seen), "mode": mode,
        "visible": sum(1 for states in readings if any(st["owner"] is not None for st in states.values())),  # secondes où le HUD se voit (hexagone coloré ou liseré blanc)
        "active_known": sum(1 for a in dec["active"] if a),
        "contested": {k: sum(dec["contested"][k]) for k in letters},
    }
    return {
        "mode": mode, "letters": letters, "times": times, "owner": dec["owner"], "active": dec["active"], "contested": dec["contested"],
        "owner_segments": owner_segments(times, dec["owner"]), "active_segments": active_segments(times, dec["active"], letters), "stats": stats,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Lit les hexagones des points sous le chrono (HUD) et affiche les segments (rien n'est écrit : voir point_owner.py).")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--db", default=str(paths.db_path()))
    args = parser.parse_args(argv)
    import db

    conn = db.connect(args.db)
    result = analyse(conn, args.game)
    if not result:
        print("rien à lire : game absente, vidéo absente ou carte sans hexagone")
        return 0
    for seg in result["owner_segments"]:
        print(f"  point {seg['point']} {seg['t0']:6.1f} s à {seg['t1']:6.1f} s : {seg['owner']}")
    for seg in result["active_segments"]:
        print(f"  actif {seg['point']} {seg['t0']:6.1f} s à {seg['t1']:6.1f} s")
    s = result["stats"]
    print(f"{s['seconds']} secondes lues, {s['readable']} avec au moins un hexagone lisible, mode {s['mode']}, contestées {s['contested']}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
