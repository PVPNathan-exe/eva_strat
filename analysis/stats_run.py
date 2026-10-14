"""Calcul des tables Stats d'une game (lives, kill_links, point_owner, life_loadouts, episodes) : `python analysis/stats_run.py --game N [--only module]`.

Chaque module de calcul expose `compute(conn, game_id) -> int` (idempotent : efface puis réécrit les lignes de la game, renvoie le nombre de lignes écrites). La liste STEPS donne l'ordre :
un module peut lire les tables écrites par ceux d'avant (episodes lit lives et point_owner). Les modules s'ajoutent ici à mesure qu'ils sont livrés (docs/PLAN_STATS_AGENTS.md)."""

import argparse
import importlib
import json
import sys

import db
import paths

# (nom, module) dans l'ordre de calcul ; vide à la vague 0.
STEPS = []


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
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--only", default=None, help="Modules à calculer, séparés par des virgules")
    parser.add_argument("--db", default=str(paths.db_path()))
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    print(json.dumps(run(conn, args.game, set(args.only.split(",")) if args.only else None), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
