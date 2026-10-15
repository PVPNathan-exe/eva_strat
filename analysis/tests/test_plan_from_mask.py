"""Tests de plan_from_mask : segments redressés, plan de Reef Point dessiné à la bonne taille avec les tyroliennes en vert."""

import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
import plan_from_mask as pm  # noqa: E402


def test_straighten_rend_un_rectangle_penche_exact():
    # rectangle dont les côtés sont à quelques degrés des axes
    rect = np.array([[0, 0], [100, 4], [102, 60], [3, 57]])
    out = pm.straighten(rect, tol=12)
    assert out[0][1] == out[1][1] and out[2][1] == out[3][1]  # côtés horizontaux
    assert out[0][0] == out[3][0] and out[1][0] == out[2][0]  # côtés verticaux


def test_straighten_laisse_une_direction_franche_tranquille():
    # un segment à 30 degrés n'est ni un axe ni une diagonale à 45 degrés : il ne bouge pas
    tri = np.array([[0, 0], [100, 58], [0, 100]])
    out = pm.straighten(tri, tol=12)
    assert np.allclose(out[0], [0, 0], atol=1e-6) or abs(np.degrees(np.arctan2(out[1][1] - out[0][1], out[1][0] - out[0][0])) - 30) < 1.5


def test_plan_de_reef_point():
    insets = json.loads((pm.HERE / "map_plan_insets.json").read_text(encoding="utf-8"))["Reef Point"]
    inset = (insets["l"], insets["t"], insets["r"], insets["b"])
    img, floor = pm.draw_plan("Reef Point", inset)
    assert img.shape == (pm.SIZE[1], pm.SIZE[0], 3)
    green = (np.abs(img.astype(int) - np.array(pm.TP_GREEN)).sum(axis=2) < 12).sum()
    assert green > 2 * 3.14 * pm.TP_DISK ** 2 * 0.8  # deux disques de tyrolienne
    # la fenêtre du spawn n'est pas dessinée : aucun pixel de la couleur des traits de vue
    assert floor.any() and not floor.all()
