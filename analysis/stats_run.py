"""Calcul des tables Stats d'une game (lives, kill_links, point_owner, life_loadouts, episodes) : `python analysis/stats_run.py --game N [--only module]`, ou `--all` pour toutes les games qui ont des positions (une game à la fois : le propriétaire des points relit la vidéo, environ 10 à 20 s par game).

Chaque module de calcul expose `compute(conn, game_id) -> int` (idempotent : efface puis réécrit les lignes de la game, renvoie le nombre de lignes écrites). La liste STEPS donne l'ordre :
un module peut lire les tables écrites par ceux d'avant (episodes lit lives et point_owner). Les modules s'ajoutent ici à mesure qu'ils sont livrés (docs/PLAN_STATS_AGENTS.md)."""

import argparse
import importlib
import json
import sys

import db
import paths

# (nom, module) dans l'ordre de calcul.
STEPS = [("lives", "lives"), ("levels", "levels"), ("loadout_life", "loadout_life"), ("gadget_state", "gadget_state"), ("kill_links", "kill_links"), ("point_owner", "point_owner"), ("retakes", "retakes"), ("rotations", "rotations"), ("duels", "duels"), ("kill_scores", "kill_scores")]


def run(conn, game_id, only=None):
    """Calcule les tables Stats d'une game. Renvoie {module: lignes écrites}."""
    out = {}
    for name, module in STEPS:
        if only and name not in only:
            continue
        out[name] = importlib.import_module(module).compute(conn, game_id)
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description="Calcule les tables Stats d'une game.")
    parser.add_argument("--game", type=int, default=None)
    parser.add_argument("--all", action="store_true", help="Toutes les games qui ont des positions")
    parser.add_argument("--only", default=None, help="Modules à calculer, séparés par des virgules")
    parser.add_argument("--db", default=str(paths.db_path()))
    args = parser.parse_args(argv)
    if args.game is None and not args.all:
        parser.error("indique --game N ou --all")
    conn = db.connect(args.db)
    only = set(args.only.split(",")) if args.only else None
    games = [r[0] for r in conn.execute("SELECT DISTINCT game_id FROM samples ORDER BY game_id")] if args.all else [args.game]
    for game_id in games:
        print(json.dumps({"game": game_id, **run(conn, game_id, only)}, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
