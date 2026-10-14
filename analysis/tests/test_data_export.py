import json
import shutil

import cv2
import numpy as np
import pytest

import data_export
import db


def png(folder, name, value):
    """Écrit une petite image d'icône (niveau de gris unique : deux icônes de valeurs différentes ont des octets différents)."""
    folder.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(folder / f"{name}.png"), np.full((12, 32), value, np.uint8))


def icons(folder, wanted):
    """Dossier d'icônes : {identifiant: (valeur de gris, nom ou None)}."""
    names = {}
    for icon, (value, name) in wanted.items():
        png(folder, icon, value)
        if name:
            names[icon] = name
    (folder / "names.json").write_text(json.dumps(names), encoding="utf-8")
    return folder


def make_source(tmp_path):
    """Une base avec une vidéo, une game et de quoi remplir chaque table citée par l'export."""
    conn = db.connect(tmp_path / "source.db")
    vid = conn.execute("INSERT INTO videos (path, duration_s, fps, width, height) VALUES (?, ?, ?, ?, ?)", ("D:/videos/match.mp4", 600.0, 30.0, 1920, 1080)).lastrowid
    gid = conn.execute("INSERT INTO games (video_id, start_s, end_s, map, status) VALUES (?, ?, ?, ?, ?)", (vid, 10.0, 250.0, "Polaris", "confirmed")).lastrowid
    conn.execute("INSERT INTO players (game_id, slot, name) VALUES (?, 1, 'ALPHA')", (gid,))
    conn.execute("INSERT INTO loadouts (game_id, slot, weapon1, weapon2, gadget) VALUES (?, 1, 'B1', NULL, 'G1')", (gid,))
    conn.execute("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon, kind) VALUES (?, 30.0, 1, 5, 'B1', 'kill')", (gid,))
    conn.executemany("INSERT INTO samples (game_id, frame, t, slot, team, x, y, angle, alive, confidence) VALUES (?, ?, ?, 1, 'A', ?, 0.5, 90, 1, 0.9)", [(gid, f, f * 0.2, 0.1 * f) for f in range(5)])
    conn.execute("INSERT INTO user_marks (game_id, slot, t, x, y, angle, level, dead) VALUES (?, 1, 20.0, 0.3, 0.4, 45, 'dessous', 0)", (gid,))
    conn.execute("INSERT INTO comments (video_id, game_id, t, text) VALUES (?, ?, 12.0, 'à revoir')", (vid, gid))
    conn.execute("INSERT INTO teams (tag, name) VALUES ('ALP', 'Alpha Team')")
    conn.commit()
    return conn, icons(tmp_path / "icons_src", {"B1": (50, "STRIKER"), "G1": (200, "STICKY")})


def test_export_ecrit_manifest_games_icones(tmp_path):
    conn, src_icons = make_source(tmp_path)
    out = tmp_path / "export"
    result = data_export.export_all(conn, out, icon_dir=src_icons)
    assert result["games"] == 1 and result["files_written"] == 1 and result["icons_without_image"] == 0
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["format"] == data_export.FORMAT and manifest["games"][0]["rows"]["samples"] == 5
    assert (out / "icons" / "B1.png").exists() and json.loads((out / "icons" / "names.json").read_text(encoding="utf-8")) == {"B1": "STRIKER", "G1": "STICKY"}


def test_deuxieme_export_ne_reecrit_rien(tmp_path):
    conn, src_icons = make_source(tmp_path)
    out = tmp_path / "export"
    data_export.export_all(conn, out, icon_dir=src_icons)
    again = data_export.export_all(conn, out, icon_dir=src_icons)
    assert again["files_written"] == 0 and again["files_unchanged"] == 1


def test_import_dans_une_base_neuve_garde_les_donnees(tmp_path):
    conn, src_icons = make_source(tmp_path)
    out = tmp_path / "export"
    data_export.export_all(conn, out, icon_dir=src_icons)
    dest = db.connect(tmp_path / "dest.db")
    dest_icons = tmp_path / "icons_dest"
    dest_icons.mkdir()
    report = data_export.import_bundle(dest, out, icon_dir=dest_icons)
    assert report["imported"] == 1 and report["skipped"] == 0 and report["missing_videos"] == ["D:/videos/match.mp4"]
    for table in ("games", "players", "loadouts", "kills", "samples", "user_marks", "comments", "teams"):
        assert dest.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0], table
    comment = dest.execute("SELECT video_id, game_id FROM comments").fetchone()
    assert comment["video_id"] == dest.execute("SELECT id FROM videos").fetchone()[0] and comment["game_id"] == dest.execute("SELECT id FROM games").fetchone()[0]
    a = conn.execute("SELECT t, x FROM samples ORDER BY frame").fetchall()
    b = dest.execute("SELECT t, x FROM samples ORDER BY frame").fetchall()
    assert [tuple(r) for r in a] == [tuple(r) for r in b]


def test_import_deux_fois_saute_la_game_deja_la(tmp_path):
    conn, src_icons = make_source(tmp_path)
    out = tmp_path / "export"
    data_export.export_all(conn, out, icon_dir=src_icons)
    dest = db.connect(tmp_path / "dest.db")
    data_export.import_bundle(dest, out, icon_dir=tmp_path / "icons_dest")
    second = data_export.import_bundle(dest, out, icon_dir=tmp_path / "icons_dest")
    assert second["imported"] == 0 and second["skipped"] == 1
    assert dest.execute("SELECT COUNT(*) FROM samples").fetchone()[0] == 5


def test_dry_run_n_ecrit_rien(tmp_path):
    conn, src_icons = make_source(tmp_path)
    out = tmp_path / "export"
    data_export.export_all(conn, out, icon_dir=src_icons)
    dest = db.connect(tmp_path / "dest.db")
    dest_icons = tmp_path / "icons_dest"
    dest_icons.mkdir()
    report = data_export.import_bundle(dest, out, icon_dir=dest_icons, dry_run=True)
    assert report["imported"] == 1 and report["rows"]["samples"] == 5
    assert dest.execute("SELECT COUNT(*) FROM games").fetchone()[0] == 0 and dest.execute("SELECT COUNT(*) FROM samples").fetchone()[0] == 0
    assert not list(dest_icons.glob("*.png"))


def test_identifiants_d_icones_traduits(tmp_path):
    """Destination : B1 est une autre arme (WARDEN), B2 est un STRIKER d'une autre image, pas de gadget : B1 source devient B2, G1 source devient une nouvelle icône G1."""
    conn, src_icons = make_source(tmp_path)
    out = tmp_path / "export"
    data_export.export_all(conn, out, icon_dir=src_icons)
    dest_icons = icons(tmp_path / "icons_dest", {"B1": (120, "WARDEN"), "B2": (80, "STRIKER")})
    dest = db.connect(tmp_path / "dest.db")
    report = data_export.import_bundle(dest, out, icon_dir=dest_icons)
    row = dest.execute("SELECT weapon1, gadget FROM loadouts").fetchone()
    assert (row["weapon1"], row["gadget"]) == ("B2", "G1")
    assert dest.execute("SELECT weapon FROM kills").fetchone()[0] == "B2"
    assert report["icons_created"] == 1
    assert json.loads((dest_icons / "names.json").read_text(encoding="utf-8"))["G1"] == "STICKY"
    assert (dest_icons / "G1.png").exists()


def test_meme_installation_garde_les_identifiants(tmp_path):
    conn, src_icons = make_source(tmp_path)
    out = tmp_path / "export"
    data_export.export_all(conn, out, icon_dir=src_icons)
    copy = tmp_path / "icons_copy"
    shutil.copytree(src_icons, copy)
    dest = db.connect(tmp_path / "dest.db")
    report = data_export.import_bundle(dest, out, icon_dir=copy)
    assert dest.execute("SELECT weapon1 FROM loadouts").fetchone()[0] == "B1" and report["icons_created"] == 0


def test_format_inconnu_refuse(tmp_path):
    out = tmp_path / "export"
    out.mkdir()
    (out / "manifest.json").write_text(json.dumps({"format": 99, "games": []}), encoding="utf-8")
    dest = db.connect(tmp_path / "dest.db")
    with pytest.raises(ValueError):
        data_export.import_bundle(dest, out, icon_dir=tmp_path)


def test_erreur_pendant_l_import_annule_tout(tmp_path):
    """Un fichier de game illisible au milieu : rien n'est gardé (transaction)."""
    conn, src_icons = make_source(tmp_path)
    out = tmp_path / "export"
    data_export.export_all(conn, out, icon_dir=src_icons)
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    manifest["games"].append({**manifest["games"][0], "file": "games/absent.json.gz"})
    (out / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    dest = db.connect(tmp_path / "dest.db")
    with pytest.raises(OSError):
        data_export.import_bundle(dest, out, icon_dir=tmp_path / "icons_dest")
    assert dest.execute("SELECT COUNT(*) FROM games").fetchone()[0] == 0


def test_sauvegarde_avant_import(tmp_path):
    conn, _ = make_source(tmp_path)
    copy = data_export.backup_db(conn)
    assert copy.exists() and "avant-import" in copy.name
    assert db.connect(copy).execute("SELECT COUNT(*) FROM games").fetchone()[0] == 1
