"""Armes du killfeed : l'icône entre le tueur et la victime est comparée à des modèles rangés dans weapon_icons/.

Une icône jamais vue devient un nouveau modèle « W1 », « W2 »… (« B1 » pour une arme de bandeau, « G1 » pour un gadget) (image enregistrée dans weapon_icons/). Pour donner un vrai nom,
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
        for path in sorted(Path(folder).glob("[A-Z]*.png")):
            img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
            if img is not None:
                found[path.stem] = _blur(img)
        _cache[key] = found
    return _cache[key]


def _score(a, b):
    same = bool(np.allclose(a, b, atol=1e-3))
    a, b = a - a.mean(), b - b.mean()
    d = np.linalg.norm(a) * np.linalg.norm(b)
    if not d:  # image unie (aucun relief) : la corrélation n'est pas définie, on compare les images elles-mêmes
        return 1.0 if same else -1.0
    return float(a @ b / d)


def _write_preview(folder, name, icon, tone):
    """Aperçu agrandi pour reconnaître le logo à l'écran de nommage. Avec le relief (niveaux de gris, moyenné sur plusieurs images),
    il est net et lisible ; sans, c'est la forme binaire agrandie sans lissage."""
    ys, xs = np.nonzero(icon)
    box = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
    (Path(folder) / "previews").mkdir(exist_ok=True)
    if tone is not None and tone.shape == icon.shape:
        near = cv2.dilate((icon > 0).astype(np.uint8), np.ones((3, 3), np.uint8))  # le décor autour de l'icône n'entre pas dans l'aperçu
        piece = (tone * near)[box].astype(np.float32)
        piece = np.clip(piece * (255.0 / max(piece.max(), 1.0)), 0, 255).astype(np.uint8)
        piece = cv2.copyMakeBorder(piece, 2, 2, 2, 2, cv2.BORDER_CONSTANT, value=0)
        big = cv2.resize(piece, None, fx=8, fy=8, interpolation=cv2.INTER_CUBIC)
    else:
        big = cv2.resize(icon[box], None, fx=4, fy=4, interpolation=cv2.INTER_NEAREST)
    cv2.imwrite(str(Path(folder) / "previews" / f"{name}.png"), big)


def _is_binary_preview(folder, name):
    path = Path(folder) / "previews" / f"{name}.png"
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE) if path.exists() else None
    return img is None or bool(np.isin(img, (0, 255)).all())


def identify(icon, folder=ICON_DIR, create=True, prefix="W", tone=None):
    """Identifiant (« W3 ») d'une icône binaire, ou None si elle est vide. Crée un modèle si elle est inconnue.
    tone : relief de l'icône (même taille), pour un aperçu plus net ; il remplace aussi un ancien aperçu binaire.

    Le préfixe sépare les catalogues : W killfeed, B armes des bandeaux, G gadgets des bandeaux."""
    if icon is None:
        return None
    v = _vec(icon)
    if v is None:
        return None
    templates = _templates(folder)
    best = max(((_score(v, t), name) for name, t in templates.items() if name.startswith(prefix)), default=(-1.0, None))
    if best[0] >= MATCH_SCORE:
        if tone is not None and create and _is_binary_preview(folder, best[1]):
            _write_preview(folder, best[1], icon, tone)
        return best[1]
    if not create:
        return None
    Path(folder).mkdir(parents=True, exist_ok=True)
    n = 1
    while f"{prefix}{n}" in templates:
        n += 1
    name = f"{prefix}{n}"
    ys, xs = np.nonzero(icon)
    shape = icon[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]
    cv2.imwrite(str(Path(folder) / f"{name}.png"), cv2.resize(shape, SIZE, interpolation=cv2.INTER_AREA))
    _write_preview(folder, name, icon, tone)
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
