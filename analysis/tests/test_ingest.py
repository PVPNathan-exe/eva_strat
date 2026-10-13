import subprocess

import ingest


def test_is_url():
    assert ingest.is_url("https://www.youtube.com/watch?v=abc")
    assert ingest.is_url("  http://youtu.be/abc ")
    assert not ingest.is_url("D:\rec\match.mp4")
    assert not ingest.is_url("match.mp4")


def test_clean_path_strips_quotes_and_spaces():
    assert ingest.clean_path('  "D:\rec\match 1.mp4"  ') == "D:\rec\match 1.mp4"
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


def test_best_height_ignores_audio_only_formats_and_missing_info():
    info = {"formats": [{"vcodec": "none", "height": None}, {"vcodec": "avc1", "height": 360}, {"vcodec": "avc1", "height": 1080}, {"vcodec": "av01", "height": 720}]}
    assert ingest.best_height(info) == 1080
    assert ingest.best_height({"formats": [{"vcodec": "none"}]}) == 0
    assert ingest.best_height({}) == 0


def test_youtube_cookie_options_come_from_the_environment_file_first():
    assert ingest.cookie_options({}) == {}
    assert ingest.cookie_options({"EVA_YT_COOKIES_BROWSER": "firefox"}) == {"cookiesfrombrowser": ("firefox",)}
    assert ingest.cookie_options({"EVA_YT_COOKIES_FILE": "C:/c.txt", "EVA_YT_COOKIES_BROWSER": "firefox"}) == {"cookiefile": "C:/c.txt"}
