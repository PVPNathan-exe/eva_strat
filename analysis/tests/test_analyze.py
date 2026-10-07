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
