"""CLI d'analyse : lit (ou télécharge) une vidéo, détecte les games par le chrono et enregistre le tout dans SQLite.

Les événements sont écrits sur stdout, un objet JSON par ligne :
  {"event": "progress", "stage": "download" | "detect" | "maps", "pct": 0-100}
  {"event": "done", "video_id": N}
  {"event": "error", "message": "..."}
"""

import argparse
import json
import sys
import time
from pathlib import Path

import db
import capture
import ingest
import killfeed
import loadout
import mapname
import names
import ocr
import positions
import segments
import timer
import tracking

ZONES_PATH = Path(__file__).with_name("default_zones.json")


def print_event(event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


MIN_RANGE_S = 25.0  # un trou plus court entre deux games en ordre ne peut pas contenir une game


def gaps_around(ok, duration):
    """Parties de la vidéo qui ne sont pas couvertes par des games en ordre (seules à relire)."""
    gaps, cursor = [], 0.0
    for g in ok:
        if g["start_s"] - cursor >= MIN_RANGE_S:
            gaps.append((cursor, g["start_s"]))
        cursor = max(cursor, g["end_s"])
    if duration - cursor >= MIN_RANGE_S:
        gaps.append((cursor, duration))
    return gaps


def wait_if_paused(control):
    """Bloque tant que le fichier de contrôle existe (pause demandée par l'interface)."""
    while control and Path(control).exists():
        time.sleep(0.25)


def detect(path, meta, emit, pre_roll, post_roll, ranges=None, control=None):
    """Lit le chrono toutes les secondes (zone par défaut) et en déduit les games, sur toute la vidéo ou sur des plages."""
    zone = json.loads(ZONES_PATH.read_text(encoding="utf-8"))["timer"]
    templates = timer.load_templates()
    ranges = ranges or [(0.0, meta["duration_s"])]
    total = max(sum(b - a for a, b in ranges), 1)
    done, last_pct, games = 0.0, -1, []
    for a, b in ranges:
        samples = []
        for t, crop in timer.iter_crops(path, zone, meta["width"], meta["height"], t0=a, t1=b):
            wait_if_paused(control)
            samples.append((t, timer.read_timer(crop, templates)))
            pct = int(100 * (done + t - a) / total)
            if pct != last_pct:
                last_pct = pct
                emit({"event": "progress", "stage": "detect", "pct": pct})
        done += b - a
        games += segments.detect_games(samples, b, pre_roll=pre_roll, post_roll=post_roll)
    return games


def fill_maps(conn, video_id, path, meta, emit, control=None):
    """Apprend le nom des cartes que l'utilisateur a étiquetées, puis remplit les games sans carte.
    Une carte déjà choisie n'est jamais écrasée ; une carte non reconnue reste vide."""
    games = [dict(r) for r in conn.execute("SELECT id, start_s, end_s, map FROM games WHERE video_id = ? ORDER BY start_s", (video_id,))]
    templates = mapname.load_templates()
    for g in games:
        if g["map"] and g["map"] not in templates:
            masks = mapname.game_masks(path, g, meta["width"], meta["height"])
            if masks:
                mapname.save_template(masks[len(masks) // 2], g["map"])
                templates = mapname.load_templates()
    todo = [g for g in games if not g["map"]]
    for i, g in enumerate(todo):
        wait_if_paused(control)
        emit({"event": "progress", "stage": "maps", "pct": round(100 * i / max(len(todo), 1))})
        name = mapname.recognize_game(path, g, meta["width"], meta["height"], templates)
        if name:
            conn.execute("UPDATE games SET map = ? WHERE id = ? AND map IS NULL", (name, g["id"]))
    conn.commit()


def extract_names(conn, video_id, path, meta, emit, control=None):
    """Pseudos des joueurs des games qui n'en ont pas encore (lus sur les bandeaux). Renvoie (games lues, message d'échec ou None)."""
    todo = db.games_without_players(conn, video_id)
    done = 0
    for i, g in enumerate(todo):
        wait_if_paused(control)
        emit({"event": "progress", "stage": "names", "pct": round(100 * i / len(todo), 1)})
        zones = {key: db.zone_for(conn, g["map"], key) for key in ("team_a_bar", "team_b_bar")}
        try:
            found = names.read_names(path, g, zones, meta["width"], meta["height"])
        except ocr.OcrUnavailable as exc:
            return done, str(exc)
        if found:
            db.replace_players(conn, g["id"], found)
            done += 1
    return done, None


def extract_capture(conn, video_id, path, meta, emit, control=None):
    """Score de capture (% de chaque équipe) des games qui n'en ont pas encore, lu de part et d'autre du chrono."""
    todo = db.games_without_capture(conn, video_id)
    for i, g in enumerate(todo):
        def progress(pct, i=i):
            emit({"event": "progress", "stage": "capture", "pct": round((i + pct / 100) / len(todo) * 100, 1)})

        zones = {"A": db.zone_for(conn, g["map"], "capture_pct_a"), "B": db.zone_for(conn, g["map"], "capture_pct_b")}
        series = capture.read_game(path, g, zones, meta["width"], meta["height"], wait=lambda: wait_if_paused(control), emit=progress)
        db.replace_capture(conn, g["id"], series)
    return len(todo)


def extract_loadouts(conn, video_id, path, meta, emit, control=None):
    """Équipement (armes et gadget) des joueurs des games qui n'en ont pas encore, lu sur les bandeaux."""
    todo = db.games_without_loadouts(conn, video_id)
    for i, g in enumerate(todo):
        wait_if_paused(control)
        emit({"event": "progress", "stage": "loadout", "pct": round(100 * i / len(todo), 1)})
        zones = {key: db.zone_for(conn, g["map"], key) for key in ("team_a_bar", "team_b_bar")}
        found = loadout.read_loadouts(path, g, zones, meta["width"], meta["height"])
        if found:
            db.replace_loadouts(conn, g["id"], found)
    return len(todo)


def extract_kills(conn, video_id, path, meta, emit, control=None):
    """Killfeed des games qui ont leurs pseudos et pas encore de kills lus. Renvoie le nombre de games lues, ou (n, erreur)."""
    todo = db.games_without_kills(conn, video_id)
    done = 0
    for i, g in enumerate(todo):
        def progress(pct, i=i):
            emit({"event": "progress", "stage": "kills", "pct": round((i + pct / 100) / len(todo) * 100, 1)})

        try:
            events = killfeed.read_events(
                path, g, db.players_of(conn, g["id"]), meta["width"], meta["height"],
                wait=lambda: wait_if_paused(control), emit=progress,
            )
        except ocr.OcrUnavailable as exc:
            return done, str(exc)
        db.replace_kills(conn, g["id"], events)
        done += 1
    return done, None


def extract_positions(conn, video_id, path, meta, emit, control=None, step_s=positions.STEP_S):
    """Positions des joueurs des games qui n'en ont pas encore. Chaque game est enregistrée d'un seul bloc."""
    todo = db.games_without_samples(conn, video_id, step_s, tracking.PARAMS_VERSION, use_kills=True)
    for i, g in enumerate(todo):
        def progress(pct, i=i):
            emit({"event": "progress", "stage": "positions", "pct": round((i + pct / 100) / len(todo) * 100, 1), "game": i + 1, "games": len(todo)})

        zone = db.zone_for(conn, g["map"], "minimap")
        scanned = conn.execute("SELECT 1 FROM kills_meta WHERE game_id = ?", (g["id"],)).fetchone() is not None
        deaths = [(k["t"], k["victim_slot"]) for k in db.kills_of(conn, g["id"])]
        rows = positions.read_game(path, g, zone, meta["width"], meta["height"], emit=progress, wait=lambda: wait_if_paused(control), step_s=step_s, deaths=deaths)
        db.replace_samples(conn, g["id"], rows, tracking.PARAMS_VERSION, with_kills=scanned)
        db.apply_corrections(conn, g["id"])
    return len(todo)


def run(source, db_path, cache_dir, emit=print_event, do_detect=True, pre_roll=segments.PRE_ROLL_S, post_roll=segments.POST_ROLL_S, skip_if_ok=False, control=None, with_positions=False, pos_every=positions.EVERY_FRAMES):
    conn = db.connect(db_path)
    source_url = None

    if ingest.is_url(source):
        emit({"event": "progress", "stage": "download", "pct": 0})
        path = ingest.download(
            source.strip(), cache_dir,
            lambda p: emit({"event": "progress", "stage": "download", "pct": round(p, 1)}),
        )
        source_url = source.strip()
    else:
        path = Path(ingest.clean_path(source))
        if not path.is_file():
            raise FileNotFoundError(f"Fichier introuvable : {path}")

    meta = ingest.probe(path)
    video_id = db.upsert_video(conn, str(path.resolve()), source_url, **meta)

    verified = skip_if_ok and db.all_verified(conn, video_id)
    if verified and not with_positions:
        emit({"event": "done", "video_id": video_id, "message": "Toutes les games sont déjà vérifiées : rien à relancer"})
        return

    if do_detect and not verified:
        emit({"event": "progress", "stage": "detect", "pct": 0})
        ok = db.ok_games(conn, video_id) if skip_if_ok else []
        ranges = gaps_around(ok, meta["duration_s"]) if ok else None
        found = detect(path, meta, emit, pre_roll, post_roll, ranges, control) if ranges != [] else []
        db.replace_detected_games(conn, video_id, found, keep_ok=skip_if_ok)
    if not verified:
        fill_maps(conn, video_id, path, meta, emit, control)

    message = "Games déjà vérifiées" if verified else None
    if with_positions:
        n_names, names_error = extract_names(conn, video_id, path, meta, emit, control)
        if names_error:
            message = f"{message} · pseudos non lus ({names_error})" if message else f"Pseudos non lus ({names_error})"
        extract_loadouts(conn, video_id, path, meta, emit, control)
        extract_capture(conn, video_id, path, meta, emit, control)
        n_kills, kills_error = extract_kills(conn, video_id, path, meta, emit, control)
        if kills_error:
            message = f"{message} · killfeed non lu ({kills_error})" if message else f"Killfeed non lu ({kills_error})"
        step_s = pos_every / meta["fps"] if meta.get("fps") else positions.STEP_S
        n = extract_positions(conn, video_id, path, meta, emit, control, step_s=step_s)
        text = f"positions lues sur {n} game(s)" if n else "positions déjà à jour"
        message = f"{message} · {text}" if message else text.capitalize()

    event = {"event": "done", "video_id": video_id}
    if message:
        event["message"] = message
    emit(event)


def main(argv=None, emit=print_event):
    parser = argparse.ArgumentParser(description="Enregistre une vidéo EVA (fichier local ou URL).")
    parser.add_argument("--source", required=True, help="Chemin d'un .mp4 ou URL YouTube")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--cache", default="data/cache")
    parser.add_argument("--no-detect", action="store_true", help="Ne pas chercher les games (vidéo d'une seule game)")
    parser.add_argument("--pre-roll", type=float, default=segments.PRE_ROLL_S, help="Secondes gardées avant le départ du chrono")
    parser.add_argument("--post-roll", type=float, default=segments.POST_ROLL_S, help="Secondes gardées après la fin du chrono (écran de victoire)")
    parser.add_argument("--skip-if-ok", action="store_true", help="Ne rien relire si toutes les games sont déjà confirmées et vérifiées")
    parser.add_argument("--control", default=None, help="Fichier dont la présence met l'analyse en pause")
    parser.add_argument("--pos-every", type=int, default=positions.EVERY_FRAMES, help="Une lecture de la minimap toutes les N images (positions)")
    parser.add_argument("--positions", action="store_true", help="Lire aussi les positions des joueurs (minimap)")
    args = parser.parse_args(argv)
    try:
        run(args.source, args.db, args.cache, emit, do_detect=not args.no_detect, pre_roll=args.pre_roll, post_roll=args.post_roll, skip_if_ok=args.skip_if_ok, control=args.control, with_positions=args.positions, pos_every=args.pos_every)
    except Exception as exc:  # noqa: BLE001 - tout échec doit être signalé à l'UI
        emit({"event": "error", "message": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    # Sous Windows, stdout est en cp1252 par défaut : on force l'UTF-8 (Node décode en UTF-8).
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
