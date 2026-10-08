import json
import random

import tracking
import tune


def det(team, x, y, number=None):
    import minimap

    return {"team": team, "x": x, "y": y, "number": number, "slot": minimap.slot_of(number) if number else None,
            "angle": 0.0, "axis": 0.0, "skew": 1.0, "alive": True, "spectated": False}


def dataset(n=40):
    frames = []
    for i in range(n):
        frames.append((i, round(i * 0.2, 2), [det("A", 0.2 + 0.004 * i, 0.3, 1), det("A", 0.7 - 0.004 * i, 0.6, 2)]))
    return {"name": "synthetic", "map": None, "step_s": 0.2, "games": [{"game_id": 1, "frames": frames}]}


def test_dataset_roundtrip(tmp_path):
    ds = dataset()
    tune.save_dataset("synthetic", ds["games"], 0.2, folder=tmp_path)
    back = tune.load_datasets(tmp_path)
    assert len(back) == 1 and back[0]["step_s"] == 0.2
    assert len(back[0]["games"][0]["frames"]) == 40
    assert back[0]["games"][0]["frames"][3][2][0]["slot"] == 1


def test_masking_hides_reads_and_keeps_the_truth():
    ds = dataset()
    masked, truth = tune._mask_reads(ds["games"][0]["frames"], random.Random(0), p=1.0)
    assert len(truth) == 80
    assert all(d["slot"] is None for _, _, dets in masked for d in dets)


def test_easy_case_is_fully_recovered_after_masking():
    m = tune.evaluate([dataset()])
    assert m["identity_accuracy"] > 0.95 and m["jumps_per_1000"] == 0


def test_params_are_saved_loaded_and_ignore_unknown_names(tmp_path, monkeypatch):
    monkeypatch.setattr(tune, "HISTORY_PATH", tmp_path / "history.jsonl")
    path = tmp_path / "params.json"
    original = tracking.current_params()
    try:
        params = dict(original, GATE_BASE=0.07)
        rec = tune.save_params(params, {"objective": 90.0}, [dataset()], 10, path=path)
        assert rec["version"] == 1 and rec["iterations_total"] == 10
        rec2 = tune.save_params(params, {"objective": 91.0}, [dataset()], 5, path=path)
        assert rec2["version"] == 2 and rec2["iterations_total"] == 15  # on repart du total précédent
        tracking.configure({"GATE_BASE": 0.09, "INCONNU": 3})
        assert tracking.current_params()["GATE_BASE"] == 0.09
        assert len((tmp_path / "history.jsonl").read_text(encoding="utf-8").splitlines()) == 2
    finally:
        tracking.configure(original)


def test_saved_parameter_file_has_every_tunable_value():
    saved = json.loads(tracking.PARAMS_PATH.read_text(encoding="utf-8")) if tracking.PARAMS_PATH.exists() else {"params": {}}
    assert set(saved["params"]) <= set(tracking.TUNABLE)
