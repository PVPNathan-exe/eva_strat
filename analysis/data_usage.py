"""Place prise par les données : base, copies de sauvegarde, cache (vidéos téléchargées, lectures gardées), icônes ; et nettoyage de ce qui se recalcule.

Ce qui grossit : la table des positions (environ 1,7 Mo par game analysée sur la base de référence, 13 games lues sur 32 : estimation, pas une garantie) et surtout le cache : une vidéo YouTube
téléchargée pèse plusieurs Go, une lecture gardée par `evaluate.py` 10 à 13 Mo par game. Seules les lectures gardées (`eval_*.json`) sont effacées par `--purge-eval-cache` : elles se refont
(1 à 2 minutes par game). Une vidéo téléchargée n'est jamais effacée par ce programme : la base en garde le chemin (lecture, nouvelle analyse), c'est à l'utilisateur de la supprimer."""

import argparse
import json
import sqlite3
import sys
from pathlib import Path

import paths
import weapons

BACKUP_PATTERN = "*.avant-*.db"  # copies faites par les essais, les recalculs et les imports (data_export.backup_db)


def _size(path):
    p = Path(path)
    return p.stat().st_size if p.is_file() else 0


def _tree(path, pattern="*"):
    return sum(_size(f) for f in Path(path).glob(pattern)) if Path(path).exists() else 0


def usage(db_file=None, cache=None):
    """Dictionnaire des tailles en octets : base (et journal), sauvegardes à côté de la base, cache (lectures gardées, vidéos téléchargées, reste), icônes ; games lues ; avertissement de disque."""
    db_file = Path(db_file or paths.db_path())
    cache = Path(cache or paths.cache_dir())
    videos = sorted(((f.name, _size(f)) for f in cache.glob("*.mp4")), key=lambda x: -x[1]) if cache.exists() else []
    out = {
        "db_path": str(db_file), "cache_path": str(cache),
        "db_bytes": _size(db_file), "db_journal_bytes": _size(str(db_file) + "-wal") + _size(str(db_file) + "-shm"),
        "backups": [{"name": f.name, "bytes": _size(f)} for f in sorted(db_file.parent.glob(BACKUP_PATTERN))] if db_file.parent.exists() else [],
        "eval_cache_bytes": _tree(cache, "eval_*.json"), "downloaded_videos": [{"name": n, "bytes": b} for n, b in videos],
        "cache_other_bytes": _tree(cache) - _tree(cache, "eval_*.json") - sum(b for _, b in videos),
        "icons_bytes": sum(_size(f) for f in Path(weapons.ICON_DIR).rglob("*") if f.is_file()),
        "warning": paths.storage_warning(db_file),
    }
    if db_file.exists():
        conn = sqlite3.connect(f"file:{db_file.as_posix()}?mode=ro", uri=True)  # lecture seule : aucune migration, la base peut être en cours d'usage
        out["games"] = conn.execute("SELECT COUNT(*) FROM games").fetchone()[0]
        out["games_with_positions"] = conn.execute("SELECT COUNT(DISTINCT game_id) FROM samples").fetchone()[0]
        out["sample_rows"] = conn.execute("SELECT COUNT(*) FROM samples").fetchone()[0]
        conn.close()
        out["bytes_per_analysed_game"] = round(out["db_bytes"] / out["games_with_positions"]) if out["games_with_positions"] else None
    return out


def purge_eval_cache(cache=None):
    """Efface les lectures gardées (`eval_*.json`). Renvoie (fichiers effacés, octets libérés)."""
    cache = Path(cache or paths.cache_dir())
    files = list(cache.glob("eval_*.json")) if cache.exists() else []
    freed = sum(_size(f) for f in files)
    for f in files:
        f.unlink()
    return len(files), freed


def mb(n):
    return f"{n / 1e6:,.1f} Mo".replace(",", " ")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Place prise par les données d'EVA Strat.")
    parser.add_argument("--db", default=None)
    parser.add_argument("--purge-eval-cache", action="store_true", help="Efface les lectures gardées par evaluate.py (elles se refont)")
    parser.add_argument("--json", action="store_true", help="Sortie JSON (pour l'interface)")
    args = parser.parse_args(argv)
    freed = purge_eval_cache() if args.purge_eval_cache else None
    u = usage(args.db)
    if freed:
        u["purged"] = {"files": freed[0], "bytes": freed[1]}
    if args.json:
        print(json.dumps(u, ensure_ascii=False))
        return 0
    print(f"Base : {u['db_path']} : {mb(u['db_bytes'])} (journal {mb(u['db_journal_bytes'])}), {u.get('games', 0)} games dont {u.get('games_with_positions', 0)} avec positions")
    if u.get("bytes_per_analysed_game"):
        print(f"  environ {mb(u['bytes_per_analysed_game'])} par game analysée (base entière divisée par les games lues : estimation)")
    print(f"Sauvegardes à côté de la base : {len(u['backups'])} fichier(s), {mb(sum(b['bytes'] for b in u['backups']))}")
    print(f"Cache : {u['cache_path']}")
    print(f"  lectures gardées : {mb(u['eval_cache_bytes'])} (effaçables : --purge-eval-cache)")
    print(f"  vidéos téléchargées : {mb(sum(v['bytes'] for v in u['downloaded_videos']))} ({len(u['downloaded_videos'])} fichier(s), à supprimer à la main si besoin)")
    print(f"Icônes d'armes : {mb(u['icons_bytes'])}")
    if freed:
        print(f"Effacé : {freed[0]} fichier(s), {mb(freed[1])}")
    if u["warning"]:
        print("ATTENTION : " + u["warning"])
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
