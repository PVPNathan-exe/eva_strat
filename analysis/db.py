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



def replace_detected_games(conn, video_id, games):
    """Remplace les games détectées d'une vidéo. Les games confirmées ne sont jamais touchées ni chevauchées."""
    conn.execute("DELETE FROM games WHERE video_id = ? AND status = 'detected'", (video_id,))
    confirmed = conn.execute("SELECT start_s, end_s FROM games WHERE video_id = ?", (video_id,)).fetchall()
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
