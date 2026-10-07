# Onglet Analyse (chantier 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un onglet « Analyse » à EVA Strat : charger un .mp4 ou une URL YouTube, détecter automatiquement les games dans la vidéo, les corriger à la main, et calibrer les zones du HUD par carte, le tout stocké dans SQLite.

**Architecture:** Un script Python (`analysis/analyze.py`, ffmpeg + OpenCV) télécharge/lit la vidéo, détecte les segments de game et écrit `data/eva.db`. Un plugin Vite (`server/`) lance le script, relaie la progression en SSE, sert la vidéo avec `Range`, et expose une petite API REST (`node:sqlite`) pour les corrections de l'utilisateur. L'UI React ajoute un onglet avec lecteur, timeline, liste de games et éditeur de calibration.

**Tech Stack:** Python 3.14 (opencv-python, numpy, yt-dlp, pytest), Node 24 (`node:sqlite`, `node:test`, TypeScript exécuté nativement pour les tests), Vite 8, React 19, Zustand 5.

**Spec :** `docs/superpowers/specs/2026-10-07-onglet-analyse-design.md`

---

## File Structure

**Créés**

| Fichier | Responsabilité |
| --- | --- |
| `analysis/requirements.txt` | Dépendances Python |
| `analysis/schema.sql` | Schéma SQLite unique, lu par Python et Node |
| `analysis/default_zones.json` | Zones HUD par défaut (coordonnées relatives), lues par Python et par l'UI |
| `analysis/db.py` | Connexion SQLite, `upsert_video`, `replace_detected_games` |
| `analysis/segments.py` | `build_segments` : suite de booléens → segments (fonction pure) |
| `analysis/hud.py` | `hud_present` : détection du HUD par couleurs sur une image |
| `analysis/ingest.py` | `is_url`, `clean_path`, `probe` (ffprobe), `download` (yt-dlp) |
| `analysis/analyze.py` | CLI : orchestre ingestion, détection, écriture, événements JSON sur stdout |
| `analysis/tests/` | Tests pytest et image de référence |
| `pytest.ini` | Config pytest |
| `server/db.ts` | Ouverture de la base (WAL) et application du schéma |
| `server/api.ts` | Logique REST pure : `handleApi(ctx, method, pathname, query, body)` |
| `server/range.ts` | `parseRange` (en-tête `Range`) |
| `server/jobs.ts` | `JobManager` : lance le script, garde les événements, abonnements SSE |
| `server/analysisPlugin.ts` | Plugin Vite : branche tout ça sur `/api` |
| `tests/server/*.test.ts`, `tests/timeline.test.ts` | Tests `node:test` |
| `src/types/analysis.ts` | Types partagés côté UI |
| `src/lib/analysisApi.ts` | Appels `fetch` vers `/api` et abonnement SSE |
| `src/lib/timeline.ts` | Fonctions pures de temps (formatage, pourcentages, bornes) |
| `src/lib/videoRef.ts` | Référence au `<video>` et capture d'une frame |
| `src/store/analysisStore.ts` | État de l'onglet (vidéo, games, temps courant, job) |
| `src/components/analysis/` | `AnalysisTab`, `IngestBar`, `VideoPlayer`, `SegmentTimeline`, `GameList`, `CalibrationEditor` |

**Modifiés** : `.gitignore`, `package.json` (scripts de test), `tsconfig.node.json` (inclure `server` et `tests`), `vite.config.ts` (plugin), `src/App.tsx` (onglets), `src/App.css` (styles), `README.md`.

## Conventions

- Tests Python : `python -m pytest -q` depuis la racine. Tests Node : `npm run test:js`. Les deux : `npm test`.
- Les messages visibles par l'utilisateur sont en français, comme le reste de l'app.
- `erasableSyntaxOnly` est actif : pas d'`enum` ni de propriétés de paramètre de constructeur en TypeScript.
- Commits en français, préfixe `feat:`/`test:`/`chore:`, terminés par `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: Socle Python et schéma partagé

**Files:**
- Create: `analysis/requirements.txt`, `analysis/schema.sql`, `analysis/default_zones.json`, `pytest.ini`
- Modify: `.gitignore`

- [ ] **Step 1: Installer les dépendances Python**

Créer `analysis/requirements.txt` :

```
opencv-python
numpy
yt-dlp
pytest
```

Run: `python -m pip install -r analysis/requirements.txt`
Expected: fin sans erreur (`Successfully installed ...`).

Run: `python -c "import cv2, numpy, yt_dlp, pytest; print(cv2.__version__)"`
Expected: affiche un numéro de version OpenCV, sans erreur.

- [ ] **Step 2: Créer le schéma SQLite**

Créer `analysis/schema.sql` :

```sql
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
```

- [ ] **Step 3: Créer les zones par défaut**

Créer `analysis/default_zones.json` (mesurées sur la capture de référence 1917×1078) :

```json
{
  "minimap": { "x": 0.003, "y": 0.742, "w": 0.186, "h": 0.255 },
  "capture_points": { "x": 0.448, "y": 0.06, "w": 0.105, "h": 0.032 },
  "team_a_bar": { "x": 0.005, "y": 0.028, "w": 0.31, "h": 0.083 },
  "team_b_bar": { "x": 0.685, "y": 0.028, "w": 0.31, "h": 0.083 },
  "timer": { "x": 0.474, "y": 0.038, "w": 0.052, "h": 0.058 }
}
```

- [ ] **Step 4: Config pytest et .gitignore**

Créer `pytest.ini` :

```ini
[pytest]
pythonpath = analysis
testpaths = analysis/tests
```

Ajouter à la fin de `.gitignore` :

```
# Analyse vidéo
data/
__pycache__/
.pytest_cache/
```

- [ ] **Step 5: Commit**

```bash
git add analysis/requirements.txt analysis/schema.sql analysis/default_zones.json pytest.ini .gitignore
git commit -m "chore(analyse): socle Python, schéma SQLite et zones HUD par défaut

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Accès base côté Python (`db.py`)

**Files:**
- Create: `analysis/db.py`, `analysis/tests/test_db.py`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `analysis/tests/test_db.py` :

```python
import db


def make_conn(tmp_path):
    return db.connect(tmp_path / "eva.db")


def test_connect_creates_all_tables(tmp_path):
    conn = make_conn(tmp_path)
    names = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"videos", "games", "calibrations", "samples", "capture_state"} <= names


def test_upsert_video_returns_same_id_for_same_path(tmp_path):
    conn = make_conn(tmp_path)
    a = db.upsert_video(conn, "D:/rec/a.mp4", None, 600.0, 60.0, 1920, 1080)
    b = db.upsert_video(conn, "D:/rec/a.mp4", None, 650.0, 60.0, 1920, 1080)
    assert a == b
    row = conn.execute("SELECT duration_s FROM videos WHERE id=?", (a,)).fetchone()
    assert row["duration_s"] == 650.0


def test_replace_detected_games_replaces_only_detected(tmp_path):
    conn = make_conn(tmp_path)
    vid = db.upsert_video(conn, "D:/rec/a.mp4", None, 3000.0, 60.0, 1920, 1080)
    db.replace_detected_games(conn, vid, [(0.0, 100.0), (500.0, 700.0)])
    conn.execute("UPDATE games SET status='confirmed' WHERE start_s=500.0")
    conn.commit()
    db.replace_detected_games(conn, vid, [(10.0, 90.0), (1000.0, 1200.0)])
    rows = conn.execute("SELECT start_s, end_s, status FROM games WHERE video_id=? ORDER BY start_s", (vid,)).fetchall()
    assert [(r["start_s"], r["end_s"], r["status"]) for r in rows] == [
        (10.0, 90.0, "detected"),
        (500.0, 700.0, "confirmed"),
        (1000.0, 1200.0, "detected"),
    ]


def test_replace_detected_games_skips_segments_overlapping_confirmed(tmp_path):
    conn = make_conn(tmp_path)
    vid = db.upsert_video(conn, "D:/rec/a.mp4", None, 3000.0, 60.0, 1920, 1080)
    conn.execute("INSERT INTO games(video_id, start_s, end_s, status) VALUES (?, 500, 700, 'confirmed')", (vid,))
    conn.commit()
    db.replace_detected_games(conn, vid, [(480.0, 720.0), (800.0, 900.0)])
    rows = conn.execute("SELECT start_s FROM games WHERE video_id=? AND status='detected'", (vid,)).fetchall()
    assert [r["start_s"] for r in rows] == [800.0]
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `python -m pytest analysis/tests/test_db.py -q`
Expected: FAIL / erreur `ModuleNotFoundError: No module named 'db'`.

- [ ] **Step 3: Implémenter `db.py`**

Créer `analysis/db.py` :

```python
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


def replace_detected_games(conn, video_id, segments):
    """Remplace les games 'detected' d'une vidéo, sans toucher aux 'confirmed'.

    Un segment qui chevauche une game confirmée est ignoré.
    """
    confirmed = conn.execute(
        "SELECT start_s, end_s FROM games WHERE video_id = ? AND status = 'confirmed'",
        (video_id,),
    ).fetchall()
    kept = [
        (start, end)
        for start, end in segments
        if not any(start < c["end_s"] and end > c["start_s"] for c in confirmed)
    ]
    with conn:
        conn.execute("DELETE FROM games WHERE video_id = ? AND status = 'detected'", (video_id,))
        conn.executemany(
            "INSERT INTO games (video_id, start_s, end_s) VALUES (?, ?, ?)",
            [(video_id, start, end) for start, end in kept],
        )
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `python -m pytest analysis/tests/test_db.py -q`
Expected: `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add analysis/db.py analysis/tests/test_db.py
git commit -m "feat(analyse): accès SQLite Python (vidéos, games détectées)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Construction des segments (`segments.py`)

**Files:**
- Create: `analysis/segments.py`, `analysis/tests/test_segments.py`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `analysis/tests/test_segments.py` :

```python
from segments import build_segments

F, T = False, True


def test_single_run():
    flags = [F] * 5 + [T] * 10 + [F] * 5
    assert build_segments(flags, 1.0, min_len_s=5, gap_tolerance_s=2) == [(5.0, 15.0)]


def test_small_gap_is_merged():
    flags = [F] * 5 + [T] * 10 + [F] * 3 + [T] * 10 + [F] * 2
    assert build_segments(flags, 1.0, min_len_s=5, gap_tolerance_s=5) == [(5.0, 28.0)]


def test_large_gap_splits():
    flags = [F] * 5 + [T] * 10 + [F] * 3 + [T] * 10 + [F] * 2
    assert build_segments(flags, 1.0, min_len_s=5, gap_tolerance_s=2) == [(5.0, 15.0), (18.0, 28.0)]


def test_short_run_is_dropped():
    flags = [T] * 3 + [F] * 20 + [T] * 12
    assert build_segments(flags, 1.0, min_len_s=10, gap_tolerance_s=2) == [(23.0, 35.0)]


def test_run_reaching_the_end_is_kept():
    assert build_segments([F, F, T, T, T], 1.0, min_len_s=2, gap_tolerance_s=1) == [(2.0, 5.0)]


def test_step_scales_times():
    flags = [F, T, T, T, F]
    assert build_segments(flags, 2.0, min_len_s=2, gap_tolerance_s=1) == [(2.0, 8.0)]


def test_empty_and_all_false():
    assert build_segments([], 1.0) == []
    assert build_segments([F] * 50, 1.0, min_len_s=1) == []
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `python -m pytest analysis/tests/test_segments.py -q`
Expected: erreur `ModuleNotFoundError: No module named 'segments'`.

- [ ] **Step 3: Implémenter `segments.py`**

Créer `analysis/segments.py` :

```python
"""Transforme une suite de booléens (HUD présent ou non, un par échantillon)
en segments (début_s, fin_s)."""


def build_segments(flags, step_s, min_len_s=120.0, gap_tolerance_s=10.0):
    runs = []
    start = None
    for i, present in enumerate(flags):
        if present and start is None:
            start = i
        elif not present and start is not None:
            runs.append([start, i - 1])
            start = None
    if start is not None:
        runs.append([start, len(flags) - 1])

    merged = []
    for run in runs:
        gap_s = (run[0] - merged[-1][1] - 1) * step_s if merged else None
        if gap_s is not None and gap_s <= gap_tolerance_s:
            merged[-1][1] = run[1]
        else:
            merged.append(run)

    return [
        (first * step_s, (last + 1) * step_s)
        for first, last in merged
        if (last + 1 - first) * step_s >= min_len_s
    ]
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `python -m pytest analysis/tests/test_segments.py -q`
Expected: `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add analysis/segments.py analysis/tests/test_segments.py
git commit -m "feat(analyse): construction des segments de game

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Détection du HUD (`hud.py`)

**Files:**
- Create: `analysis/hud.py`, `analysis/tests/test_hud.py`, `analysis/tests/fixtures/game_hud.png`

- [ ] **Step 1: Ajouter l'image de référence**

Run (copie la capture d'écran fournie en début de session) :

```bash
mkdir -p analysis/tests/fixtures
cp "C:/Users/IPMSC/AppData/Local/Temp/claude/c--Users-IPMSC-eva-strat/a51d2e88-7c14-416c-8463-b301d3dc3a19/images/1.png" analysis/tests/fixtures/game_hud.png
```

Expected: le fichier existe (`ls analysis/tests/fixtures/game_hud.png`). Si le chemin n'existe plus, demander à l'utilisateur de redéposer la capture à cet emplacement.

- [ ] **Step 2: Écrire les tests qui échouent**

Créer `analysis/tests/test_hud.py` :

```python
from pathlib import Path

import cv2
import numpy as np

import hud

FIXTURE = Path(__file__).parent / "fixtures" / "game_hud.png"


def solid(color_bgr, w=640, h=360):
    img = np.zeros((h, w, 3), np.uint8)
    img[:] = color_bgr
    return img


def test_real_game_frame_is_detected():
    frame = cv2.imread(str(FIXTURE))
    assert frame is not None, "image de référence introuvable"
    assert hud.hud_score(frame) >= hud.HUD_THRESHOLD
    assert hud.hud_present(frame)


def test_real_game_frame_is_detected_after_downscale():
    frame = cv2.resize(cv2.imread(str(FIXTURE)), (640, 360), interpolation=cv2.INTER_AREA)
    assert hud.hud_present(frame)


def test_black_screen_is_not_hud():
    assert not hud.hud_present(solid((0, 0, 0)))


def test_green_jungle_is_not_hud():
    assert not hud.hud_present(solid((40, 140, 60)))


def test_only_one_team_color_is_not_hud():
    frame = solid((0, 0, 0))
    zone = hud.DEFAULT_ZONES["team_a_bar"]
    region = hud.crop(frame, zone)
    region[:] = (0, 140, 255)  # orange (BGR), seulement à gauche
    assert not hud.hud_present(frame)


def test_both_team_colors_in_their_zones_is_hud():
    frame = solid((0, 0, 0))
    hud.crop(frame, hud.DEFAULT_ZONES["team_a_bar"])[:] = (0, 140, 255)  # orange
    hud.crop(frame, hud.DEFAULT_ZONES["team_b_bar"])[:] = (230, 120, 30)  # bleu
    assert hud.hud_present(frame)
```

- [ ] **Step 3: Lancer les tests pour vérifier qu'ils échouent**

Run: `python -m pytest analysis/tests/test_hud.py -q`
Expected: erreur `ModuleNotFoundError: No module named 'hud'`.

- [ ] **Step 4: Implémenter `hud.py`**

Créer `analysis/hud.py` :

```python
"""Détection de la présence du HUD de jeu sur une image BGR.

Le HUD est présent quand les deux bandeaux de joueurs du haut sont colorés,
l'un en orange et l'autre en bleu. Les zones sont en coordonnées relatives.
"""

import json
from pathlib import Path

import cv2
import numpy as np

DEFAULT_ZONES = json.loads(Path(__file__).with_name("default_zones.json").read_text(encoding="utf-8"))

# Bornes HSV d'OpenCV (H sur 0-179).
ORANGE = (np.array([5, 150, 150]), np.array([25, 255, 255]))
BLUE = (np.array([95, 120, 120]), np.array([125, 255, 255]))

HUD_THRESHOLD = 0.10


def crop(frame, zone):
    """Sous-image (vue, pas une copie) correspondant à une zone relative."""
    h, w = frame.shape[:2]
    x0 = int(zone["x"] * w)
    y0 = int(zone["y"] * h)
    x1 = max(x0 + 1, int((zone["x"] + zone["w"]) * w))
    y1 = max(y0 + 1, int((zone["y"] + zone["h"]) * h))
    return frame[y0:y1, x0:x1]


def color_fraction(region, bounds):
    hsv = cv2.cvtColor(region, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, bounds[0], bounds[1])
    return float(np.count_nonzero(mask)) / mask.size


def hud_score(frame, zones=None):
    z = zones or DEFAULT_ZONES
    left = crop(frame, z["team_a_bar"])
    right = crop(frame, z["team_b_bar"])
    straight = min(color_fraction(left, ORANGE), color_fraction(right, BLUE))
    swapped = min(color_fraction(left, BLUE), color_fraction(right, ORANGE))
    return max(straight, swapped)


def hud_present(frame, zones=None, threshold=HUD_THRESHOLD):
    return hud_score(frame, zones) >= threshold
```

- [ ] **Step 5: Lancer les tests pour vérifier qu'ils passent**

Run: `python -m pytest analysis/tests/test_hud.py -q`
Expected: `6 passed`.

Si `test_real_game_frame_is_detected` échoue, afficher le score réel :
`python -c "import cv2, sys; sys.path.insert(0,'analysis'); import hud; print(hud.hud_score(cv2.imread('analysis/tests/fixtures/game_hud.png')))"`
puis ajuster **uniquement** `HUD_THRESHOLD` (le score réel doit être nettement au-dessus du seuil, avec une marge d'au moins un facteur 2) ou les bornes `ORANGE` / `BLUE` si le score est proche de 0. Relancer jusqu'à ce que les 6 tests passent.

- [ ] **Step 6: Commit**

```bash
git add analysis/hud.py analysis/tests/test_hud.py analysis/tests/fixtures/game_hud.png
git commit -m "feat(analyse): détection du HUD de jeu par couleurs des bandeaux

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ingestion (`ingest.py`)

**Files:**
- Create: `analysis/ingest.py`, `analysis/tests/test_ingest.py`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `analysis/tests/test_ingest.py` :

```python
import subprocess

import ingest


def test_is_url():
    assert ingest.is_url("https://www.youtube.com/watch?v=abc")
    assert ingest.is_url("  http://youtu.be/abc ")
    assert not ingest.is_url("D:\\rec\\match.mp4")
    assert not ingest.is_url("match.mp4")


def test_clean_path_strips_quotes_and_spaces():
    assert ingest.clean_path('  "D:\\rec\\match 1.mp4"  ') == "D:\\rec\\match 1.mp4"
    assert ingest.clean_path("'/tmp/a.mp4'") == "/tmp/a.mp4"


def test_probe_reads_real_video(tmp_path):
    video = tmp_path / "t.mp4"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25:duration=2",
         "-pix_fmt", "yuv420p", str(video)],
        check=True,
    )
    meta = ingest.probe(video)
    assert meta["width"] == 320 and meta["height"] == 180
    assert abs(meta["fps"] - 25.0) < 0.01
    assert 1.9 < meta["duration_s"] < 2.2
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `python -m pytest analysis/tests/test_ingest.py -q`
Expected: erreur `ModuleNotFoundError: No module named 'ingest'`.

- [ ] **Step 3: Implémenter `ingest.py`**

Créer `analysis/ingest.py` :

```python
"""Résolution de la source : fichier local ou URL (téléchargée avec yt-dlp)."""

import json
import subprocess
from pathlib import Path


def is_url(source):
    return source.strip().lower().startswith(("http://", "https://"))


def clean_path(source):
    """Retire espaces et guillemets (Windows « Copier en tant que chemin » en ajoute)."""
    return source.strip().strip('"').strip("'")


def probe(path):
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,avg_frame_rate",
            "-show_entries", "format=duration",
            "-of", "json", str(path),
        ],
        capture_output=True, text=True, check=True,
    ).stdout
    data = json.loads(out)
    stream = data["streams"][0]
    num, den = stream["avg_frame_rate"].split("/")
    fps = float(num) / float(den) if float(den) else 0.0
    return {
        "duration_s": float(data["format"]["duration"]),
        "fps": fps,
        "width": int(stream["width"]),
        "height": int(stream["height"]),
    }


def download(url, cache_dir, on_progress):
    """Télécharge une vidéo (1080p max) en mp4 dans cache_dir et renvoie son chemin."""
    import yt_dlp

    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                on_progress(d["downloaded_bytes"] / total * 100)

    options = {
        "format": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]",
        "merge_output_format": "mp4",
        "outtmpl": str(cache_dir / "%(id)s.%(ext)s"),
        "progress_hooks": [hook],
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        return Path(ydl.prepare_filename(info)).with_suffix(".mp4")
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `python -m pytest analysis/tests/test_ingest.py -q`
Expected: `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add analysis/ingest.py analysis/tests/test_ingest.py
git commit -m "feat(analyse): ingestion fichier local et URL YouTube (yt-dlp)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: CLI d'analyse (`analyze.py`)

**Files:**
- Create: `analysis/analyze.py`, `analysis/tests/test_analyze.py`

- [ ] **Step 1: Écrire le test d'intégration qui échoue**

Il fabrique une vidéo synthétique de 50 s : lobby gris (0–10 s), « game » avec bandeaux orange et bleu (10–40 s), lobby (40–50 s).

Créer `analysis/tests/test_analyze.py` :

```python
import cv2
import numpy as np

import analyze
import db
import hud


def make_video(path, fps=5, w=640, h=360):
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (w, h))
    lobby = np.full((h, w, 3), 90, np.uint8)
    game = np.zeros((h, w, 3), np.uint8)
    hud.crop(game, hud.DEFAULT_ZONES["team_a_bar"])[:] = (0, 140, 255)
    hud.crop(game, hud.DEFAULT_ZONES["team_b_bar"])[:] = (230, 120, 30)
    for second in range(50):
        frame = game if 10 <= second < 40 else lobby
        for _ in range(fps):
            writer.write(frame)
    writer.release()


def test_run_detects_one_game(tmp_path):
    video = tmp_path / "match.mp4"
    make_video(video)
    events = []
    analyze.run(
        source=f'"{video}"',
        db_path=tmp_path / "eva.db",
        cache_dir=tmp_path / "cache",
        step_s=1.0,
        min_len_s=10.0,
        gap_s=2.0,
        emit=events.append,
    )
    assert events[-1]["event"] == "done"
    assert events[-1]["games"] == 1

    conn = db.connect(tmp_path / "eva.db")
    games = conn.execute("SELECT start_s, end_s, status FROM games").fetchall()
    assert len(games) == 1
    assert 8 <= games[0]["start_s"] <= 12
    assert 38 <= games[0]["end_s"] <= 42
    assert games[0]["status"] == "detected"
    assert any(e["event"] == "progress" and e["stage"] == "detect" for e in events)


def test_run_reports_missing_file(tmp_path):
    events = []
    code = analyze.main(
        ["--source", str(tmp_path / "absent.mp4"), "--db", str(tmp_path / "eva.db"), "--cache", str(tmp_path / "c")],
        emit=events.append,
    )
    assert code == 1
    assert events[-1]["event"] == "error"
    assert "introuvable" in events[-1]["message"].lower()
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `python -m pytest analysis/tests/test_analyze.py -q`
Expected: erreur `ModuleNotFoundError: No module named 'analyze'`.

- [ ] **Step 3: Implémenter `analyze.py`**

Créer `analysis/analyze.py` :

```python
"""CLI d'analyse : lit (ou télécharge) une vidéo, détecte les games, écrit dans SQLite.

Les événements sont écrits sur stdout, un objet JSON par ligne :
  {"event": "progress", "stage": "download" | "detect", "pct": 0-100}
  {"event": "done", "video_id": N, "games": N}
  {"event": "error", "message": "..."}
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

import db
import hud
import ingest
import segments

FRAME_W, FRAME_H = 640, 360


def print_event(event):
    print(json.dumps(event, ensure_ascii=False), flush=True)


def sample_flags(path, duration_s, step_s, on_progress):
    """Décode la vidéo à 1 image toutes les step_s secondes et teste le HUD."""
    cmd = [
        "ffmpeg", "-v", "error", "-i", str(path),
        "-vf", f"fps=1/{step_s},scale={FRAME_W}:{FRAME_H}",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    frame_size = FRAME_W * FRAME_H * 3
    flags = []
    while True:
        buf = proc.stdout.read(frame_size)
        if len(buf) < frame_size:
            break
        frame = np.frombuffer(buf, np.uint8).reshape(FRAME_H, FRAME_W, 3)
        flags.append(hud.hud_present(frame))
        if len(flags) % 10 == 0:
            on_progress(min(99.0, len(flags) * step_s / duration_s * 100))
    proc.wait()
    if proc.returncode:
        raise RuntimeError("ffmpeg n'a pas pu décoder la vidéo")
    return flags


def run(source, db_path, cache_dir, step_s, min_len_s, gap_s, emit=print_event):
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

    emit({"event": "progress", "stage": "detect", "pct": 0})
    flags = sample_flags(
        path, meta["duration_s"], step_s,
        lambda p: emit({"event": "progress", "stage": "detect", "pct": round(p, 1)}),
    )
    found = segments.build_segments(flags, step_s, min_len_s, gap_s)
    db.replace_detected_games(conn, video_id, found)
    emit({"event": "done", "video_id": video_id, "games": len(found)})


def main(argv=None, emit=print_event):
    parser = argparse.ArgumentParser(description="Détecte les games d'une vidéo EVA.")
    parser.add_argument("--source", required=True, help="Chemin d'un .mp4 ou URL YouTube")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--cache", default="data/cache")
    parser.add_argument("--step", type=float, default=1.0, help="Secondes entre deux échantillons")
    parser.add_argument("--min-len", type=float, default=120.0, help="Durée minimale d'une game (s)")
    parser.add_argument("--gap", type=float, default=10.0, help="Coupure tolérée dans une game (s)")
    args = parser.parse_args(argv)
    try:
        run(args.source, args.db, args.cache, args.step, args.min_len, args.gap, emit)
    except Exception as exc:  # noqa: BLE001 - tout échec doit être signalé à l'UI
        emit({"event": "error", "message": str(exc)})
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `python -m pytest -q`
Expected: tous les tests Python passent (`20 passed` environ).

- [ ] **Step 5: Commit**

```bash
git add analysis/analyze.py analysis/tests/test_analyze.py
git commit -m "feat(analyse): CLI analyze.py (ingestion, détection, événements JSON)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Socle TypeScript serveur et scripts de test

**Files:**
- Modify: `package.json`, `tsconfig.node.json`
- Create: `server/db.ts`, `tests/server/helpers.ts`, `tests/server/db.test.ts`

- [ ] **Step 1: Ajouter les scripts de test**

Dans `package.json`, section `"scripts"`, ajouter après `"preview": "vite preview"` (sans oublier la virgule précédente) :

```json
    "test:js": "node --test --disable-warning=ExperimentalWarning \"tests/**/*.test.ts\"",
    "test:py": "python -m pytest -q",
    "test": "npm run test:js && npm run test:py"
```

- [ ] **Step 2: Étendre la config TypeScript du côté Node**

Dans `tsconfig.node.json`, remplacer la ligne `"include": ["vite.config.ts"]` par :

```json
  "include": ["vite.config.ts", "server", "tests"]
```

et ajouter dans `compilerOptions`, après `"types": ["node"],` :

```json
    "lib": ["ES2023", "DOM"],
```

en supprimant la ligne `"lib": ["ES2023"],` existante (pour que `src/lib/timeline.ts`, importé par un test, compile sans erreur).

- [ ] **Step 3: Écrire le test qui échoue**

Créer `tests/server/helpers.ts` :

```ts
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { openDb } from '../../server/db.ts';
import type { ApiContext, Zones } from '../../server/api.ts';

const schemaPath = fileURLToPath(new URL('../../analysis/schema.sql', import.meta.url));
const zonesPath = fileURLToPath(new URL('../../analysis/default_zones.json', import.meta.url));

export function testContext(): ApiContext {
  const db = openDb(':memory:', schemaPath);
  const defaultZones = JSON.parse(readFileSync(zonesPath, 'utf-8')) as Zones;
  return { db, defaultZones };
}

export function insertVideo(ctx: ApiContext, duration = 3000): number {
  const result = ctx.db
    .prepare('INSERT INTO videos (path, duration_s, fps, width, height) VALUES (?, ?, 60, 1920, 1080)')
    .run(`D:/rec/${Math.random()}.mp4`, duration);
  return Number(result.lastInsertRowid);
}
```

Créer `tests/server/db.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../server/db.ts';

const schemaPath = fileURLToPath(new URL('../../analysis/schema.sql', import.meta.url));

test('openDb applique le schéma complet', () => {
  const db = openDb(':memory:', schemaPath);
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  const names = rows.map((r) => r.name);
  for (const table of ['videos', 'games', 'calibrations', 'samples', 'capture_state']) {
    assert.ok(names.includes(table), `table manquante : ${table}`);
  }
});

test('les clés étrangères sont actives', () => {
  const db = openDb(':memory:', schemaPath);
  assert.throws(() => db.prepare('INSERT INTO games (video_id, start_s, end_s) VALUES (999, 0, 10)').run());
});
```

- [ ] **Step 4: Lancer le test pour vérifier qu'il échoue**

Run: `npm run test:js`
Expected: FAIL, `Cannot find module '.../server/db.ts'`.

- [ ] **Step 5: Implémenter `server/db.ts`**

Créer `server/db.ts` :

```ts
// Ouverture de la base SQLite (mode WAL) et application du schéma partagé avec Python.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path: string, schemaPath: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(readFileSync(schemaPath, 'utf-8'));
  return db;
}
```

`tests/server/helpers.ts` importe aussi `server/api.ts`, qui n'existe pas encore : créer ce fichier minimal pour que le test de cette tâche compile (il sera complété à la tâche 8) :

```ts
// Logique REST de l'onglet Analyse (fonctions pures, testables sans serveur HTTP).

import type { DatabaseSync } from 'node:sqlite';

export const ZONE_NAMES = ['minimap', 'capture_points', 'team_a_bar', 'team_b_bar', 'timer'] as const;
export type ZoneName = (typeof ZONE_NAMES)[number];
export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Zones = Record<ZoneName, Zone>;

export interface ApiContext {
  db: DatabaseSync;
  defaultZones: Zones;
}

export interface ApiResult {
  status: number;
  json: unknown;
}
```

- [ ] **Step 6: Lancer le test pour vérifier qu'il passe**

Run: `npm run test:js`
Expected: `# pass 2`, `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.node.json server/db.ts server/api.ts tests/server/helpers.ts tests/server/db.test.ts
git commit -m "chore(analyse): socle serveur TypeScript et scripts de test

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: API REST (`server/api.ts`)

**Files:**
- Modify: `server/api.ts`
- Create: `tests/server/api.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `tests/server/api.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../../server/api.ts';
import { insertVideo, testContext } from './helpers.ts';

const q = (s = '') => new URLSearchParams(s);

test('GET /api/videos liste les vidéos', () => {
  const ctx = testContext();
  insertVideo(ctx);
  const res = handleApi(ctx, 'GET', '/api/videos', q(), undefined);
  assert.equal(res.status, 200);
  assert.equal((res.json as unknown[]).length, 1);
});

test('POST /api/games crée une game confirmée manuellement', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  const res = handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  assert.equal(res.status, 201);
  const list = handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined);
  const games = list.json as { start_s: number; status: string }[];
  assert.equal(games.length, 1);
  assert.equal(games[0].start_s, 100);
  assert.equal(games[0].status, 'confirmed');
});

test('POST /api/games refuse des bornes invalides', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx, 600);
  assert.equal(handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 50, end_s: 50 }).status, 400);
  assert.equal(handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: -5, end_s: 50 }).status, 400);
  assert.equal(handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 0, end_s: 9999 }).status, 400);
  assert.equal(handleApi(ctx, 'POST', '/api/games', q(), { video_id: 999, start_s: 0, end_s: 10 }).status, 400);
});

test('POST /api/games refuse un chevauchement', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const res = handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 600, end_s: 900 });
  assert.equal(res.status, 400);
  assert.match((res.json as { error: string }).error, /chevauche/i);
});

test('PATCH /api/games/:id modifie bornes, carte et statut', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  const res = handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { start_s: 120, end_s: 710, map: 'Silva', status: 'confirmed' });
  assert.equal(res.status, 200);
  const game = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as Record<string, unknown>[])[0];
  assert.equal(game.start_s, 120);
  assert.equal(game.end_s, 710);
  assert.equal(game.map, 'Silva');
});

test('PATCH autorise de rester sur ses propres bornes (pas de faux chevauchement)', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  assert.equal(handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { end_s: 710 }).status, 200);
});

test('PATCH refuse un statut inconnu et une game absente', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  assert.equal(handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { status: 'bidon' }).status, 400);
  assert.equal(handleApi(ctx, 'PATCH', '/api/games/9999', q(), { map: 'Silva' }).status, 404);
});

test('DELETE /api/games/:id supprime la game', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  assert.equal(handleApi(ctx, 'DELETE', `/api/games/${id}`, q(), undefined).status, 200);
  assert.equal((handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as unknown[]).length, 0);
  assert.equal(handleApi(ctx, 'DELETE', `/api/games/${id}`, q(), undefined).status, 404);
});

test('GET /api/calibrations renvoie les zones par défaut quand rien n’est enregistré', () => {
  const ctx = testContext();
  const res = handleApi(ctx, 'GET', '/api/calibrations', q('map=Silva'), undefined);
  assert.equal(res.status, 200);
  const body = res.json as { isDefault: boolean; zones: Record<string, unknown> };
  assert.equal(body.isDefault, true);
  assert.deepEqual(Object.keys(body.zones).sort(), ['capture_points', 'minimap', 'team_a_bar', 'team_b_bar', 'timer']);
});

test('PUT /api/calibrations enregistre puis relit les zones', () => {
  const ctx = testContext();
  const zones = { ...ctx.defaultZones, minimap: { x: 0.01, y: 0.7, w: 0.2, h: 0.28 } };
  assert.equal(handleApi(ctx, 'PUT', '/api/calibrations', q(), { map: 'Silva', zones }).status, 200);
  const body = handleApi(ctx, 'GET', '/api/calibrations', q('map=Silva'), undefined).json as {
    isDefault: boolean;
    zones: Record<string, { x: number }>;
  };
  assert.equal(body.isDefault, false);
  assert.equal(body.zones.minimap.x, 0.01);
  const other = handleApi(ctx, 'GET', '/api/calibrations', q('map=Atlantis'), undefined).json as { isDefault: boolean };
  assert.equal(other.isDefault, true);
});

test('PUT /api/calibrations refuse une zone hors de l’image', () => {
  const ctx = testContext();
  const zones = { ...ctx.defaultZones, minimap: { x: 0.9, y: 0.7, w: 0.3, h: 0.28 } };
  assert.equal(handleApi(ctx, 'PUT', '/api/calibrations', q(), { map: 'Silva', zones }).status, 400);
  assert.equal(handleApi(ctx, 'PUT', '/api/calibrations', q(), { map: '', zones: ctx.defaultZones }).status, 400);
});

test('route inconnue → 404', () => {
  const ctx = testContext();
  assert.equal(handleApi(ctx, 'GET', '/api/nimporte', q(), undefined).status, 404);
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm run test:js`
Expected: FAIL, `handleApi` n'est pas exportée.

- [ ] **Step 3: Implémenter l'API**

Ajouter à la fin de `server/api.ts` (le début du fichier, types et `ApiContext`, existe déjà depuis la tâche 7) :

```ts

type Row = Record<string, unknown>;

const reply = (status: number, json: unknown): ApiResult => ({ status, json });
const fail = (error: string, status = 400): ApiResult => reply(status, { error });
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const STATUSES = ['detected', 'confirmed'];

function validateBounds(db: DatabaseSync, videoId: number, start: unknown, end: unknown, selfId?: number): string | null {
  const s = num(start);
  const e = num(end);
  if (s === null || e === null) return 'start_s et end_s doivent être des nombres';
  if (s < 0 || e <= s) return 'Bornes invalides : il faut 0 ≤ début < fin';
  const video = db.prepare('SELECT duration_s FROM videos WHERE id = ?').get(videoId) as Row | undefined;
  if (!video) return 'Vidéo inconnue';
  if (e > (video.duration_s as number) + 0.5) return 'La fin dépasse la durée de la vidéo';
  const clash = db
    .prepare('SELECT id FROM games WHERE video_id = ? AND id <> ? AND start_s < ? AND end_s > ?')
    .get(videoId, selfId ?? -1, e, s);
  if (clash) return 'Cette game chevauche une autre game';
  return null;
}

function listGames(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const videoId = Number(query.get('video'));
  if (!Number.isInteger(videoId)) return fail('Paramètre video manquant');
  const rows = ctx.db
    .prepare('SELECT id, video_id, start_s, end_s, map, status, winner FROM games WHERE video_id = ? ORDER BY start_s')
    .all(videoId);
  return reply(200, rows);
}

function createGame(ctx: ApiContext, body: Row): ApiResult {
  const videoId = num(body.video_id);
  if (videoId === null) return fail('video_id manquant');
  const error = validateBounds(ctx.db, videoId, body.start_s, body.end_s);
  if (error) return fail(error);
  const map = typeof body.map === 'string' && body.map ? body.map : null;
  const result = ctx.db
    .prepare("INSERT INTO games (video_id, start_s, end_s, map, status) VALUES (?, ?, ?, ?, 'confirmed')")
    .run(videoId, body.start_s as number, body.end_s as number, map);
  return reply(201, { id: Number(result.lastInsertRowid) });
}

function patchGame(ctx: ApiContext, id: number, body: Row): ApiResult {
  const current = ctx.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as Row | undefined;
  if (!current) return fail('Game introuvable', 404);
  const start = body.start_s ?? current.start_s;
  const end = body.end_s ?? current.end_s;
  const error = validateBounds(ctx.db, current.video_id as number, start, end, id);
  if (error) return fail(error);
  const status = body.status ?? current.status;
  if (typeof status !== 'string' || !STATUSES.includes(status)) return fail('Statut inconnu');
  const map = 'map' in body ? (typeof body.map === 'string' && body.map ? body.map : null) : (current.map as string | null);
  const winner = 'winner' in body ? (typeof body.winner === 'string' && body.winner ? body.winner : null) : (current.winner as string | null);
  ctx.db
    .prepare('UPDATE games SET start_s = ?, end_s = ?, map = ?, status = ?, winner = ? WHERE id = ?')
    .run(start as number, end as number, map, status, winner, id);
  return reply(200, { ok: true });
}

function deleteGame(ctx: ApiContext, id: number): ApiResult {
  const result = ctx.db.prepare('DELETE FROM games WHERE id = ?').run(id);
  return result.changes ? reply(200, { ok: true }) : fail('Game introuvable', 404);
}

function getCalibration(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const map = query.get('map');
  if (!map) return fail('Paramètre map manquant');
  const rows = ctx.db.prepare('SELECT zone, x, y, w, h FROM calibrations WHERE map = ?').all(map) as unknown as (Zone & { zone: ZoneName })[];
  const zones: Zones = { ...ctx.defaultZones };
  for (const r of rows) zones[r.zone] = { x: r.x, y: r.y, w: r.w, h: r.h };
  return reply(200, { map, zones, isDefault: rows.length === 0 });
}

function validZone(z: unknown): z is Zone {
  if (!z || typeof z !== 'object') return false;
  const { x, y, w, h } = z as Record<string, unknown>;
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  const [X, Y, W, H] = [x, y, w, h] as number[];
  return X >= 0 && Y >= 0 && W > 0 && H > 0 && X + W <= 1.0001 && Y + H <= 1.0001;
}

function putCalibration(ctx: ApiContext, body: Row): ApiResult {
  const map = typeof body.map === 'string' ? body.map.trim() : '';
  if (!map) return fail('Nom de carte manquant');
  const zones = body.zones as Record<string, unknown> | undefined;
  if (!zones) return fail('Zones manquantes');
  for (const name of ZONE_NAMES) {
    if (!validZone(zones[name])) return fail(`Zone invalide : ${name}`);
  }
  const upsert = ctx.db.prepare(
    `INSERT INTO calibrations (map, zone, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(map, zone) DO UPDATE SET x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h`,
  );
  ctx.db.exec('BEGIN');
  try {
    for (const name of ZONE_NAMES) {
      const z = zones[name] as Zone;
      upsert.run(map, name, z.x, z.y, z.w, z.h);
    }
    ctx.db.exec('COMMIT');
  } catch (err) {
    ctx.db.exec('ROLLBACK');
    throw err;
  }
  return reply(200, { ok: true });
}

export function handleApi(
  ctx: ApiContext,
  method: string,
  pathname: string,
  query: URLSearchParams,
  body: unknown,
): ApiResult {
  const payload = (body && typeof body === 'object' ? body : {}) as Row;

  if (method === 'GET' && pathname === '/api/videos') {
    return reply(200, ctx.db.prepare('SELECT id, path, source_url, duration_s, fps, width, height FROM videos ORDER BY id DESC').all());
  }
  if (pathname === '/api/games') {
    if (method === 'GET') return listGames(ctx, query);
    if (method === 'POST') return createGame(ctx, payload);
  }
  const gameMatch = /^\/api\/games\/(\d+)$/.exec(pathname);
  if (gameMatch) {
    const id = Number(gameMatch[1]);
    if (method === 'PATCH') return patchGame(ctx, id, payload);
    if (method === 'DELETE') return deleteGame(ctx, id);
  }
  if (pathname === '/api/calibrations') {
    if (method === 'GET') return getCalibration(ctx, query);
    if (method === 'PUT') return putCalibration(ctx, payload);
  }
  return fail('Route inconnue', 404);
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm run test:js`
Expected: tous les tests passent (`# fail 0`).

- [ ] **Step 5: Commit**

```bash
git add server/api.ts tests/server/api.test.ts
git commit -m "feat(analyse): API REST des games et calibrations

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Lecture vidéo par plage d'octets (`server/range.ts`)

**Files:**
- Create: `server/range.ts`, `tests/server/range.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `tests/server/range.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from '../../server/range.ts';

test('pas d’en-tête → null (réponse complète)', () => {
  assert.equal(parseRange(undefined, 1000), null);
});

test('plage fermée', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
});

test('plage ouverte jusqu’à la fin', () => {
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
});

test('fin au-delà du fichier est ramenée à la taille', () => {
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
});

test('plage de suffixe : les N derniers octets', () => {
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
});

test('plages invalides', () => {
  assert.equal(parseRange('bytes=1000-', 1000), 'invalid');
  assert.equal(parseRange('bytes=50-10', 1000), 'invalid');
  assert.equal(parseRange('bytes=-', 1000), 'invalid');
  assert.equal(parseRange('bytes=-0', 1000), 'invalid');
  assert.equal(parseRange('octets=0-10', 1000), 'invalid');
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm run test:js`
Expected: FAIL, `Cannot find module '.../server/range.ts'`.

- [ ] **Step 3: Implémenter `server/range.ts`**

Créer `server/range.ts` :

```ts
// Lecture de l'en-tête HTTP Range, indispensable pour naviguer dans une vidéo de plusieurs Go.

export interface ByteRange {
  start: number;
  end: number; // inclus
}

/** null : pas de Range (réponse complète). 'invalid' : à refuser avec un 416. */
export function parseRange(header: string | undefined, size: number): ByteRange | null | 'invalid' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';

  let start: number;
  let end: number;
  if (m[1] === '') {
    const last = Number(m[2]);
    if (last === 0) return 'invalid';
    start = Math.max(0, size - last);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'invalid';
  return { start, end };
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm run test:js`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server/range.ts tests/server/range.test.ts
git commit -m "feat(analyse): analyse de l'en-tête Range pour la lecture vidéo

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Gestion des jobs (`server/jobs.ts`)

**Files:**
- Create: `server/jobs.ts`, `tests/server/jobs.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Ils lancent `node -e` comme faux script d'analyse.

Créer `tests/server/jobs.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobManager, type JobEvent } from '../../server/jobs.ts';

const node = process.execPath;

function collect(manager: JobManager, command: string, args: string[]): Promise<JobEvent[]> {
  const job = manager.start(command, args);
  return new Promise((resolve) => {
    const seen: JobEvent[] = [];
    job.subscribe((e) => {
      seen.push(e);
      if (e.event === 'done' || e.event === 'error') resolve(seen);
    });
  });
}

test('relaie les événements JSON du script', async () => {
  const script = `
    console.log(JSON.stringify({ event: 'progress', stage: 'detect', pct: 10 }));
    console.log(JSON.stringify({ event: 'done', video_id: 1, games: 2 }));
  `;
  const events = await collect(new JobManager(), node, ['-e', script]);
  assert.deepEqual(
    events.map((e) => e.event),
    ['progress', 'done'],
  );
  assert.equal(events[1].games, 2);
});

test('un abonné tardif reçoit l’historique', async () => {
  const manager = new JobManager();
  const job = manager.start(node, ['-e', "console.log(JSON.stringify({event:'done'}))"]);
  await new Promise((r) => setTimeout(r, 500));
  const seen: string[] = [];
  job.subscribe((e) => seen.push(e.event));
  assert.deepEqual(seen, ['done']);
});

test('un code de sortie non nul sans événement d’erreur produit une erreur', async () => {
  const events = await collect(new JobManager(), node, ['-e', "console.error('boum'); process.exit(3)"]);
  assert.equal(events.at(-1)?.event, 'error');
  assert.match(String(events.at(-1)?.message), /boum/);
});

test('une commande introuvable produit une erreur', async () => {
  const events = await collect(new JobManager(), 'commande-qui-n-existe-pas-eva', []);
  assert.equal(events.at(-1)?.event, 'error');
});

test('refuse un second job tant que le premier tourne', async () => {
  const manager = new JobManager();
  manager.start(node, ['-e', 'setTimeout(() => {}, 700)']);
  assert.throws(() => manager.start(node, ['-e', '0']), /déjà en cours/);
  await new Promise((r) => setTimeout(r, 1000));
  assert.doesNotThrow(() => manager.start(node, ['-e', '0']));
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm run test:js`
Expected: FAIL, `Cannot find module '.../server/jobs.ts'`.

- [ ] **Step 3: Implémenter `server/jobs.ts`**

Créer `server/jobs.ts` :

```ts
// Lance le script d'analyse et garde ses événements (une ligne JSON par événement sur stdout).

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export interface JobEvent {
  event: string;
  [key: string]: unknown;
}

type Listener = (event: JobEvent) => void;

export class Job {
  readonly id = randomUUID();
  readonly events: JobEvent[] = [];
  finished = false;
  private listeners = new Set<Listener>();
  private stdoutBuffer = '';
  private stderrTail = '';

  constructor(command: string, args: string[]) {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => {
      this.stdoutBuffer += chunk;
      const lines = this.stdoutBuffer.split('\n');
      this.stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) this.handleLine(line);
    });

    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-2000);
    });

    child.on('error', (err) => this.finish({ event: 'error', message: `Impossible de lancer ${command} : ${err.message}` }));
    child.on('close', (code) => {
      if (this.stdoutBuffer.trim()) this.handleLine(this.stdoutBuffer);
      if (this.finished) return;
      const detail = this.stderrTail.trim().split('\n').slice(-3).join(' ');
      this.finish({ event: 'error', message: detail || `Le script s'est arrêté (code ${code})` });
    });
  }

  private handleLine(line: string) {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line) as JobEvent;
      if (event.event === 'done' || event.event === 'error') this.finish(event);
      else this.push(event);
    } catch {
      // Ligne qui n'est pas du JSON : ignorée (sortie parasite d'une bibliothèque).
    }
  }

  private push(event: JobEvent) {
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
  }

  private finish(event: JobEvent) {
    if (this.finished) return;
    this.finished = true;
    this.push(event);
  }

  /** Rejoue l'historique puis suit les nouveaux événements. Renvoie la fonction de désabonnement. */
  subscribe(listener: Listener): () => void {
    for (const event of this.events) listener(event);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class JobManager {
  private jobs = new Map<string, Job>();
  private current: Job | null = null;

  start(command: string, args: string[]): Job {
    if (this.current && !this.current.finished) throw new Error('Une analyse est déjà en cours');
    const job = new Job(command, args);
    this.jobs.set(job.id, job);
    this.current = job;
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm run test:js`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add server/jobs.ts tests/server/jobs.test.ts
git commit -m "feat(analyse): gestion des jobs d'analyse et suivi des événements

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Plugin Vite

**Files:**
- Create: `server/analysisPlugin.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Écrire le plugin**

Créer `server/analysisPlugin.ts` :

```ts
// Plugin Vite : branche l'API d'analyse sur le serveur de dev (aucun serveur en plus).
//   GET  /api/videos/:id/stream   vidéo locale, avec Range
//   POST /api/ingest              lance analyze.py, renvoie { jobId }
//   GET  /api/jobs/:id/events     progression en SSE
//   le reste                      handleApi (games, calibrations, vidéos)

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { handleApi, type ApiContext, type Zones } from './api.ts';
import { openDb } from './db.ts';
import { JobManager } from './jobs.ts';
import { parseRange } from './range.ts';

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf-8')));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, json: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(json));
}

function streamVideo(req: IncomingMessage, res: ServerResponse, path: string) {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return sendJson(res, 404, { error: 'Fichier vidéo introuvable sur le disque' });
  }
  const range = parseRange(req.headers.range, size);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'video/mp4');
  if (range === 'invalid') {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${size}`);
    return res.end();
  }
  if (range === null) {
    res.statusCode = 200;
    res.setHeader('Content-Length', size);
    return createReadStream(path).pipe(res);
  }
  res.statusCode = 206;
  res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  res.setHeader('Content-Length', range.end - range.start + 1);
  createReadStream(path, { start: range.start, end: range.end }).pipe(res);
}

export function analysisPlugin(): Plugin {
  return {
    name: 'eva-analysis',
    configureServer(server) {
      const root = server.config.root;
      const dbPath = join(root, 'data', 'eva.db');
      const cacheDir = join(root, 'data', 'cache');
      const script = join(root, 'analysis', 'analyze.py');
      const python = process.env.EVA_PYTHON ?? 'python';

      const ctx: ApiContext = {
        db: openDb(dbPath, join(root, 'analysis', 'schema.sql')),
        defaultZones: JSON.parse(readFileSync(join(root, 'analysis', 'default_zones.json'), 'utf-8')) as Zones,
      };
      const jobs = new JobManager();

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        const method = req.method ?? 'GET';

        try {
          const stream = /^\/api\/videos\/(\d+)\/stream$/.exec(url.pathname);
          if (stream && method === 'GET') {
            const row = ctx.db.prepare('SELECT path FROM videos WHERE id = ?').get(Number(stream[1])) as { path: string } | undefined;
            if (!row) return sendJson(res, 404, { error: 'Vidéo inconnue' });
            return streamVideo(req, res, row.path);
          }

          if (url.pathname === '/api/ingest' && method === 'POST') {
            const body = (await readJson(req)) as { source?: unknown } | undefined;
            const source = typeof body?.source === 'string' ? body.source.trim() : '';
            if (!source) return sendJson(res, 400, { error: 'Indique un chemin de fichier ou une URL' });
            try {
              const job = jobs.start(python, [script, '--source', source, '--db', dbPath, '--cache', cacheDir]);
              return sendJson(res, 202, { jobId: job.id });
            } catch (err) {
              return sendJson(res, 409, { error: (err as Error).message });
            }
          }

          const events = /^\/api\/jobs\/([\w-]+)\/events$/.exec(url.pathname);
          if (events && method === 'GET') {
            const job = jobs.get(events[1]);
            if (!job) return sendJson(res, 404, { error: 'Job inconnu' });
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            const unsubscribe = job.subscribe((event) => {
              res.write(`data: ${JSON.stringify(event)}\n\n`);
              if (event.event === 'done' || event.event === 'error') res.end();
            });
            req.on('close', unsubscribe);
            return;
          }

          const body = method === 'GET' || method === 'DELETE' ? undefined : await readJson(req);
          const result = handleApi(ctx, method, url.pathname, url.searchParams, body);
          return sendJson(res, result.status, result.json);
        } catch (err) {
          return sendJson(res, 500, { error: (err as Error).message });
        }
      });
    },
  };
}
```

- [ ] **Step 2: Brancher le plugin**

Remplacer le contenu de `vite.config.ts` par :

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { analysisPlugin } from './server/analysisPlugin.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), analysisPlugin()],
})
```

- [ ] **Step 3: Vérifier le typage et le démarrage**

Run: `npx tsc -b`
Expected: aucune erreur.

Run (en arrière-plan) : `npm run dev`, puis dans un autre terminal :
`curl -s http://localhost:5173/api/videos`
Expected: `[]`. Puis `curl -s -X POST http://localhost:5173/api/ingest -H "Content-Type: application/json" -d "{\"source\":\"C:/introuvable.mp4\"}"`
Expected: `{"jobId":"..."}` et, avec `curl -s http://localhost:5173/api/jobs/<jobId>/events`, une ligne `data: {"event":"error","message":"Fichier introuvable : ..."}`.
Arrêter le serveur ensuite.

- [ ] **Step 4: Commit**

```bash
git add server/analysisPlugin.ts vite.config.ts
git commit -m "feat(analyse): plugin Vite (API, lecture vidéo Range, jobs SSE)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Types UI, fonctions de temps et appels API

**Files:**
- Create: `src/types/analysis.ts`, `src/lib/timeline.ts`, `src/lib/analysisApi.ts`, `tests/timeline.test.ts`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `tests/timeline.test.ts` :

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampBounds, formatTime, pctToTime, timeToPct } from '../src/lib/timeline.ts';

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65.9), '1:05');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(-3), '0:00');
});

test('timeToPct et pctToTime sont réciproques', () => {
  assert.equal(timeToPct(150, 600), 25);
  assert.equal(pctToTime(25, 600), 150);
  assert.equal(timeToPct(10, 0), 0);
  assert.equal(timeToPct(900, 600), 100);
});

test('clampBounds garde 0 ≤ début < fin ≤ durée', () => {
  assert.deepEqual(clampBounds(-5, 100, 600), { start: 0, end: 100 });
  assert.deepEqual(clampBounds(100, 9999, 600), { start: 100, end: 600 });
  assert.deepEqual(clampBounds(300, 300, 600), { start: 300, end: 301 });
  assert.deepEqual(clampBounds(599.9, 599.9, 600), { start: 599, end: 600 });
});
```

- [ ] **Step 2: Lancer les tests pour vérifier qu'ils échouent**

Run: `npm run test:js`
Expected: FAIL, `Cannot find module '.../src/lib/timeline.ts'`.

- [ ] **Step 3: Implémenter `timeline.ts`**

Créer `src/lib/timeline.ts` :

```ts
// Fonctions pures de temps pour la timeline de l'onglet Analyse.

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function timeToPct(t: number, duration: number): number {
  if (duration <= 0) return 0;
  return Math.min(100, Math.max(0, (t / duration) * 100));
}

export function pctToTime(pct: number, duration: number): number {
  return (pct / 100) * duration;
}

/** Ramène des bornes dans 0 ≤ début < fin ≤ durée (au moins 1 s d'écart). */
export function clampBounds(start: number, end: number, duration: number): { start: number; end: number } {
  const s = Math.min(Math.max(0, start), Math.max(0, duration - 1));
  const e = Math.min(Math.max(end, s + 1), duration);
  return { start: s, end: e };
}
```

- [ ] **Step 4: Lancer les tests pour vérifier qu'ils passent**

Run: `npm run test:js`
Expected: `# fail 0`.

- [ ] **Step 5: Créer les types et les appels API**

Créer `src/types/analysis.ts` :

```ts
export interface Video {
  id: number;
  path: string;
  source_url: string | null;
  duration_s: number;
  fps: number;
  width: number;
  height: number;
}

export type GameStatus = 'detected' | 'confirmed';

export interface Game {
  id: number;
  video_id: number;
  start_s: number;
  end_s: number;
  map: string | null;
  status: GameStatus;
  winner: string | null;
}

export const ZONE_NAMES = ['minimap', 'capture_points', 'team_a_bar', 'team_b_bar', 'timer'] as const;
export type ZoneName = (typeof ZONE_NAMES)[number];

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Zones = Record<ZoneName, Zone>;

export const ZONE_LABELS: Record<ZoneName, string> = {
  minimap: 'Minimap',
  capture_points: 'Points de capture',
  team_a_bar: 'Équipe gauche (bandeaux)',
  team_b_bar: 'Équipe droite (bandeaux)',
  timer: 'Chrono',
};

export interface JobEvent {
  event: 'progress' | 'done' | 'error';
  stage?: 'download' | 'detect';
  pct?: number;
  games?: number;
  video_id?: number;
  message?: string;
}
```

Créer `src/lib/analysisApi.ts` :

```ts
// Appels HTTP vers le plugin Vite (/api). Les erreurs du serveur remontent en Error(message).

import type { Game, JobEvent, Video, Zones } from '../types/analysis';

async function parse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erreur serveur (${res.status})`);
  return data as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const streamUrl = (videoId: number) => `/api/videos/${videoId}/stream`;

export const analysisApi = {
  videos: () => fetch('/api/videos').then(parse<Video[]>),
  games: (videoId: number) => fetch(`/api/games?video=${videoId}`).then(parse<Game[]>),
  createGame: (videoId: number, start: number, end: number, map?: string) =>
    fetch('/api/games', jsonInit('POST', { video_id: videoId, start_s: start, end_s: end, map })).then(parse<{ id: number }>),
  patchGame: (id: number, patch: Partial<Pick<Game, 'start_s' | 'end_s' | 'map' | 'status' | 'winner'>>) =>
    fetch(`/api/games/${id}`, jsonInit('PATCH', patch)).then(parse<{ ok: true }>),
  deleteGame: (id: number) => fetch(`/api/games/${id}`, { method: 'DELETE' }).then(parse<{ ok: true }>),
  calibration: (map: string) =>
    fetch(`/api/calibrations?map=${encodeURIComponent(map)}`).then(parse<{ map: string; zones: Zones; isDefault: boolean }>),
  saveCalibration: (map: string, zones: Zones) =>
    fetch('/api/calibrations', jsonInit('PUT', { map, zones })).then(parse<{ ok: true }>),
  ingest: (source: string) => fetch('/api/ingest', jsonInit('POST', { source })).then(parse<{ jobId: string }>),
};

/** Suit un job d'analyse en SSE. Renvoie la fonction pour fermer la connexion. */
export function subscribeJob(jobId: string, onEvent: (e: JobEvent) => void): () => void {
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.onmessage = (msg) => {
    const event = JSON.parse(msg.data) as JobEvent;
    onEvent(event);
    if (event.event === 'done' || event.event === 'error') source.close();
  };
  source.onerror = () => {
    source.close();
    onEvent({ event: 'error', message: 'Connexion au serveur perdue' });
  };
  return () => source.close();
}
```

- [ ] **Step 6: Vérifier le typage**

Run: `npx tsc -b`
Expected: aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add src/types/analysis.ts src/lib/timeline.ts src/lib/analysisApi.ts tests/timeline.test.ts
git commit -m "feat(analyse): types UI, fonctions de temps et client API

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Store, référence vidéo et squelette de l'onglet

**Files:**
- Create: `src/store/analysisStore.ts`, `src/lib/videoRef.ts`, `src/components/analysis/AnalysisTab.tsx`, `src/components/analysis/IngestBar.tsx`
- Modify: `src/App.tsx`, `src/App.css`

- [ ] **Step 1: Créer la référence vidéo**

Créer `src/lib/videoRef.ts` :

```ts
// Référence partagée au <video> de l'onglet Analyse (pour capturer une frame de calibration).

let element: HTMLVideoElement | null = null;

export function setVideoElement(el: HTMLVideoElement | null) {
  element = el;
}

/** Image courante de la vidéo en data URL JPEG, ou null si indisponible. */
export function captureFrame(): string | null {
  if (!element || !element.videoWidth) return null;
  const canvas = document.createElement('canvas');
  canvas.width = element.videoWidth;
  canvas.height = element.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(element, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.9);
}
```

- [ ] **Step 2: Créer le store**

Créer `src/store/analysisStore.ts` :

```ts
// État de l'onglet Analyse (non persisté : tout vient de la base via l'API).
// Le futur éditeur de stratégie temps réel se branchera sur currentTime / selectedGameId.

import { create } from 'zustand';
import { analysisApi, subscribeJob } from '../lib/analysisApi';
import type { Game, JobEvent, Video } from '../types/analysis';

export interface JobState {
  running: boolean;
  stage: 'download' | 'detect' | null;
  pct: number;
  error: string | null;
  message: string | null;
}

interface AnalysisState {
  videos: Video[];
  videoId: number | null;
  games: Game[];
  selectedGameId: number | null;
  currentTime: number;
  seekRequest: { t: number; nonce: number } | null;
  job: JobState;
  loadVideos: () => Promise<void>;
  selectVideo: (id: number | null) => Promise<void>;
  refreshGames: () => Promise<void>;
  selectGame: (id: number | null) => void;
  setCurrentTime: (t: number) => void;
  requestSeek: (t: number) => void;
  startIngest: (source: string) => Promise<void>;
}

const idleJob: JobState = { running: false, stage: null, pct: 0, error: null, message: null };

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  videos: [],
  videoId: null,
  games: [],
  selectedGameId: null,
  currentTime: 0,
  seekRequest: null,
  job: idleJob,

  loadVideos: async () => {
    const videos = await analysisApi.videos();
    set({ videos });
    if (get().videoId === null && videos.length > 0) await get().selectVideo(videos[0].id);
  },

  selectVideo: async (id) => {
    set({ videoId: id, games: [], selectedGameId: null, currentTime: 0 });
    if (id !== null) await get().refreshGames();
  },

  refreshGames: async () => {
    const { videoId } = get();
    if (videoId === null) return;
    set({ games: await analysisApi.games(videoId) });
  },

  selectGame: (id) => set({ selectedGameId: id }),
  setCurrentTime: (t) => set({ currentTime: t }),
  requestSeek: (t) => set({ seekRequest: { t, nonce: Date.now() } }),

  startIngest: async (source) => {
    set({ job: { ...idleJob, running: true } });
    try {
      const { jobId } = await analysisApi.ingest(source);
      subscribeJob(jobId, (e: JobEvent) => {
        if (e.event === 'progress') {
          set({ job: { running: true, stage: e.stage ?? null, pct: e.pct ?? 0, error: null, message: null } });
        } else if (e.event === 'done') {
          set({ job: { ...idleJob, message: `Analyse terminée : ${e.games ?? 0} game(s) détectée(s)` } });
          void get()
            .loadVideos()
            .then(() => (e.video_id ? get().selectVideo(e.video_id) : undefined));
        } else {
          set({ job: { ...idleJob, error: e.message ?? 'Erreur inconnue' } });
        }
      });
    } catch (err) {
      set({ job: { ...idleJob, error: (err as Error).message } });
    }
  },
}));
```

- [ ] **Step 3: Créer `IngestBar` et un `AnalysisTab` minimal**

Créer `src/components/analysis/IngestBar.tsx` :

```tsx
// Barre du haut : source (chemin .mp4 ou URL YouTube), bouton Analyser, progression,
// et choix de la vidéo déjà analysée.

import { useState } from 'react';
import { useAnalysisStore } from '../../store/analysisStore';

const STAGE_LABEL = { download: 'Téléchargement', detect: 'Détection des games' } as const;

export function IngestBar() {
  const [source, setSource] = useState('');
  const videos = useAnalysisStore((s) => s.videos);
  const videoId = useAnalysisStore((s) => s.videoId);
  const job = useAnalysisStore((s) => s.job);
  const selectVideo = useAnalysisStore((s) => s.selectVideo);
  const startIngest = useAnalysisStore((s) => s.startIngest);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (source.trim() && !job.running) void startIngest(source.trim());
  };

  return (
    <div className="ingest">
      <form className="ingest__form" onSubmit={submit}>
        <input
          className="ingest__input"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Chemin d'un .mp4 (D:\rec\match.mp4) ou URL YouTube"
          disabled={job.running}
        />
        <button type="submit" disabled={job.running || !source.trim()}>
          Analyser
        </button>
      </form>

      {videos.length > 0 && (
        <select value={videoId ?? ''} onChange={(e) => void selectVideo(Number(e.target.value))}>
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.path.split(/[\\/]/).pop()}
            </option>
          ))}
        </select>
      )}

      {job.running && (
        <div className="ingest__progress">
          <span>{job.stage ? STAGE_LABEL[job.stage] : 'Démarrage'}… {Math.round(job.pct)} %</span>
          <progress value={job.pct} max={100} />
        </div>
      )}
      {job.error && <span className="ingest__error">{job.error}</span>}
      {job.message && !job.running && <span className="ingest__ok">{job.message}</span>}
    </div>
  );
}
```

Créer `src/components/analysis/AnalysisTab.tsx` :

```tsx
import { useEffect } from 'react';
import { useAnalysisStore } from '../../store/analysisStore';
import { IngestBar } from './IngestBar';

export function AnalysisTab() {
  const loadVideos = useAnalysisStore((s) => s.loadVideos);

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  return (
    <div className="analysis">
      <IngestBar />
      <div className="analysis__body">
        <p className="analysis__empty">Colle un chemin de vidéo ou une URL pour commencer.</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Ajouter les onglets dans `App.tsx`**

Remplacer le contenu de `src/App.tsx` par :

```tsx
import { useState } from 'react';
import { Toolbar } from './components/Toolbar';
import { FloorSelector } from './components/FloorSelector';
import { DrawToolbar } from './components/DrawToolbar';
import { WeaponPanel } from './components/WeaponPanel';
import { MapCanvas } from './components/MapCanvas';
import { AnalysisTab } from './components/analysis/AnalysisTab';
import './App.css';

type View = 'strategie' | 'analyse';

export default function App() {
  const [view, setView] = useState<View>('strategie');

  return (
    <div className="app">
      <nav className="tabs">
        <button className={view === 'strategie' ? 'is-active' : ''} onClick={() => setView('strategie')}>
          Stratégie
        </button>
        <button className={view === 'analyse' ? 'is-active' : ''} onClick={() => setView('analyse')}>
          Analyse
        </button>
      </nav>
      {view === 'strategie' ? (
        <>
          <Toolbar />
          <FloorSelector />
          <DrawToolbar />
          <WeaponPanel />
          <main className="app__main">
            <MapCanvas />
          </main>
        </>
      ) : (
        <AnalysisTab />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Ajouter les styles**

Ajouter à la fin de `src/App.css` :

```css
/* --- Onglets --- */
.tabs {
  display: flex;
  gap: 0.25rem;
  padding: 0.4rem 1rem 0;
  background: #141822;
  border-bottom: 1px solid #2c3242;
}

.tabs button {
  padding: 0.4rem 1rem;
  background: transparent;
  color: #9aa3b8;
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 6px 6px 0 0;
  cursor: pointer;
}

.tabs button.is-active {
  background: #1b1f2a;
  color: #e6e8ee;
  border-color: #2c3242;
}

/* --- Onglet Analyse --- */
.analysis {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.analysis__body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 340px;
  gap: 0.75rem;
  flex: 1;
  min-height: 0;
  padding: 0.75rem;
}

.analysis__empty {
  grid-column: 1 / -1;
  align-self: center;
  justify-self: center;
  color: #9aa3b8;
}

.ingest {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  padding: 0.5rem 1rem;
  background: #1b1f2a;
  border-bottom: 1px solid #2c3242;
}

.ingest__form {
  display: flex;
  flex: 1;
  gap: 0.5rem;
  min-width: 320px;
}

.ingest__input {
  flex: 1;
  padding: 0.4rem 0.6rem;
  background: #0e1117;
  color: #e6e8ee;
  border: 1px solid #3a4256;
  border-radius: 6px;
}

.ingest button,
.ingest select,
.analysis button,
.analysis select {
  padding: 0.35rem 0.7rem;
  background: #2c3242;
  color: #e6e8ee;
  border: 1px solid #3a4256;
  border-radius: 6px;
  cursor: pointer;
}

.analysis button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ingest__progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.ingest__error {
  color: #ff6b6b;
}

.ingest__ok {
  color: #5ad18b;
}
```

- [ ] **Step 6: Vérifier**

Run: `npx tsc -b && npm run lint`
Expected: aucune erreur.

Run: `npm run dev`, ouvrir l'URL affichée : les deux onglets s'affichent, « Analyse » montre la barre du haut et le message vide.

- [ ] **Step 7: Commit**

```bash
git add src/store/analysisStore.ts src/lib/videoRef.ts src/components/analysis/AnalysisTab.tsx src/components/analysis/IngestBar.tsx src/App.tsx src/App.css
git commit -m "feat(analyse): onglet Analyse, store et barre d'ingestion

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Lecteur vidéo et timeline des segments

**Files:**
- Create: `src/components/analysis/VideoPlayer.tsx`, `src/components/analysis/SegmentTimeline.tsx`
- Modify: `src/components/analysis/AnalysisTab.tsx`, `src/App.css`

- [ ] **Step 1: Créer le lecteur**

Créer `src/components/analysis/VideoPlayer.tsx` :

```tsx
// Lecteur HTML5 sur la vidéo locale (servie avec Range) : aucune barre YouTube.

import { useEffect, useRef } from 'react';
import { streamUrl } from '../../lib/analysisApi';
import { setVideoElement } from '../../lib/videoRef';
import { useAnalysisStore } from '../../store/analysisStore';

export function VideoPlayer({ videoId }: { videoId: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const seekRequest = useAnalysisStore((s) => s.seekRequest);
  const setCurrentTime = useAnalysisStore((s) => s.setCurrentTime);

  useEffect(() => {
    setVideoElement(ref.current);
    return () => setVideoElement(null);
  }, [videoId]);

  useEffect(() => {
    if (seekRequest && ref.current) ref.current.currentTime = seekRequest.t;
  }, [seekRequest]);

  return (
    <video
      key={videoId}
      ref={ref}
      className="player"
      src={streamUrl(videoId)}
      controls
      preload="metadata"
      onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
    />
  );
}
```

- [ ] **Step 2: Créer la timeline**

Créer `src/components/analysis/SegmentTimeline.tsx` :

```tsx
// Barre de temps : games en couleur (orange = détectée, vert = confirmée), lobby en gris.
// Un clic déplace la lecture.

import { formatTime, pctToTime, timeToPct } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';

export function SegmentTimeline({ duration }: { duration: number }) {
  const games = useAnalysisStore((s) => s.games);
  const selectedGameId = useAnalysisStore((s) => s.selectedGameId);
  const currentTime = useAnalysisStore((s) => s.currentTime);
  const requestSeek = useAnalysisStore((s) => s.requestSeek);
  const selectGame = useAnalysisStore((s) => s.selectGame);

  const onBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    requestSeek(pctToTime(((e.clientX - rect.left) / rect.width) * 100, duration));
  };

  return (
    <div className="timeline">
      <div className="timeline__bar" onClick={onBarClick}>
        {games.map((g) => (
          <div
            key={g.id}
            className={`timeline__game timeline__game--${g.status}${g.id === selectedGameId ? ' is-selected' : ''}`}
            style={{
              left: `${timeToPct(g.start_s, duration)}%`,
              width: `${timeToPct(g.end_s, duration) - timeToPct(g.start_s, duration)}%`,
            }}
            title={`${formatTime(g.start_s)} → ${formatTime(g.end_s)}`}
            onClick={(e) => {
              e.stopPropagation();
              selectGame(g.id);
              requestSeek(g.start_s);
            }}
          />
        ))}
        <div className="timeline__cursor" style={{ left: `${timeToPct(currentTime, duration)}%` }} />
      </div>
      <div className="timeline__legend">
        <span>0:00</span>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Les afficher dans l'onglet**

Remplacer le contenu de `src/components/analysis/AnalysisTab.tsx` par :

```tsx
import { useEffect } from 'react';
import { useAnalysisStore } from '../../store/analysisStore';
import { IngestBar } from './IngestBar';
import { SegmentTimeline } from './SegmentTimeline';
import { VideoPlayer } from './VideoPlayer';

export function AnalysisTab() {
  const loadVideos = useAnalysisStore((s) => s.loadVideos);
  const videoId = useAnalysisStore((s) => s.videoId);
  const video = useAnalysisStore((s) => s.videos.find((v) => v.id === s.videoId));

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  return (
    <div className="analysis">
      <IngestBar />
      {videoId !== null && video ? (
        <div className="analysis__body">
          <section className="analysis__main">
            <VideoPlayer videoId={videoId} />
            <SegmentTimeline duration={video.duration_s} />
          </section>
          <aside className="analysis__side" />
        </div>
      ) : (
        <div className="analysis__body">
          <p className="analysis__empty">Colle un chemin de vidéo ou une URL pour commencer.</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Ajouter les styles**

Ajouter à la fin de `src/App.css` :

```css
.analysis__main {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  min-width: 0;
  min-height: 0;
}

.analysis__side {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-height: 0;
  overflow-y: auto;
}

.player {
  width: 100%;
  max-height: calc(100vh - 260px);
  background: #000;
  border-radius: 8px;
}

.timeline__bar {
  position: relative;
  height: 28px;
  background: #2a2f3d;
  border-radius: 6px;
  cursor: pointer;
  overflow: hidden;
}

.timeline__game {
  position: absolute;
  top: 0;
  bottom: 0;
  opacity: 0.85;
}

.timeline__game--detected {
  background: #ff9f1c;
}

.timeline__game--confirmed {
  background: #2ec27e;
}

.timeline__game.is-selected {
  outline: 2px solid #fff;
  outline-offset: -2px;
}

.timeline__cursor {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #fff;
  pointer-events: none;
}

.timeline__legend {
  display: flex;
  justify-content: space-between;
  margin-top: 0.25rem;
  font-size: 0.8rem;
  color: #9aa3b8;
}
```

- [ ] **Step 5: Vérifier avec une vraie vidéo**

Run: `npx tsc -b && npm run lint`
Expected: aucune erreur.

Générer une vidéo de test de 60 s et l'analyser depuis l'UI :
`ffmpeg -f lavfi -i testsrc=size=1280x720:rate=30:duration=60 -pix_fmt yuv420p data/test.mp4`
Lancer `npm run dev`, onglet Analyse, coller `data/test.mp4` (chemin complet), cliquer « Analyser ».
Expected: progression, puis message « Analyse terminée : 0 game(s) détectée(s) » (aucun HUD dans la vidéo de test), le lecteur affiche la vidéo, on peut naviguer dedans, le curseur de la timeline suit la lecture et un clic sur la barre déplace la lecture.

- [ ] **Step 6: Commit**

```bash
git add src/components/analysis/VideoPlayer.tsx src/components/analysis/SegmentTimeline.tsx src/components/analysis/AnalysisTab.tsx src/App.css
git commit -m "feat(analyse): lecteur vidéo local et timeline des segments

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Liste des games

**Files:**
- Create: `src/components/analysis/GameList.tsx`
- Modify: `src/components/analysis/AnalysisTab.tsx`, `src/App.css`

- [ ] **Step 1: Créer la liste**

Créer `src/components/analysis/GameList.tsx` :

```tsx
// Panneau latéral : une ligne par game. Carte, bornes (position courante du lecteur),
// confirmation, suppression, et ajout d'un segment manquant.

import { useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { builtinMaps } from '../../lib/builtinMaps';
import { formatTime } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';
import type { Game } from '../../types/analysis';

export function GameList({ videoId, duration }: { videoId: number; duration: number }) {
  const games = useAnalysisStore((s) => s.games);
  const selectedGameId = useAnalysisStore((s) => s.selectedGameId);
  const currentTime = useAnalysisStore((s) => s.currentTime);
  const selectGame = useAnalysisStore((s) => s.selectGame);
  const requestSeek = useAnalysisStore((s) => s.requestSeek);
  const refreshGames = useAnalysisStore((s) => s.refreshGames);
  const [error, setError] = useState<string | null>(null);

  // Toute action serveur passe par ici : on rafraîchit la liste, on affiche l'erreur éventuelle.
  const act = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      await refreshGames();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const addGame = () => {
    const start = Math.floor(currentTime);
    const end = Math.min(duration, start + 600);
    void act(() => analysisApi.createGame(videoId, start, end));
  };

  const row = (g: Game, index: number) => (
    <li key={g.id} className={`game${g.id === selectedGameId ? ' is-selected' : ''}`}>
      <div className="game__head" onClick={() => { selectGame(g.id); requestSeek(g.start_s); }}>
        <strong>Game {index + 1}</strong>
        <span className={`game__badge game__badge--${g.status}`}>
          {g.status === 'confirmed' ? 'confirmée' : 'détectée'}
        </span>
        <span className="game__time">
          {formatTime(g.start_s)} → {formatTime(g.end_s)}
        </span>
      </div>
      <div className="game__actions">
        <select value={g.map ?? ''} onChange={(e) => void act(() => analysisApi.patchGame(g.id, { map: e.target.value || null }))}>
          <option value="">Carte ?</option>
          {builtinMaps.map((m) => (
            <option key={m.id} value={m.name}>{m.name}</option>
          ))}
        </select>
        <button title="Début = position actuelle" onClick={() => void act(() => analysisApi.patchGame(g.id, { start_s: currentTime }))}>
          ⇤ début ici
        </button>
        <button title="Fin = position actuelle" onClick={() => void act(() => analysisApi.patchGame(g.id, { end_s: currentTime }))}>
          fin ici ⇥
        </button>
        <button
          onClick={() => void act(() => analysisApi.patchGame(g.id, { status: g.status === 'confirmed' ? 'detected' : 'confirmed' }))}
        >
          {g.status === 'confirmed' ? 'Dé-confirmer' : 'Confirmer'}
        </button>
        <button
          className="game__delete"
          onClick={() => window.confirm('Supprimer cette game ?') && void act(() => analysisApi.deleteGame(g.id))}
        >
          Supprimer
        </button>
      </div>
    </li>
  );

  return (
    <div className="games">
      <div className="games__head">
        <h3>Games ({games.length})</h3>
        <button onClick={addGame}>+ Ajouter ici</button>
      </div>
      {error && <p className="games__error">{error}</p>}
      {games.length === 0 ? (
        <p className="games__empty">Aucune game détectée. Place le lecteur au début d'une game et clique sur « + Ajouter ici ».</p>
      ) : (
        <ul className="games__list">{games.map(row)}</ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: L'afficher dans le panneau latéral**

Dans `src/components/analysis/AnalysisTab.tsx`, ajouter l'import :

```tsx
import { GameList } from './GameList';
```

et remplacer `<aside className="analysis__side" />` par :

```tsx
          <aside className="analysis__side">
            <GameList videoId={videoId} duration={video.duration_s} />
          </aside>
```

- [ ] **Step 3: Ajouter les styles**

Ajouter à la fin de `src/App.css` :

```css
.games__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.games__head h3 {
  margin: 0;
}

.games__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.games__empty {
  color: #9aa3b8;
  font-size: 0.9rem;
}

.games__error {
  color: #ff6b6b;
  font-size: 0.9rem;
}

.game {
  padding: 0.5rem;
  background: #1b1f2a;
  border: 1px solid #2c3242;
  border-radius: 8px;
}

.game.is-selected {
  border-color: #6c8cff;
}

.game__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  cursor: pointer;
}

.game__time {
  margin-left: auto;
  color: #9aa3b8;
  font-variant-numeric: tabular-nums;
}

.game__badge {
  padding: 0.05rem 0.4rem;
  font-size: 0.75rem;
  border-radius: 999px;
}

.game__badge--detected {
  background: #4a3410;
  color: #ff9f1c;
}

.game__badge--confirmed {
  background: #123d29;
  color: #2ec27e;
}

.game__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin-top: 0.5rem;
}

.game__actions button,
.game__actions select {
  font-size: 0.8rem;
  padding: 0.25rem 0.5rem;
}

.game__delete {
  color: #ff6b6b;
}
```

- [ ] **Step 4: Vérifier**

Run: `npx tsc -b && npm run lint`
Expected: aucune erreur.

Avec `data/test.mp4` chargé (tâche 14) dans `npm run dev` : cliquer « + Ajouter ici » crée une game, visible dans la liste et sur la timeline (en vert, confirmée). Choisir une carte, déplacer la lecture puis « début ici » / « fin ici » met à jour les bornes, « Dé-confirmer » repasse la game en orange, « Supprimer » la retire. Une game qui chevauche une autre affiche « Cette game chevauche une autre game ».

- [ ] **Step 5: Commit**

```bash
git add src/components/analysis/GameList.tsx src/components/analysis/AnalysisTab.tsx src/App.css
git commit -m "feat(analyse): liste des games (carte, bornes, confirmation, suppression)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Éditeur de calibration

**Files:**
- Create: `src/components/analysis/CalibrationEditor.tsx`
- Modify: `src/components/analysis/AnalysisTab.tsx`, `src/App.css`

- [ ] **Step 1: Créer l'éditeur**

Il affiche une capture de la frame courante et cinq rectangles qu'on déplace et qu'on redimensionne (poignée en bas à droite). Les valeurs restent des fractions de l'image.

Créer `src/components/analysis/CalibrationEditor.tsx` :

```tsx
// Fenêtre de calibration : on dessine les zones du HUD sur une frame de la vidéo, par carte.

import { useEffect, useRef, useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { builtinMaps } from '../../lib/builtinMaps';
import { captureFrame } from '../../lib/videoRef';
import { useAnalysisStore } from '../../store/analysisStore';
import { ZONE_LABELS, ZONE_NAMES, type ZoneName, type Zones } from '../../types/analysis';

const ZONE_COLORS: Record<ZoneName, string> = {
  minimap: '#2ec27e',
  capture_points: '#f5c211',
  team_a_bar: '#ff9f1c',
  team_b_bar: '#3d8bff',
  timer: '#ffffff',
};

type Drag = { zone: ZoneName; mode: 'move' | 'resize'; startX: number; startY: number; origin: Zones[ZoneName] };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function CalibrationEditor({ onClose }: { onClose: () => void }) {
  const selectedMap = useAnalysisStore((s) => s.games.find((g) => g.id === s.selectedGameId)?.map);
  const [map, setMap] = useState(selectedMap ?? builtinMaps[0]?.name ?? '');
  const [frame] = useState(() => captureFrame());
  const [zones, setZones] = useState<Zones | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    analysisApi
      .calibration(map)
      .then((res) => {
        if (cancelled) return;
        setZones(res.zones);
        setIsDefault(res.isDefault);
        setStatus(null);
      })
      .catch((err: Error) => !cancelled && setStatus(err.message));
    return () => {
      cancelled = true;
    };
  }, [map]);

  const startDrag = (e: React.PointerEvent, zone: ZoneName, mode: Drag['mode']) => {
    if (!zones) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ zone, mode, startX: e.clientX, startY: e.clientY, origin: zones[zone] });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag || !zones || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const o = drag.origin;
    const next =
      drag.mode === 'move'
        ? { ...o, x: clamp(o.x + dx, 0, 1 - o.w), y: clamp(o.y + dy, 0, 1 - o.h) }
        : { ...o, w: clamp(o.w + dx, 0.01, 1 - o.x), h: clamp(o.h + dy, 0.01, 1 - o.y) };
    setZones({ ...zones, [drag.zone]: next });
  };

  const save = async () => {
    if (!zones) return;
    try {
      await analysisApi.saveCalibration(map, zones);
      setIsDefault(false);
      setStatus(`Calibration enregistrée pour ${map}`);
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  return (
    <div className="calib">
      <div className="calib__panel">
        <div className="calib__head">
          <h3>Calibrer les zones du HUD</h3>
          <select value={map} onChange={(e) => setMap(e.target.value)}>
            {builtinMaps.map((m) => (
              <option key={m.id} value={m.name}>{m.name}</option>
            ))}
          </select>
          <span className="calib__hint">{isDefault ? 'Zones par défaut' : 'Zones enregistrées'}</span>
          <button onClick={() => void save()} disabled={!zones}>Enregistrer</button>
          <button onClick={onClose}>Fermer</button>
        </div>

        {!frame ? (
          <p className="games__error">
            Aucune image disponible : lance la lecture de la vidéo (ou avance un peu) puis rouvre la calibration.
          </p>
        ) : (
          <div className="calib__stage" ref={stageRef} onPointerMove={onMove} onPointerUp={() => setDrag(null)}>
            <img src={frame} alt="Frame de la vidéo" draggable={false} />
            {zones &&
              ZONE_NAMES.map((name) => {
                const z = zones[name];
                return (
                  <div
                    key={name}
                    className="calib__zone"
                    style={{
                      left: `${z.x * 100}%`,
                      top: `${z.y * 100}%`,
                      width: `${z.w * 100}%`,
                      height: `${z.h * 100}%`,
                      borderColor: ZONE_COLORS[name],
                    }}
                    onPointerDown={(e) => startDrag(e, name, 'move')}
                  >
                    <span style={{ background: ZONE_COLORS[name] }}>{ZONE_LABELS[name]}</span>
                    <i className="calib__handle" onPointerDown={(e) => startDrag(e, name, 'resize')} />
                  </div>
                );
              })}
          </div>
        )}
        {status && <p className="calib__status">{status}</p>}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Ajouter le bouton « Calibrer »**

Dans `src/components/analysis/AnalysisTab.tsx`, ajouter l'import et l'état :

```tsx
import { useEffect, useState } from 'react';
import { CalibrationEditor } from './CalibrationEditor';
```

(en remplaçant l'import existant de `useEffect`), puis dans le composant, juste après la ligne `const video = ...` :

```tsx
  const [calibrating, setCalibrating] = useState(false);
```

Dans `<section className="analysis__main">`, après `<SegmentTimeline ... />`, ajouter :

```tsx
            <button className="analysis__calibrate" onClick={() => setCalibrating(true)}>
              Calibrer les zones du HUD
            </button>
```

et juste avant la fermeture `</div>` du composant (dernier élément de `.analysis`) :

```tsx
      {calibrating && <CalibrationEditor onClose={() => setCalibrating(false)} />}
```

- [ ] **Step 3: Ajouter les styles**

Ajouter à la fin de `src/App.css` :

```css
.analysis__calibrate {
  align-self: flex-start;
}

.calib {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.7);
}

.calib__panel {
  width: min(1200px, 95vw);
  max-height: 95vh;
  overflow: auto;
  padding: 1rem;
  background: #141822;
  border: 1px solid #2c3242;
  border-radius: 10px;
}

.calib__head {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.75rem;
}

.calib__head h3 {
  margin: 0;
  margin-right: auto;
}

.calib__hint {
  color: #9aa3b8;
  font-size: 0.85rem;
}

.calib__stage {
  position: relative;
  user-select: none;
  touch-action: none;
}

.calib__stage img {
  display: block;
  width: 100%;
}

.calib__zone {
  position: absolute;
  border: 2px solid;
  cursor: move;
}

.calib__zone span {
  position: absolute;
  top: -1.2rem;
  left: -2px;
  padding: 0 0.35rem;
  font-size: 0.7rem;
  color: #000;
  white-space: nowrap;
  pointer-events: none;
}

.calib__handle {
  position: absolute;
  right: -6px;
  bottom: -6px;
  width: 12px;
  height: 12px;
  background: #fff;
  border: 1px solid #000;
  cursor: nwse-resize;
}

.calib__status {
  margin: 0.5rem 0 0;
  color: #9aa3b8;
}
```

- [ ] **Step 4: Vérifier**

Run: `npx tsc -b && npm run lint`
Expected: aucune erreur.

Dans `npm run dev`, avec `data/test.mp4` chargé et la lecture avancée de quelques secondes : « Calibrer les zones du HUD » ouvre la fenêtre avec la frame et les 5 rectangles. On les déplace et on les redimensionne à la poignée, « Enregistrer » affiche « Calibration enregistrée pour … ». Fermer puis rouvrir avec la même carte : les zones modifiées sont restaurées (« Zones enregistrées »), et une autre carte montre « Zones par défaut ».

- [ ] **Step 5: Commit**

```bash
git add src/components/analysis/CalibrationEditor.tsx src/components/analysis/AnalysisTab.tsx src/App.css
git commit -m "feat(analyse): éditeur de calibration des zones HUD par carte

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Vérification de bout en bout et documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Lancer toute la batterie automatique**

Run: `npm test`
Expected: tests Node (`# fail 0`) puis tests Python (`passed`), sans échec.

Run: `npm run lint && npm run build`
Expected: aucune erreur de lint, build réussi.

- [ ] **Step 2: Vérification manuelle sur une vraie vidéo**

Avec une vraie vidéo de partie (le .mp4 de l'utilisateur) :
1. `npm run dev`, onglet Analyse, coller le chemin complet, « Analyser ». Une barre de progression « Détection des games » doit apparaître.
2. À la fin, les games détectées apparaissent en orange sur la timeline, et les parties de lobby restent grises. Noter les cas faux (game manquée ou lobby pris pour une game).
3. Ajuster une borne avec « début ici » / « fin ici », confirmer la game, choisir la carte.
4. Relancer « Analyser » sur la même vidéo : la game confirmée est conservée, les détectées sont recalculées.
5. Tester l'URL YouTube : coller l'URL d'une vidéo courte, vérifier le téléchargement puis la détection.
6. Ouvrir la calibration sur une frame de game, ajuster, enregistrer.

Si la détection est mauvaise (trop de faux positifs ou de games manquées), ajuster `HUD_THRESHOLD` dans `analysis/hud.py`, ou les options `--min-len` et `--gap` du script, puis relancer `python -m pytest -q`. Reporter le réglage retenu dans le README.

- [ ] **Step 3: Documenter l'usage**

Ajouter au `README.md` une section :

```markdown
## Onglet Analyse

Détecte les games d'une vidéo de partie (fichier .mp4 ou URL YouTube) et permet de les corriger.

**Prérequis** : Python 3.10+, ffmpeg dans le PATH, puis `python -m pip install -r analysis/requirements.txt`.

**Utilisation** : `npm run dev`, onglet « Analyse », coller le chemin d'un .mp4 ou une URL YouTube, « Analyser ».
Les données sont dans `data/eva.db` (SQLite, ignoré par git) ; les vidéos YouTube téléchargées sont dans `data/cache/`.
Les vidéos locales ne sont jamais copiées.

**Réglages** : `python analysis/analyze.py --help` (cadence `--step`, durée minimale d'une game `--min-len`, coupure tolérée `--gap`).
Variable d'environnement `EVA_PYTHON` pour utiliser un autre exécutable Python que `python`.

**Tests** : `npm test` (Node et Python).
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs(analyse): usage de l'onglet Analyse

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Couverture de la spec**
- Architecture (script Python, plugin Vite, SQLite, WAL, schéma partagé) : tâches 1, 2, 7, 11.
- Écritures : script Python pour les données d'analyse (tâches 2, 6), plugin pour les corrections de l'utilisateur (tâche 8).
- Schéma complet dont `samples` et `capture_state` : tâche 1.
- Entrées .mp4 et YouTube, champ texte avec nettoyage des guillemets : tâches 5, 6, 13.
- Vidéo jamais copiée, lecture avec `Range` : tâches 9, 11.
- Détection des segments par couleurs des bandeaux, tolérance de coupure, jamais confirmés automatiquement : tâches 3, 4, 6.
- Onglet : lecteur sans barre YouTube, timeline, liste, boutons de bornes, confirmation, suppression : tâches 13 à 15.
- Calibration par carte avec zones par défaut : tâches 1, 8, 16.
- Gestion des erreurs (URL en échec, fichier introuvable, analyse interrompue, game confirmée préservée) : tâches 2, 6, 10, 13.
- Tests Python, serveur et UI manuelle : toutes les tâches, et la tâche 17.
- Hors périmètre, volontairement : extraction (chantier 2), récaps (chantier 3), éditeur de stratégie temps réel. Le store expose `currentTime` et `selectedGameId` pour ce dernier.

**Cohérence des noms** : `build_segments`, `hud_present`, `hud_score`, `HUD_THRESHOLD`, `DEFAULT_ZONES`, `crop`, `replace_detected_games`, `upsert_video`, `handleApi`, `ApiContext`, `parseRange`, `JobManager`, `analysisApi`, `streamUrl`, `subscribeJob`, `useAnalysisStore`, `captureFrame`, `ZONE_NAMES` : utilisés de façon identique dans les tâches qui les définissent et celles qui les appellent. Le champ `map` côté base, API et UI correspond au nom lisible de `builtinMaps`.

**Points à surveiller à l'exécution**
- Les seuils HUD (tâche 4) sont validés sur la capture de référence ; la tâche 17 prévoit de les réajuster sur une vraie vidéo.
- `node:sqlite` affiche un avertissement « experimental » : inoffensif, masqué dans les tests par `--disable-warning`.
