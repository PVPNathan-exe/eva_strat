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


def test_banner_weapons_need_a_closer_match_than_killfeed_icons(tmp_path, monkeypatch):
    icon, tone = _icon()
    first_b = weapons.identify(icon, folder=tmp_path, prefix="B", tone=tone)
    first_w = weapons.identify(icon, folder=tmp_path, prefix="W", tone=tone)
    weapons._cache.clear()
    monkeypatch.setattr(weapons, "_score", lambda a, b: 0.75)  # deux armes différentes mais proches (NEEDLE et SPECTRE)
    assert weapons.identify(icon, folder=tmp_path, prefix="B") != first_b  # bandeau : une nouvelle icône
    assert weapons.identify(icon, folder=tmp_path, prefix="W") == first_w  # killfeed : seuil d'origine


def test_a_player_never_has_the_same_weapon_twice(tmp_path):
    import loadout

    block = np.zeros((20, 40), np.uint8)
    block[4:16, 6:24] = 255  # arme compacte (SMG)
    block[8:10, 10:18] = 0  # avec du relief, sinon la corrélation n'est pas définie
    block[12:16, 20:24] = 0
    bar = np.zeros((20, 40), np.uint8)
    bar[8:12, 2:38] = 255  # arme longue et fine (fusil)
    bar[8:10, 20:24] = 0
    bar[10:12, 8:11] = 0
    first = weapons.identify(block, folder=tmp_path, prefix="B")
    weapons._cache.clear()
    # les deux cases ressemblent au même modèle : la moins ressemblante doit devenir une autre icône, jamais le même identifiant deux fois
    worn = block.copy()
    worn[4:7, 6:12] = 0  # lecture un peu abîmée de la même icône : elle ressemble moins au modèle
    out = loadout.resolve_loadout({"arme1": (block, block), "arme2": (worn, worn)}, folder=tmp_path)
    assert out["arme1"] == first and out["arme2"] not in (None, first)
    # deux armes bien distinctes ne sont pas touchées
    weapons._cache.clear()
    out = loadout.resolve_loadout({"arme1": (block, block), "arme2": (bar, bar)}, folder=tmp_path)
    assert out["arme1"] == first and out["arme2"] not in (None, first)
