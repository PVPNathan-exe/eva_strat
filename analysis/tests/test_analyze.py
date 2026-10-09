import pytest
import subprocess

import analyze
import db


def make_video(path):
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=25:duration=2",
         "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )


def test_run_stops_and_forgets_video_without_games(tmp_path):
    """Un fichier sans aucun chrono lisible (pas une rediff) : l'analyse s'arrête avec un message et la vidéo n'est pas gardée."""
    video = tmp_path / "match.mp4"
    make_video(video)
    with pytest.raises(ValueError, match="Aucune game"):
        analyze.run(source=f'"{video}"', db_path=tmp_path / "eva.db", cache_dir=tmp_path / "cache", emit=lambda e: None)

    conn = db.connect(tmp_path / "eva.db")
    assert conn.execute("SELECT COUNT(*) AS n FROM videos").fetchone()["n"] == 0


def test_run_reports_missing_file(tmp_path):
    events = []
    code = analyze.main(
        ["--source", str(tmp_path / "absent.mp4"), "--db", str(tmp_path / "eva.db"), "--cache", str(tmp_path / "c")],
        emit=events.append,
    )
    assert code == 1
    assert events[-1]["event"] == "error"
    assert "introuvable" in events[-1]["message"].lower()


def test_gaps_around_games_already_ok():
    ok = [{"start_s": 100.0, "end_s": 300.0}, {"start_s": 310.0, "end_s": 500.0}, {"start_s": 700.0, "end_s": 900.0}]
    # trou de 10 s ignoré ; avant, entre et après les games en ordre sinon
    assert analyze.gaps_around(ok, 1000.0) == [(0.0, 100.0), (500.0, 700.0), (900.0, 1000.0)]
    assert analyze.gaps_around([], 1000.0) == [(0.0, 1000.0)]
