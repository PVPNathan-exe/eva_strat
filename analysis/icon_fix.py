"""Icônes d'armes signalées : le programme relit les bandeaux autour des endroits où l'icône a été vue et la recalcule.

  python icon_fix.py candidates --id B7 --db data/eva.db   images candidates (JSON sur la sortie)
  python icon_fix.py rebuild --id B7 --db data/eva.db      recalcul automatique à partir des meilleures images
  python icon_fix.py rebuild --id B7 --token 24_4_120      recalcul avec une image choisie à la main comme modèle

Une icône « B7 » (arme de bandeau) ou « G3 » (gadget) a été lue sur le bandeau d'un joueur dans une ou plusieurs games : on y retourne,
on lit la même case sur des images réparties dans la game, et on garde celles où l'icône est nette, entière et de la bonne forme.
Les images candidates sont rangées dans weapon_icons/candidates/<id>/ (non versionné)."""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

import db
import loadout
import names
import weapons

FRAMES_PER_SOURCE = 12  # images lues par endroit où l'icône a été vue
MAX_SOURCES = 3  # nombre de games explorées
HELD_MIN = 100  # relief (95e centile) d'une icône nette : l'arme tenue ou le gadget prêt est en noir sur le bandeau
BEST = 8  # nombre d'images moyennées pour le recalcul automatique
SIZE_TOLERANCE = 0.35  # surface de l'icône à moins de 35 % de la médiane (sinon : icône coupée ou superposée)
ASPECT_TOLERANCE = 0.2  # rapport largeur / hauteur à moins de 20 % de la médiane


def _fields(icon_id):
    """Cases du bandeau où chercher : « B » = les deux armes, « G » = le gadget."""
    return ("arme1", "arme2") if icon_id.startswith("B") else ("gadget",)


def _sources(conn, icon_id):
    """[(game, slot, case)] où l'icône a été lue, au plus MAX_SOURCES games différentes."""
    out, seen = [], set()
    rows = conn.execute(
        "SELECT game_id, slot, weapon1, weapon2, gadget FROM loadouts WHERE ? IN (weapon1, weapon2, gadget) ORDER BY game_id, slot",
        (icon_id,),
    ).fetchall()
    for r in rows:
        if r["game_id"] in seen:
            continue
        for field, col in (("arme1", "weapon1"), ("arme2", "weapon2"), ("gadget", "gadget")):
            if r[col] == icon_id and field in _fields(icon_id):
                seen.add(r["game_id"])
                out.append((r["game_id"], r["slot"], field))
                break
        if len(out) >= MAX_SOURCES:
            break
    return out


def _quality(shape, tone):
    """Netteté de l'icône (variance du laplacien sur le relief) : plus c'est net, plus c'est grand."""
    return float(cv2.Laplacian(tone.astype(np.float32), cv2.CV_32F).var()) if tone.size else 0.0


def read_candidates(conn, icon_id, root=None, frames=FRAMES_PER_SOURCE):
    """Lit les images autour des endroits où l'icône a été vue. Renvoie [dict] avec le masque et le relief (pour le recalcul)."""
    out = []
    for game_id, slot, field in _sources(conn, icon_id):
        g = dict(conn.execute("SELECT g.*, v.path, v.width, v.height FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (game_id,)).fetchone())
        zones = {k: db.zone_for(conn, g["map"], k) for k in ("team_a_bar", "team_b_bar")}
        key = "team_a_bar" if slot <= 4 else "team_b_bar"
        index = names.TEAM_SLOTS[key].index(slot)
        span = max(g["end_s"] - g["start_s"] - 6, 1)
        for k in range(frames):
            t = g["start_s"] + 3 + span * k / max(frames - 1, 1)
            crop = names._grab(g["path"], t, zones[key], g["width"], g["height"])
            if crop is None:
                continue
            h, w = crop.shape[:2]
            bw = w / 4
            banner = crop[:, int(index * bw) : int((index + 1) * bw)]
            a, b, c, d = loadout.BOXES[field]
            piece = banner[int(c * h) : int(d * h), int(a * bw) : int(b * bw)]
            shape, tone = loadout._shape(piece), loadout._dark(piece)
            if int(shape.sum()) < weapons.MIN_PIXELS:
                continue
            ys, xs = np.nonzero(shape)
            out.append({
                "token": f"{game_id}_{slot}_{int(round(t * 10))}",
                "game": game_id,
                "slot": slot,
                "field": field,
                "t": round(float(t), 1),
                "held": float(np.percentile(tone, 95)),
                "sharp": _quality(shape, tone),
                "area": int(shape.sum()),
                "aspect": float((xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1)),
                "shape": shape,
                "tone": tone,
            })
    return out


def choose_best(cands, best=BEST):
    """Images à moyenner pour recalculer l'icône : nettes (relief fort), de surface et de forme proches de la médiane
    (une icône coupée ou superposée à une autre s'en écarte), les plus nettes d'abord."""
    clear = [c for c in cands if c["held"] >= HELD_MIN]
    if not clear:
        return []
    area = float(np.median([c["area"] for c in clear]))
    aspect = float(np.median([c["aspect"] for c in clear]))
    kept = [c for c in clear if abs(c["area"] - area) <= SIZE_TOLERANCE * area and abs(c["aspect"] - aspect) <= ASPECT_TOLERANCE * aspect]
    # même taille d'image seulement (les zones de deux games peuvent différer d'un pixel) : on garde la taille la plus fréquente
    sizes = {}
    for c in kept:
        sizes[c["shape"].shape] = sizes.get(c["shape"].shape, 0) + 1
    if not sizes:
        return []
    size = max(sizes, key=sizes.get)
    return sorted((c for c in kept if c["shape"].shape == size), key=lambda c: -c["sharp"])[:best]


def merge(cands):
    """Forme (vote majoritaire) et relief (moyenne) d'un groupe d'images de même taille."""
    shape = loadout.merge_masks([c["shape"] for c in cands])
    tone = np.mean([c["tone"].astype(np.float32) for c in cands], axis=0).astype(np.uint8)
    return shape, tone


def save_candidate_images(icon_id, cands, folder=weapons.ICON_DIR):
    target = Path(folder) / "candidates" / icon_id
    target.mkdir(parents=True, exist_ok=True)
    for old in target.glob("*"):
        old.unlink()
    for c in cands:
        piece = np.clip(c["tone"].astype(np.float32) * (255.0 / max(float(c["tone"].max()), 1.0)), 0, 255).astype(np.uint8)
        cv2.imwrite(str(target / f"{c['token']}.png"), cv2.resize(piece, None, fx=8, fy=8, interpolation=cv2.INTER_CUBIC))
        np.savez_compressed(target / f"{c['token']}.npz", shape=c["shape"], tone=c["tone"])


def rebuild(conn, icon_id, token=None, folder=weapons.ICON_DIR):
    """Remplace le modèle de l'icône. token : image choisie à la main (sinon : meilleures images, moyennées). Renvoie les jetons utilisés."""
    if token:
        path = Path(folder) / "candidates" / icon_id / f"{token}.npz"
        if not path.exists():
            raise ValueError("Image candidate introuvable : relance la recherche d'images")
        data = np.load(path)
        shape, tone, used = data["shape"], data["tone"], [token]
    else:
        cands = read_candidates(conn, icon_id)
        chosen = choose_best(cands)
        if not chosen:
            raise ValueError("Aucune image nette trouvée autour des endroits où l'icône a été vue")
        shape, tone = merge(chosen)
        used = [c["token"] for c in chosen]
        if shape is None:
            raise ValueError("Les images retenues ne donnent pas de forme exploitable")
    weapons.replace_template(icon_id, shape, tone, folder)
    return used


def main(argv=None):
    parser = argparse.ArgumentParser(description="Recalcule une icône d'arme signalée.")
    parser.add_argument("command", choices=("candidates", "rebuild"))
    parser.add_argument("--id", required=True)
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--token", default=None)
    args = parser.parse_args(argv)
    if not (len(args.id) >= 2 and args.id[0] in "BG" and args.id[1:].isdigit()):
        print(json.dumps({"error": "Seules les armes et gadgets des bandeaux (B…, G…) se recalculent"}))
        return 1
    conn = db.connect(args.db)
    try:
        if args.command == "candidates":
            cands = read_candidates(conn, args.id)
            save_candidate_images(args.id, cands)
            best = {c["token"] for c in choose_best(cands)}
            print(json.dumps({"id": args.id, "candidates": [
                {k: (round(v, 1) if isinstance(v, float) else v) for k, v in c.items() if k not in ("shape", "tone")} | {"auto": c["token"] in best}
                for c in cands
            ]}))
        else:
            print(json.dumps({"id": args.id, "used": rebuild(conn, args.id, args.token)}))
    except ValueError as exc:
        print(json.dumps({"error": str(exc)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
