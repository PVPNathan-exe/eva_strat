"""Aligne la minimap du jeu sur le plan stratégique d'une carte (celui de l'onglet Stratégie et du replay).

  python analysis/plan_align.py --map Polaris

Les positions sont normalisées sur la minimap du jeu ; le replay les dessine sur le plan. Un cadre trop approximatif met les joueurs dans les murs du plan (une
dérive de 4 % à droite sur Polaris avec le cadre par défaut). Les traits de murs de la minimap (analysis/map_masks/<Carte>_lignes.png, construits par map_mask.py) sont
recalés sur les contours blancs du plan par corrélation (ECC, transformation affine) ; le résultat est écrit sous forme de cadre (l, t, r, b : fractions des bords du plan
où tombent les bords de la minimap) dans analysis/map_plan_insets.json, lu par le site. Seules les cartes qui ont des traits de murs peuvent être alignées."""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
PLANS = HERE.parent / "src" / "assets" / "maps"
OUT = HERE / "map_plan_insets.json"
DEFAULT_INSET = (0.01, 0.022, 0.01, 0.045)  # cadre du replay quand la carte n'est pas alignée
WHITE_V, WHITE_S = 238, 35  # contour blanc du plan


def align(plan_bgr, lines):
    """Cadre (l, t, r, b) et corrélation de l'alignement des traits de murs de la minimap sur le plan."""
    h, w = plan_bgr.shape[:2]
    hsv = cv2.cvtColor(plan_bgr, cv2.COLOR_BGR2HSV)
    plan = ((hsv[:, :, 2] >= WHITE_V) & (hsv[:, :, 1] <= WHITE_S)).astype(np.float32)
    lh, lw = lines.shape
    il, it, ir, ib = DEFAULT_INSET
    start = np.array([[w * (1 - il - ir) / lw, 0, w * il], [0, h * (1 - it - ib) / lh, h * it]], np.float32)
    blur = lambda a: cv2.GaussianBlur(a, (0, 0), 3)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6)
    cc, inverse = cv2.findTransformECC(blur(plan), blur((lines > 0).astype(np.float32)), cv2.invertAffineTransform(start).astype(np.float32), cv2.MOTION_AFFINE, crit, None, 5)
    a = cv2.invertAffineTransform(inverse)  # pixels des traits -> pixels du plan
    x_scale, y_scale = a[0, 0] * lw / w, a[1, 1] * lh / h
    left, top = a[0, 2] / w, a[1, 2] / h
    return tuple(float(v) for v in (left, top, 1 - left - x_scale, 1 - top - y_scale)), float(cc)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Aligne la minimap sur le plan stratégique d'une carte.")
    parser.add_argument("--map", required=True)
    args = parser.parse_args(argv)
    lines_path = HERE / "map_masks" / f"{args.map}_lignes.png"
    plan_path = next((p for p in PLANS.glob("*") if p.stem.replace("_", " ").lower() == args.map.replace("_", " ").lower()), None)
    if not lines_path.exists() or plan_path is None:
        print(f"Il faut {lines_path.name} (map_mask.py) et un plan dans src/assets/maps pour la carte {args.map}.")
        return 1
    inset, cc = align(cv2.imread(str(plan_path)), cv2.imread(str(lines_path), 0))
    known = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    known[args.map] = {"l": round(inset[0], 4), "t": round(inset[1], 4), "r": round(inset[2], 4), "b": round(inset[3], 4), "correlation": round(cc, 3)}
    OUT.write_text(json.dumps(known, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{args.map} : cadre l={inset[0]:.4f} t={inset[1]:.4f} r={inset[2]:.4f} b={inset[3]:.4f} (corrélation {cc:.2f})")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
