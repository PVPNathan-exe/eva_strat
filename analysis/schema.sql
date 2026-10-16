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
  gaze_coh REAL,
  PRIMARY KEY (game_id, frame, slot)
);

-- Positions calculées que la vraie minimap ne confirme pas (superpose.py) : le joueur est placé là où aucune pastille de son équipe n'existe.
CREATE TABLE IF NOT EXISTS sample_flags (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  frame INTEGER NOT NULL,
  slot INTEGER NOT NULL,
  flag TEXT NOT NULL,
  PRIMARY KEY (game_id, frame, slot, flag)
);

-- Positions et regards posés à la main par l'utilisateur (onglet Lecture) : des vérités qui servent d'ancres au suivi et de mesure de son erreur (marks_eval.py).
CREATE TABLE IF NOT EXISTS user_marks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 8),
  t REAL NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  angle REAL,
  created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  frame INTEGER,
  frame_t REAL,
  level TEXT CHECK (level IN ('etage', 'dessous')),  -- niveau du joueur sur une carte à deux étages (Atlantis, The Cliff), posé à la main ; NULL : non précisé
  dead INTEGER NOT NULL DEFAULT 0  -- 1 : le joueur est mort à cet instant (position de la mort) ; le suivi le tient mort jusqu'à sa réapparition (tracking.USER_DEAD_S) ou la correction suivante
);

-- Joueur observé (cadre blanc du bandeau) au cours de la game : un intervalle par période, temps de la vidéo.
CREATE TABLE IF NOT EXISTS observed_segments (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  t0 REAL NOT NULL,
  t1 REAL NOT NULL
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
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0  -- version de l'algorithme de lecture du killfeed : une lecture plus ancienne est refaite
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

-- Cartographie à la main d'une carte (onglet Lecture) : couleurs rangées en classes, tyroliennes, portes, zones de départ, alignement sur le plan (map_annotations.py).
CREATE TABLE IF NOT EXISTS map_annotations (
  map TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Kills marqués à la main : « libanaise » = le tueur est collé à un mur, décale son arme dans l'ouverture et tire à l'aveugle en restant protégé. Son regard ne vise pas sa victime :
-- la règle du kill (tracking.kill_gaze) ne s'applique pas. Clé : le kill (game, instant, victime) ; l'instant est celui de la table kills au moment du marquage.
CREATE TABLE IF NOT EXISTS kill_flags (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  t REAL NOT NULL,
  victim_slot INTEGER NOT NULL CHECK (victim_slot BETWEEN 1 AND 8),
  flag TEXT NOT NULL CHECK (flag IN ('libanaise')),
  PRIMARY KEY (game_id, t, victim_slot, flag)
);

-- Boîte du point de capture actif vue sur la minimap (capture_points.py) : un segment par point actif (Outlaw : un seul point à la fois, il change toutes les 1 min 30). t0 et t1 en
-- secondes depuis le début de la game ; x, y (centre), w, h en fractions de la minimap ; point : lettre du point de la carte le plus proche (map_capture_points.json).
CREATE TABLE IF NOT EXISTS capture_boxes (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  t0 REAL NOT NULL,
  t1 REAL NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  w REAL,
  h REAL,
  point TEXT,
  PRIMARY KEY (game_id, t0)
);

-- Noms d'équipes valables pour un morceau de vidéo (bootcamp : des rediffs de 4 à 5 heures où les équipes tournent) : les games dont le milieu tombe dans l'intervalle les reçoivent.
CREATE TABLE IF NOT EXISTS team_ranges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  start_s REAL NOT NULL,
  end_s REAL NOT NULL,
  team_a TEXT,
  team_b TEXT
);

-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------
-- Onglet Stats : tables DÉRIVÉES (recalculables depuis samples, kills, capture_*), voir docs/PLAN_STATS_AGENTS.md. Temps en secondes depuis le début de la game, positions en fractions de la minimap.
-- ---------------------------------------------------------------------------------------------------------------------------------------------------------------

-- Une vie : de l'apparition à la mort (ended = 'death') ou à la fin de la game (ended = 'end'). killer_slot, weapon et kill_kind viennent du killfeed.
CREATE TABLE IF NOT EXISTS lives (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 8),
  idx INTEGER NOT NULL,
  t0 REAL NOT NULL,
  t1 REAL NOT NULL,
  x0 REAL, y0 REAL,  -- position d'apparition
  x1 REAL, y1 REAL,  -- position de la mort (ou dernière position)
  ended TEXT NOT NULL CHECK (ended IN ('death', 'end')),
  killer_slot INTEGER CHECK (killer_slot BETWEEN 1 AND 8),
  weapon TEXT,
  kill_kind TEXT,
  PRIMARY KEY (game_id, slot, idx)
);

-- Liens entre kills : trade (duel où les deux joueurs meurent à moins de 1 s : deux kills croisés) et revenge (un coéquipier de la victime tue le tueur dans les 5 s, à moins de 12 m).
-- victim_slot : le joueur mort sur la ligne ; other_slot : l'autre joueur du lien (pour un revenge : le joueur vengé) ; dt en secondes ; dist_m en mètres.
CREATE TABLE IF NOT EXISTS kill_links (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  t REAL NOT NULL,
  victim_slot INTEGER NOT NULL CHECK (victim_slot BETWEEN 1 AND 8),
  kind TEXT NOT NULL CHECK (kind IN ('trade', 'revenge')),
  other_slot INTEGER CHECK (other_slot BETWEEN 1 AND 8),
  dt REAL,
  dist_m REAL,
  PRIMARY KEY (game_id, t, victim_slot, kind)
);

-- Propriétaire d'un point de capture au cours de la game (couleur de la boîte sur la minimap, recoupée avec la pente des scores) : un segment par période.
CREATE TABLE IF NOT EXISTS point_owner (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  point TEXT NOT NULL,
  t0 REAL NOT NULL,
  t1 REAL NOT NULL,
  owner TEXT NOT NULL CHECK (owner IN ('A', 'B', 'none')),
  source TEXT CHECK (source IN ('box', 'score', 'hud')),
  PRIMARY KEY (game_id, point, t0)
);

-- Équipement d'un joueur pour une vie (il change à chaque réapparition) ; held : arme tenue au moment de la mort ; source : comment la case a été lue.
CREATE TABLE IF NOT EXISTS life_loadouts (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 8),
  life_idx INTEGER NOT NULL,
  weapon1 TEXT,
  weapon2 TEXT,
  gadget TEXT,
  held TEXT,
  source TEXT,
  PRIMARY KEY (game_id, slot, life_idx)
);

-- Épisodes de retake (le même point change de propriétaire) et de rotation (une équipe quitte un point pour un autre) ; data : JSON (positions de départ, joueurs, morts, causes) ;
-- verdict : jugement de l'utilisateur sur la détection (NULL : pas encore regardé).
CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('retake', 'rotation')),
  point TEXT,
  point_to TEXT,
  team TEXT CHECK (team IN ('A', 'B')),
  t0 REAL NOT NULL,
  t1 REAL NOT NULL,
  outcome TEXT,
  data TEXT,
  verdict TEXT CHECK (verdict IN ('ok', 'ko'))
);
CREATE INDEX IF NOT EXISTS idx_episodes_game ON episodes(game_id, kind, t0);

-- Version de chaque module de calcul des tables Stats, par game : un module dont la version a changé est recalculé.
CREATE TABLE IF NOT EXISTS stats_meta (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  module TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, module)
);

-- Point de capture ACTIF au cours de la game (celui qui clignote sous le chrono, ou dont la boîte est dessinée sur la minimap) : un segment par période, en secondes depuis le début de la game.
-- Sur Outlaw et les cartes à plusieurs points, c'est le calendrier des rotations de points (docs/PLAN_STATS_AGENTS.md).
CREATE TABLE IF NOT EXISTS point_active (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  point TEXT NOT NULL,
  t0 REAL NOT NULL,
  t1 REAL NOT NULL,
  source TEXT CHECK (source IN ('hud', 'box', 'schedule')),
  PRIMARY KEY (game_id, point, t0)
);

-- Niveau d'un joueur sur une carte à deux étages (Atlantis, The Cliff) au cours de la game : un segment par période, en secondes depuis le début de la game. 'dessous' : rez-de-chaussée (au départ),
-- 'etage' : à l'étage, seulement après avoir pris une tyrolienne qui y mène (source 'tp') ou en zone qui n'existe qu'à l'étage (source 'zone') ; 'grey' : pastille grisée sur la minimap (analysis/levels.py).
CREATE TABLE IF NOT EXISTS player_levels (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 8),
  t0 REAL NOT NULL,
  t1 REAL NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('etage', 'dessous')),
  source TEXT CHECK (source IN ('default', 'tp', 'zone', 'grey')),
  PRIMARY KEY (game_id, slot, t0)
);

-- Vague 2 de Stats (docs/PLAN_STATS_2.md). Temps en secondes depuis le début de la game, slot 1 à 8.

-- État du gadget (secondaire) d'un joueur : l'icône du bandeau passe de noire (disponible) à grise (utilisé, en recharge), comme l'arme tenue et l'arme rangée. Un segment par période (analysis/gadget_state.py).
CREATE TABLE IF NOT EXISTS gadget_state (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 8),
  t0 REAL NOT NULL,
  t1 REAL NOT NULL,
  gadget TEXT,
  state TEXT NOT NULL CHECK (state IN ('ready', 'used', 'unknown')),
  PRIMARY KEY (game_id, slot, t0)
);

-- Duel : un joueur en pousse un autre (ou deux) sans aide proche ; `winner_slot` NULL si personne ne meurt ; `outcome` en texte libre (analysis/duels.py), `data` JSON (points de vie perdus de chacun, aide proche).
CREATE TABLE IF NOT EXISTS duels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  t0 REAL NOT NULL,
  t1 REAL NOT NULL,
  slot_a INTEGER NOT NULL CHECK (slot_a BETWEEN 1 AND 8),
  slot_b INTEGER NOT NULL CHECK (slot_b BETWEEN 1 AND 8),
  winner_slot INTEGER,
  outcome TEXT,
  data TEXT
);

-- Note d'un kill (donc de la mort qui l'accompagne) : `impact` du point de vue de l'équipe du tueur, `reasons` JSON (analysis/kill_scores.py). Une convention, pas une vérité terrain.
CREATE TABLE IF NOT EXISTS kill_scores (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  t REAL NOT NULL,
  killer_slot INTEGER,
  victim_slot INTEGER NOT NULL CHECK (victim_slot BETWEEN 1 AND 8),
  impact REAL NOT NULL,
  reasons TEXT,
  PRIMARY KEY (game_id, t, victim_slot)
);

-- Bilan d'un joueur sur une game (analysis/player_game_stats.py) : vitesses en mètres par seconde (v_p98 : 98e centile, plus sûr que le maximum brut qui garde les erreurs de lecture).
CREATE TABLE IF NOT EXISTS player_game_stats (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 8),
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  alive_s REAL,
  dist_m REAL,
  v_mean REAL,
  v_p98 REAL,
  v_max REAL,
  gadget_uses INTEGER,
  gadget_unused_at_death INTEGER,
  gadget_possible REAL,
  duels_won INTEGER NOT NULL DEFAULT 0,
  duels_lost INTEGER NOT NULL DEFAULT 0,
  duels_other INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, slot)
);

-- Notes de review : annotations posées sur la reconstruction sous la vidéo, SANS aucun effet sur les données lues (le suivi, les stats et les corrections `user_marks` ne les lisent jamais).
-- kind 'position' : le joueur `slot` était trop avancé (ou mal placé) à l'instant `t` ; (x, y) est l'endroit où il aurait dû être (position « fausse » voulue), `angle` le regard voulu (degrés, 0 = est) ;
-- kind 'action' : action à faire à l'instant `t`, par exemple poser le gadget `gadget` du joueur `slot` en (x, y) ; kind 'note' : remarque libre. `text` : le commentaire qui explique l'erreur.
-- Base d'un futur « jeu d'échecs » de stratégie (docs/IDEES_STRATEGIE.md) : ces notes gardent les variantes essayées. Temps en secondes depuis le début de la game.
CREATE TABLE IF NOT EXISTS review_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  t REAL NOT NULL,
  slot INTEGER CHECK (slot BETWEEN 1 AND 8),
  kind TEXT NOT NULL CHECK (kind IN ('position', 'action', 'note')),
  x REAL,
  y REAL,
  angle REAL,
  gadget TEXT,
  text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_review_notes_game ON review_notes(game_id, t);
