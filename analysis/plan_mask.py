"""Recoupe le masque des zones praticables (cartographie à la main) avec le plan stratégique de la carte, pour corriger les erreurs de saisie.

  python analysis/plan_mask.py --map Atlantis    montre ce que le plan changerait (aucun fichier du programme n'est écrit)

Le plan (src/assets/maps/<Carte>.png) est un dessin net : les murs sont des traits et des blocs blancs, le sol est sombre. Posé sur la minimap avec le cadre d'alignement de la
carte (celui de la cartographie, ou map_plan_insets.json), il dit deux choses que la saisie à la main peut manquer :
  - un grand morceau de sol à l'intérieur de l'arène que la saisie n'a pas rendu praticable (une couleur oubliée : les pièces du dessous d'Atlantis) : il est ajouté ;
  - un mur du plan (trait ou bloc blanc) sur lequel la saisie dit « praticable » (un carré de capture dessiné trop large, la bordure d'une zone) : il est retiré ;
  - tout ce qui est hors de l'arène d'après le plan (au-delà du cadre blanc) : retiré aussi, car une couleur de sol saisie (le sol de l'étage, sombre) recouvre le fond de la minimap.
Les deux niveaux d'Atlantis et de The Cliff restent praticables : le plan ne retire que les murs et l'extérieur, jamais un niveau.
Règles de prudence : les classes que l'utilisateur a données explicitement (mur, tir par-dessus, vue seulement, porte) ne sont jamais écrasées par un ajout ; les petits blocs blancs
(lettres A B C, icônes des stations) ne sont pas des murs ; les petites taches de sol (décors) ne sont pas ajoutées ; les portes tracées restent praticables. Si la carte a des lectures sûres,
la correction est refusée quand elle ferait refuser plus de lectures qu'avant (`MAX_REFUSAL_RISE`). Le plan ne vaut que si son sol est dessiné sombre dans les couloirs et ses obstacles en blanc (cas d'Atlantis : +9 % de sol, 0,19 % puis 0,01 % de lectures sûres refusées) : une correction qui ajoute plus de `MAX_ADD_SHARE` du sol saisi, ou retire plus de `MAX_CUT_SHARE`, est refusée (les plans de Polaris et d'Artefact ajouteraient 190 % et 170 % : leurs blocs sombres ne sont pas du sol)."""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).parent
PLAN_DIR = HERE.parent / "src" / "assets" / "maps"
INSETS = HERE / "map_plan_insets.json"
WALL_MIN_VALUE = 200  # un pixel du plan dont les trois canaux dépassent cette valeur est blanc (mur)
WALL_MIN_AREA = 2500  # pixels du plan : en deçà, un bloc blanc est une lettre ou une icône, pas un mur
FILL_MIN_SHARE = 0.0075  # part de l'image : une tache de sol plus petite (un décor) n'est pas ajoutée
MAX_REFUSAL_RISE = 0.002  # hausse tolérée de la part des lectures sûres refusées
MAX_ADD_SHARE = 0.25  # le plan n'ajoute pas plus que cette part du sol saisi : au-delà, son sol n'est pas le même que celui de la minimap (Polaris et Artefact : +190 % et +170 %, plans dont les blocs sombres ne sont pas du sol)
MAX_CUT_SHARE = 0.15  # même garde-fou pour les retraits


def plan_file(map_name):
    """Image du plan de la carte (Atlantis.png, Reef_Point.png...), ou None."""
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        path = PLAN_DIR / f"{map_name.replace(' ', '_')}{ext}"
        if path.exists():
            return path
    return None


def wall_mask(plan):
    """Murs du plan (bool, résolution du plan) : pixels blancs des composantes assez grandes."""
    white = (plan.min(axis=2) >= WALL_MIN_VALUE).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(white, connectivity=8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= WALL_MIN_AREA
    return keep[lab]


def warp_to_grid(image, inset, width, height):
    """Plan recadré sur la minimap (cadre `inset`, fractions des bords du plan) à la taille width x height. Hors du plan : blanc."""
    h, w = image.shape[:2]
    x0, y0 = inset["l"] * w, inset["t"] * h
    x1, y1 = (1 - inset["r"]) * w, (1 - inset["b"]) * h
    sx, sy = (x1 - x0) / width, (y1 - y0) / height
    m = np.float32([[sx, 0, x0 + sx / 2 - 0.5], [0, sy, y0 + sy / 2 - 0.5]])
    return cv2.warpAffine(image, m, (width, height), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderValue=255)


def corrections(labels, sol_code, plan, inset, exclude=None):
    """(ajout, murs, hors_carte) : trois images bool de la taille de `labels`.
    ajout : sol du plan à l'intérieur de l'arène, sans classe (label 0), en taches assez grandes, hors des zones `exclude` (bool, facultatif) ;
    murs : murs du plan (à retirer du masque praticable de la saisie) ;
    hors_carte : tout ce qui est hors de l'arène d'après le plan (au-delà du cadre blanc) : une couleur de sol saisie (le sol de l'étage, sombre) y recouvre aussi le fond de la
    minimap, qui n'est pas du terrain. Une composante qui touche le bord de l'image mais porte la moitié du sol saisi (cadre ouvert, cadre mal aligné) n'est pas hors carte."""
    h, w = labels.shape
    walls = warp_to_grid((wall_mask(plan) * 255).astype(np.uint8), inset, w, h) > 127
    sealed = cv2.dilate(walls.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0  # referme les fuites d'un pixel du cadre
    n, comp = cv2.connectedComponents((~sealed).astype(np.uint8), connectivity=4)
    sol = labels == sol_code
    counts = np.bincount(comp[sol & ~sealed], minlength=n)
    counts[0] = 0
    outside = np.unique(np.concatenate([comp[0, :], comp[-1, :], comp[:, 0], comp[:, -1]]))  # composantes qui touchent le bord de l'image : l'extérieur du cadre
    inside_ids = np.setdiff1d(np.arange(1, n), outside)  # tout ce qui est enfermé par les murs du plan : l'arène (pièces du dessous comprises)
    with_sol = np.nonzero(counts >= max(1, 0.05 * sol.sum()))[0]  # et les composantes qui portent l'essentiel du sol saisi, même si elles touchent le bord
    interior = np.isin(comp, np.union1d(inside_ids, with_sol)) & ~walls
    leak = np.nonzero(counts >= 0.5 * sol.sum())[0]  # une composante qui touche le bord mais porte la moitié du sol saisi : cadre ouvert ou mal aligné, pas l'extérieur
    outside_ids = np.setdiff1d(outside, np.union1d([0], leak))
    exterior = np.isin(comp, outside_ids) & ~walls
    fill = np.zeros((h, w), bool)
    candidate = interior & (labels == 0)
    k, lab, stats, _ = cv2.connectedComponentsWithStats(candidate.astype(np.uint8), connectivity=8)
    for i in range(1, k):
        if stats[i, cv2.CC_STAT_AREA] >= FILL_MIN_SHARE * h * w:
            fill |= lab == i
    if exclude is not None:
        fill &= ~exclude  # zones laissées en trou à la main (anneaux tournants d'Engine)
    return fill, walls, exterior


def apply_to_walk(walk, fill, walls, protect, exterior=None):
    """Masque praticable corrigé : ajout du sol manquant, retrait des murs du plan (sauf sous les tracés `protect` : portes) et de tout ce qui est hors de l'arène."""
    out = walk | fill
    out &= ~walls | protect
    if exterior is not None:
        out &= ~exterior
    return out


def inset_of(map_name, annotation_inset=None):
    """Cadre minimap sur le plan : celui de la cartographie, sinon celui de map_plan_insets.json, sinon None."""
    if annotation_inset:
        return annotation_inset
    known = json.loads(INSETS.read_text(encoding="utf-8")) if INSETS.exists() else {}
    return known.get(map_name)


def main(argv=None):
    import sqlite3

    import map_annotations as ma

    parser = argparse.ArgumentParser(description="Montre ce que le plan stratégique changerait au masque d'une carte (lecture seule).")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--map", required=True)
    args = parser.parse_args(argv)
    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    raw = ma.annotation_of(conn, args.map)
    path = plan_file(args.map)
    median = cv2.imread(str(ma.MASK_DIR / f"{args.map}_mediane.png"))
    if raw is None or path is None or median is None:
        print(json.dumps({"map": args.map, "erreur": "pas d'annotation, de plan ou de médiane"}, ensure_ascii=False))
        return 1
    data = ma.validate(raw)
    inset = inset_of(args.map, data["inset"])
    if not inset:
        print(json.dumps({"map": args.map, "erreur": "pas de cadre d'alignement (outil Alignement)"}, ensure_ascii=False))
        return 1
    labels = ma.classify(median, data["colors"])
    ma.apply_overrides(labels, data["overrides"])
    fill, walls, exterior = corrections(labels, ma.CODES["sol"], cv2.imread(str(path)), inset)
    walk = ma.walkable_from_classes(labels)
    print(json.dumps({"map": args.map, "ajout_pixels": int((fill & ~walk).sum()), "retrait_pixels": int((walk & walls).sum()), "hors_carte_pixels": int((walk & exterior).sum()), "praticable_avant": round(float(walk.mean()), 3)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.path.insert(0, str(HERE))
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
