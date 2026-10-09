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
