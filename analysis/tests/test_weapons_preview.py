import cv2
import numpy as np

import weapons


def _icon():
    icon = np.zeros((20, 40), np.uint8)
    icon[5:15, 8:32] = 255
    tone = np.zeros((20, 40), np.uint8)
    tone[5:15, 8:32] = np.tile(np.linspace(80, 200, 24, dtype=np.uint8), (10, 1))
    return icon, tone


def test_preview_keeps_the_grey_levels_when_a_tone_is_given(tmp_path):
    icon, tone = _icon()
    name = weapons.identify(icon, folder=tmp_path, prefix="G", tone=tone)
    preview = cv2.imread(str(tmp_path / "previews" / f"{name}.png"), cv2.IMREAD_GRAYSCALE)
    assert len(np.unique(preview)) > 10  # dégradé conservé, pas une forme binaire


def test_old_binary_preview_is_replaced_when_the_same_icon_is_seen_again(tmp_path):
    icon, tone = _icon()
    name = weapons.identify(icon, folder=tmp_path, prefix="G")  # ancien aperçu : binaire
    path = tmp_path / "previews" / f"{name}.png"
    assert set(np.unique(cv2.imread(str(path), cv2.IMREAD_GRAYSCALE))) <= {0, 255}
    weapons._cache.clear()
    assert weapons.identify(icon, folder=tmp_path, prefix="G", tone=tone) == name
    assert len(np.unique(cv2.imread(str(path), cv2.IMREAD_GRAYSCALE))) > 10
