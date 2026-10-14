import data_usage
import db
import data_usage
import paths


def make_data(tmp_path):
    """Un dossier de données : base avec une game lue, une sauvegarde à côté, un cache avec une lecture gardée et une vidéo téléchargée."""
    data = tmp_path / "data"
    conn = db.connect(data / "eva.db")
    vid = conn.execute("INSERT INTO videos (path, duration_s, fps, width, height) VALUES ('v.mp4', 100, 30, 1920, 1080)").lastrowid
    gid = conn.execute("INSERT INTO games (video_id, start_s, end_s) VALUES (?, 0, 50)", (vid,)).lastrowid
    conn.execute("INSERT INTO games (video_id, start_s, end_s) VALUES (?, 60, 90)", (vid,))
    conn.execute("INSERT INTO samples (game_id, frame, t, slot, team) VALUES (?, 0, 0, 1, 'A')", (gid,))
    conn.commit()
    conn.close()
    (data / "eva.avant-essai.db").write_bytes(b"x" * 100)
    cache = data / "cache"
    cache.mkdir()
    (cache / "eval_1.json").write_bytes(b"y" * 1000)
    (cache / "in-abc.mp4").write_bytes(b"z" * 5000)
    return data


def test_usage_compte_chaque_poste(tmp_path):
    data = make_data(tmp_path)
    u = data_usage.usage(data / "eva.db", data / "cache")
    assert u["games"] == 2 and u["games_with_positions"] == 1 and u["sample_rows"] == 1
    assert u["eval_cache_bytes"] == 1000 and u["downloaded_videos"] == [{"name": "in-abc.mp4", "bytes": 5000}]
    assert [b["name"] for b in u["backups"]] == ["eva.avant-essai.db"] and u["backups"][0]["bytes"] == 100
    assert u["db_bytes"] > 0 and u["bytes_per_analysed_game"] == u["db_bytes"]


def test_purge_n_efface_que_les_lectures_gardees(tmp_path):
    data = make_data(tmp_path)
    files, freed = data_usage.purge_eval_cache(data / "cache")
    assert (files, freed) == (1, 1000)
    assert (data / "cache" / "in-abc.mp4").exists() and not (data / "cache" / "eval_1.json").exists()


def test_usage_ne_modifie_pas_la_base(tmp_path):
    data = make_data(tmp_path)
    before = (data / "eva.db").read_bytes()
    data_usage.usage(data / "eva.db", data / "cache")
    assert (data / "eva.db").read_bytes() == before


def test_variables_d_environnement(monkeypatch, tmp_path):
    monkeypatch.delenv("EVA_DB", raising=False)
    monkeypatch.delenv("EVA_CACHE", raising=False)
    monkeypatch.setenv("EVA_DATA_DIR", str(tmp_path / "ailleurs"))
    assert paths.db_path() == tmp_path / "ailleurs" / "eva.db" and paths.cache_dir() == tmp_path / "ailleurs" / "cache"
    monkeypatch.setenv("EVA_DB", str(tmp_path / "copie.db"))
    monkeypatch.setenv("EVA_CACHE", str(tmp_path / "gros"))
    assert paths.db_path() == tmp_path / "copie.db" and paths.cache_dir() == tmp_path / "gros"


def test_sans_variables_le_dossier_data_du_projet(monkeypatch):
    for name in ("EVA_DATA_DIR", "EVA_DB", "EVA_CACHE"):
        monkeypatch.delenv(name, raising=False)
    assert paths.db_path() == paths.ROOT / "data" / "eva.db" and paths.cache_dir() == paths.ROOT / "data" / "cache"


def test_avertissement_disque_amovible_ou_reseau(monkeypatch, tmp_path):
    monkeypatch.setattr(paths, "drive_type", lambda p: "removable")
    assert "clé USB" in paths.storage_warning(tmp_path / "eva.db")
    monkeypatch.setattr(paths, "drive_type", lambda p: "network")
    assert "réseau" in paths.storage_warning(tmp_path / "eva.db")
    monkeypatch.setattr(paths, "drive_type", lambda p: "fixed")
    assert paths.storage_warning(tmp_path / "eva.db") is None
