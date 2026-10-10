"""Mesure de la qualité du suivi des positions, sans vérité terrain faite à la main : les bandeaux du haut de l'écran sont un second
témoin, indépendant de la minimap, de qui est vivant et mort à chaque instant.

  python analysis/evaluate.py --game 24            compare le suivi avec et sans les bandeaux sur une game (relit la vidéo, mis en cache)
  python analysis/evaluate.py --video 2            les games d'une vidéo

Indicateurs (par joueur et par image) :
  accord    le suivi dit « vivant » exactement quand le bandeau est coloré ;
  fantôme   le suivi montre un joueur vivant alors que son bandeau est grisé (mort) ;
  manquant  le bandeau est coloré mais le suivi n'a aucune pastille vivante pour ce joueur.
  sauts     un joueur vivant se déplace d'une image à la suivante de plus de JUMP_DIST (impossible : numéros échangés ou fausse pastille)."""

import argparse
import json
import sys
from pathlib import Path

import db
import positions
import tracking

JUMP_DIST = 0.08  # distance (relative à la minimap) entre deux images consécutives au-delà de laquelle un déplacement est impossible
CACHE = Path(__file__).resolve().parent.parent / "data" / "cache"


def compare(rows, states, dead_sets=None):
    """Compare les lignes du suivi {(image, slot): vivant} avec les bandeaux. Renvoie les compteurs."""
    alive_rows = {(r[0], r[2]) for r in rows if r[7]}
    dead_sets = dead_sets if dead_sets is not None else tracking.dead_frames(states)
    n = agree = ghost = missing = 0
    for fi, per_slot in states.items():
        for slot, st in per_slot.items():
            if slot not in dead_sets:
                continue  # bandeau mal lu sur toute la game : pas un témoin fiable
            banner_dead = fi in dead_sets[slot]
            banner_alive = st["alive"] and not banner_dead
            have = (fi, slot) in alive_rows
            n += 1
            agree += have == banner_alive
            ghost += have and banner_dead
            missing += (not have) and banner_alive
    return {"n": n, "agree": agree, "ghost": ghost, "missing": missing, "jumps": count_jumps(rows)}


def count_jumps(rows):
    """Nombre de sauts impossibles : un même joueur vivant qui change de place de plus de JUMP_DIST entre deux images consécutives."""
    last, jumps = {}, 0
    for r in sorted(rows, key=lambda r: (r[2], r[0])):
        if not r[7]:
            continue
        prev = last.get(r[2])
        if prev and r[0] - prev[0] == 1 and ((r[4] - prev[4]) ** 2 + (r[5] - prev[5]) ** 2) ** 0.5 > JUMP_DIST:
            jumps += 1
        last[r[2]] = r
    return jumps


def _load(conn, game, step_s, refresh=False):
    """Détections de la minimap et états des bandeaux d'une game, mis en cache (la lecture de la vidéo est longue)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"eval_{game['id']}.json"
    zone_key = db.minimap_zone_key(conn, game["map"])
    if path.exists() and not refresh:
        raw = json.loads(path.read_text(encoding="utf-8"))
        if raw.get("zone_key") != zone_key:  # lu avec une autre zone de minimap : à refaire
            return _load(conn, game, step_s, refresh=True)
        frames = [(fi, t, dets) for fi, t, dets in raw["frames"]]
        states = {int(k): {int(slot): v for slot, v in per.items()} for k, per in raw["states"].items()}
        return {"frames": frames, "states": states}
    zone = db.zone_for(conn, game["map"], "minimap")
    za, zb = db.zone_for(conn, game["map"], "team_a_bar"), db.zone_for(conn, game["map"], "team_b_bar")
    frames = positions.detect_frames(game["path"], game, zone, game["width"], game["height"], step_s=step_s)
    states = positions.detect_states(game["path"], game, za, zb, game["width"], game["height"], step_s=step_s)
    path.write_text(json.dumps({"frames": frames, "states": states, "zone_key": zone_key}, default=float), encoding="utf-8")
    return {"frames": frames, "states": states}


def evaluate_game(conn, game_id, refresh=False):
    g = dict(
        conn.execute(
            "SELECT g.*, v.path, v.width, v.height, v.fps FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (game_id,)
        ).fetchone()
    )
    step_s = 6 / g["fps"]
    data = _load(conn, g, step_s, refresh)
    deaths = [(k["t"], k["victim_slot"]) for k in db.kills_of(conn, game_id)]
    out = {}
    for label, use_states in (("sans bandeaux", False), ("avec bandeaux", True)):
        rows = tracking.solve(data["frames"], step_s, deaths, data["states"] if use_states else None)
        out[label] = compare(rows, data["states"])
    return g, out


def main(argv=None):
    parser = argparse.ArgumentParser(description="Mesure la qualité du suivi avec les bandeaux comme témoin.")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--game", type=int, default=None)
    parser.add_argument("--video", type=int, default=None)
    parser.add_argument("--refresh", action="store_true", help="Relire la vidéo au lieu d'utiliser le cache")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    ids = [args.game] if args.game else [r["id"] for r in conn.execute("SELECT id FROM games WHERE video_id = ? ORDER BY start_s", (args.video,))]
    total = {"sans bandeaux": [0, 0, 0, 0, 0], "avec bandeaux": [0, 0, 0, 0, 0]}
    for gid in ids:
        g, res = evaluate_game(conn, gid, args.refresh)
        for label, c in res.items():
            for i, k in enumerate(("n", "agree", "ghost", "missing", "jumps")):
                total[label][i] += c[k]
            pct = lambda x: f"{100 * x / max(c['n'], 1):.1f} %"
            print(f"jeu {gid} {g['map']:<11} {label:<14} accord {pct(c['agree'])} · fantômes {pct(c['ghost'])} · manquants {pct(c['missing'])} · sauts {c['jumps']}")
    if len(ids) > 1:
        for label, (n, agree, ghost, missing, jumps) in total.items():
            print(f"TOTAL {label:<14} accord {100 * agree / max(n, 1):.1f} % · fantômes {100 * ghost / max(n, 1):.1f} % · manquants {100 * missing / max(n, 1):.1f} % · sauts {jumps}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
