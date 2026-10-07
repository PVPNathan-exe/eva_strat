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
