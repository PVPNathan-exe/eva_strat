"""Tests de capture_speed : niveau de remplissage d'un hexagone synthétique, comptage dans un cadre, plages à nombre de joueurs constant, rejet des cas contestés ou douteux, résumé par nombre de joueurs, fenêtres."""

import numpy as np

import capture_speed as cs
import hud_points as hp

H, W = 76, 114
ZONE = {"x": 0.47, "y": 0.125, "w": 0.06, "h": 0.07}
ORANGE_BGR = (10, 126, 249)
BLUE_BGR = (253, 150, 51)


def hexagon_image(level, bottom="A", top=None):
    """Image 76 x 114 avec l'hexagone de Polaris rempli depuis le bas de `level` (0 à 1) de la couleur `bottom` ; le reste (`top`, ou sombre) ; même géométrie que cs.V_LO et cs.V_HI."""
    mode, layout = hp.layout_for("Polaris", ZONE)
    cx, cy, hw, hh = layout["A"]
    im = np.full((H, W, 3), 60, np.uint8)
    ys, xs = np.mgrid[0:H, 0:W]
    u, v = ((xs + 0.5) / W - cx) / hw, ((ys + 0.5) / H - cy) / hh
    inside = np.maximum(np.abs(v - 0.05), np.abs(u) + np.abs(v - 0.05) / 2) <= 1.0
    edge = cs.V_HI - level * (cs.V_HI - cs.V_LO)
    colors = {"A": ORANGE_BGR, "B": BLUE_BGR}
    if top:
        im[inside] = colors[top]
    im[inside & (v >= edge)] = colors[bottom]
    letter = (np.abs(u) < 0.25) & (np.abs(v) < 0.4)  # lettre sombre au centre
    im[letter & inside] = (20, 20, 20)
    return im, layout["A"]


def read_level(im, rel):
    orange, blue, _ = hp.color_planes(im)
    return cs.fill_level(*cs.row_shares(orange, blue, cs.band_rows(im.shape, *rel)))


def test_fill_level_follows_the_drawn_level():
    for level in (0.25, 0.5, 0.75, 1.0):
        im, rel = hexagon_image(level, "A")
        team, got = read_level(im, rel)
        assert team == "A" and abs(got - level) < 0.1, (level, got)


def test_fill_level_team_is_the_bottom_color_and_empty_is_none():
    im, rel = hexagon_image(0.4, "B", top="A")  # bleu qui monte sur un point orange
    team, got = read_level(im, rel)
    assert team == "B" and abs(got - 0.4) < 0.1
    im, rel = hexagon_image(0.0, "A")
    assert read_level(im, rel)[0] is None


def test_count_in_rect_counts_confident_living_players_of_each_team():
    teams = ["A"] * 4 + ["B"] * 4
    xs = [0.5, 0.51, 0.9, np.nan, 0.5, 0.5, 0.1, 0.1]
    ys = [0.5, 0.5, 0.9, np.nan, 0.5, 0.5, 0.1, 0.1]
    alive = [1, 1, 1, 0, 1, 1, 0, 1]
    conf = [0.9, 0.9, 0.9, 0.0, 0.9, 0.9, 0.9, 0.9]
    out = cs.count_in_rect(xs, ys, alive, conf, teams, (0.45, 0.45, 0.55, 0.55))
    assert out == {"A": 2, "B": 2, "unsure": False}


def test_count_in_rect_flags_low_confidence_near_the_frame_and_unknown_positions():
    teams = ["A"] * 4 + ["B"] * 4
    base = dict(ys=[0.5] * 8, alive=[1] * 8, conf=[0.9] * 8)
    xs = [0.5, 0.57, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]
    conf = [0.9, 0.3, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]  # le 2 : confiance basse à 0,02 du cadre : douteux et non compté
    out = cs.count_in_rect(xs, base["ys"], base["alive"], conf, teams, (0.45, 0.45, 0.55, 0.55))
    assert out["A"] == 1 and out["unsure"]
    conf = [0.9] * 8
    xs = [0.5, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9]
    far = cs.count_in_rect(xs, base["ys"], base["alive"], [0.2] + conf[1:], teams, (0.45, 0.45, 0.55, 0.55))
    assert far["A"] == 0 and far["unsure"]  # confiance basse DANS le cadre : non compté mais douteux
    xs[3] = np.nan
    assert cs.count_in_rect(xs, base["ys"], base["alive"], conf, teams, (0.45, 0.45, 0.55, 0.55))["unsure"]  # vivant sans position


def ramp(t, slope, start=0.1):
    return [round(start + slope * (ti - t[0]), 4) for ti in t]


def test_build_runs_slope_per_constant_player_count():
    t = [i * 0.2 for i in range(40)]  # 8 s
    level = ramp(t[:20], 0.1) + [0.1 + 0.1 * 3.8 + 0.2 * (ti - t[20]) for ti in t[20:]]  # 0,1/s puis 0,2/s
    n = [1] * 20 + [2] * 20
    runs = cs.build_runs(t, level, ["A"] * 40, n, [0] * 40, [False] * 40, settle_s=0.0)
    got = {r["n"]: r["slope"] for r in runs}
    assert abs(got[1] - 0.1) < 0.01 and abs(got[2] - 0.2) < 0.01
    summary = cs.summarize(runs)["par_joueurs"]
    assert abs(summary["1"]["duree_mediane_s"] - 10.0) < 1.0 and summary["1"]["episodes"] == 1


def test_build_runs_rejects_contested_unsure_and_saturated_images():
    t = [i * 0.2 for i in range(30)]
    level = ramp(t, 0.1)
    runs = cs.build_runs(t, level, ["B"] * 30, [2] * 30, [1] * 30, [False] * 30, settle_s=0.0)  # un ennemi dans le cadre : plage contestée
    assert len(runs) == 1 and runs[0]["enemy"] == 1
    summary = cs.summarize(runs)
    assert summary["par_joueurs"] == {} and "2_contre_1" in summary["contestees"]
    assert cs.build_runs(t, level, ["B"] * 30, [2] * 30, [0] * 30, [True] * 30, settle_s=0.0) == []  # tout douteux
    full = [1.0] * 30
    assert cs.build_runs(t, full, ["B"] * 30, [2] * 30, [0] * 30, [False] * 30, settle_s=0.0) == []  # plein : butée, pas de pente


def test_build_runs_splits_when_the_player_count_changes_and_drops_short_runs():
    t = [i * 0.2 for i in range(30)]
    level = ramp(t, 0.1)
    n = [1] * 10 + [2] * 3 + [1] * 17  # 3 images à 2 joueurs : trop court
    runs = cs.build_runs(t, level, ["A"] * 30, n, [0] * 30, [False] * 30, settle_s=0.0)
    assert sorted(r["n"] for r in runs) == [1, 1]


def test_settle_removes_the_first_seconds_of_each_run():
    t = [i * 0.2 for i in range(30)]
    level = [0.1 if ti < 1.0 else 0.1 + 0.1 * (ti - 1.0) for ti in t]  # plat 1 s (le remplissage n'a pas réagi) puis monte
    slow = cs.build_runs(t, level, ["A"] * 30, [1] * 30, [0] * 30, [False] * 30, settle_s=0.0)[0]["slope"]
    fast = cs.build_runs(t, level, ["A"] * 30, [1] * 30, [0] * 30, [False] * 30, settle_s=1.0)[0]["slope"]
    assert abs(fast - 0.1) < 0.005 and slow < fast


def test_two_episodes_are_counted_separately():
    t = [i * 0.2 for i in range(30)] + [20 + i * 0.2 for i in range(30)]
    level = ramp(t[:30], 0.1) + ramp(t[30:], 0.1)
    runs = cs.build_runs(t, level, ["A"] * 60, [1] * 60, [0] * 60, [False] * 60, settle_s=0.0)
    assert len({r["episode"] for r in runs}) == 2 and cs.summarize(runs)["par_joueurs"]["1"]["episodes"] == 2


def test_smooth_levels_removes_a_one_frame_glitch_but_keeps_a_ramp():
    assert cs.smooth_levels([0.4, 0.45, 0.0, 0.55, 0.6], ["A"] * 5) == [0.4, 0.4, 0.45, 0.55, 0.6]
    ramp_ = [0.1, 0.2, 0.3, 0.4]
    assert cs.smooth_levels(ramp_, ["A"] * 4) == ramp_


def test_candidate_windows_merge_neighbours_and_clip():
    def st(owner, contested):
        return {"owner": owner, "contested": contested}

    times = list(range(0, 60))
    readings = [{"A": st("none", False)} for _ in times]
    for i in (20, 21, 22, 30):
        readings[i] = {"A": st("A", True)}
    wins = cs.candidate_windows(times, readings, ["A"], 59.0, pre=5, post=2, merge_gap=1)
    assert wins == [(15, 33)]  # les secondes 20 à 22 et 30 sont fusionnées ; 31 (retour de A à none) compte comme un changement
    assert cs.candidate_windows(times, [{"A": st("none", False)} for _ in times], ["A"], 59.0) == []


def test_pair_slopes_keeps_short_runs_and_respects_settle_and_contest():
    t = [i * 0.2 for i in range(30)]
    level = ramp(t, 0.1)
    n = [1] * 12 + [3] * 3 + [1] * 15  # 3 images à 3 joueurs : trop court pour une droite, mais 2 paires pour la somme
    pairs = cs.pair_slopes(t, level, ["A"] * 30, n, [0] * 30, [False] * 30, settle_s=0.0)
    by_n = {}
    for (ep, nn, en), (dl, dt, cnt) in pairs.items():
        by_n.setdefault(nn, [0.0, 0.0, 0])
        by_n[nn][0] += dl
        by_n[nn][1] += dt
        by_n[nn][2] += cnt
    assert by_n[3][2] == 2 and abs(by_n[3][0] / by_n[3][1] - 0.1) < 0.01
    settled = cs.pair_slopes(t, level, ["A"] * 30, [1] * 30, [0] * 30, [False] * 30, settle_s=1.0)
    assert sum(v[2] for v in settled.values()) < 29  # les premières paires de l'état sont écartées
    contested = cs.pair_slopes(t, level, ["A"] * 30, [1] * 30, [1] * 30, [False] * 30, settle_s=0.0)
    assert all(key[2] == 1 for key in contested)  # rangées sous « ennemis = 1 », jamais avec les autres
    summary = cs.summarize([], [{"game": 1, "point": "A", "episode": e, "n": 3, "enemy": 0, "dl": 0.3, "dt": 3.0, "pairs": 15} for e in range(6)])
    assert summary["par_joueurs"]["3"]["paires"]["episodes"] == 6 and abs(summary["par_joueurs"]["3"]["paires"]["duree_s"] - 10.0) < 0.01
