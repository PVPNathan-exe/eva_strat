"""Refait le suivi des positions de games déjà analysées SANS relire la vidéo, à partir des lectures mises en cache par evaluate.py.

  python analysis/resolve.py --video 1          toutes les games d'une vidéo
  python analysis/resolve.py --game 7           une seule game

Utile après un changement de l'algorithme de suivi (tracking.py) : une analyse complète relit toute la vidéo (environ une heure pour 58 minutes),
alors que le suivi seul prend quelques secondes. Si le cache d'une game n'existe pas (ou date d'une autre zone de minimap), evaluate.py la relit.
Les corrections manuelles (échanges de joueurs) sont réappliquées. Les tueurs déduits ne sont pas recalculés (relancer « Analyser » pour cela)."""

import argparse
import sys

import db
import evaluate
import tracking


def resolve_game(conn, game_id):
    """Recalcule et enregistre les positions d'une game. Renvoie le nombre de lignes."""
    g = dict(conn.execute("SELECT g.*, v.path, v.width, v.height, v.fps FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (game_id,)).fetchone())
    step_s = 6 / g["fps"]  # même cadence que l'analyse (une lecture toutes les 6 images)
    data = evaluate._load(conn, g, step_s)
    deaths = [(k["t"], k["victim_slot"]) for k in db.kills_of(conn, game_id)]
    rows = tracking.solve(data["frames"], step_s, deaths, data["states"], db.teleports_for(g["map"]))
    scanned = conn.execute("SELECT 1 FROM kills_meta WHERE game_id = ?", (game_id,)).fetchone() is not None
    db.replace_samples(conn, game_id, rows, tracking.PARAMS_VERSION, with_kills=scanned)
    db.apply_corrections(conn, game_id)
    return len(rows)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Refait le suivi des positions à partir des lectures en cache.")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--game", type=int, default=None)
    parser.add_argument("--video", type=int, default=None)
    args = parser.parse_args(argv)
    if args.game is None and args.video is None:
        parser.error("indiquer --game ou --video")
    conn = db.connect(args.db)
    ids = [args.game] if args.game else [r["id"] for r in conn.execute("SELECT id FROM games WHERE video_id = ? ORDER BY start_s", (args.video,))]
    for gid in ids:
        print(f"game {gid} : {resolve_game(conn, gid)} lignes")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
