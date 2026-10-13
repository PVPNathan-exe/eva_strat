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
        capture_output=True, text=True, check=True, stdin=subprocess.DEVNULL,
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


MIN_HEIGHT = 720  # en dessous, la minimap est illisible : on refuse plutôt que d'analyser une vidéo en 360p
FORMAT = "bestvideo[height<=1080][vcodec^=avc1]+bestaudio[ext=m4a]/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]"  # H.264 d'abord : décodage rapide et sûr


def best_height(info):
    """Hauteur de la meilleure image vidéo proposée par YouTube pour cette vidéo (0 si aucune)."""
    return max([f.get("height") or 0 for f in (info.get("formats") or []) if f.get("vcodec") not in (None, "none")] or [0])


def cookie_options(env=None):
    """Connexion à YouTube pour les vidéos qui n'offrent que du 360p sans compte : EVA_YT_COOKIES_FILE (fichier cookies.txt exporté du navigateur) ou EVA_YT_COOKIES_BROWSER (firefox, brave, chrome, edge :
    sous Windows, yt-dlp ne sait plus lire les cookies chiffrés de Chrome, Edge ni Brave récents, Firefox marche toujours). Aucune des deux : pas de connexion."""
    import os

    env = os.environ if env is None else env
    if env.get("EVA_YT_COOKIES_FILE"):
        return {"cookiefile": env["EVA_YT_COOKIES_FILE"]}
    if env.get("EVA_YT_COOKIES_BROWSER"):
        return {"cookiesfrombrowser": (env["EVA_YT_COOKIES_BROWSER"],)}
    return {}


def download(url, cache_dir, on_progress):
    """Télécharge une vidéo (1080p max) en mp4 dans cache_dir et renvoie son chemin. Refuse une vidéo dont la meilleure qualité est sous MIN_HEIGHT (YouTube ne donne alors que du 360p sans connexion :
    voir cookie_options)."""
    import yt_dlp

    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    def hook(d):
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                on_progress(d["downloaded_bytes"] / total * 100)

    options = {
        "format": FORMAT,
        "merge_output_format": "mp4",
        "outtmpl": str(cache_dir / "%(id)s.%(ext)s"),
        "progress_hooks": [hook],
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
    }
    options.update(cookie_options())
    with yt_dlp.YoutubeDL({**options, "skip_download": True}) as probe:
        height = best_height(probe.extract_info(url, download=False))
    if height < MIN_HEIGHT:
        raise ValueError(
            f"YouTube ne propose que du {height or 'très bas'}p pour cette vidéo : la minimap est illisible. Connecte-toi : définis EVA_YT_COOKIES_FILE (cookies.txt exporté de ton navigateur) "
            "ou EVA_YT_COOKIES_BROWSER=firefox, puis relance ; ou télécharge la vidéo en 1080p avec 4K Video Downloader et charge le .mp4."
        )
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=True)
        return Path(ydl.prepare_filename(info)).with_suffix(".mp4")
