import cv2
import numpy as np

import icon_fix
import weapons


def _cand(token, area_w, held=130, sharp=50.0, aspect_h=8):
    shape = np.zeros((20, 60), np.uint8)
    shape[6 : 6 + aspect_h, 4 : 4 + area_w] = 255
    tone = (shape // 2).astype(np.uint8)
    return {"token": token, "shape": shape, "tone": tone, "held": held, "sharp": sharp, "area": int(shape.sum() // 255),
            "aspect": area_w / aspect_h, "t": 0.0, "game": 1, "slot": 1, "field": "arme1"}


def test_best_images_are_clear_and_of_the_usual_size():
    good = [_cand(f"g{i}", 40, sharp=100 - i) for i in range(5)]
    pale = _cand("pale", 40, held=40)  # icône pâle (autre arme tenue) : écartée
    overlapped = _cand("overlap", 56)  # beaucoup plus large : deux icônes superposées
    cut = _cand("cut", 18)  # coupée
    chosen = icon_fix.choose_best(good + [pale, overlapped, cut])
    assert {c["token"] for c in chosen} == {c["token"] for c in good}
    assert chosen[0]["token"] == "g0"  # la plus nette d'abord


def test_no_clear_image_means_nothing_to_rebuild_from():
    assert icon_fix.choose_best([_cand("a", 40, held=30), _cand("b", 40, held=50)]) == []


def test_replace_template_keeps_the_id_and_updates_the_preview(tmp_path):
    first = np.zeros((20, 40), np.uint8)
    first[4:16, 6:24] = 255
    first[8:10, 10:18] = 0
    icon_id = weapons.identify(first, folder=tmp_path, prefix="B")
    better = np.zeros((20, 60), np.uint8)
    better[7:12, 3:57] = 255
    better[8:10, 20:24] = 0
    tone = (better // 2 + 20).astype(np.uint8)
    weapons.replace_template(icon_id, better, tone, tmp_path)
    preview = cv2.imread(str(tmp_path / "previews" / f"{icon_id}.png"), cv2.IMREAD_GRAYSCALE)
    assert preview.shape[1] > preview.shape[0] * 3  # l'aperçu est maintenant long et fin
    weapons._cache.clear()
    assert weapons.identify(better, folder=tmp_path, prefix="B", create=False) == icon_id  # le nouveau modèle est reconnu


def test_edge_width_tells_sharp_from_blurry():
    sharp = np.zeros((30, 80), np.uint8)
    sharp[8:22, 10:70] = 255
    blurry = cv2.GaussianBlur(sharp, (0, 0), 3)
    assert weapons.edge_width(sharp) < weapons.SHARP_MAX < weapons.edge_width(blurry)
    assert weapons.edge_width(np.zeros((5, 5), np.uint8)) is None


def test_choose_best_prefers_thinnest_edges():
    a, b = _cand("sharp", 40), _cand("soft", 40)
    a["width"], b["width"] = 1.1, 2.5
    assert [c["token"] for c in icon_fix.choose_best([b, a], best=1)] == ["sharp"]


def _box_read(width, height, top=4, left=6, tone_value=130):
    """Lecture synthétique : une arme (rectangle) dans une boîte de 20 x 40 pixels."""
    shape = np.zeros((20, 40), np.uint8)
    shape[top : top + height, left : left + width] = 1
    return shape, (shape * tone_value).astype(np.uint8)


def test_only_held_whole_weapons_are_usable_reads():
    import loadout

    assert loadout.usable_weapon_read(*_box_read(26, 8))  # arme tenue, entière, plus longue que haute
    assert not loadout.usable_weapon_read(*_box_read(26, 8, tone_value=40))  # arme rangée (pâle)
    assert not loadout.usable_weapon_read(*_box_read(26, 8, top=0))  # coupée en haut de la boîte
    assert not loadout.usable_weapon_read(*_box_read(8, 14))  # plus haute que longue : pas une arme (fond mal séparé)
    assert not loadout.usable_weapon_read(np.zeros((20, 40), np.uint8), np.zeros((20, 40), np.uint8))


def test_background_is_measured_row_by_row_when_the_health_fill_crosses_the_icon_band():
    import loadout

    piece = np.full((20, 40, 3), (150, 150, 150), np.uint8)  # haut du bandeau : gris
    piece[10:] = (230, 120, 40)  # bas : couleur d'équipe (fond rempli selon les points de vie)
    piece[4:8, 3:37] = (20, 20, 20)  # longue icône noire (85 % de la ligne) dans la partie grise
    shape = loadout._shape(piece)
    assert shape[4:8, 3:37].all() and not shape[10:].any()  # seule l'icône ressort, pas la moitié colorée de la boîte


def test_merging_keeps_the_weapon_and_its_attached_parts_only():
    import loadout

    mask = np.zeros((20, 60), np.uint8)
    mask[8:14, 5:35] = 1  # arme
    mask[4:7, 10:22] = 1  # lunette détachée mais proche
    mask[4:14, 52:58] = 1  # morceau de portrait, loin
    merged = loadout.merge_masks([mask, mask])
    assert merged[8:14, 5:35].all() and merged[4:7, 10:22].any()
    assert not merged[:, 50:].any()


def test_same_weapon_is_recognised_at_its_real_size_even_when_blurry():
    import weapons

    sharp = np.zeros((30, 50), np.uint8)
    sharp[8:16, 6:34] = 1
    sharp[16:24, 14:19] = 1  # poignée
    blurry = cv2.GaussianBlur(sharp.astype(np.float32), (0, 0), 1.2)
    other = np.zeros((30, 50), np.uint8)
    other[12:18, 6:44] = 1  # arme plus longue et plus fine
    d_sharp = weapons._native_desc(weapons._native_mask(sharp.astype(np.float32) * 130))
    d_blurry = weapons._native_desc(weapons._native_mask(blurry * 130))
    d_other = weapons._native_desc(weapons._native_mask(other.astype(np.float32) * 130))
    assert weapons._score(d_sharp[0], d_blurry[0]) >= weapons.NATIVE_MATCH
    assert weapons._score(d_sharp[0], d_other[0]) < weapons.NATIVE_MATCH
