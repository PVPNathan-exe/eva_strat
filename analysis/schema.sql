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
  team_a TEXT,  -- nom de l'équipe orange (côté gauche, joueurs 1 à 4), saisi par l'utilisateur
  team_b TEXT,  -- nom de l'équipe bleue (côté droit, joueurs 5 à 8)
  CHECK (end_s > start_s)
);
CREATE INDEX IF NOT EXISTS idx_games_video ON games(video_id);

-- Diminutifs d'équipe (préfixe commun des pseudos, ex. SNV) et nom complet saisi par l'utilisateur : le diminutif ne vaut pas pour toutes les équipes.
CREATE TABLE IF NOT EXISTS teams (
  tag TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calibrations (
  map TEXT NOT NULL,
  zone TEXT NOT NULL CHECK (zone IN ('minimap', 'capture_points', 'capture_pct_a', 'capture_pct_b', 'team_a_bar', 'team_b_bar', 'timer')),
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

-- Pseudos des 8 joueurs d'une game (slot 1 à 4 : équipe de gauche, 5 à 8 : équipe de droite), lus sur les bandeaux.
CREATE TABLE IF NOT EXISTS players (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 8),
  name TEXT NOT NULL,
  PRIMARY KEY (game_id, slot)
);

-- Commentaires liés à un instant de la vidéo : problèmes de suivi à signaler, points à revoir en replay d'équipe.
CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  t REAL NOT NULL,
  tag TEXT NOT NULL DEFAULT 'suivi' CHECK (tag IN ('suivi', 'equipe', 'note')),
  text TEXT NOT NULL,
  slots TEXT,  -- joueurs concernés, ex. '2,5'
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_video ON comments(video_id, t);

-- Corrections manuelles du suivi : entre t0 et t1, les deux joueurs (de la même équipe) sont échangés. Réappliquées si les positions sont relues.
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  t0 REAL NOT NULL,
  t1 REAL NOT NULL,
  slot_a INTEGER NOT NULL CHECK (slot_a BETWEEN 1 AND 8),
  slot_b INTEGER NOT NULL CHECK (slot_b BETWEEN 1 AND 8),
  CHECK (t1 > t0 AND slot_a <> slot_b)
);

-- Équipement des joueurs (icônes des bandeaux, identifiants voir weapons.py : B = arme, G = gadget).
CREATE TABLE IF NOT EXISTS loadouts (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 8),
  weapon1 TEXT,
  weapon2 TEXT,
  gadget TEXT,
  PRIMARY KEY (game_id, slot)
);

-- Kills lus dans le killfeed. kills_meta : la game a été examinée (même s'il n'y a eu aucun kill).
CREATE TABLE IF NOT EXISTS kills (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  t REAL NOT NULL,
  killer_slot INTEGER CHECK (killer_slot BETWEEN 1 AND 8),
  victim_slot INTEGER NOT NULL CHECK (victim_slot BETWEEN 1 AND 8),
  weapon TEXT,
  headshot INTEGER NOT NULL DEFAULT 0,
  kind TEXT,  -- kill, suicide, environment (aucun tueur sur la ligne : décor ou admin), unknown (tueur illisible), inferred (tueur déduit par élimination)
  PRIMARY KEY (game_id, t, victim_slot)
);
CREATE TABLE IF NOT EXISTS kills_meta (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE
);

-- Version des réglages du suivi avec laquelle les positions d'une game ont été lues : si elle change, elles sont relues.
CREATE TABLE IF NOT EXISTS samples_meta (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  params_version INTEGER NOT NULL,
  with_kills INTEGER NOT NULL DEFAULT 0,  -- 1 : les morts du killfeed étaient connues quand les positions ont été lues
  zone_key TEXT  -- zone de la minimap utilisée à la lecture : si la calibration change ensuite, les positions sont relues
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
