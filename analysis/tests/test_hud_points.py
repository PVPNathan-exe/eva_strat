"""Tests de hud_points : hexagones synthétiques (couleur, neutre, lettre blanche, capture en cours), lissage, point actif, segments, écriture par point_owner.compute."""

import cv2
import numpy as np

import db
import hud_points as hp
import point_owner as po

H, W = 76, 114  # zone capture_points par défaut sur une vidéo 1920 x 1080 (0,06 x 0,07)
ORANGE = (10, 126, 249)  # BGR mesurés sur les remplissages réels
BLUE = (253, 150, 51)
DARK = (20, 20, 20)
ZONE = {"x": 0.47, "y": 0.125, "w": 0.06, "h": 0.07}
OUTLAW_ZONE = {"x": 0.47, "y": 0.125, "w": 0.06428816466552316, "h": 0.09744425385934821}


def hexagon(im, rel, fill=None, outline=True, letter=None, bottom=None, bottom_share=0.5, top=None):
    """Dessine un hexagone du layout `rel` = (cx, cy, hw, hh) en fractions de l'image : `fill` (BGR) plein, ou intérieur sombre avec liseré blanc ; `letter` : « white » ou « grey » ;
    `bottom` : couleur qui monte depuis le bas sur `bottom_share` de la hauteur (capture en cours), `top` : couleur du reste."""
    h, w = im.shape[:2]
    cx, cy, hw, hh = rel[0] * w, rel[1] * h, rel[2] * w, rel[3] * h
    pts = np.array([(cx - hw, cy), (cx - hw / 2, cy - hh), (cx + hw / 2, cy - hh), (cx + hw, cy), (cx + hw / 2, cy + hh), (cx - hw / 2, cy + hh)], np.int32)
    mask = np.zeros((h, w), np.uint8)
    cv2.fillPoly(mask, [pts], 255)
    body = top if top is not None else (fill if fill is not None else DARK)
    im[mask > 0] = body
    if bottom is not None:
        y_cut = cy + hh - 2 * hh * bottom_share
        rows = np.arange(h)[:, None] >= y_cut
        im[(mask > 0) & rows.repeat(w, axis=1)] = bottom
    if fill is None and top is None and outline:
        cv2.polylines(im, [pts], True, (255, 255, 255), 2)
    if letter:
        im[int(cy - hh * 0.3):int(cy + hh * 0.3), int(cx - hw * 0.15):int(cx + hw * 0.15)] = 255 if letter == "white" else 110


def blank(color=0):
    return np.full((H, W, 3), color, np.uint8)


def layout(map_name="Engine", zone=ZONE):
    return hp.layout_for(map_name, zone)


def read(im, map_name="Engine", zone=ZONE):
    mode, lay = layout(map_name, zone)
    return hp.read_frame(im, lay, {})


# ---------------------------------------------------------------- disposition

def test_les_cartes_a_trois_points_ont_leurs_trois_lettres_de_gauche_a_droite():
    for name in ("Engine", "Atlantis"):
        mode, lay = layout(name)
        assert list(lay) == ["B", "A", "C"] and lay["B"][0] < lay["A"][0] < lay["C"][0]
    assert layout("Engine")[0] == hp.ALWAYS and layout("Atlantis")[0] == hp.ACTIVE_ONLY


def test_une_carte_a_un_point_n_a_que_l_hexagone_a_au_centre():
    mode, lay = layout("Polaris")
    assert list(lay) == ["A"] and abs(lay["A"][0] - 0.521) < 1e-6 and mode == hp.ALWAYS


def test_outlaw_a_cinq_hexagones_avec_la_zone_calibree_et_deux_sans():
    assert list(layout("Outlaw", OUTLAW_ZONE)[1]) == ["A", "B", "C", "D", "E"]
    assert list(layout("Outlaw", ZONE)[1]) == ["A", "B"]  # la zone par défaut coupe C et toute la deuxième rangée : sans calibration d'Outlaw le HUD n'est pas lisible en entier
    _, lay = layout("Outlaw", OUTLAW_ZONE)
    assert lay["D"][1] > lay["A"][1] and lay["A"][0] < lay["B"][0] < lay["C"][0]


def test_la_disposition_suit_la_zone_recalibree():
    wide = {"x": 0.47, "y": 0.125, "w": 0.12, "h": 0.14}
    _, a = layout("Engine", ZONE)
    _, b = layout("Engine", wide)
    assert abs(b["A"][0] * wide["w"] - a["A"][0] * ZONE["w"]) < 1e-9  # même position sur l'écran


# ---------------------------------------------------------------- un hexagone

def test_remplissage_plein_orange_ou_bleu():
    lay = layout()[1]
    im = blank()
    hexagon(im, lay["B"], fill=ORANGE)
    hexagon(im, lay["A"], fill=BLUE)
    hexagon(im, lay["C"])
    states = read(im)
    assert states["B"]["owner"] == "A" and states["A"]["owner"] == "B" and states["C"]["owner"] == "none"
    assert states["B"]["lit"] == 1.0 and not states["B"]["contested"]


def test_hexagone_neutre_eteint_ou_lettre_blanche():
    lay = layout()[1]
    im = blank()
    hexagon(im, lay["B"], letter="grey")
    hexagon(im, lay["A"], letter="white")
    states = read(im)
    assert states["B"]["owner"] == "none" and states["B"]["lit"] == 0.0
    assert states["A"]["owner"] == "none" and states["A"]["lit"] == 0.5


def test_lettre_blanche_noyee_dans_un_decor_clair_ne_compte_pas():
    lay = layout()[1]
    im = blank(190)  # décor clair : l'intérieur translucide est clair
    hexagon(im, lay["A"], letter="white")
    im[:, :] = np.maximum(im, 170)
    states = read(im)
    assert states["A"]["lit"] == 0.0


def test_hud_absent_ecran_noir_est_illisible():
    assert all(s["owner"] is None for s in read(blank()).values())


def test_un_decor_bleu_vif_n_est_pas_un_point_bleu():
    lay = layout()[1]
    im = blank()
    hexagon(im, lay["A"], fill=(183, 134, 30))  # H 100, V 183 mesuré sur un mur bleu : plus sombre et plus violet que le remplissage réel
    assert read(im)["A"]["owner"] != "B"


def test_capture_en_cours_depuis_un_point_neutre():
    lay = layout()[1]
    im = blank()
    hexagon(im, lay["C"], top=DARK, bottom=ORANGE, bottom_share=0.4)
    st = read(im)["C"]
    assert st["owner"] == "none" and st["contested"] and st["lit"] == 1.0


def test_capture_en_cours_le_propriétaire_reste_la_couleur_du_haut():
    lay = layout()[1]
    im = blank()
    hexagon(im, lay["A"], top=BLUE, bottom=ORANGE, bottom_share=0.5)
    st = read(im)["A"]
    assert st["owner"] == "B" and st["contested"]


def test_liseré_de_l_ancien_proprietaire_en_haut_quand_la_capture_est_presque_finie():
    lay = layout()[1]
    im = blank()
    hexagon(im, lay["A"], top=ORANGE, bottom=BLUE, bottom_share=0.8)
    assert read(im)["A"]["owner"] == "A"


# ---------------------------------------------------------------- lissage et point actif

def state(owner, lit=1.0, wl=0.0, contested=False):
    return {"owner": owner, "contested": contested, "lit": lit, "wl": wl}


def series(rows):
    """Une lecture par seconde à partir de {lettre: état} (états déjà construits)."""
    return rows


def test_engine_chaque_hexagone_garde_son_proprietaire_et_les_trous_courts_sont_combles():
    letters = ["B", "A", "C"]
    readings = []
    for t in range(20):
        a = state("A") if t not in (8, 9) else state(None, lit=0.0)  # 2 s illisibles entre deux lectures orange
        readings.append({"B": state("A"), "A": a, "C": state("B" if t < 12 else "A")})
    dec = hp.decode(readings, hp.ALWAYS, letters)
    assert dec["owner"]["A"] == ["A"] * 20
    assert dec["owner"]["C"] == ["B"] * 12 + ["A"] * 8
    assert all(act == letters for act in dec["active"])  # tous actifs, tous lisibles


def test_atlantis_un_seul_point_actif_a_la_fois_et_les_eteints_n_ont_pas_de_proprietaire():
    letters = ["B", "A", "C"]
    readings = []
    for t in range(40):
        on = "A" if t < 20 else "B"
        readings.append({k: (state("A") if k == on else state("none", lit=0.0)) for k in letters})
    dec = hp.decode(readings, hp.ACTIVE_ONLY, letters)
    assert dec["active"][5] == ["A"] and dec["active"][30] == ["B"]
    assert dec["owner"]["A"][5] == "A" and dec["owner"]["A"][30] is None and dec["owner"]["B"][5] is None


def test_un_eclair_d_une_seconde_ne_change_pas_le_point_actif():
    letters = ["B", "A", "C"]
    readings = []
    for t in range(40):
        row = {k: state("none", lit=0.0) for k in letters}
        row["A"] = state("none", lit=0.5, wl=0.2)  # lettre blanche de A
        if t == 15:
            row["C"] = state("none", lit=0.5, wl=0.3)  # reflet d'une seconde sur C
        readings.append(row)
    dec = hp.decode(readings, hp.ACTIVE_ONLY, letters)
    assert all(act == ["A"] for act in dec["active"])


def test_les_trois_points_colores_s_allument_ensemble_a_la_fin():
    letters = ["B", "A", "C"]
    readings = []
    for t in range(60):
        row = {k: state("none", lit=0.0) for k in letters}
        if t < 40:
            row["B"] = state("B")
        else:
            row["A"], row["C"] = state("B"), state("A")
        readings.append(row)
    dec = hp.decode(readings, hp.ACTIVE_ONLY, letters)
    assert dec["active"][10] == ["B"] and dec["active"][50] == ["A", "C"]


def test_un_trou_de_lecture_du_point_actif_est_comble_entre_deux_lectures_du_meme_point():
    letters = ["B", "A", "C"]
    readings = []
    for t in range(60):
        row = {k: state("none", lit=0.0) for k in letters}
        if t < 20 or t >= 32:  # 12 s sans lettre lisible (décor clair), même point avant et après
            row["B"] = state("none", lit=0.5, wl=0.2)
        readings.append(row)
    assert all(act == ["B"] for act in hp.decode(readings, hp.ACTIVE_ONLY, letters)["active"])


def test_segments_de_proprietaire_et_de_point_actif():
    letters = ["B", "A", "C"]
    times = [float(t) for t in range(30)]
    owner = {"B": [None] * 30, "A": ["none"] * 10 + ["A"] * 20, "C": [None] * 30}
    segs = hp.owner_segments(times, owner)
    assert segs == [
        {"point": "A", "t0": 0.0, "t1": 10.0, "owner": "none", "source": "hud"},
        {"point": "A", "t0": 10.0, "t1": 30.0, "owner": "A", "source": "hud"},
    ]
    act = hp.active_segments(times, [["A"]] * 30, letters)
    assert act == [{"point": "A", "t0": 0.0, "t1": 30.0, "source": "hud"}]


# ---------------------------------------------------------------- game complète dans la base

def make_game(tmp_path, map_name, start=100.0, end=140.0):
    conn = db.connect(tmp_path / "t.db")
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, ?, 500, 60, 1920, 1080)", (str(tmp_path / "absente.mp4"),))
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, ?, ?, ?)", (start, end, map_name))
    conn.commit()
    return conn


def hud_frames(map_name, plan, zone=ZONE):
    """Images du HUD : plan = liste de {lettre: dict d'arguments de hexagon} par seconde."""
    _, lay = hp.layout_for(map_name, zone)
    out = []
    for t, hexes in enumerate(plan):
        im = blank()
        for k, rel in lay.items():
            hexagon(im, rel, **hexes.get(k, {"letter": "grey"}))
        out.append((float(t), im))
    return out


def test_engine_est_lu_sur_le_hud_et_ecrit_les_tables(tmp_path):
    conn = make_game(tmp_path, "Engine")
    plan = [{"B": {"fill": ORANGE}, "A": {"fill": BLUE}, "C": {}}] * 8 + [{"B": {"fill": ORANGE}, "A": {"fill": BLUE}, "C": {"fill": BLUE}}] * 12
    n = po.compute(conn, 1, hud_frames=hud_frames("Engine", plan))
    rows = [tuple(r) for r in conn.execute("SELECT point, t0, t1, owner, source FROM point_owner ORDER BY point, t0")]
    assert n == len(rows) == 4
    assert rows == [("A", 0.0, 20.0, "B", "hud"), ("B", 0.0, 20.0, "A", "hud"), ("C", 0.0, 8.0, "none", "hud"), ("C", 8.0, 20.0, "B", "hud")]
    active = [tuple(r) for r in conn.execute("SELECT point, t0, t1, source FROM point_active ORDER BY point")]
    assert active == [("A", 0.0, 20.0, "hud"), ("B", 0.0, 20.0, "hud"), ("C", 0.0, 20.0, "hud")]  # tous les points sont toujours actifs
    assert tuple(conn.execute("SELECT module, revision FROM stats_meta WHERE game_id = 1").fetchone()) == ("point_owner", po.REVISION)
    assert po.compute(conn, 1, hud_frames=hud_frames("Engine", plan)) == 4  # idempotent
    assert conn.execute("SELECT COUNT(*) FROM point_owner").fetchone()[0] == 4 and conn.execute("SELECT COUNT(*) FROM point_active").fetchone()[0] == 3


def test_atlantis_le_point_actif_tourne_et_le_proprietaire_se_lit_sur_le_point_allume(tmp_path):
    conn = make_game(tmp_path, "Atlantis")
    plan = [{"A": {"letter": "white"}}] * 4 + [{"A": {"fill": ORANGE}}] * 16 + [{"B": {"letter": "white"}}] * 4 + [{"B": {"fill": BLUE}}] * 16
    po.compute(conn, 1, hud_frames=hud_frames("Atlantis", plan))
    rows = [tuple(r) for r in conn.execute("SELECT point, t0, t1, owner, source FROM point_owner ORDER BY t0")]
    assert rows == [("A", 0.0, 4.0, "none", "hud"), ("A", 4.0, 20.0, "A", "hud"), ("B", 20.0, 24.0, "none", "hud"), ("B", 24.0, 40.0, "B", "hud")]
    assert [tuple(r) for r in conn.execute("SELECT point, t0, t1 FROM point_active ORDER BY t0")] == [("A", 0.0, 20.0), ("B", 20.0, 40.0)]


def test_sans_video_atlantis_n_ecrit_rien_mais_garde_la_revision(tmp_path):
    conn = make_game(tmp_path, "Atlantis")
    assert po.compute(conn, 1) == 0
    assert conn.execute("SELECT COUNT(*) FROM point_active").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM stats_meta WHERE module = 'point_owner'").fetchone()[0] == 1


def test_une_base_ancienne_dont_le_check_refuse_hud_est_migree(tmp_path):
    conn = make_game(tmp_path, "Engine")
    conn.executescript(
        "DROP TABLE point_owner; CREATE TABLE point_owner (game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE, point TEXT NOT NULL, t0 REAL NOT NULL, t1 REAL NOT NULL, "
        "owner TEXT NOT NULL CHECK (owner IN ('A', 'B', 'none')), source TEXT CHECK (source IN ('box', 'score')), PRIMARY KEY (game_id, point, t0));"
        "INSERT INTO point_owner VALUES (1, 'A', 0, 5, 'A', 'box');"
    )
    plan = [{"B": {"fill": ORANGE}, "A": {"fill": BLUE}, "C": {"fill": BLUE}}] * 10
    assert po.compute(conn, 1, hud_frames=hud_frames("Engine", plan)) == 3
    assert "'hud'" in conn.execute("SELECT sql FROM sqlite_master WHERE name = 'point_owner'").fetchone()[0]
    assert conn.execute("SELECT COUNT(*) FROM point_owner WHERE source = 'hud'").fetchone()[0] == 3


def test_carte_a_un_point_la_boite_reste_la_reference_et_le_hud_la_recoupe(tmp_path):
    conn = make_game(tmp_path, "Polaris")
    rect = po.point_rects("Polaris")["A"]

    def box_image(color):
        im = np.full((100, 200, 3), 20, np.uint8)
        im[int(rect[1] * 100):int(rect[3] * 100), int(rect[0] * 200):int(rect[2] * 200)] = color
        return im

    box_colors = [(140, 140, 140)] * 5 + [(40, 90, 190)] * 15  # gris puis orange (BGR de test_point_owner)
    frames = [(float(t), box_image(c)) for t, c in enumerate(box_colors)]
    plan = [{"A": {}}] * 5 + [{"A": {"fill": ORANGE}}] * 15
    result = po.analyse(conn, 1, frames=frames, hud_frames=hud_frames("Polaris", plan))
    assert [(s["owner"], s["source"]) for s in result["segments"]] == [("none", "box"), ("A", "box")]
    s = result["stats"]
    assert s["hud_compared"] == 20 and s["hud_agree"] == 20 and s["hud_only"] == 0 and s["hud_read"]
    assert result["active"] == []  # un seul point : pas de calendrier du point actif


def test_le_hud_comble_les_secondes_ou_la_boite_est_illisible_avant_la_pente_des_scores(tmp_path):
    conn = make_game(tmp_path, "Polaris")
    rect = po.point_rects("Polaris")["A"]
    black = np.zeros((100, 200, 3), np.uint8)
    frames = [(float(t), black) for t in range(12)]  # minimap noire : aucune boîte lisible
    plan = [{"A": {"fill": ORANGE}}] * 12
    result = po.analyse(conn, 1, frames=frames, hud_frames=hud_frames("Polaris", plan))
    assert [(s["owner"], s["source"]) for s in result["segments"]] == [("A", "hud")]
    assert result["stats"]["hud_only"] == 12 and rect


def test_merge_boite_puis_hud_puis_score():
    labels, sources = po.merge(["A", None, None, None], ["B", "B", None, "B"], ["B", "A", "A", None])
    assert labels == ["A", "A", "A", "B"] and sources == ["box", "hud", "hud", "score"]
    assert po.merge(["A", None], ["A", "B"]) == (["A", "B"], ["box", "score"])  # sans HUD : comportement d'avant


def test_outlaw_sans_hud_garde_les_plages_des_boites_comme_point_actif(tmp_path):
    conn = make_game(tmp_path, "Outlaw", end=160.0)
    box1 = {"x": 0.3, "y": 0.3, "w": 0.2, "h": 0.2}
    db.replace_capture_boxes(conn, 1, [dict(t0=0.0, t1=9.0, **box1)], lambda x, y: "C")
    im = np.full((100, 200, 3), 20, np.uint8)
    rect = po.box_rect(box1)
    im[int(rect[1] * 100):int(rect[3] * 100), int(rect[0] * 200):int(rect[2] * 200)] = (40, 90, 190)
    po.compute(conn, 1, frames=[(float(t), im) for t in range(10)])
    assert [tuple(r) for r in conn.execute("SELECT point, t0, t1, source FROM point_active")] == [("C", 0.0, 10.0, "box")]


def test_accord_du_hud_avec_la_pente_des_scores_engine():
    letters = ["B", "A", "C"]
    n = 30
    hud = {"times": [float(t) for t in range(n)], "letters": letters, "mode": hp.ALWAYS,
           "owner": {"B": ["A"] * n, "A": ["A"] * n, "C": ["B"] * n}}  # A tient 2 points, B un seul
    capture = {"A": [(float(t), 2.0 * t) for t in range(n)], "B": [(float(t), 0.0) for t in range(n)]}  # A marque seule
    out = hp.agreement_with_score(hud, capture)
    assert out["compared"] > 0 and out["agree"] == out["compared"] and out["agree_majority"] == out["compared_majority"] > 0
    capture = {"A": [(float(t), 0.0) for t in range(n)], "B": [(float(t), 2.0 * t) for t in range(n)]}  # B marque seul alors qu'il tient le moins de points
    out = hp.agreement_with_score(hud, capture)
    assert out["agree"] == out["compared"] and out["agree_majority"] == 0 < out["compared_majority"]


def test_la_ligne_de_commande_de_hud_points_sans_video(tmp_path, capsys):
    make_game(tmp_path, "Engine").close()
    assert hp.main(["--game", "1", "--db", str(tmp_path / "t.db")]) == 0
    assert "rien à lire" in capsys.readouterr().out


# ---------------------------------------------------------------- calendrier du point actif (rotation_schedule) branché sur point_owner

def chrono_of(n, start=600, offset=1):
    """Lectures du chrono d'une game dont la seconde + le chrono valent start + offset (la valeur de départ reste affichée 2 secondes)."""
    return [(float(t), start if t < 2 else start + offset - t) for t in range(n)]


def test_atlantis_les_bornes_du_point_actif_viennent_du_calendrier_et_le_hud_donne_l_identite(tmp_path):
    conn = make_game(tmp_path, "Atlantis", start=100.0, end=400.0)
    # off 601 : changements à 6, 96, 156, 216, 276 s ; le HUD s'allume 1 s plus tard, et l'ancien point s'éteint une seconde plus tard
    plan = [{}] * 7 + [{"A": {"letter": "white"}}] * 90 + [{"B": {"letter": "white"}}] * 60 + [{"A": {"letter": "white"}}] * 60 + [{"C": {"letter": "white"}}] * 60 + [{"B": {"letter": "white"}}] * 24
    result = po.analyse(conn, 1, hud_frames=hud_frames("Atlantis", plan), chrono=chrono_of(45))
    assert [(a["point"], a["t0"], a["t1"], a["source"]) for a in result["active"]] == [
        ("A", 6.0, 96.0, "schedule"), ("B", 96.0, 156.0, "schedule"), ("A", 156.0, 216.0, "schedule"), ("C", 216.0, 276.0, "schedule"), ("B", 276.0, 301.0, "schedule")]
    sc = result["stats"]["schedule"]
    assert sc["used"] and sc["off"] == 601.0 and sc["periods"] == 5 and sc["read"] == 5 and sc["unread"] == [] and sc["tail"] == 0
    n = po.compute(conn, 1, hud_frames=hud_frames("Atlantis", plan), chrono=chrono_of(45))
    assert n > 0 and conn.execute("SELECT COUNT(*) FROM point_active WHERE source = 'schedule'").fetchone()[0] == 5


def test_sans_chrono_lisible_le_point_actif_retombe_sur_le_hud_seul(tmp_path):
    conn = make_game(tmp_path, "Atlantis")
    plan = [{"A": {"letter": "white"}}] * 20 + [{"B": {"letter": "white"}}] * 20
    result = po.analyse(conn, 1, hud_frames=hud_frames("Atlantis", plan), chrono=[(float(t), None) for t in range(40)])
    assert [(a["point"], a["source"]) for a in result["active"]] == [("A", "hud"), ("B", "hud")]
    assert result["stats"]["schedule"] == {"used": False}


def test_outlaw_le_point_precedent_reste_allume_et_le_nouveau_est_quand_meme_lu(tmp_path):
    conn = make_game(tmp_path, "Outlaw", start=100.0, end=600.0)
    d_on = {"D": {"fill": BLUE}}
    # off 721 : changements à 36, 126, 216, 306, 396, 486 s (685, 595, 505, 415, 325, 235) ; D reste allumé (bleu) au dernier changement, B s'allume à côté
    plan = ([{}] * 37 + [{"C": {"letter": "white"}}] * 90 + [{"B": {"letter": "white"}}] * 90 + [{"A": {"letter": "white"}}] * 90 + [{"B": {"letter": "white"}}] * 90
            + [dict(d_on)] * 90 + [dict(d_on, B={"letter": "white"})] * 60)
    result = po.analyse(conn, 1, hud_frames=hud_frames("Outlaw", plan, zone=OUTLAW_ZONE), chrono=chrono_of(45, start=720))
    assert [(a["point"], a["t0"]) for a in result["active"]] == [("C", 36.0), ("B", 126.0), ("A", 216.0), ("B", 306.0), ("D", 396.0), ("B", 486.0)]
    assert result["stats"]["schedule"]["unread"] == []
