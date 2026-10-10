import cv2
import numpy as np

import banners
import minimap
import tracking


def _bar(fills, spectated=None, hue=12, size=(120, 400)):
    """Barre de 4 bandeaux : chacun est rempli depuis le bas à la hauteur donnée (0 = grisé), cadre blanc sur celui qui est observé."""
    h, w = size
    img = np.full((h, w, 3), 90, np.uint8)  # gris
    color = cv2.cvtColor(np.uint8([[[hue, 220, 230]]]), cv2.COLOR_HSV2BGR)[0, 0].tolist()
    bw = w // 4
    for i, fill in enumerate(fills):
        top = int(h * (1 - fill))
        img[top:h, i * bw + 2 : (i + 1) * bw - 2] = color
        if spectated == i:
            img[:3, i * bw + 8 : (i + 1) * bw - 8] = 255
            img[-3:, i * bw + 8 : (i + 1) * bw - 8] = 255
    return img


def test_banner_fill_gives_alive_dead_and_the_observed_player():
    states = banners.read_team(_bar([1.0, 0.5, 0.0, 0.06], spectated=1))
    assert [s["alive"] for s in states] == [True, True, False, True]  # à moitié rempli ou presque vide : blessé, pas mort
    assert [s["spectated"] for s in states] == [False, True, False, False]
    assert states[0]["fill"] > states[1]["fill"] > states[3]["fill"] > states[2]["fill"]


def _states(per_frame):
    return {i: {slot: {"alive": alive, "spectated": False} for slot, alive in per.items()} for i, per in enumerate(per_frame)}


def test_dead_frames_ignore_a_single_glitch_and_unreadable_banners():
    glitch = [{1: True}] * 5 + [{1: False}] + [{1: True}] * 5
    assert tracking.dead_frames(_states(glitch))[1] == set()  # un seul état mort isolé : ignoré
    died = [{1: True}] * 5 + [{1: False}] * 30 + [{1: True}] * 30
    assert tracking.dead_frames(_states(died))[1] == set(range(5, 35))
    broken = [{2: False}] * 20  # grisé toute la game : bandeau mal lu, pas un témoin
    assert 2 not in tracking.dead_frames(_states(broken))


def test_a_banner_that_blinks_around_a_death_stays_dead():
    blink = [{1: True}] * 20 + [{1: False}] * 12 + [{1: True}] * 3 + [{1: False}] * 20 + [{1: True}] * 20  # vivant 0,3 s au milieu d'une mort
    assert tracking.dead_frames(_states(blink))[1] == set(range(20, 55))
    brief_death = [{1: True}] * 20 + [{1: False}] * 4 + [{1: True}] * 20  # 0,4 s grisé : parasite, pas une mort
    assert tracking.dead_frames(_states(brief_death))[1] == set()
    # à 5 lectures par seconde (0,2 s), 1,5 s font 8 lectures : une mort de 10 lectures est réelle
    slow = [{1: True}] * 20 + [{1: False}] * 10 + [{1: True}] * 20
    assert tracking.dead_frames(_states(slow), step_s=0.2)[1] == set(range(20, 30))


def test_the_white_marker_is_the_observed_player_whatever_number_was_read():
    det = lambda number, spec: {"team": "B", "x": 0.5, "y": 0.5, "number": number, "slot": None, "alive": True, "spectated": spec, "area": 200}
    frames = [(0, 0.0, [det(None, True), det(9, False)])]
    states = {0: {slot: {"alive": True, "spectated": slot == 6} for slot in range(1, 9)}}
    out = tracking.anchor_spectated(frames, states)[0][2]
    assert out[0]["slot"] == 6 and out[0]["number"] == 7  # le slot 6 est le numéro 7
    assert out[1]["number"] == 9  # les autres ne changent pas


def test_a_track_cannot_belong_to_a_player_whose_banner_is_greyed_out():
    def det(x, number=None):
        return {"team": "A", "x": x, "y": 0.5, "number": number, "slot": minimap.slot_of(number) if number else None, "angle": 0.0, "axis": 0.0, "skew": 1.0, "alive": True, "spectated": False}

    # un joueur numéroté « 3 » partout, mais le bandeau du joueur 3 est grisé : la pastille ne peut pas être la sienne
    frames = [(i, i * 0.2, [det(0.2 + i * 0.002, 3), det(0.6, 1)]) for i in range(40)]
    states = {i: {slot: {"alive": slot != 3 or False, "spectated": False} for slot in range(1, 5)} for i in range(40)}
    # le bandeau 3 est mort, mais pour que ce témoin soit retenu il doit être vivant ailleurs : on ajoute une période vivante
    for i in range(40, 120):
        states[i] = {slot: {"alive": True, "spectated": False} for slot in range(1, 5)}
    slots = {r[2] for r in tracking.solve(frames, 0.2, None, states) if r[7]}
    assert 3 not in slots


def test_a_waiting_player_circle_is_not_taken_for_the_observed_marker():
    def crop_with(radius, on_spawn):
        img = np.full((330, 440, 3), 60, np.uint8)
        if on_spawn:
            blue = cv2.cvtColor(np.uint8([[[108, 200, 200]]]), cv2.COLOR_HSV2BGR)[0, 0].tolist()
            cv2.rectangle(img, (300, 100), (440, 260), blue, -1)
        cx, cy = (360, 180) if on_spawn else (200, 160)
        cv2.circle(img, (cx, cy), radius, (255, 255, 255), -1)
        return img

    waiting = [d for d in minimap.find_markers(crop_with(8, True), {}) if d["spectated"]]
    assert waiting == []  # petit disque blanc sur la zone de départ : joueur mort en attente


def test_a_kill_is_confirmed_only_if_the_victim_banner_turns_grey(monkeypatch):
    import names

    alive = _bar([1.0, 1.0, 1.0, 1.0])
    dead_second = _bar([1.0, 0.0, 1.0, 1.0])
    frames = {}
    monkeypatch.setattr(names, "_grab", lambda video, t, zone, w, h: frames.get(round(t, 1)))
    for t in (11.2, 12.2, 13.2):
        frames[t] = dead_second
    assert banners.confirm_death("v.mp4", {}, 1920, 1080, 10.0, 1) is True  # le joueur 2 est grisé juste après le kill
    assert banners.confirm_death("v.mp4", {}, 1920, 1080, 10.0, 0) is False  # le joueur 1 est resté vivant : ligne du killfeed inventée
    for t in (11.2, 12.2, 13.2):
        frames[t] = alive
    frames[12.2] = dead_second  # un seul parasite isolé du bandeau
    assert banners.confirm_death("v.mp4", {}, 1920, 1080, 10.0, 1) is False
    frames.clear()
    assert banners.confirm_death("v.mp4", {}, 1920, 1080, 10.0, 1) is None  # bandeau illisible : on ne tranche pas
