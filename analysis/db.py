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
    _migrate_calibrations(conn)
    if "kind" not in {row["name"] for row in conn.execute("PRAGMA table_info(kills)")}:
        conn.execute("ALTER TABLE kills ADD COLUMN kind TEXT")
    if "headshot" not in {row["name"] for row in conn.execute("PRAGMA table_info(kills)")}:
        conn.execute("ALTER TABLE kills ADD COLUMN headshot INTEGER NOT NULL DEFAULT 0")
    if "zone_key" not in {row["name"] for row in conn.execute("PRAGMA table_info(samples_meta)")}:
        conn.execute("ALTER TABLE samples_meta ADD COLUMN zone_key TEXT")
    if "with_kills" not in {row["name"] for row in conn.execute("PRAGMA table_info(samples_meta)")}:
        conn.execute("ALTER TABLE samples_meta ADD COLUMN with_kills INTEGER NOT NULL DEFAULT 0")
    # Version 2 : suivi global des joueurs. Les positions lues avec l'ancien algorithme sont à refaire.
    if conn.execute("PRAGMA user_version").fetchone()[0] < 2:
        conn.execute("DELETE FROM samples")
        conn.execute("PRAGMA user_version = 2")
        conn.commit()
    return conn


def _migrate_calibrations(conn):
    """Une base créée avant l'ajout de zones du HUD a une contrainte CHECK trop stricte : on reconstruit la table."""
    sql = conn.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calibrations'").fetchone()
    if not sql or "capture_pct_a" in sql["sql"]:
        return
    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    start = schema.index("CREATE TABLE IF NOT EXISTS calibrations")
    create = schema[start : schema.index(");", start) + 2].replace("IF NOT EXISTS calibrations", "calibrations_new")
    conn.execute("DROP TABLE IF EXISTS calibrations_new")
    conn.execute(create)
    conn.execute("INSERT INTO calibrations_new SELECT map, zone, x, y, w, h FROM calibrations")
    conn.execute("DROP TABLE calibrations")
    conn.execute("ALTER TABLE calibrations_new RENAME TO calibrations")
    conn.commit()


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


def confirm_clean_games(conn, video_id):
    """Confirme les games détectées sans aucun doute : l'analyse complète les a lues, inutile de redemander les bornes.
    Celles qui ont une zone à vérifier restent « détectées » pour que l'utilisateur les regarde."""
    conn.execute("UPDATE games SET status = 'confirmed', checked = 1 WHERE video_id = ? AND status = 'detected' AND doubts IS NULL", (video_id,))
    conn.commit()


def drop_video_if_empty(conn, video_id):
    """Retire une vidéo qui n'a aucune game ni commentaire (fichier qui n'est pas une rediff). Renvoie True si elle a été retirée."""
    row = conn.execute(
        "SELECT (SELECT COUNT(*) FROM games WHERE video_id = ?) AS g, (SELECT COUNT(*) FROM comments WHERE video_id = ?) AS c", (video_id, video_id)
    ).fetchone()
    if row["g"] or row["c"]:
        return False
    conn.execute("DELETE FROM videos WHERE id = ?", (video_id,))
    conn.commit()
    return True


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
MAP_ZONES_PATH = Path(__file__).with_name("map_zones.json")  # zones propres à une carte (la minimap n'a pas la même taille partout)


def zone_for(conn, map_name, zone):
    """Rectangle relatif d'une zone du HUD : calibration de l'utilisateur, sinon zone connue de la carte (map_zones.json), sinon zone par défaut."""
    if map_name:
        row = conn.execute("SELECT x, y, w, h FROM calibrations WHERE map = ? AND zone = ?", (map_name, zone)).fetchone()
        if row:
            return dict(row)
        known = json.loads(MAP_ZONES_PATH.read_text(encoding="utf-8")).get(map_name, {}).get(zone)
        if known:
            return known
    return json.loads(DEFAULT_ZONES_PATH.read_text(encoding="utf-8"))[zone]


def _sample_step(conn, game_id):
    """Intervalle (s) entre deux lectures déjà enregistrées pour une game, ou None s'il n'y en a pas."""
    row = conn.execute("SELECT COUNT(DISTINCT frame) AS n, MIN(t) AS lo, MAX(t) AS hi FROM samples WHERE game_id = ?", (game_id,)).fetchone()
    if not row["n"]:
        return None
    return (row["hi"] - row["lo"]) / (row["n"] - 1) if row["n"] > 1 else 0.0


def minimap_zone_key(conn, map_name):
    """Empreinte de la zone de la minimap d'une carte (calibration ou zone par défaut) : elle change si on recalibre."""
    z = zone_for(conn, map_name, "minimap")
    return f"{z['x']:.4f},{z['y']:.4f},{z['w']:.4f},{z['h']:.4f}"


def _zone_changed(conn, game, stored_key):
    """Vrai si la zone de la minimap n'est plus celle avec laquelle les positions ont été lues. Sans empreinte enregistrée (lectures
    anciennes), on ne relit que les cartes qui ont une calibration propre : la zone par défaut n'a pas changé."""
    if stored_key is not None:
        return stored_key != minimap_zone_key(conn, game["map"])
    return bool(game["map"]) and conn.execute("SELECT 1 FROM calibrations WHERE map = ? AND zone = 'minimap'", (game["map"],)).fetchone() is not None


def games_without_samples(conn, video_id, step_s=None, params_version=None, use_kills=False):
    """Games dont les positions sont à lire : aucune lecture, lues à une autre cadence que step_s, ou avec d'autres réglages
    du suivi que params_version (si donnés)."""
    out = []
    for g in conn.execute("SELECT id, start_s, end_s, map FROM games WHERE video_id = ? ORDER BY start_s", (video_id,)).fetchall():
        have = _sample_step(conn, g["id"])
        stale = False
        if params_version is not None:
            meta = conn.execute("SELECT params_version, with_kills, zone_key FROM samples_meta WHERE game_id = ?", (g["id"],)).fetchone()
            stale = (meta["params_version"] if meta else 0) != params_version
            if meta and have is not None:
                stale = stale or _zone_changed(conn, g, meta["zone_key"])
            if use_kills and conn.execute("SELECT 1 FROM kills_meta WHERE game_id = ?", (g["id"],)).fetchone():
                stale = stale or not (meta and meta["with_kills"])
        if have is None or stale or (step_s is not None and abs(have - step_s) > 0.15 * step_s):
            out.append(dict(g))
    return out


def replace_samples(conn, game_id, rows, params_version=0, with_kills=False):
    """Enregistre d'un seul bloc les positions d'une game (lignes : frame, t, slot, team, x, y, angle, alive, confiance)."""
    conn.execute("DELETE FROM samples WHERE game_id = ?", (game_id,))
    conn.executemany(
        "INSERT OR REPLACE INTO samples (game_id, frame, t, slot, team, x, y, angle, alive, confidence) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [(game_id, *r) for r in rows],
    )
    game = conn.execute("SELECT map FROM games WHERE id = ?", (game_id,)).fetchone()
    conn.execute(
        "INSERT OR REPLACE INTO samples_meta (game_id, params_version, with_kills, zone_key) VALUES (?, ?, ?, ?)",
        (game_id, params_version, int(with_kills), minimap_zone_key(conn, game["map"] if game else None)),
    )
    conn.commit()


def games_without_players(conn, video_id):
    return [
        dict(r)
        for r in conn.execute(
            "SELECT id, start_s, end_s, map FROM games WHERE video_id = ? "
            "AND id NOT IN (SELECT DISTINCT game_id FROM players) ORDER BY start_s",
            (video_id,),
        )
    ]


def replace_players(conn, game_id, names):
    """Enregistre les pseudos d'une game ({slot: pseudo})."""
    conn.execute("DELETE FROM players WHERE game_id = ?", (game_id,))
    conn.executemany("INSERT INTO players (game_id, slot, name) VALUES (?, ?, ?)", [(game_id, s, n) for s, n in names.items()])
    conn.commit()


def games_without_kills(conn, video_id):
    """Games dont les pseudos sont connus (nécessaires pour reconnaître les noms du killfeed) et dont le killfeed n'a pas été lu."""
    return [
        dict(r)
        for r in conn.execute(
            "SELECT id, start_s, end_s, map FROM games WHERE video_id = ? "
            "AND id IN (SELECT DISTINCT game_id FROM players) "
            "AND id NOT IN (SELECT game_id FROM kills_meta) ORDER BY start_s",
            (video_id,),
        )
    ]


def players_of(conn, game_id):
    return {r["slot"]: r["name"] for r in conn.execute("SELECT slot, name FROM players WHERE game_id = ?", (game_id,))}


def replace_kills(conn, game_id, events):
    """Enregistre d'un seul bloc les kills d'une game (events : {t, killer, victim, weapon})."""
    conn.execute("DELETE FROM kills WHERE game_id = ?", (game_id,))
    conn.executemany(
        "INSERT OR REPLACE INTO kills (game_id, t, killer_slot, victim_slot, weapon, headshot, kind) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [(game_id, round(e["t"], 2), e.get("killer"), e["victim"], e.get("weapon"), int(bool(e.get("headshot"))), e.get("kind")) for e in events],
    )
    conn.execute("INSERT OR REPLACE INTO kills_meta (game_id) VALUES (?)", (game_id,))
    conn.commit()


def kills_of(conn, game_id):
    return [dict(r) for r in conn.execute("SELECT t, killer_slot, victim_slot, weapon, headshot, kind FROM kills WHERE game_id = ? ORDER BY t", (game_id,))]


def loadouts_of(conn, game_id):
    """Équipement des joueurs d'une game : {slot: {"arme1", "arme2", "gadget"}} (identifiants d'icônes)."""
    return {
        r["slot"]: {"arme1": r["weapon1"], "arme2": r["weapon2"], "gadget": r["gadget"]}
        for r in conn.execute("SELECT slot, weapon1, weapon2, gadget FROM loadouts WHERE game_id = ?", (game_id,))
    }


def games_with_icon_kills(conn, video_id):
    """Games dont des kills portent encore une icône de killfeed (« W… ») : à convertir en arme lue sur le bandeau du tueur."""
    return [
        dict(r)
        for r in conn.execute(
            "SELECT id, start_s, end_s, map FROM games WHERE video_id = ? "
            "AND id IN (SELECT game_id FROM kills WHERE weapon LIKE 'W%' AND killer_slot IS NOT NULL) ORDER BY start_s",
            (video_id,),
        )
    ]


def games_with_unknown_killers(conn, video_id):
    """Games qui ont des kills dont le tueur n'a pas pu être lu et qui ont leurs positions (nécessaires pour le déduire)."""
    return [
        dict(r)
        for r in conn.execute(
            "SELECT id, start_s, end_s, map FROM games WHERE video_id = ? "
            "AND id IN (SELECT game_id FROM kills WHERE kind = 'unknown') "
            "AND id IN (SELECT game_id FROM samples_meta) ORDER BY start_s",
            (video_id,),
        )
    ]


def set_kill_killer(conn, game_id, t, victim_slot, killer_slot, weapon, kind):
    conn.execute(
        "UPDATE kills SET killer_slot = ?, weapon = ?, kind = ? WHERE game_id = ? AND t = ? AND victim_slot = ?",
        (killer_slot, weapon, kind, game_id, t, victim_slot),
    )


def set_kill_weapon(conn, game_id, t, victim_slot, weapon):
    conn.execute("UPDATE kills SET weapon = ? WHERE game_id = ? AND t = ? AND victim_slot = ?", (weapon, game_id, t, victim_slot))


def games_without_loadouts(conn, video_id):
    return [
        dict(r)
        for r in conn.execute(
            "SELECT id, start_s, end_s, map FROM games WHERE video_id = ? "
            "AND id NOT IN (SELECT DISTINCT game_id FROM loadouts) ORDER BY start_s",
            (video_id,),
        )
    ]


def replace_loadouts(conn, game_id, loadouts):
    conn.execute("DELETE FROM loadouts WHERE game_id = ?", (game_id,))
    conn.executemany(
        "INSERT INTO loadouts (game_id, slot, weapon1, weapon2, gadget) VALUES (?, ?, ?, ?, ?)",
        [(game_id, slot, l.get("arme1"), l.get("arme2"), l.get("gadget")) for slot, l in loadouts.items()],
    )
    conn.commit()


def games_without_capture(conn, video_id):
    return [
        dict(r)
        for r in conn.execute(
            "SELECT id, start_s, end_s, map FROM games WHERE video_id = ? "
            "AND id NOT IN (SELECT DISTINCT game_id FROM capture_state WHERE point IN ('score_A', 'score_B')) ORDER BY start_s",
            (video_id,),
        )
    ]


def replace_capture(conn, game_id, series):
    """Score de chaque équipe au cours de la game. series : {"A": [(t, %)], "B": [(t, %)]} (les valeurs None sont ignorées)."""
    conn.execute("DELETE FROM capture_state WHERE game_id = ? AND point IN ('score_A', 'score_B')", (game_id,))
    rows = [(game_id, round(t, 2), f"score_{team}", v, team) for team, pts in series.items() for t, v in pts if v is not None]
    conn.executemany("INSERT OR REPLACE INTO capture_state (game_id, t, point, pct, team) VALUES (?, ?, ?, ?, ?)", rows)
    conn.commit()


def capture_of(conn, game_id):
    out = {"A": [], "B": []}
    for r in conn.execute("SELECT t, pct, team FROM capture_state WHERE game_id = ? AND point IN ('score_A', 'score_B') ORDER BY t", (game_id,)):
        out[r["team"]].append((r["t"], r["pct"]))
    return out


def _team_of(slot):
    return "A" if slot <= 4 else "B"


def swap_slots(conn, game_id, slot_a, slot_b, t0, t1):
    """Échange deux joueurs d'une même équipe entre t0 et t1 dans les positions déjà enregistrées."""
    rows = conn.execute(
        "SELECT * FROM samples WHERE game_id = ? AND slot IN (?, ?) AND t BETWEEN ? AND ?", (game_id, slot_a, slot_b, t0, t1)
    ).fetchall()
    conn.execute("DELETE FROM samples WHERE game_id = ? AND slot IN (?, ?) AND t BETWEEN ? AND ?", (game_id, slot_a, slot_b, t0, t1))
    for r in rows:
        new = slot_b if r["slot"] == slot_a else slot_a
        conn.execute(
            "INSERT OR REPLACE INTO samples (game_id, frame, t, slot, team, x, y, angle, alive, hp, weapon, confidence) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (game_id, r["frame"], r["t"], new, r["team"], r["x"], r["y"], r["angle"], r["alive"], r["hp"], r["weapon"], r["confidence"]),
        )
    conn.commit()


def apply_corrections(conn, game_id):
    """Réapplique, dans l'ordre, les corrections manuelles d'une game (après une relecture des positions)."""
    for c in conn.execute("SELECT slot_a, slot_b, t0, t1 FROM corrections WHERE game_id = ? ORDER BY id", (game_id,)).fetchall():
        swap_slots(conn, game_id, c["slot_a"], c["slot_b"], c["t0"], c["t1"])
