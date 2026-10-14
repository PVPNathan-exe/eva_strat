"""Export et import des données en fichiers JSON : sauvegarde, archivage sur une clé ou un disque externe, passage d'un PC à l'autre.

Pourquoi des fichiers et pas la base directement sur la clé : lire un disque ne l'use pas, mais la base écrit sans cesse (journal WAL) et un débranchement en cours d'écriture la corrompt. Ici
chaque game est écrite une seule fois, d'un bloc, dans son propre fichier `games/<carte>_<uid>.json.gz` ; un deuxième export ne réécrit que les games qui ont changé (octets identiques :
fichier non touché). Format lisible par n'importe quel outil (JSON compressé : pour chaque table, les colonnes puis les lignes), donc importable dans une autre base (SQL ou NoSQL) sans ce programme.

Dossier produit :
  manifest.json   version du format, date, liste des games (uid, carte, vidéo, bornes, lignes par table)
  config.json     calibrations du HUD, noms d'équipes, cartographie à la main des cartes, noms d'équipes par morceau de vidéo
  games/*.json.gz une game : sa ligne, sa vidéo et toutes les tables qui portent un `game_id` (positions, kills, équipement, corrections à la main, ...), trouvées dans la base elle-même :
                  une table ajoutée plus tard est exportée sans changer ce module
  icons/          images et noms des icônes d'armes citées par les games (les identifiants B25, G9... sont propres à chaque installation)

Import : une game déjà présente (même vidéo, début à 2 s près) est sautée, jamais écrasée ; les identifiants d'icônes sont traduits (même image, sinon même nom, sinon nouvelle icône) ; une copie de
la base est faite avant d'écrire (désactivable) ; `--dry-run` montre ce qui serait fait sans rien écrire. Les avis et verrous d'icônes (`reviews.json`) ne voyagent pas : ce sont des jugements locaux."""

import argparse
import gzip
import hashlib
import io
import json
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

import db
import paths
import weapons

FORMAT = 1
ICON_COLUMNS = ("weapon", "weapon1", "weapon2", "gadget")  # colonnes qui citent un identifiant d'icône
SAME_GAME_S = 2.0  # deux games de la même vidéo dont le début diffère de moins de 2 s sont la même
SAME_VIDEO_S = 1.0  # deux vidéos de même nom de fichier et de durée à 1 s près sont la même
CONFIG_TABLES = ("calibrations", "teams", "map_annotations")  # réglages sans game_id


def _q(name):
    """Nom de table ou de colonne entre guillemets pour SQL."""
    return '"' + name + '"'


# ------------------------------------------------------------------ lecture de la base

def _columns(conn, table):
    return [(r["name"], r["pk"]) for r in conn.execute(f"PRAGMA table_info({_q(table)})")]


def game_tables(conn):
    """Tables, autres que games, qui portent un game_id (et donc se rangent dans le fichier d'une game)."""
    names = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
    return [t for t in names if t != "games" and "game_id" in {c for c, _ in _columns(conn, t)}]


def _exported_columns(conn, table):
    """Colonnes à exporter : sans game_id (réécrit à l'import) et sans la clé numérique automatique `id` (une nouvelle est donnée à l'import)."""
    cols = _columns(conn, table)
    auto_id = len([1 for _, pk in cols if pk]) == 1 and any(c == "id" and pk for c, pk in cols)
    return [c for c, _ in cols if c != "game_id" and not (auto_id and c == "id")]


def game_uid(video, game):
    """Identifiant stable d'une game, le même d'une installation à l'autre : nom du fichier vidéo, durée, début."""
    key = f"{Path(video['path']).name}|{round(video['duration_s'])}|{round(game['start_s'], 1)}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:10]


def build_game_doc(conn, game):
    """Document JSON d'une game (dictionnaire) : ligne, vidéo, tables."""
    video = dict(conn.execute("SELECT path, source_url, duration_s, fps, width, height FROM videos WHERE id = ?", (game["video_id"],)).fetchone())
    doc = {"format": FORMAT, "uid": game_uid(video, game), "video": video,
           "game": {k: game[k] for k in game.keys() if k not in ("id", "video_id")}, "tables": {}}
    for table in game_tables(conn):
        cols = _exported_columns(conn, table)
        order = " ORDER BY " + ", ".join(_q(c) for c in cols[:3]) if cols else ""
        rows = [list(r) for r in conn.execute(f"SELECT {', '.join(_q(c) for c in cols)} FROM {_q(table)} WHERE game_id = ?{order}", (game["id"],))]
        if rows:
            doc["tables"][table] = {"columns": cols, "rows": rows}
    return doc


def _gz(doc):
    """Octets compressés d'un document, identiques d'un export à l'autre pour le même contenu (date de l'en-tête gzip à 0)."""
    raw = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode="wb", compresslevel=6, mtime=0) as f:
        f.write(raw)
    return buffer.getvalue()


def _write_if_changed(path, data):
    """Écrit `data` dans `path` sauf si le fichier contient déjà ces octets (économise les écritures sur une clé). Écriture dans un fichier temporaire puis renommage. True si écrit."""
    path = Path(path)
    if path.exists() and path.stat().st_size == len(data) and path.read_bytes() == data:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".part")
    tmp.write_bytes(data)
    tmp.replace(path)
    return True


# ------------------------------------------------------------------ icônes

def _icon_ids(doc):
    ids = set()
    for table in doc["tables"].values():
        for i, c in enumerate(table["columns"]):
            if c in ICON_COLUMNS:
                ids.update(r[i] for r in table["rows"] if r[i])
    return ids


def _read_names(icon_dir):
    p = Path(icon_dir) / "names.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def _copy_icons(ids, icon_dir, out_dir):
    """Copie les images (et aperçus) des icônes citées et écrit leurs noms. Renvoie le nombre d'icônes citées sans image."""
    names = _read_names(icon_dir)
    kept, missing = {}, 0
    for icon in sorted(ids):
        png = Path(icon_dir) / f"{icon}.png"
        if not png.exists():
            missing += 1
            continue
        _write_if_changed(Path(out_dir) / "icons" / png.name, png.read_bytes())
        preview = Path(icon_dir) / "previews" / png.name
        if preview.exists():
            _write_if_changed(Path(out_dir) / "icons" / "previews" / png.name, preview.read_bytes())
        if icon in names:
            kept[icon] = names[icon]
    _write_if_changed(Path(out_dir) / "icons" / "names.json", json.dumps(kept, ensure_ascii=False, indent=1, sort_keys=True).encode("utf-8"))
    return missing


def _sha(path):
    return hashlib.sha1(Path(path).read_bytes()).hexdigest()


def _number(icon_id):
    return int(icon_id[1:]) if icon_id[1:].isdigit() else 0


def map_icons(src_dir, dest_dir):
    """Traduit les identifiants d'icônes d'un export vers ceux de cette installation. Règle : même identifiant et même image, sinon une icône du même type (B ou G) de même nom, sinon nouvelle
    icône (image copiée sous le prochain numéro libre, avec son nom). Renvoie ({ancien: nouveau}, nombre d'icônes créées). Réécrit names.json de la destination si une icône est créée."""
    src, dest = Path(src_dir) / "icons", Path(dest_dir)
    if not src.exists():
        return {}, 0
    src_names, dest_names = _read_names(src), _read_names(dest)
    dest_ids = {p.stem for p in dest.glob("*.png")}
    mapping, created = {}, 0
    for png in sorted(src.glob("*.png")):
        old, prefix = png.stem, png.stem[:1]
        if old in dest_ids and _sha(dest / f"{old}.png") == _sha(png):
            mapping[old] = old
            continue
        name = src_names.get(old)
        same = sorted((i for i in dest_ids if name and i[:1] == prefix and dest_names.get(i) == name), key=_number)
        if same:
            mapping[old] = same[0]
            continue
        dest.mkdir(parents=True, exist_ok=True)
        new = f"{prefix}{max((_number(i) for i in dest_ids if i[:1] == prefix), default=0) + 1}"
        shutil.copyfile(png, dest / f"{new}.png")
        if (src / "previews" / png.name).exists():
            (dest / "previews").mkdir(exist_ok=True)
            shutil.copyfile(src / "previews" / png.name, dest / "previews" / f"{new}.png")
        if name:
            dest_names[new] = name
        dest_ids.add(new)
        mapping[old] = new
        created += 1
    if created:
        (dest / "names.json").write_text(json.dumps(dest_names, ensure_ascii=False, indent=1), encoding="utf-8")
    return mapping, created


# ------------------------------------------------------------------ export

def _team_ranges(conn):
    """Noms d'équipes par morceau de vidéo, avec le nom du fichier vidéo à la place de l'identifiant (propre à chaque base)."""
    return [{"video": Path(r["path"]).name, "duration_s": r["duration_s"], "start_s": r["start_s"], "end_s": r["end_s"], "team_a": r["team_a"], "team_b": r["team_b"]}
            for r in conn.execute("SELECT v.path, v.duration_s, t.start_s, t.end_s, t.team_a, t.team_b FROM team_ranges t JOIN videos v ON v.id = t.video_id")]


def export_all(conn, out_dir, game_ids=None, icon_dir=None):
    """Exporte les games (toutes, ou celles de `game_ids`) vers `out_dir`. Renvoie un résumé : games, fichiers écrits ou inchangés, octets, icônes sans image, fichiers de games en trop."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    icon_dir = icon_dir or weapons.ICON_DIR
    games = [g for g in conn.execute("SELECT * FROM games ORDER BY video_id, start_s") if game_ids is None or g["id"] in game_ids]
    entries, icons, written, total = [], set(), 0, 0
    for game in games:
        doc = build_game_doc(conn, game)
        data = _gz(doc)
        rel = f"games/{(game['map'] or 'inconnue').replace(' ', '_')}_{doc['uid']}.json.gz"
        written += _write_if_changed(out / rel, data)
        total += len(data)
        icons |= _icon_ids(doc)
        entries.append({"uid": doc["uid"], "file": rel, "map": game["map"], "video": Path(doc["video"]["path"]).name, "start_s": game["start_s"], "end_s": game["end_s"],
                        "bytes": len(data), "rows": {t: len(v["rows"]) for t, v in doc["tables"].items()}})
    missing = _copy_icons(icons, icon_dir, out)
    config = {t: [dict(r) for r in conn.execute(f"SELECT * FROM {_q(t)}")] for t in CONFIG_TABLES}
    config["team_ranges"] = _team_ranges(conn)
    _write_if_changed(out / "config.json", json.dumps(config, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    manifest = {"format": FORMAT, "app": "eva-strat", "created": datetime.now(timezone.utc).isoformat(timespec="seconds"), "games": entries}
    _write_if_changed(out / "manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1).encode("utf-8"))
    wanted = {e["file"] for e in entries}
    orphans = sorted(p.relative_to(out).as_posix() for p in (out / "games").glob("*.json.gz") if p.relative_to(out).as_posix() not in wanted)
    return {"games": len(entries), "files_written": written, "files_unchanged": len(entries) - written, "bytes": total, "icons_without_image": missing, "orphans": orphans}


# ------------------------------------------------------------------ import

def _find_video(conn, video):
    name = Path(video["path"]).name
    for r in conn.execute("SELECT id, path, duration_s FROM videos"):
        if Path(r["path"]).name == name and abs(r["duration_s"] - video["duration_s"]) <= SAME_VIDEO_S:
            return r["id"]
    return None


def _find_game(conn, video_id, start_s):
    r = conn.execute("SELECT id FROM games WHERE video_id = ? AND ABS(start_s - ?) <= ?", (video_id, start_s, SAME_GAME_S)).fetchone()
    return r["id"] if r else None


def _insert(conn, table, columns, rows):
    """Insère des lignes dans `table` en ne gardant que les colonnes que cette installation connaît. Une table inconnue est ignorée."""
    known = {c for c, _ in _columns(conn, table)}
    keep = [i for i, c in enumerate(columns) if c in known]
    if not keep:
        return 0
    sql = f"INSERT OR IGNORE INTO {_q(table)} ({', '.join(_q(columns[i]) for i in keep)}) VALUES ({', '.join('?' * len(keep))})"
    conn.executemany(sql, [[r[i] for i in keep] for r in rows])
    return len(rows)


def _import_game(conn, doc, video_id, mapping, report):
    """Écrit une game et ses tables (identifiants d'icônes traduits, game_id et video_id de cette base)."""
    if video_id is None:
        v = doc["video"]
        video_id = conn.execute("INSERT INTO videos (path, source_url, duration_s, fps, width, height) VALUES (?, ?, ?, ?, ?, ?)",
                                (v["path"], v["source_url"], v["duration_s"], v["fps"], v["width"], v["height"])).lastrowid
        if not Path(v["path"]).exists():
            report["missing_videos"].append(v["path"])
    known = {c for c, _ in _columns(conn, "games")}
    g = {k: v for k, v in doc["game"].items() if k in known}
    game_id = conn.execute(f"INSERT INTO games (video_id, {', '.join(g)}) VALUES (?, {', '.join('?' * len(g))})", (video_id, *g.values())).lastrowid
    for table, part in doc["tables"].items():
        icon_cols = [i for i, c in enumerate(part["columns"]) if c in ICON_COLUMNS]
        video_cols = [i for i, c in enumerate(part["columns"]) if c == "video_id"]
        rows = []
        for r in part["rows"]:
            r = list(r)
            for i in icon_cols:
                r[i] = mapping.get(r[i], r[i])
            for i in video_cols:
                r[i] = video_id
            rows.append([game_id] + r)
        _insert(conn, table, ["game_id"] + part["columns"], rows)


def import_bundle(conn, in_dir, icon_dir=None, dry_run=False, config=True):
    """Importe un dossier produit par `export_all`. Renvoie un résumé : games importées, sautées (déjà là), lignes par table, icônes créées, vidéos introuvables sur ce disque."""
    src = Path(in_dir)
    manifest = json.loads((src / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("format") != FORMAT:
        raise ValueError(f"format d'export {manifest.get('format')} non pris en charge (attendu : {FORMAT})")
    report = {"imported": 0, "skipped": 0, "rows": {}, "icons_created": 0, "missing_videos": [], "dry_run": dry_run}
    mapping = {}
    if not dry_run:
        mapping, report["icons_created"] = map_icons(src, Path(icon_dir or weapons.ICON_DIR))
    conn.commit()
    conn.execute("BEGIN")
    try:
        for entry in manifest["games"]:
            doc = json.loads(gzip.decompress((src / entry["file"]).read_bytes()))
            video_id = _find_video(conn, doc["video"])
            if video_id is not None and _find_game(conn, video_id, doc["game"]["start_s"]) is not None:
                report["skipped"] += 1
                continue
            report["imported"] += 1
            for t, part in doc["tables"].items():
                report["rows"][t] = report["rows"].get(t, 0) + len(part["rows"])
            if not dry_run:
                _import_game(conn, doc, video_id, mapping, report)
        if config and not dry_run:
            _import_config(conn, src / "config.json")
    except Exception:
        conn.execute("ROLLBACK")
        raise
    conn.execute("ROLLBACK" if dry_run else "COMMIT")
    return report


def _import_config(conn, path):
    """Réglages d'une autre installation : ajoutés seulement là où cette installation n'a rien (aucun réglage existant n'est écrasé)."""
    if not Path(path).exists():
        return
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    for table in CONFIG_TABLES:
        rows = cfg.get(table) or []
        if rows:
            _insert(conn, table, list(rows[0]), [list(r.values()) for r in rows])
    for r in cfg.get("team_ranges") or []:
        vid = _find_video(conn, {"path": r["video"], "duration_s": r["duration_s"]})
        if vid is not None and not conn.execute("SELECT 1 FROM team_ranges WHERE video_id = ? AND start_s = ? AND end_s = ?", (vid, r["start_s"], r["end_s"])).fetchone():
            conn.execute("INSERT INTO team_ranges (video_id, start_s, end_s, team_a, team_b) VALUES (?, ?, ?, ?, ?)", (vid, r["start_s"], r["end_s"], r["team_a"], r["team_b"]))


def backup_db(conn, dest_dir=None, label="import"):
    """Copie cohérente de la base avant une opération qui l'écrit (API de sauvegarde de SQLite, valable avec le journal WAL) : `eva.avant-<label>-<date>.db`. Renvoie le chemin de la copie."""
    src = Path(conn.execute("PRAGMA database_list").fetchone()["file"])
    dest = Path(dest_dir or src.parent) / f"{src.stem}.avant-{label}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.db"
    target = sqlite3.connect(dest)
    conn.backup(target)
    target.close()
    return dest


# ------------------------------------------------------------------ ligne de commande

def main(argv=None):
    parser = argparse.ArgumentParser(description="Exporte ou importe les données en fichiers JSON (sauvegarde, clé ou disque externe, autre PC).")
    parser.add_argument("action", choices=("export", "import"))
    parser.add_argument("folder", help="Dossier d'export (créé au besoin) ou à importer")
    parser.add_argument("--db", default=None, help="Base à lire ou à remplir (défaut : EVA_DB, sinon data/eva.db)")
    parser.add_argument("--games", default=None, help="Export : identifiants des games à exporter, séparés par des virgules (sinon toutes)")
    parser.add_argument("--dry-run", action="store_true", help="Import : montre ce qui serait importé sans rien écrire")
    parser.add_argument("--no-backup", action="store_true", help="Import : ne fait pas de copie de la base avant d'écrire")
    parser.add_argument("--no-config", action="store_true", help="Import : n'importe pas les calibrations, noms d'équipes et cartographies")
    parser.add_argument("--json", action="store_true", help="Résumé sur une ligne JSON (pour l'interface)")
    args = parser.parse_args(argv)
    conn = db.connect(args.db or paths.db_path())
    try:
        if args.action == "export":
            result = export_all(conn, args.folder, {int(i) for i in args.games.split(",") if i} if args.games else None)
        else:
            if not args.dry_run and not args.no_backup:
                result_backup = str(backup_db(conn))
            result = import_bundle(conn, args.folder, dry_run=args.dry_run, config=not args.no_config)
            if not args.dry_run and not args.no_backup:
                result["backup"] = result_backup
    except (OSError, ValueError, sqlite3.Error) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False) if args.json else f"Erreur : {exc}")
        return 1
    print(json.dumps(result, ensure_ascii=False) if args.json else json.dumps(result, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
