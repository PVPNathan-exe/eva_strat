CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  source_url TEXT,
  duration_s REAL NOT NULL,
  fps REAL NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  start_s REAL NOT NULL,
  end_s REAL NOT NULL,
  map TEXT,
  status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected', 'confirmed')),
  winner TEXT,
  checked INTEGER NOT NULL DEFAULT 0,  -- 1 : bornes comparées à la détection automatique (remis à 0 si on les déplace)
  doubts TEXT,  -- JSON : zones à vérifier [{start_s, end_s, label}] posées par la détection automatique
  CHECK (end_s > start_s)
);
CREATE INDEX IF NOT EXISTS idx_games_video ON games(video_id);

CREATE TABLE IF NOT EXISTS calibrations (
  map TEXT NOT NULL,
  zone TEXT NOT NULL CHECK (zone IN ('minimap', 'capture_points', 'team_a_bar', 'team_b_bar', 'timer')),
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL NOT NULL,
  h REAL NOT NULL,
  PRIMARY KEY (map, zone)
);

-- Remplie au chantier 2.
CREATE TABLE IF NOT EXISTS samples (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  frame INTEGER NOT NULL,
  t REAL NOT NULL,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 8),
  team TEXT NOT NULL,
  x REAL,
  y REAL,
  angle REAL,
  alive INTEGER,
  hp INTEGER,
  weapon TEXT,
  confidence REAL,
  PRIMARY KEY (game_id, frame, slot)
);

-- Remplie au chantier 2.
CREATE TABLE IF NOT EXISTS capture_state (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  t REAL NOT NULL,
  point TEXT NOT NULL,
  pct REAL,
  team TEXT,
  PRIMARY KEY (game_id, t, point)
);
