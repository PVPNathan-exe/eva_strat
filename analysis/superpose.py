"""Superposition du suivi calculé sur la vraie minimap : chaque position est-elle confirmée par les pixels ?

  python analysis/superpose.py --game 26                      positions enregistrées dans la base
  python analysis/superpose.py --game 26 --rows lignes.pkl    autres positions (liste de lignes du suivi) pour comparer

À une image par seconde, on regarde la vraie minimap autour de chaque position vivante calculée : une pastille de la couleur de l'équipe doit s'y trouver
(un disque blanc pour le joueur observé que les bandeaux désignent). Une position sans pastille autour d'elle est « non confirmée » : joueur placé là où il n'y a
rien (traversée de mur, saut sur un disque d'attente, trou mal comblé). Les positions reconstituées (trou comblé, joueur caché sous un autre) peuvent à bon droit
n'être pas confirmées : le taux de positions lues non confirmées est le vrai indicateur d'erreur. Aucune écriture dans la base."""

import argparse
import math
import pickle
import sys

import cv2
import numpy as np

import db
import minimap
import timer
import paths

RADIUS = 0.022  # rayon (fraction de la largeur de la minimap) autour de la position où l'on cherche la pastille
MIN_TEAM_PIXELS = 50  # pixels de la couleur d'équipe pour confirmer une pastille (une pastille pleine en fait environ 180)
MIN_WHITE_PIXELS = 50  # pixels blancs pour confirmer le disque du joueur observé
READ_CONF = 0.7


def _disc(shape, x, y):
    h, w = shape[:2]
    r = RADIUS * w
    yy, xx = np.mgrid[0:h, 0:w]
    return (xx - x * w) ** 2 + (yy - y * h) ** 2 <= r * r


def supported(hsv, row, observed):
    """Vrai si la vraie minimap montre, autour de la position de la ligne, de quoi la confirmer."""
    _, _, _, team, x, y, _, alive, _ = row
    near = _disc(hsv.shape, x, y)
    bounds = (minimap.ORANGE_DIM, minimap.ORANGE) if team == "A" else (minimap.BLUE_DIM, minimap.BLUE)
    colour = cv2.inRange(hsv, np.array(bounds[0][0]), np.array(bounds[0][1])) > 0
    if int((colour & near).sum()) >= MIN_TEAM_PIXELS:
        return True
    if observed:
        white = (hsv[:, :, 2] >= 205) & (hsv[:, :, 1] <= 70)
        return int((white & near).sum()) >= MIN_WHITE_PIXELS
    return False


def check(video, game, zone, width, height, step_s, row_sets, states=None, every_s=1.0):
    """Pour chaque jeu de lignes ({nom: lignes}), renvoie {nom: {"vues", "lues", "lues_non_confirmees", "autres_non_confirmees", "liste"}}.
    states : états des bandeaux ({indice: {slot: {"alive", "spectated"}}}) pour savoir quel joueur est observé."""
    by = {name: {} for name in row_sets}
    for name, rows in row_sets.items():
        for r in rows:
            by[name].setdefault(r[0], []).append(r)
    out = {name: {"vues": 0, "lues": 0, "lues_non_confirmees": 0, "autres_non_confirmees": 0, "liste": []} for name in row_sets}
    stride = max(1, round(every_s / step_s))
    # Les images sont lues à la cadence de l'analyse (et non à celle de la vérification) : un échantillonnage plus lent de ffmpeg tombe au milieu de l'intervalle,
    # soit environ une demi-période plus tard que l'image d'analyse correspondante (mesuré : 69 % de positions confirmées avec ce décalage, 91 % sans).
    for fi, (t, crop) in enumerate(timer.iter_crops(video, zone, width, height, step_s=step_s, t0=game["start_s"], t1=game["end_s"])):
        if fi % stride:
            continue
        hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
        watched = [s for s, v in (states or {}).get(fi, {}).items() if v["spectated"]]
        for name in row_sets:
            for row in by[name].get(fi, []):
                if not row[7]:
                    continue
                ok = supported(hsv, row, len(watched) == 1 and watched[0] == row[2])
                res = out[name]
                res["vues"] += 1
                read = row[8] >= READ_CONF
                res["lues"] += read
                if not ok:
                    res["lues_non_confirmees" if read else "autres_non_confirmees"] += 1
                    res["liste"].append((round(t - game["start_s"], 1), row[2], round(row[4], 2), round(row[5], 2), round(row[8], 2), len(watched) == 1 and watched[0] == row[2], fi))
    return out


def store_flags(conn, game, video, width, height, step_s, states):
    """Contrôle toutes les positions enregistrées d'une game à la vraie minimap et enregistre celles qui ne sont pas confirmées (le site les cercle en rouge).
    game : ligne de games (id, start_s, end_s, map) ; states : états des bandeaux de la lecture. Renvoie le nombre de positions non confirmées."""
    stored = [(r["frame"], 0.0, r["slot"], r["team"], r["x"], r["y"], r["angle"], r["alive"], r["confidence"]) for r in conn.execute("SELECT * FROM samples WHERE game_id = ?", (game["id"],))]
    result = check(video, game, db.zone_for(conn, game["map"], "minimap"), width, height, step_s, {"base": stored}, states, every_s=step_s)["base"]
    db.replace_flags(conn, game["id"], "unconfirmed", [(r[6], r[1]) for r in result["liste"]])
    return len(result["liste"])


def report(name, res):
    n, bad_read, bad_other = res["vues"], res["lues_non_confirmees"], res["autres_non_confirmees"]
    print(f"{name}: {n} positions vivantes vérifiées ; non confirmées : {bad_read + bad_other} ({(bad_read + bad_other) / max(n, 1) * 100:.1f} %), "
          f"dont lues avec certitude {bad_read} sur {res['lues']} ({bad_read / max(res['lues'], 1) * 100:.1f} %) et reconstituées {bad_other} sur {n - res['lues']}")


def main(argv=None):
    import evaluate

    parser = argparse.ArgumentParser(description="Vérifie le suivi enregistré en le superposant à la vraie minimap.")
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--rows", default=None, help="fichier pickle de lignes du suivi à comparer à celles de la base")
    parser.add_argument("--store", action="store_true", help="contrôle toutes les images et enregistre dans la base les positions non confirmées (affichées par le site)")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    g = dict(conn.execute("SELECT g.*, v.path, v.width, v.height, v.fps FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (args.game,)).fetchone())
    step = 6 / g["fps"]
    stored = [(r["frame"], 0.0, r["slot"], r["team"], r["x"], r["y"], r["angle"], r["alive"], r["confidence"]) for r in conn.execute("SELECT * FROM samples WHERE game_id = ?", (args.game,))]
    sets = {"base": stored}
    if args.rows:
        sets["autres"] = pickle.load(open(args.rows, "rb"))
    states = evaluate._load(conn, g, step)["states"]
    every = step if args.store else 1.0  # --store : toutes les images (le site marque chaque position)
    results = check(g["path"], g, db.zone_for(conn, g["map"], "minimap"), g["width"], g["height"], step, sets, states, every_s=every)
    for name, res in results.items():
        report(name, res)
    if args.store:
        bad = results["base"]["liste"]
        db.replace_flags(conn, args.game, "unconfirmed", [(r[6], r[1]) for r in bad])
        print(f"{len(bad)} positions non confirmées enregistrées pour la game {args.game}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
