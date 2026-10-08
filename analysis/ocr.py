"""Pont vers la reconnaissance de texte intégrée à Windows (ocr_win.ps1). Aucune installation : elle fait partie de Windows.

Les images sont traitées par lots (un seul démarrage de PowerShell pour tout le lot).
"""

import json
import subprocess
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("ocr_win.ps1")


class OcrUnavailable(RuntimeError):
    pass


def read_images(paths):
    """paths : chemins d'images. Renvoie {chemin: [{"text", "x", "y", "w", "h"}]}."""
    paths = [str(p) for p in paths]
    if not paths:
        return {}
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False, encoding="utf-8") as f:
        f.write("\n".join(paths))
        listing = f.name
    try:
        proc = subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT), "-ListFile", listing],
            capture_output=True,
        )
    except FileNotFoundError as exc:
        raise OcrUnavailable("PowerShell est introuvable : la reconnaissance de texte nécessite Windows.") from exc
    finally:
        Path(listing).unlink(missing_ok=True)
    if proc.returncode != 0:
        raise OcrUnavailable(proc.stderr.decode("utf-8", "replace").strip().splitlines()[0] if proc.stderr.strip() else "Échec de la reconnaissance de texte")
    data = json.loads(proc.stdout.decode("utf-8-sig"))
    return {item["path"]: item.get("lines") or [] for item in data}
