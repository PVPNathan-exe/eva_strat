import cv2
import numpy as np

import mapname


def frame(text, bg=20):
    img = np.full((40, 384, 3), bg, np.uint8)
    cv2.putText(img, text, (60, 30), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
    return img


def test_same_name_is_recognized_and_other_names_are_not():
    templates = {"Silva": [mapname._vec(mapname.name_mask(frame("SILVA")))], "Engine": [mapname._vec(mapname.name_mask(frame("ENGINE")))]}
    assert mapname.recognize(mapname.name_mask(frame("SILVA", bg=40)), templates)[0] == "Silva"
    assert mapname.recognize(mapname.name_mask(frame("ENGINE")), templates)[0] == "Engine"
    assert mapname.recognize(mapname.name_mask(frame("OUTLAW")), templates)[0] is None


def test_no_text_or_no_templates_gives_nothing():
    assert mapname.name_mask(np.full((40, 384, 3), 20, np.uint8)) is None
    assert mapname.recognize(mapname.name_mask(frame("SILVA")), {}) == (None, -1.0)


def test_save_template_numbers_variants(tmp_path):
    mask = mapname.name_mask(frame("SILVA"))
    mapname.save_template(mask, "Silva", tmp_path)
    mapname.save_template(mask, "Silva", tmp_path)
    assert sorted(p.name for p in tmp_path.glob("*.png")) == ["Silva.png", "Silva__2.png"]
    assert list(mapname.load_templates(tmp_path)) == ["Silva"]
