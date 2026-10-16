"""Anneaux tournants (Engine) : mesure de leur rotation sur la vidéo, modèle de leur position à chaque instant, test « dans un arc plein ».

  python analysis/rotors.py --map Engine --game 30 --game 14 --game 21     mesure sur ces games et écrit analysis/map_rotors.json

Engine a deux anneaux de murs autour du point central : l'extérieur tourne dans le sens horaire, l'intérieur dans le sens anti-horaire. Chaque anneau est fait d'arcs pleins séparés
par des ouvertures qui tournent avec lui. La minimap montre les anneaux en clair (blanc verdâtre) : on en tire un profil angulaire (présence d'anneau par degré), la vitesse est celle
qui aligne les profils des images successives (balayage des vitesses candidates), la phase et les ouvertures sont mesurées sur des images ramenées à un même instant de game (les
anneaux repartent de la même position à chaque game : mesuré à 3 degrés près sur 3 games). Les angles sont ceux de l'image (atan2(y, x), y vers le bas) : croissant = sens horaire à l'écran.

Fichier map_rotors.json : { carte: { "aspect": largeur / hauteur de la minimap, "centre": [x, y] (fractions), "t_ref": instant de game de la mesure (secondes),
  "anneaux": [ { "nom", "r_min", "r_max" (bande d'arc plein), "trou_min", "trou_max" (bande graphique entière de l'anneau, laissée en trou du masque), fractions de la hauteur de la
  minimap, "omega" (degrés par seconde), "ouvertures": [[debut, fin] (degrés à t_ref)], "fenetres": [[centre, demi-largeur]] (degrés à t_ref, tracées à la main) } ] } }"""

import argparse
import glob
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
import paths
import priority

HERE = Path(__file__).parent
ROTORS = HERE / "map_rotors.json"
BINS = 720  # profil angulaire : 0,5 degré par case
SWEEP = (-12.0, 12.0, 0.02)  # vitesses candidates (degrés par seconde)
GAP_LEVEL = 0.25  # une ouverture est une zone où le profil tombe sous cette part du niveau des arcs
MARGIN_DEG = 4.0  # marge autour d'une ouverture : une lecture à cette distance d'un arc plein n'est pas dans le mur (le centre d'une pastille est à quelques degrés près)


def load(map_name):
    """Modèle des anneaux tournants d'une carte, ou None."""
    if not ROTORS.exists():
        return None
    return json.loads(ROTORS.read_text(encoding="utf-8")).get(map_name)


def angle_deg(model, x, y):
    """Angle (degrés, image, horaire croissant) et distance au centre (fraction de la hauteur de la minimap) d'un point de la minimap (fractions)."""
    dx = (x - model["centre"][0]) * model["aspect"]
    dy = y - model["centre"][1]
    return math.degrees(math.atan2(dy, dx)) % 360, math.hypot(dx, dy)


def in_gap(ring, phi, margin=MARGIN_DEG):
    """Vrai si l'angle phi (degrés, repère de l'anneau à t_ref) est dans une ouverture, à la marge près."""
    phi %= 360
    return any(a - margin <= phi <= b + margin or a - margin <= phi + 360 <= b + margin for a, b in ring["ouvertures"])


def solid_ring_at(model, x, y, t_game):
    """Nom de l'anneau dont un arc plein occupe le point (x, y) de la minimap à l'instant de game t_game, ou None. Un point entre deux anneaux, dans une ouverture ou hors des
    anneaux n'est pas dans un mur."""
    angle, dist = angle_deg(model, x, y)
    for ring in model["anneaux"]:
        if ring["r_min"] <= dist <= ring["r_max"] and not in_gap(ring, angle - ring["omega"] * (t_game - model["t_ref"])):
            return ring["nom"]
    return None


def nearest_outside(model, ring, x, y):
    """Point du bord de la bande de l'anneau (intérieur ou extérieur, le plus proche) pour sortir (x, y) d'un arc plein : même angle, rayon du bord, avec 5 % de marge."""
    angle, dist = angle_deg(model, x, y)
    target = ring["r_min"] * 0.95 if dist - ring["r_min"] <= ring["r_max"] - dist else ring["r_max"] * 1.05
    a = math.radians(angle)
    return model["centre"][0] + target * math.cos(a) / model["aspect"], model["centre"][1] + target * math.sin(a)


def in_window(ring, phi):
    """Vrai si l'angle phi (degrés, repère de l'anneau à t_ref) est dans une fenêtre de l'anneau : on voit à travers, on ne passe pas."""
    return any(abs((phi - centre + 180) % 360 - 180) <= half for centre, half in ring.get("fenetres", []))


def blocks_sight(model, x, y, t_game):
    """Vrai si un arc plein de l'un des anneaux, hors fenêtre, occupe le point (x, y) à l'instant de game t_game : il coupe la vue (une ouverture ou une fenêtre la laisse passer)."""
    angle, dist = angle_deg(model, x, y)
    for ring in model["anneaux"]:
        if ring["r_min"] <= dist <= ring["r_max"]:
            phi = angle - ring["omega"] * (t_game - model["t_ref"])
            if not in_gap(ring, phi) and not in_window(ring, phi):
                return True
    return False


def windows_from_lines(model, lines, t_draw):
    """Fenêtres de chaque anneau d'après les traits « fenêtre » tracés à la main sur la carte au départ (lines : [{from, to}] en fractions de la minimap), ramenées à t_ref :
    centre et demi-largeur en degrés. `t_draw` : instant de game où ces traits ont été tracés (négatif : avant le début de la game ; les anneaux tournent déjà)."""
    out = {ring["nom"]: [] for ring in model["anneaux"]}
    for line in lines:
        mid = ((line["from"][0] + line["to"][0]) / 2, (line["from"][1] + line["to"][1]) / 2)
        angle, dist = angle_deg(model, *mid)
        for ring in model["anneaux"]:
            if ring["r_min"] - 0.03 <= dist <= ring["r_max"] + 0.03:
                a1, _ = angle_deg(model, *line["from"])
                a2, _ = angle_deg(model, *line["to"])
                half = max(3.0, abs((a1 - a2 + 180) % 360 - 180) / 2)
                out[ring["nom"]].append([round((angle + ring["omega"] * (model["t_ref"] - t_draw)) % 360, 1), round(half, 1)])
    return out


def hole_mask(model, shape):
    """Image bool (hauteur, largeur) des anneaux entiers : toute la bande graphique de chaque anneau (fenêtre de mesure, plus large que la bande d'arc plein). Ces zones restent des
    trous du masque quand il est construit : le plan et les lectures ne les remplissent pas (le sol y change à chaque instant, l'utilisateur les dessine à la main)."""
    h, w = shape
    fx = (np.arange(w) + 0.5) / w
    fy = (np.arange(h) + 0.5) / h
    dist = np.hypot((fx[None, :] - model["centre"][0]) * model["aspect"], fy[:, None] - model["centre"][1])
    mask = np.zeros((h, w), bool)
    for ring in model["anneaux"]:
        mask |= (dist >= ring["trou_min"]) & (dist <= ring["trou_max"])
    return mask


def snap_point(model, x, y, t_game):
    """Point (x, y) ramené hors d'un arc plein : un joueur ne traverse pas un mur tournant, il passe par une ouverture. Même rayon, angle ramené (dans le repère de l'anneau) au bord de
    l'ouverture la plus proche, 1 degré à l'intérieur. Renvoie (x, y) ou None si le point n'est pas dans un arc plein."""
    name = solid_ring_at(model, x, y, t_game)
    if name is None:
        return None
    ring = next(r for r in model["anneaux"] if r["nom"] == name)
    angle, dist = angle_deg(model, x, y)
    shift = ring["omega"] * (t_game - model["t_ref"])
    phi = (angle - shift) % 360
    best = None
    for a, b in ring["ouvertures"]:
        for edge, inward in ((a, 1.0), (b, -1.0)):
            d = abs((phi - edge + 180) % 360 - 180)
            if best is None or d < best[0]:
                best = (d, edge + inward)
    a = math.radians((best[1] + shift) % 360)
    return model["centre"][0] + dist * math.cos(a) / model["aspect"], model["centre"][1] + dist * math.sin(a)


# ---------------------------------------------------------------- mesure sur la vidéo

def grab_frames(video, t0, seconds, zone, folder, fps=5):
    """Images de la minimap (zone en fractions de l'écran) prises avec ffmpeg à `fps` images par seconde depuis t0."""
    os.makedirs(folder, exist_ok=True)
    for f in glob.glob(folder + "/*.png"):
        os.remove(f)
    crop = f"fps={fps},crop=iw*{zone['w']}:ih*{zone['h']}:iw*{zone['x']}:ih*{zone['y']}"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", str(t0), "-t", str(seconds), "-i", str(video), "-vf", crop, folder + "/s_%03d.png"], check=True, creationflags=priority.creation_flags())
    return sorted(glob.glob(folder + "/s_*.png"))


def ring_mask(bgr):
    """Pixels de l'anneau : blanc verdâtre clair (le vert dépasse le rouge)."""
    b, g, r = (bgr[:, :, i].astype(int) for i in range(3))
    return (g >= 200) & (b >= 190) & (r >= 150) & (g - r >= 12)


def profile(bgr, centre_px, r_lo, r_hi):
    """Profil angulaire des pixels d'anneau entre les rayons r_lo et r_hi (pixels) autour du centre : BINS cases, lissé sur 5 cases."""
    ys, xs = np.nonzero(ring_mask(bgr))
    d = np.hypot(xs - centre_px[0], ys - centre_px[1])
    sel = (d >= r_lo) & (d <= r_hi)
    ang = (np.degrees(np.arctan2(ys[sel] - centre_px[1], xs[sel] - centre_px[0])) % 360) / 360 * BINS
    p = np.bincount(ang.astype(int) % BINS, minlength=BINS).astype(float)
    return np.convolve(np.r_[p[-2:], p, p[:2]], np.ones(5) / 5, mode="valid")


def rolled(p, deg):
    """Profil tourné de deg degrés (positif : sens horaire), par décalage de phase de Fourier."""
    f = np.fft.rfft(p)
    return np.fft.irfft(f * np.exp(-2j * np.pi * np.arange(len(f)) * deg / 360), n=len(p))


def best_speed(profs, step_s, span=SWEEP):
    """Vitesse (degrés par seconde) qui aligne le mieux tous les profils sur le premier, et son accord moyen (corrélation, 1 = parfait)."""
    base = profs[0] - profs[0].mean()
    best = (-2.0, 0.0)
    for w in np.arange(span[0], span[1] + span[2], span[2]):
        total = 0.0
        for k, p in enumerate(profs):
            a, b = rolled(base, w * k * step_s), p - p.mean()
            total += float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
        if total / len(profs) > best[0]:
            best = (total / len(profs), float(w))
    return best[1], best[0]


def gaps_of(p):
    """Ouvertures (début, fin en degrés) d'un profil : zones où il tombe sous GAP_LEVEL fois le niveau des arcs (90e centile). Les creux de moins de 6 degrés sont des défauts de lecture."""
    low = p < GAP_LEVEL * np.percentile(p, 90)
    n, runs, start = len(p), [], None
    for k in range(2 * n):
        if low[k % n] and start is None:
            start = k
        if not low[k % n] and start is not None:
            if start < n and (k - start) * 360 / n >= 6:
                runs.append((start * 360 / n, (k - 1) * 360 / n))
            start = None
    return runs


# Engine, mesuré sur les games 30, 14 et 21 : centre des anneaux, taille de la minimap en pixels, fenêtres de mesure du profil (larges : elles contiennent l'anneau) et bandes d'arc
# plein (étroites : une lecture n'est « dans le mur » que dans le cœur de l'arc).
ENGINE = {
    "size_px": (452, 238),
    "centre_px": (223.2, 118.4),
    "windows": {"interieur": (40, 56), "exterieur": (70, 90)},
    "bands": {"interieur": (46, 51), "exterieur": (77, 83)},
}


def measure(games, zone, spec=ENGINE, t_ref=15.0):
    """Mesure les anneaux sur les games donnés [(vidéo, début de game)] : vitesse de chaque anneau (20 s d'images à partir de t_ref sur la première game), puis ouvertures à t_ref
    moyennées sur toutes les games (images ramenées à t_ref avec la vitesse). Renvoie le modèle (dict) et un compte rendu (liste de textes)."""
    notes, speeds = [], {}
    tmp = tempfile.mkdtemp(prefix="rotors_")
    w_px, h_px = spec["size_px"]
    centre = spec["centre_px"]
    video0, start0 = games[0]
    for name, (lo, hi) in spec["windows"].items():
        files = grab_frames(video0, start0 + t_ref, 20, zone, f"{tmp}/{name}")
        profs = [profile(cv2.imread(f), centre, lo, hi) for f in files]
        w, q = best_speed(profs, 1 / 5)
        speeds[name] = w
        notes.append(f"{name} : {w:+.2f} degrés par seconde ({'horaire' if w > 0 else 'anti-horaire'} à l'écran), accord {q:.2f}")
    omegas = {name: float(round(w)) if abs(w - round(w)) < 0.25 else round(w, 2) for name, w in speeds.items()}  # vitesse du jeu : un nombre rond quand la mesure en est à moins de 0,25 degré par seconde
    notes.append(f"vitesses retenues : {omegas}")
    openings = {}
    for name, (lo, hi) in spec["windows"].items():
        acc = []
        for video, start in games:
            files = grab_frames(video, start + t_ref - 4, 8, zone, f"{tmp}/{name}_g")
            for k, f in enumerate(files):
                acc.append(rolled(profile(cv2.imread(f), centre, lo, hi), -omegas[name] * (k / 5 - 4)))  # ramené à t_ref
        openings[name] = [[round(a, 1), round(b, 1)] for a, b in gaps_of(np.mean(acc, axis=0))]
        notes.append(f"{name} : ouvertures à t_ref {openings[name]} sur {len(acc)} images de {len(games)} game(s)")
    model = {
        "aspect": round(w_px / h_px, 4),
        "centre": [round(centre[0] / w_px, 4), round(centre[1] / h_px, 4)],
        "t_ref": t_ref,
        "anneaux": [
            {
                "nom": name,
                "r_min": round(spec["bands"][name][0] / h_px, 4),
                "r_max": round(spec["bands"][name][1] / h_px, 4),
                "trou_min": round(spec["windows"][name][0] / h_px, 4),
                "trou_max": round(spec["windows"][name][1] / h_px, 4),
                "omega": omegas[name],
                "ouvertures": openings[name],
            }
            for name in spec["windows"]
        ],
    }
    return model, notes


def main(argv=None):
    parser = argparse.ArgumentParser(description="Mesure la rotation des anneaux d'Engine sur la vidéo (et écrit map_rotors.json avec --write).")
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--map", default="Engine")
    parser.add_argument("--game", type=int, action="append", required=True)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--t-draw", type=float, help="instant de game (négatif : avant le début) où les traits « fenêtre » de la cartographie ont été tracés : les fenêtres du modèle en sont tirées")
    args = parser.parse_args(argv)
    import sqlite3

    conn = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    games = []
    for gid in args.game:
        g = conn.execute("SELECT g.start_s, g.map, v.path FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (gid,)).fetchone()
        if g is None or g["map"] != args.map:
            print(f"game {gid} : pas une game {args.map}")
            return 1
        games.append((g["path"], g["start_s"]))
    zone = json.loads((HERE / "map_zones.json").read_text(encoding="utf-8"))[args.map]["minimap"]
    model, notes = measure(games, zone)
    if args.t_draw is not None:
        row = conn.execute("SELECT data FROM map_annotations WHERE map = ?", (args.map,)).fetchone()
        lines = [d for d in json.loads(row["data"]).get("doors", []) if d.get("kind") == "fenetre"] if row else []
        found = windows_from_lines(model, lines, args.t_draw)
        for ring in model["anneaux"]:
            ring["fenetres"] = found[ring["nom"]]
        notes.append(f"fenêtres tirées de {len(lines)} traits de la cartographie (tracés à t = {args.t_draw} s) : " + str({k: len(v) for k, v in found.items()}))
    print("\n".join(notes))
    if args.write:
        known = json.loads(ROTORS.read_text(encoding="utf-8")) if ROTORS.exists() else {}
        known[args.map] = model
        ROTORS.write_text(json.dumps(known, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"écrit dans {ROTORS.name}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
