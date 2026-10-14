import json

import db
import reset_parts


def make_db(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    vid = conn.execute("INSERT INTO videos (path, duration_s, fps, width, height) VALUES ('v.mp4', 100, 30, 1920, 1080)").lastrowid
    g1 = conn.execute("INSERT INTO games (video_id, start_s, end_s, map) VALUES (?, 0, 50, 'Polaris')", (vid,)).lastrowid
    g2 = conn.execute("INSERT INTO games (video_id, start_s, end_s, map) VALUES (?, 60, 90, 'Ceres')", (vid,)).lastrowid
    for m in ("Polaris", "Ceres"):
        conn.execute("INSERT INTO calibrations (map, zone, x, y, w, h) VALUES (?, 'minimap', 0.1, 0.1, 0.2, 0.2)", (m,))
        conn.execute("INSERT INTO map_annotations (map, data) VALUES (?, '{}')", (m,))
    for g in (g1, g2):
        conn.execute("INSERT INTO user_marks (game_id, slot, t, x, y) VALUES (?, 1, 5, 0.5, 0.5)", (g,))
        conn.execute("INSERT INTO corrections (game_id, t0, t1, slot_a, slot_b) VALUES (?, 1, 2, 1, 2)", (g,))
    conn.commit()
    return conn, g1, g2


def count(conn, table, where="1"):
    return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {where}").fetchone()[0]


def test_calibrages_d_une_carte_seulement(tmp_path):
    conn, _, _ = make_db(tmp_path)
    assert reset_parts.count_rows(conn, "calibrages", "Polaris") == {"calibrations": 1}
    reset_parts.reset_rows(conn, "calibrages", "Polaris")
    assert count(conn, "calibrations", "map = 'Polaris'") == 0 and count(conn, "calibrations", "map = 'Ceres'") == 1


def test_calibrages_de_toutes_les_cartes(tmp_path):
    conn, _, _ = make_db(tmp_path)
    reset_parts.reset_rows(conn, "calibrages")
    assert count(conn, "calibrations") == 0


def test_cartographie_d_une_carte(tmp_path):
    conn, _, _ = make_db(tmp_path)
    reset_parts.reset_rows(conn, "cartographie", "Ceres")
    assert count(conn, "map_annotations", "map = 'Ceres'") == 0 and count(conn, "map_annotations") == 1


def test_corrections_d_une_game_seulement(tmp_path):
    conn, g1, g2 = make_db(tmp_path)
    assert reset_parts.count_rows(conn, "corrections", game=g1) == {"user_marks": 1, "corrections": 1, "kill_flags": 0}
    reset_parts.reset_rows(conn, "corrections", game=g1)
    assert count(conn, "user_marks", f"game_id = {g1}") == 0 and count(conn, "user_marks", f"game_id = {g2}") == 1
    assert count(conn, "corrections", f"game_id = {g2}") == 1


def test_partie_inconnue_refusee(tmp_path):
    conn, _, _ = make_db(tmp_path)
    try:
        reset_parts.count_rows(conn, "tout")
    except ValueError:
        return
    raise AssertionError("une partie inconnue doit être refusée")


def write_json(path, data):
    path.write_text(json.dumps(data), encoding="utf-8")


def test_entree_de_carte_remplacee_par_celle_de_github(tmp_path):
    local, up = tmp_path / "analysis", tmp_path / "up"
    local.mkdir()
    up.mkdir()
    write_json(local / "map_stations.json", {"Polaris": {"a": "mien"}, "Ceres": {"a": "ceres"}})
    write_json(up / "map_stations.json", {"Polaris": {"a": "github"}, "Ceres": {"a": "autre"}})
    result = reset_parts.reset_map_json("Polaris", up, analysis_dir=local)
    assert result == [("map_stations.json", "remplacee")]
    data = json.loads((local / "map_stations.json").read_text(encoding="utf-8"))
    assert data == {"Polaris": {"a": "github"}, "Ceres": {"a": "ceres"}}  # l'autre carte n'est pas touchée


def test_entree_absente_de_github_est_retiree_et_dry_run_n_ecrit_pas(tmp_path):
    local, up = tmp_path / "analysis", tmp_path / "up"
    local.mkdir()
    up.mkdir()
    write_json(local / "map_doors.json", {"Polaris": {"x": 1}, "Ceres": {"x": 2}})
    write_json(up / "map_doors.json", {"Ceres": {"x": 2}})
    assert reset_parts.reset_map_json("Polaris", up, analysis_dir=local, dry_run=True) == [("map_doors.json", "retiree")]
    assert "Polaris" in json.loads((local / "map_doors.json").read_text(encoding="utf-8"))
    reset_parts.reset_map_json("Polaris", up, analysis_dir=local)
    assert "Polaris" not in json.loads((local / "map_doors.json").read_text(encoding="utf-8"))


def test_entree_deja_identique_et_fichier_sans_la_carte(tmp_path):
    local, up = tmp_path / "analysis", tmp_path / "up"
    local.mkdir()
    up.mkdir()
    write_json(local / "map_spawns.json", {"Polaris": {"s": 1}})
    write_json(up / "map_spawns.json", {"Polaris": {"s": 1}})
    write_json(local / "map_rotors.json", {"Engine": {}})
    assert dict(reset_parts.reset_map_json("Polaris", up, analysis_dir=local)) == {"map_spawns.json": "identique", "map_rotors.json": "absente"}
