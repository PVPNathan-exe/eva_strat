"""Compare ta version d'une partie du programme à celle de GitHub, avec une mesure, pour décider laquelle garder (`npm run comparer`).

Deux mesures existent, les autres parties (noms d'armes, modèles de chiffres) n'en ont pas : le verdict est alors « inconnu » et c'est toi qui décides.
- masks : masque d'une carte. Part de TES positions lues avec certitude qu'il refuserait (`map_mask.share_outside`, plus bas = mieux, un masque juste en rejette 0,05 % ou moins),
  avec la surface praticable en contrôle (un masque tout blanc ne rejette rien et ne vaut rien). Il faut assez de positions de cette carte dans ta base (`MIN_POINTS`).
- params : réglages du suivi. Note `tune.evaluate` (plus haut = mieux) sur les jeux de données du dépôt, les mêmes pour les deux versions : ceux de ton dossier et ceux de GitHub réunis.

Sortie JSON : verdict `local`, `github`, `equivalent` ou `inconnu`, les chiffres des deux côtés et la raison."""

import argparse
import json
import sys
from pathlib import Path

import cv2
import db
import map_mask
import paths
import tracking
import tune

MIN_POINTS = 500  # positions sûres minimales d'une carte pour juger un masque
TIE_REJECT = 0.0005  # écart de rejet (0,05 point) en dessous duquel deux masques sont équivalents
BIG_AREA = 1.25  # un masque dont la surface praticable dépasse de 25 % celle de l'autre mérite un avertissement
TIE_OBJECTIVE = 0.5  # écart de note du suivi en dessous duquel deux réglages sont équivalents


def _load_mask(path):
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE) if Path(path).exists() else None
    return None if img is None else img > 127


def mask_verdict(local_reject, other_reject, local_area, other_area):
    """Verdict de deux masques d'après leur rejet (plus bas = mieux) et leur surface : ('local' | 'github' | 'equivalent', avertissement ou None)."""
    if abs(local_reject - other_reject) < TIE_REJECT:
        return "equivalent", None
    winner = "local" if local_reject < other_reject else "github"
    w_area, l_area = (local_area, other_area) if winner == "local" else (other_area, local_area)
    warning = "le masque gagnant est nettement plus large : il rejette moins parce qu'il laisse passer plus de sol, à vérifier à l'œil" if l_area and w_area > BIG_AREA * l_area else None
    return winner, warning


def compare_masks(conn, map_name, other_analysis_dir, min_points=MIN_POINTS):
    """Compare le masque local de `map_name` à celui du dossier `analysis` de l'autre version, sur les positions sûres de la base."""
    local = map_mask.load(map_name)
    other = _load_mask(Path(other_analysis_dir) / "map_masks" / f"{map_name}.png")
    if local is None or other is None:
        return {"part": "masques", "map": map_name, "verdict": "inconnu", "reason": "pas de masque de cette carte " + ("chez toi" if local is None else "sur GitHub")}
    points = map_mask.read_points(conn, map_name)
    if len(points) < min_points:
        return {"part": "masques", "map": map_name, "verdict": "inconnu", "points": len(points),
                "reason": f"{len(points)} positions sûres de cette carte seulement dans ta base (minimum {min_points}) : analyse d'abord des games de cette carte"}
    lr, orr = map_mask.share_outside(local, points), map_mask.share_outside(other, points)
    la, oa = float(local.mean()), float(other.mean())
    verdict, warning = mask_verdict(lr, orr, la, oa)
    return {"part": "masques", "map": map_name, "verdict": verdict, "points": len(points), "warning": warning,
            "local": {"rejected": round(lr, 5), "area": round(la, 4)}, "github": {"rejected": round(orr, 5), "area": round(oa, 4)}}


def params_from_file(path):
    """Réglages d'un fichier tracking_params.json (dictionnaire vide s'il manque)."""
    p = Path(path)
    return json.loads(p.read_text(encoding="utf-8")).get("params", {}) if p.exists() else {}


def datasets_union(*folders):
    """Jeux de données de plusieurs dossiers, sans doublon de nom (le premier dossier l'emporte)."""
    seen, out = set(), []
    for folder in folders:
        if folder and Path(folder).exists():
            for ds in tune.load_datasets(folder):
                if ds["name"] not in seen:
                    seen.add(ds["name"])
                    out.append(ds)
    return out


def objective_verdict(local_obj, other_obj):
    if abs(local_obj - other_obj) < TIE_OBJECTIVE:
        return "equivalent"
    return "local" if local_obj > other_obj else "github"


def compare_params(other_analysis_dir):
    """Compare les réglages du suivi locaux à ceux de GitHub sur les mêmes jeux de données (ceux des deux dossiers réunis)."""
    other_file = Path(other_analysis_dir) / "tracking_params.json"
    if not other_file.exists():
        return {"part": "suivi", "verdict": "inconnu", "reason": "pas de réglages du suivi sur GitHub"}
    datasets = datasets_union(tune.DATASETS_DIR, Path(other_analysis_dir) / "datasets")
    if not datasets:
        return {"part": "suivi", "verdict": "inconnu", "reason": "aucun jeu de données pour noter les réglages"}
    saved = tracking.current_params()
    try:
        tracking.configure(params_from_file(tracking.PARAMS_PATH))
        local = tune.evaluate(datasets)
        tracking.configure(params_from_file(other_file))
        other = tune.evaluate(datasets)
    finally:
        tracking.configure(saved)  # le processus garde ses réglages d'origine
    pick = lambda m: {k: round(v, 4) if isinstance(v, float) else v for k, v in m.items()}
    return {"part": "suivi", "verdict": objective_verdict(local["objective"], other["objective"]), "datasets": [d["name"] for d in datasets], "local": pick(local), "github": pick(other)}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Compare une partie du programme à la version de GitHub.")
    parser.add_argument("part", choices=("masks", "params"))
    parser.add_argument("--other", required=True, help="Dossier analysis de l'autre version (GitHub)")
    parser.add_argument("--map", default=None)
    parser.add_argument("--db", default=str(paths.db_path()))
    args = parser.parse_args(argv)
    if args.part == "masks":
        if not args.map:
            parser.error("--map est obligatoire pour les masques")
        import sqlite3

        conn = sqlite3.connect(f"file:{Path(args.db).as_posix()}?mode=ro", uri=True)
        conn.row_factory = sqlite3.Row
        result = compare_masks(conn, args.map, args.other)
    else:
        result = compare_params(args.other)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
