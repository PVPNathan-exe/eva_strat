"""Armes du killfeed : l'icône entre le tueur et la victime est comparée à des modèles rangés dans weapon_icons/.

Une icône jamais vue devient un nouveau modèle « W1 », « W2 »… (image enregistrée dans weapon_icons/). Pour donner un vrai nom,
il suffit de l'écrire dans weapon_icons/names.json : {"W1": "Blaster", "W2": "Grenade"}. Rien d'autre à refaire : les kills déjà
enregistrés affichent le nom à l'écran, ils gardent l'identifiant.
"""

import json
from pathlib import Path

import cv2
import numpy as np

ICON_DIR = Path(__file__).with_name("weapon_icons")
NAMES_PATH = ICON_DIR / "names.json"
SIZE = (32, 12)
MIN_PIXELS = 25
MATCH_SCORE = 0.6  # avec le flou ci-dessous : une même arme dépasse 0,62, deux armes différentes restent sous 0,45
_cache = {}


def _vec(icon):
    """Icône binaire -> vecteur normalisé (recadré sur la forme, ramené à 32 x 12)."""
    ys, xs = np.nonzero(icon)
    if xs.size < MIN_PIXELS:
        return None
    shape = icon[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    small = cv2.resize(shape, SIZE, interpolation=cv2.INTER_AREA)
    return _blur(small)


def _blur(small):
    """Léger flou : le recadrage de l'icône varie d'une image à l'autre, le flou rapproche deux lectures de la même arme."""
    return cv2.GaussianBlur(small, (5, 5), 0).astype(np.float32).ravel() / 255.0


def _templates(folder):
    key = str(folder)
    if key not in _cache:
        found = {}
        for path in sorted(Path(folder).glob("W*.png")):
            img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
            if img is not None:
                found[path.stem] = _blur(img)
        _cache[key] = found
    return _cache[key]


def _score(a, b):
    a, b = a - a.mean(), b - b.mean()
    d = np.linalg.norm(a) * np.linalg.norm(b)
    return float(a @ b / d) if d else -1.0


def identify(icon, folder=ICON_DIR, create=True):
    """Identifiant de l'arme (« W3 ») pour une icône binaire, ou None si l'icône est vide. Crée un modèle si elle est inconnue."""
    if icon is None:
        return None
    v = _vec(icon)
    if v is None:
        return None
    templates = _templates(folder)
    best = max(((_score(v, t), name) for name, t in templates.items()), default=(-1.0, None))
    if best[0] >= MATCH_SCORE:
        return best[1]
    if not create:
        return None
    Path(folder).mkdir(parents=True, exist_ok=True)
    n = 1
    while f"W{n}" in templates:
        n += 1
    name = f"W{n}"
    ys, xs = np.nonzero(icon)
    shape = icon[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    cv2.imwrite(str(Path(folder) / f"{name}.png"), cv2.resize(shape, SIZE, interpolation=cv2.INTER_AREA))
    templates[name] = _vec(icon)
    return name


def display_names(folder=ICON_DIR):
    path = Path(folder) / "names.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except ValueError:
            return {}
    return {}
