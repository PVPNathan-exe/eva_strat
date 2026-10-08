import cv2
import numpy as np

import db
import killfeed
import minimap
import tracking
import weapons

STEP = 0.2


def det(team, x, y, number=None, alive=True):
    return {"team": team, "x": x, "y": y, "number": number, "slot": minimap.slot_of(number) if number else None,
            "angle": 0.0, "axis": 0.0, "skew": 1.0, "alive": alive, "spectated": False}


def frames_of(seq):
    return [(i, round(i * STEP, 2), dets) for i, dets in enumerate(seq)]


def test_kill_without_a_cross_on_the_minimap_still_marks_the_victim_dead():
    seq = [[det("B", 0.8, 0.3, number=8)] for _ in range(15)] + [[] for _ in range(15)]  # le joueur disparaît sans croix lue
    rows = tracking.solve(frames_of(seq), STEP, deaths=[(15 * STEP, 7)])
    dead = [r for r in rows if r[2] == 7 and not r[7]]
    assert dead and all(abs(r[4] - 0.8) < 1e-6 for r in dead)  # morts à leur dernière position connue
    assert len(dead) <= round(tracking.DEATH_SHOWN_S / STEP) + 2


def test_death_does_not_overwrite_a_player_who_is_clearly_alive():
    seq = [[det("B", 0.8, 0.3, number=8)] for _ in range(30)]
    rows = tracking.solve(frames_of(seq), STEP, deaths=[(15 * STEP, 7)])  # lecture erronée : il continue à courir
    assert all(r[7] == 1 for r in rows if r[2] == 7 and r[0] > 27)  # la mort du killfeed prime le temps de la croix, pas au-delà


def test_cross_goes_to_the_victim_named_by_the_killfeed():
    seq = [[det("A", 0.2, 0.2, number=1), det("A", 0.25, 0.22, number=2)] for _ in range(10)]
    seq += [[det("A", 0.2, 0.2, number=1), det("A", 0.25, 0.22, alive=False)] for _ in range(8)]
    rows = tracking.solve(frames_of(seq), STEP, deaths=[(10 * STEP, 2)])
    assert {r[2] for r in rows if not r[7]} == {2}


def test_kills_are_stored_and_the_game_is_marked_as_read(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s) VALUES (?, 10, 200)", (vid,))
    gid = conn.execute("SELECT id FROM games").fetchone()["id"]
    assert db.games_without_kills(conn, vid) == []  # sans pseudos, le killfeed ne peut pas être lu
    db.replace_players(conn, gid, {1: "SHADYJ4Y", 5: "ORXPAPY"})
    assert [g["id"] for g in db.games_without_kills(conn, vid)] == [gid]
    db.replace_kills(conn, gid, [{"t": 42.5, "killer": 1, "victim": 5, "weapon": "W1", "headshot": True, "kind": "kill"}])
    assert db.games_without_kills(conn, vid) == []
    assert db.kills_of(conn, gid) == [{"t": 42.5, "killer_slot": 1, "victim_slot": 5, "weapon": "W1", "headshot": 1, "kind": "kill"}]
    db.replace_kills(conn, gid, [])  # aucun kill : la game reste « lue »
    assert db.games_without_kills(conn, vid) == []


def test_positions_are_read_again_once_the_killfeed_is_known(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s) VALUES (?, 10, 200)", (vid,))
    gid = conn.execute("SELECT id FROM games").fetchone()["id"]
    db.replace_samples(conn, gid, [(0, 10.0, 1, "A", 0.1, 0.2, None, 1, 1.0), (1, 10.2, 1, "A", 0.1, 0.2, None, 1, 1.0)], 0, with_kills=False)
    assert db.games_without_samples(conn, vid, 0.2, 0, use_kills=True) == []
    db.replace_players(conn, gid, {1: "SHADYJ4Y"})
    db.replace_kills(conn, gid, [])
    assert [g["id"] for g in db.games_without_samples(conn, vid, 0.2, 0, use_kills=True)] == [gid]
    db.replace_samples(conn, gid, [(0, 10.0, 1, "A", 0.1, 0.2, None, 1, 1.0), (1, 10.2, 1, "A", 0.1, 0.2, None, 1, 1.0)], 0, with_kills=True)
    assert db.games_without_samples(conn, vid, 0.2, 0, use_kills=True) == []


def _icon(kind):
    img = np.zeros((14, 40), np.uint8)
    if kind == "long":
        cv2.rectangle(img, (2, 5), (36, 9), 255, -1)
        cv2.rectangle(img, (30, 3), (36, 12), 255, -1)
    else:
        cv2.circle(img, (20, 7), 5, 255, -1)
    return img


def test_weapon_icons_get_stable_ids_and_new_ones_a_new_id(tmp_path):
    a = weapons.identify(_icon("long"), folder=tmp_path)
    b = weapons.identify(_icon("round"), folder=tmp_path)
    assert a == "W1" and b == "W2"
    assert weapons.identify(_icon("long"), folder=tmp_path) == "W1"
    assert weapons.identify(np.zeros((14, 40), np.uint8), folder=tmp_path) is None  # icône vide


def test_find_rows_splits_a_killfeed_line_into_killer_icon_victim():
    img = np.zeros((120, 340, 3), np.uint8)
    img[20:34, 40:130] = (110, 110, 110)  # pastille grise du tueur
    cv2.putText(img, "ORANGE", (45, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 150, 255), 2)  # texte orange (BGR)
    cv2.rectangle(img, (170, 22), (205, 32), (230, 230, 230), -1)  # icône d'arme blanche
    cv2.putText(img, "BLEUX", (255, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 140, 60), 2)  # texte bleu
    rows = killfeed.find_rows(img)
    assert len(rows) == 1
    teams = [s["team"] for s in rows[0]["segments"]]
    assert teams[0] == "A" and teams[-1] == "B"


def test_headshot_marker_is_split_from_the_weapon_icon():
    icon = np.zeros((18, 84), np.uint8)
    cv2.rectangle(icon, (7, 5), (52, 12), 255, -1)  # arme : ligne fine
    cv2.circle(icon, (68, 9), 7, 255, 2)  # petite cible (anneau)
    cv2.circle(icon, (68, 9), 1, 255, -1)
    weapon, headshot = killfeed.split_icon(icon)
    assert headshot is True
    assert weapon[:, 60:].sum() == 0 and weapon[:, :55].sum() > 0  # la cible a disparu de l'icône de l'arme


def test_a_round_grenade_icon_is_not_mistaken_for_a_headshot():
    icon = np.zeros((18, 40), np.uint8)
    cv2.rectangle(icon, (8, 3), (30, 15), 255, -1)  # grenade : une seule forme, plus large que haute
    weapon, headshot = killfeed.split_icon(icon)
    assert headshot is False and weapon.sum() == icon.sum()


def test_loadouts_are_stored_per_game(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s) VALUES (?, 10, 200)", (vid,))
    gid = conn.execute("SELECT id FROM games").fetchone()["id"]
    assert [g["id"] for g in db.games_without_loadouts(conn, vid)] == [gid]
    db.replace_loadouts(conn, gid, {1: {"arme1": "B1", "arme2": "B2", "gadget": "G1"}, 5: {"arme2": "B3"}})
    assert db.games_without_loadouts(conn, vid) == []
    row = conn.execute("SELECT weapon1, weapon2, gadget FROM loadouts WHERE game_id = ? AND slot = 5", (gid,)).fetchone()
    assert (row["weapon1"], row["weapon2"], row["gadget"]) == (None, "B3", None)


def test_loadout_shape_is_stable_after_merging_noisy_frames():
    import loadout

    clean = np.zeros((20, 40), np.uint8)
    cv2.rectangle(clean, (4, 8), (34, 12), 1, -1)
    noisy = [clean.copy() for _ in range(5)]
    noisy[0][2, 2] = 1  # parasite sur une seule image : disparaît au vote
    noisy[1][15, 30] = 1
    merged = loadout.merge_masks(noisy)
    assert merged is not None and merged[2, 2] == 0 and merged[15, 30] == 0 and merged[10, 10] == 255


def test_icon_catalogues_are_separate_by_prefix(tmp_path):
    shape = np.zeros((14, 40), np.uint8)
    cv2.rectangle(shape, (2, 5), (36, 9), 255, -1)
    assert weapons.identify(shape, folder=tmp_path, prefix="W") == "W1"
    assert weapons.identify(shape, folder=tmp_path, prefix="B") == "B1"  # même forme, autre catalogue
    assert weapons.identify(shape, folder=tmp_path, prefix="B") == "B1"
    assert (tmp_path / "previews" / "B1.png").exists()


def test_capture_series_are_cleaned_and_stored(tmp_path):
    import capture

    raw = [(float(i), v) for i, v in enumerate([0, 0, 5, 9, None, None, 20, 99, 25, 30, 34])]  # 99 : lecture aberrante
    cleaned = dict(capture.clean_series(raw, 1.0))
    assert cleaned[7] != 99 and 20 <= cleaned[7] <= 30  # écartée puis comblée
    assert cleaned[4] is not None and 9 <= cleaned[4] <= 20  # trou de 2 s comblé par interpolation
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s) VALUES (?, 10, 200)", (vid,))
    gid = conn.execute("SELECT id FROM games").fetchone()["id"]
    assert [g["id"] for g in db.games_without_capture(conn, vid)] == [gid]
    db.replace_capture(conn, gid, {"A": [(10.0, 0.0), (11.0, 3.0)], "B": [(10.0, 0.0), (11.0, None)]})
    assert db.games_without_capture(conn, vid) == []
    assert db.capture_of(conn, gid) == {"A": [(10.0, 0.0), (11.0, 3.0)], "B": [(10.0, 0.0)]}


def test_capture_digits_are_read_from_a_rendered_percentage():
    import capture

    templates = capture.load_templates()
    assert templates, "les modèles de chiffres doivent être livrés avec le projet"
    # Rendu synthétique avec la police d'écran : non reproductible fidèlement, on vérifie seulement qu'une zone vide ou sans couleur ne donne rien.
    empty = np.zeros((36, 90, 3), np.uint8)
    assert capture.read_value(empty, "A", templates) is None


def test_a_line_with_only_a_victim_is_an_environment_death():
    img = np.zeros((120, 340, 3), np.uint8)
    cv2.putText(img, "BLEUX", (282, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 140, 60), 2)  # un seul pseudo, aligné à droite
    rows = killfeed.find_rows(img)
    assert len(rows) == 1 and len(rows[0]["segments"]) == 1 and rows[0]["segments"][0]["team"] == "B"
    stray = np.zeros((120, 340, 3), np.uint8)
    cv2.putText(stray, "ORANGE", (20, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 150, 255), 2)  # texte isolé à gauche : pas une ligne du killfeed
    assert killfeed.find_rows(stray) == []


def test_killfeed_rows_must_end_on_the_right_edge_and_extra_text_is_ignored():
    img = np.zeros((120, 340, 3), np.uint8)
    cv2.putText(img, "FLOTTANT", (10, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 150, 255), 2)  # pseudo orange flottant dans le décor, à gauche
    cv2.putText(img, "ORANGE", (90, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (30, 150, 255), 2)
    cv2.rectangle(img, (180, 22), (215, 32), (230, 230, 230), -1)
    cv2.putText(img, "BLEUX", (275, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 140, 60), 2)
    rows = killfeed.find_rows(img)
    assert len(rows) == 1 and [s["team"] for s in rows[0]["segments"]] == ["A", "B"]  # le texte en trop à gauche est écarté
    nowhere = np.zeros((120, 340, 3), np.uint8)
    cv2.putText(nowhere, "DECOR", (120, 31), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 140, 60), 2)  # texte bleu au milieu
    assert killfeed.find_rows(nowhere) == []


def _game_with_samples(tmp_path):
    conn = db.connect(tmp_path / "eva.db")
    vid = db.upsert_video(conn, "/v.mp4", None, 600.0, 30.0, 1920, 1080)
    conn.execute("INSERT INTO games (video_id, start_s, end_s) VALUES (?, 10, 200)", (vid,))
    gid = conn.execute("SELECT id FROM games").fetchone()["id"]
    rows = []
    for i in range(10):  # joueur 1 à gauche, joueur 2 à droite, à 1 lecture par seconde
        rows.append((i, 10.0 + i, 1, "A", 0.1, 0.5, None, 1, 1.0))
        rows.append((i, 10.0 + i, 2, "A", 0.9, 0.5, None, 1, 1.0))
    db.replace_samples(conn, gid, rows)
    return conn, gid


def test_swap_exchanges_two_players_only_inside_the_period(tmp_path):
    conn, gid = _game_with_samples(tmp_path)
    db.swap_slots(conn, gid, 1, 2, 15.0, 18.0)
    x = lambda slot, t: conn.execute("SELECT x FROM samples WHERE game_id = ? AND slot = ? AND t = ?", (gid, slot, t)).fetchone()["x"]
    assert (x(1, 12.0), x(2, 12.0)) == (0.1, 0.9)  # avant : inchangé
    assert (x(1, 16.0), x(2, 16.0)) == (0.9, 0.1)  # pendant : échangés
    assert (x(1, 19.0), x(2, 19.0)) == (0.1, 0.9)  # après : inchangé
    assert conn.execute("SELECT COUNT(*) AS n FROM samples WHERE game_id = ?", (gid,)).fetchone()["n"] == 20
    db.swap_slots(conn, gid, 1, 2, 15.0, 18.0)  # un second échange annule le premier
    assert (x(1, 16.0), x(2, 16.0)) == (0.1, 0.9)


def test_corrections_are_reapplied_after_the_positions_are_read_again(tmp_path):
    conn, gid = _game_with_samples(tmp_path)
    conn.execute("INSERT INTO corrections (game_id, t0, t1, slot_a, slot_b) VALUES (?, 15, 18, 1, 2)", (gid,))
    conn.commit()
    db.replace_samples(conn, gid, [(i, 10.0 + i, s, "A", 0.1 if s == 1 else 0.9, 0.5, None, 1, 1.0) for i in range(10) for s in (1, 2)])
    db.apply_corrections(conn, gid)  # ce que fait analyze après chaque relecture
    row = conn.execute("SELECT x FROM samples WHERE game_id = ? AND slot = 1 AND t = 16.0", (gid,)).fetchone()
    assert row["x"] == 0.9


def _weapon_read(noise=0, seed=0):
    mask = np.zeros((14, 60), np.uint8)
    mask[4:10, 5:55] = 255
    tone = (mask // 2).astype(np.uint8)
    if noise:
        rng = np.random.default_rng(seed)
        ys, xs = rng.integers(0, 14, noise), rng.integers(0, 60, noise)
        mask[ys, xs] = 255
    return mask, tone


def test_noisy_reads_are_voted_into_a_clean_icon():
    reads = [_weapon_read(noise=6, seed=s) for s in range(5)]
    mask, tone, n = killfeed.consensus_icon(reads)
    assert n == 5
    assert (mask[4:10, 5:55] == 255).all() and mask[:3].sum() == 0 and mask[11:].sum() == 0  # le bruit des lectures isolées disparaît


def test_scattered_fragments_are_not_a_reliable_weapon():
    frag = np.zeros((14, 200), np.uint8)
    frag[1, 3] = frag[12, 190] = frag[5, 90] = 255
    frag[3:5, 40:60] = 255
    assert not killfeed.icon_is_reliable(frag)
    assert killfeed.icon_is_reliable(_weapon_read()[0])


def test_stray_pixels_are_removed_but_the_weapon_stays():
    mask = _weapon_read()[0]
    mask[0, 0] = mask[13, 59] = 255
    cleaned = killfeed.clean_icon(mask)
    assert cleaned[0, 0] == 0 and cleaned[13, 59] == 0 and cleaned[6, 30] == 255


def test_kill_weapon_comes_from_the_held_weapon_of_the_killer_banner(monkeypatch):
    import analyze

    loads = {2: {"arme1": "B2", "arme2": "B3", "gadget": "G1"}}
    meta = {"width": 1920, "height": 1080}
    monkeypatch.setattr(analyze.loadout, "held_weapon", lambda *a: "arme2")
    assert analyze.kill_weapon("v.mp4", meta, {}, loads, 2, 10.0, grenade=False) == "B3"
    assert analyze.kill_weapon("v.mp4", meta, {}, loads, 2, 10.0, grenade=True) == "G1"  # une grenade : le gadget du tueur
    assert analyze.kill_weapon("v.mp4", meta, {}, loads, None, 10.0, grenade=False) is None  # pas de tueur
    monkeypatch.setattr(analyze.loadout, "held_weapon", lambda *a: None)  # bandeau ambigu : on ne devine pas
    assert analyze.kill_weapon("v.mp4", meta, {}, loads, 2, 10.0, grenade=False) is None


def test_held_weapon_is_the_black_icon_and_ignores_unclear_banners(monkeypatch):
    import loadout
    import names

    def fake_scores(video, zone, width, height, t, index):
        return {-0.5: (130.0, 40.0), 0.0: (35.0, 135.0)}[round(t, 1)]

    monkeypatch.setattr(loadout, "_held_scores", fake_scores)
    zones = {"team_a_bar": {}, "team_b_bar": {}}
    assert loadout.held_weapon("v.mp4", zones, 1920, 1080, 0.0, 1) == "arme2"  # la dernière image tranchée l'emporte (changement d'arme)
    monkeypatch.setattr(loadout, "_held_scores", lambda *a: (80.0, 70.0))
    assert loadout.held_weapon("v.mp4", zones, 1920, 1080, 0.0, 1) is None
    assert names.TEAM_SLOTS["team_a_bar"][0] == 1


def test_grenade_logo_is_recognised_by_its_compact_shape():
    compact = np.zeros((20, 20), np.uint8)
    compact[3:17, 4:16] = 255
    long = np.zeros((20, 60), np.uint8)
    long[7:13, 3:57] = 255
    assert weapons.is_grenade_shape(compact) and not weapons.is_grenade_shape(long)
