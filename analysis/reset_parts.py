"""Remise à zéro d'UNE partie du programme (jamais tout) : `npm run reset -- <partie>`.

Parties qui vivent dans la base (copie de la base faite avant, `eva.avant-reset-<partie>-<date>.db`, puis effacement des seules lignes concernées) :
  calibrages    zones de l'écran réglées par l'utilisateur (toutes les cartes, ou --map) : le programme retombe sur les zones par défaut
  cartographie  cartographie à la main d'une carte (--map obligatoire)
  corrections   positions, regards et morts posés à la main, échanges de joueurs et kills marqués d'UNE game (--game obligatoire)
  cache         lectures gardées (`eval_*.json`) : elles se refont
Partie qui vit dans des fichiers JSON :
  mapjson       l'entrée d'une carte (--map) dans les fichiers analysis/map_*.json, remplacée par celle du dossier `--upstream` (version de GitHub) ou retirée si elle n'y est pas

`--dry-run` compte ce qui serait touché sans rien écrire. Sortie JSON."""

import argparse
import json
import sqlite3
import sys
from pathlib import Path

import data_export
import data_usage
import db
import paths

MAP_JSON = "map_*.json"


def count_rows(conn, part, map_name=None, game=None):
    """Lignes concernées par une remise à zéro de la base : {table: nombre}."""
    if part == "calibrages":
        sql, args = ("SELECT COUNT(*) FROM calibrations WHERE map = ?", (map_name,)) if map_name else ("SELECT COUNT(*) FROM calibrations", ())
        return {"calibrations": conn.execute(sql, args).fetchone()[0]}
    if part == "cartographie":
        return {"map_annotations": conn.execute("SELECT COUNT(*) FROM map_annotations WHERE map = ?", (map_name,)).fetchone()[0]}
    if part == "corrections":
        return {t: conn.execute(f"SELECT COUNT(*) FROM {t} WHERE game_id = ?", (game,)).fetchone()[0] for t in ("user_marks", "corrections", "kill_flags")}
    raise ValueError(f"partie inconnue : {part}")


def reset_rows(conn, part, map_name=None, game=None):
    """Efface les lignes d'une partie (voir count_rows). Renvoie les nombres de lignes effacées."""
    counts = count_rows(conn, part, map_name, game)
    if part == "calibrages":
        conn.execute("DELETE FROM calibrations WHERE map = ?", (map_name,)) if map_name else conn.execute("DELETE FROM calibrations")
    elif part == "cartographie":
        conn.execute("DELETE FROM map_annotations WHERE map = ?", (map_name,))
    else:
        for table in counts:
            conn.execute(f"DELETE FROM {table} WHERE game_id = ?", (game,))
    conn.commit()
    return counts


def reset_map_json(map_name, upstream_analysis, analysis_dir=None, dry_run=False):
    """Remplace l'entrée `map_name` de chaque fichier analysis/map_*.json par celle de GitHub (ou la retire). Renvoie [(fichier, 'remplacee' | 'retiree' | 'identique' | 'absente')]."""
    folder = Path(analysis_dir or Path(__file__).parent)
    out = []
    for local_path in sorted(folder.glob(MAP_JSON)):
        local = json.loads(local_path.read_text(encoding="utf-8"))
        up_path = Path(upstream_analysis) / local_path.name
        upstream = json.loads(up_path.read_text(encoding="utf-8")) if up_path.exists() else {}
        if map_name in upstream:
            state = "identique" if local.get(map_name) == upstream[map_name] else "remplacee"
            local[map_name] = upstream[map_name]
        elif map_name in local:
            state, _ = "retiree", local.pop(map_name)
        else:
            out.append((local_path.name, "absente"))
            continue
        out.append((local_path.name, state))
        if state != "identique" and not dry_run:
            local_path.write_text(json.dumps(local, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description="Remet à zéro une partie du programme.")
    parser.add_argument("part", choices=("calibrages", "cartographie", "corrections", "cache", "mapjson"))
    parser.add_argument("--map", default=None)
    parser.add_argument("--game", type=int, default=None)
    parser.add_argument("--upstream", default=None, help="mapjson : dossier analysis de la version de GitHub")
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.part in ("cartographie", "mapjson") and not args.map:
        parser.error("--map est obligatoire pour cette partie")
    if args.part == "corrections" and args.game is None:
        parser.error("--game est obligatoire pour les corrections")
    if args.part == "mapjson" and not args.upstream:
        parser.error("--upstream est obligatoire pour mapjson")
    result = {"part": args.part, "dry_run": args.dry_run}
    try:
        if args.part == "cache":
            cache = paths.cache_dir()
            files = list(cache.glob("eval_*.json")) if cache.exists() else []
            result["files"] = len(files)
            if not args.dry_run:
                data_usage.purge_eval_cache()
        elif args.part == "mapjson":
            result["files"] = reset_map_json(args.map, args.upstream, dry_run=args.dry_run)
        else:
            conn = db.connect(args.db)
            if args.dry_run:
                result["rows"] = count_rows(conn, args.part, args.map, args.game)
            else:
                result["backup"] = str(data_export.backup_db(conn, label=f"reset-{args.part}"))
                result["rows"] = reset_rows(conn, args.part, args.map, args.game)
    except (OSError, ValueError, sqlite3.Error) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
