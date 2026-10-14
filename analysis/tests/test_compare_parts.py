import json
import shutil

import cv2
import numpy as np

import compare_parts
import db
import map_mask
import tracking
import tune


def write_mask(folder, map_name, white):
    """Masque 100 x 100 : blanc (praticable) dans le rectangle (x0, y0, x1, y1) en cases de 0 à 100."""
    folder.mkdir(parents=True, exist_ok=True)
    img = np.zeros((100, 100), np.uint8)
    x0, y0, x1, y1 = white
    img[y0:y1, x0:x1] = 255
    cv2.imwrite(str(folder / f"{map_name}.png"), img)


def base_with_points(tmp_path, n, region=(10, 10, 60, 60)):
    """Base avec n positions sûres réparties dans la région (en cases de 0 à 100)."""
    conn = db.connect(tmp_path / "t.db")
    vid = conn.execute("INSERT INTO videos (path, duration_s, fps, width, height) VALUES ('v.mp4', 100, 30, 1920, 1080)").lastrowid
    gid = conn.execute("INSERT INTO games (video_id, start_s, end_s, map) VALUES (?, 0, 50, 'Test')", (vid,)).lastrowid
    rng = np.random.default_rng(1)
    x0, y0, x1, y1 = region
    rows = [(gid, i, i * 0.2, 1, "A", float(rng.uniform(x0 + 3, x1 - 3) / 100), float(rng.uniform(y0 + 3, y1 - 3) / 100), 0.0, 1, 0.9) for i in range(n)]
    conn.executemany("INSERT INTO samples (game_id, frame, t, slot, team, x, y, angle, alive, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    conn.commit()
    return conn


def test_verdict_masque_le_plus_juste_gagne():
    assert compare_parts.mask_verdict(0.0005, 0.02, 0.30, 0.31) == ("local", None)
    assert compare_parts.mask_verdict(0.02, 0.0005, 0.30, 0.31) == ("github", None)
    assert compare_parts.mask_verdict(0.0010, 0.0012, 0.30, 0.31)[0] == "equivalent"


def test_verdict_masque_trop_large_est_signale():
    verdict, warning = compare_parts.mask_verdict(0.0, 0.03, 0.9, 0.3)
    assert verdict == "local" and "plus large" in warning


def test_compare_masques_sur_les_positions_de_la_base(tmp_path, monkeypatch):
    local_dir, other = tmp_path / "local", tmp_path / "other" / "analysis"
    write_mask(local_dir, "Test", (10, 10, 60, 60))  # couvre toutes les positions
    write_mask(other / "map_masks", "Test", (10, 10, 30, 30))  # n'en couvre qu'une partie
    monkeypatch.setattr(map_mask, "MASK_DIR", local_dir)
    conn = base_with_points(tmp_path, 600)
    result = compare_parts.compare_masks(conn, "Test", other)
    assert result["verdict"] == "local" and result["points"] == 600
    assert result["local"]["rejected"] < result["github"]["rejected"]
    swapped = compare_parts.compare_masks(conn, "Test", tmp_path / "local" / "..")  # pas de masque de ce côté-là : verdict inconnu
    assert swapped["verdict"] == "inconnu"


def test_compare_masques_pas_assez_de_positions(tmp_path, monkeypatch):
    local_dir, other = tmp_path / "local", tmp_path / "other" / "analysis"
    write_mask(local_dir, "Test", (0, 0, 100, 100))
    write_mask(other / "map_masks", "Test", (0, 0, 50, 50))
    monkeypatch.setattr(map_mask, "MASK_DIR", local_dir)
    result = compare_parts.compare_masks(base_with_points(tmp_path, 50), "Test", other)
    assert result["verdict"] == "inconnu" and "minimum 500" in result["reason"]


def test_masque_absent_d_un_cote(tmp_path, monkeypatch):
    local_dir = tmp_path / "local"
    write_mask(local_dir, "Test", (0, 0, 100, 100))
    monkeypatch.setattr(map_mask, "MASK_DIR", local_dir)
    result = compare_parts.compare_masks(base_with_points(tmp_path, 600), "Test", tmp_path / "vide")
    assert result["verdict"] == "inconnu" and "GitHub" in result["reason"]


def test_verdict_reglages():
    assert compare_parts.objective_verdict(97.0, 70.0) == "local"
    assert compare_parts.objective_verdict(70.0, 97.0) == "github"
    assert compare_parts.objective_verdict(70.1, 70.3) == "equivalent"


def test_reglages_lus_d_un_fichier(tmp_path):
    p = tmp_path / "tracking_params.json"
    p.write_text(json.dumps({"params": {"GATE_BASE": 0.5}}), encoding="utf-8")
    assert compare_parts.params_from_file(p) == {"GATE_BASE": 0.5}
    assert compare_parts.params_from_file(tmp_path / "absent.json") == {}


def test_compare_reglages_sur_le_jeu_de_donnees_du_depot(tmp_path):
    """Réglages locaux contre des réglages volontairement mauvais : les locaux gagnent, et le processus retrouve ses réglages d'origine."""
    other = tmp_path / "analysis"
    other.mkdir()
    bad = {name: (tune.BOUNDS[name][0] if name in tune.BOUNDS else value) for name, value in tracking.current_params().items()}
    (other / "tracking_params.json").write_text(json.dumps({"params": bad}), encoding="utf-8")
    before = tracking.current_params()
    result = compare_parts.compare_params(other)
    assert tracking.current_params() == before
    assert result["verdict"] in ("local", "equivalent", "github") and result["local"]["objective"] != result["github"]["objective"]
    assert "ceres-1" in result["datasets"]
    shutil.rmtree(other)


def test_reglages_absents_sur_github(tmp_path):
    assert compare_parts.compare_params(tmp_path)["verdict"] == "inconnu"
