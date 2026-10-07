"""Accès SQLite côté Python. Le schéma vit dans schema.sql (partagé avec Node)."""

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

