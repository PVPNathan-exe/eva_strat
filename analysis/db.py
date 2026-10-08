"""Accès SQLite côté Python. Le schéma vit dans schema.sql (partagé avec Node)."""

import json
import sqlite3
from pathlib import Path

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def connect(db_path):
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    # Bases créées avant l'ajout de la colonne doubts.
    if "doubts" not in {row["name"] for row in conn.execute("PRAGMA table_info(games)")}:
        conn.execute("ALTER TABLE games ADD COLUMN doubts TEXT")
    if "checked" not in {row["name"] for row in conn.execute("PRAGMA table_info(games)")}:
        conn.execute("ALTER TABLE games ADD COLUMN checked INTEGER NOT NULL DEFAULT 0")
    # Version 2 : suivi global des joueurs. Les positions lues avec l'ancien algorithme sont à refaire.
    if conn.execute("PRAGMA user_version").fetchone()[0] < 2:
        conn.execute("DELETE FROM samples")
        conn.execute("PRAGMA user_version = 2")
        conn.commit()
    return conn


def upsert_video(conn, path, source_url, duration_s, fps, width, height):
    conn.execute(
        """
        INSERT INTO videos (path, source_url, duration_s, fps, width, height)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          source_url = excluded.source_url,
          duration_s = excluded.duration_s,
          fps = excluded.fps,
          width = excluded.width,
          height = excluded.height
        """,
        (path, source_url, duration_s, fps, width, height),
    )
    conn.commit()
    return conn.execute("SELECT id FROM videos WHERE path = ?", (path,)).fetchone()["id"]



BOUNDS_TOLERANCE_S = 1.5  # écart toléré entre une borne posée à la main et la détection (1 lecture par seconde)


OK_SQL = "status = 'confirmed' AND checked = 1 AND doubts IS NULL AND map IS NOT NULL"


def ok_games(conn, video_id):
    """Games déjà en ordre (confirmées, vérifiées, sans doute, avec carte) : inutile de les relire."""
    return conn.execute(
        f"SELECT id, start_s, end_s FROM games WHERE video_id = ? AND {OK_SQL} ORDER BY start_s", (video_id,)
    ).fetchall()


def _check_confirmed(conn, confirmed, games):
    """Compare chaque game confirmée à la détection : elle n'est jamais modifiée, seules ses zones à vérifier le sont."""
    for c in confirmed:
        doubts = []
        match = max(
            (g for g in games if g["start_s"] < c["end_s"] and g["end_s"] > c["start_s"]),
            key=lambda g: min(g["end_s"], c["end_s"]) - max(g["start_s"], c["start_s"]),
            default=None,
        )
        if match is None:
            doubts.append({"start_s": c["start_s"], "end_s": c["end_s"], "label": "Aucun chrono lu par la détection dans cette game"})
        else:
            for name, mine, found in (("Début", c["start_s"], match["start_s"]), ("Fin", c["end_s"], match["end_s"])):
                gap = mine - found
                if abs(gap) > BOUNDS_TOLERANCE_S:
                    where = "trop tard" if (gap > 0) == (name == "Début") else "trop tôt"
                    doubts.append(
                        {
                            "start_s": min(mine, found),
                            "end_s": max(mine, found),
                            "label": f"{name} posé {where} de {abs(gap):.0f} s (la détection propose {found:.0f} s)",
                        }
                    )
        conn.execute(
            "UPDATE games SET doubts = ?, checked = 1 WHERE id = ?",
            (json.dumps(doubts, ensure_ascii=False) if doubts else None, c["id"]),
        )


def replace_detected_games(conn, video_id, games, keep_ok=False):
    """Remplace les games détectées d'une vidéo. Les games confirmées ne sont jamais touchées ni chevauchées :
    on vérifie seulement leurs bornes contre la détection."""
    conn.execute("DELETE FROM games WHERE video_id = ? AND status = 'detected'", (video_id,))
    confirmed = conn.execute("SELECT id, start_s, end_s FROM games WHERE video_id = ?", (video_id,)).fetchall()
    skipped = {r["id"] for r in ok_games(conn, video_id)} if keep_ok else set()
    _check_confirmed(conn, [c for c in confirmed if c["id"] not in skipped], games)
    added = 0
    for g in games:
        if any(g["start_s"] < c["end_s"] and g["end_s"] > c["start_s"] for c in confirmed):
            continue
        conn.execute(
            "INSERT INTO games (video_id, start_s, end_s, status, doubts) VALUES (?, ?, ?, 'detected', ?)",
            (video_id, g["start_s"], g["end_s"], json.dumps(g["doubts"], ensure_ascii=False) if g["doubts"] else None),
        )
        added += 1
    conn.commit()
    return added


def all_verified(conn, video_id):
    """Vrai si la vidéo a des games et que toutes sont confirmées, vérifiées, sans doute restant et avec une carte."""
    row = conn.execute(
        """
        SELECT COUNT(*) AS n,
               SUM(status = 'confirmed' AND checked = 1 AND doubts IS NULL AND map IS NOT NULL) AS ok
        FROM games WHERE video_id = ?
        """,
        (video_id,),
    ).fetchone()
    return row["n"] > 0 and row["ok"] == row["n"]


DEFAULT_ZONES_PATH = Path(__file__).with_name("default_zones.json")


def zone_for(conn, map_name, zone):
    """Rectangle relatif d'une zone du HUD : calibration de la carte si elle existe, sinon zone par défaut."""
    if map_name:
        row = conn.execute("SELECT x, y, w, h FROM calibrations WHERE map = ? AND zone = ?", (map_name, zone)).fetchone()
        if row:
            return dict(row)
    return json.loads(DEFAULT_ZONES_PATH.read_text(encoding="utf-8"))[zone]


def _sample_step(conn, game_id):
    """Intervalle (s) entre deux lectures déjà enregistrées pour une game, ou None s'il n'y en a pas."""
    row = conn.execute("SELECT COUNT(DISTINCT frame) AS n, MIN(t) AS lo, MAX(t) AS hi FROM samples WHERE game_id = ?", (game_id,)).fetchone()
    if not row["n"]:
        return None
    return (row["hi"] - row["lo"]) / (row["n"] - 1) if row["n"] > 1 else 0.0


def games_without_samples(conn, video_id, step_s=None, params_version=None):
    """Games dont les positions sont à lire : aucune lecture, lues à une autre cadence que step_s, ou avec d'autres réglages
    du suivi que params_version (si donnés)."""
    out = []
    for g in conn.execute("SELECT id, start_s, end_s, map FROM games WHERE video_id = ? ORDER BY start_s", (video_id,)).fetchall():
        have = _sample_step(conn, g["id"])
        stale = False
        if params_version is not None:
            meta = conn.execute("SELECT params_version FROM samples_meta WHERE game_id = ?", (g["id"],)).fetchone()
            stale = (meta["params_version"] if meta else 0) != params_version
        if have is None or stale or (step_s is not None and abs(have - step_s) > 0.15 * step_s):
            out.append(dict(g))
    return out


def replace_samples(conn, game_id, rows, params_version=0):
    """Enregistre d'un seul bloc les positions d'une game (lignes : frame, t, slot, team, x, y, angle, alive, confiance)."""
    conn.execute("DELETE FROM samples WHERE game_id = ?", (game_id,))
    conn.executemany(
        "INSERT OR REPLACE INTO samples (game_id, frame, t, slot, team, x, y, angle, alive, confidence) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [(game_id, *r) for r in rows],
    )
    conn.execute("INSERT OR REPLACE INTO samples_meta (game_id, params_version) VALUES (?, ?)", (game_id, params_version))
    conn.commit()
