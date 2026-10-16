"""Tests de point_owner : couleur de la boîte (images synthétiques), nettoyage, pente des scores, segments et écriture idempotente."""

import numpy as np

import db
import point_owner as po

RECT = (0.4, 0.4, 0.6, 0.6)  # cadre d'une boîte sur une image de 200 x 100
ORANGE = (40, 90, 190)  # BGR
BLUE = (190, 100, 40)
GREY = (140, 140, 140)


def image(color, rect=RECT, size=(100, 200)):
    """Image sombre avec la boîte du cadre `rect` remplie de `color` (BGR)."""
    im = np.full((size[0], size[1], 3), 20, np.uint8)
    h, w = size
    im[int(rect[1] * h):int(rect[3] * h), int(rect[0] * w):int(rect[2] * w)] = color
    return im


# ---------------------------------------------------------------- couleur de la boîte

def test_chaque_couleur_est_lue():
    assert po.read_color(image(ORANGE), RECT) == "A"
    assert po.read_color(image(BLUE), RECT) == "B"
    assert po.read_color(image(GREY), RECT) == "none"


def test_cadre_vide_ou_ecran_noir_est_illisible():
    assert po.read_color(image((0, 0, 0)), RECT) is None
    assert po.read_color(image((20, 20, 20)), RECT) is None


def test_pastille_de_joueur_sur_la_boite_ne_change_pas_la_couleur():
    im = image(BLUE)
    im[42:50, 80:90] = (30, 120, 250)  # pastille orange sur une partie du cadre
    assert po.read_color(im, RECT) == "B"
    im = image(GREY)
    im[40:60, 80:95] = (40, 120, 250)  # grosse pastille orange (un tiers du cadre) : le gris reste majoritaire
    assert po.read_color(im, RECT) == "none"


def test_deux_couleurs_a_egalite_sont_ambigues():
    im = image(ORANGE)
    im[40:60, 100:120] = BLUE  # moitié droite du cadre en bleu
    assert po.read_color(im, RECT) is None


def test_part_de_chaque_couleur():
    shares = po.pixel_shares(image(ORANGE), RECT)
    assert shares["A"] > 0.95 and shares["B"] == 0 and shares["none"] == 0


def test_cadre_d_une_boite_outlaw():
    assert po.box_rect({"x": 0.5, "y": 0.5, "w": 0.2, "h": 0.1}) == (0.4, 0.45, 0.6, 0.55)


def test_cadres_des_cartes_a_un_point():
    rects = po.point_rects("Polaris")
    assert list(rects) == ["A"] and 0 < rects["A"][0] < rects["A"][2] < 1
    assert len(po.point_rects("Atlantis")) == 3


# ---------------------------------------------------------------- nettoyage et segments

def test_un_trou_court_entre_deux_memes_lectures_est_comble():
    assert po.clean_labels(["A", None, None, "A"]) == ["A"] * 4
    assert po.clean_labels(["A", None, None, None, None, "A"]) == ["A", None, None, None, None, "A"]  # 4 s : trop long
    assert po.clean_labels(["A", None, "B"]) == ["A", None, "B"]  # deux bords différents : on ne devine pas


def test_un_accident_d_une_seconde_est_efface():
    assert po.clean_labels(["B", "B", "none", "B", "B"]) == ["B"] * 5
    assert po.clean_labels(["B", "B", "A", "A", "B"]) == ["B", "B", "A", "A", "B"]  # deux secondes : un vrai changement


def test_les_bords_illisibles_ne_sont_pas_inventes():
    assert po.clean_labels([None, "A", "A", None]) == [None, "A", "A", None]


def test_segments_et_sources():
    times = [0.0, 1.0, 2.0, 3.0, 4.0, 5.0]
    labels = ["none", "none", "A", "A", None, "B"]
    sources = ["box", "box", "box", "score", None, "score"]
    segs = po.to_segments("C", times, labels, sources)
    assert segs == [
        {"point": "C", "t0": 0.0, "t1": 2.0, "owner": "none", "source": "box"},
        {"point": "C", "t0": 2.0, "t1": 4.0, "owner": "A", "source": "box"},  # une seconde sur deux vient de la boîte : « box »
        {"point": "C", "t0": 5.0, "t1": 6.0, "owner": "B", "source": "score"},
    ]


# ---------------------------------------------------------------- pente des scores

def capture(a_rises_from, b_rises_from, n=40):
    """Séries de score : A monte d'un point par seconde à partir de a_rises_from, B à partir de b_rises_from (None : constante)."""
    out = {}
    for team, start in (("A", a_rises_from), ("B", b_rises_from)):
        out[team] = [(float(t), 0.0 if start is None else max(0.0, float(t - start))) for t in range(n)]
    return out


def test_l_equipe_dont_le_score_monte_tient_le_point():
    times = [float(t) for t in range(40)]
    lab = po.score_labels(capture(5, None), times)
    assert lab[20] == "A" and lab[0] is None
    lab = po.score_labels(capture(None, 5), times)
    assert lab[20] == "B"


def test_scores_a_l_arret_ou_qui_montent_tous_les_deux_ne_disent_rien():
    times = [float(t) for t in range(40)]
    assert set(po.score_labels(capture(None, None), times)) == {None}
    assert po.score_labels(capture(0, 0), times)[20] is None


def test_la_boite_l_emporte_et_la_pente_comble():
    labels, sources = po.merge(["A", None, "none", None], ["B", "B", "B", None])
    assert labels == ["A", "B", "none", None] and sources == ["box", "score", "box", None]


def test_accord_hors_transitions():
    times = [float(t) for t in range(30)]
    box = ["A"] * 15 + ["B"] * 15
    score = ["A"] * 17 + ["B"] * 13  # la pente retarde de 2 s au changement
    acc = po.agreement(box, score, times)
    assert acc["compared"] == 30 and acc["agree"] == 28
    assert acc["compared_calm"] < 30 and acc["agree_calm"] == acc["compared_calm"]


def test_boite_grise_face_a_un_score_qui_monte_est_un_desaccord():
    acc = po.agreement(["none", "none"], ["A", "A"], [0.0, 1.0])
    assert acc["compared"] == 2 and acc["agree"] == 0


# ---------------------------------------------------------------- base de données

def make_game(tmp_path, map_name="Polaris", video="absente.mp4", start=100.0, end=140.0):
    conn = db.connect(tmp_path / "t.db")
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, ?, 500, 60, 1920, 1080)", (str(tmp_path / video),))
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, ?, ?, ?)", (start, end, map_name))
    conn.commit()
    return conn


def synthetic_frames(rect, colors):
    """Une image par seconde : colors donne la couleur de chaque seconde."""
    return [(float(t), image(c, rect)) for t, c in enumerate(colors)]


def test_compute_ecrit_les_segments_et_la_revision_puis_recommence_a_l_identique(tmp_path):
    conn = make_game(tmp_path)
    rect = po.point_rects("Polaris")["A"]
    frames = synthetic_frames(rect, [GREY] * 5 + [ORANGE] * 10 + [BLUE] * 10)
    first = po.compute(conn, 1, frames=frames)
    rows = [tuple(r) for r in conn.execute("SELECT point, t0, t1, owner, source FROM point_owner WHERE game_id = 1 ORDER BY t0")]
    assert first == 3 and rows == [("A", 0.0, 5.0, "none", "box"), ("A", 5.0, 15.0, "A", "box"), ("A", 15.0, 25.0, "B", "box")]
    assert po.compute(conn, 1, frames=frames) == 3
    assert conn.execute("SELECT COUNT(*) FROM point_owner").fetchone()[0] == 3
    assert tuple(conn.execute("SELECT module, revision FROM stats_meta WHERE game_id = 1").fetchone()) == ("point_owner", po.REVISION)


def test_sans_video_la_pente_des_scores_donne_les_segments(tmp_path):
    conn = make_game(tmp_path)
    series = capture(5, None, n=40)
    db.replace_capture(conn, 1, {team: [(100.0 + t, v) for t, v in pts] for team, pts in series.items()})
    assert po.compute(conn, 1) >= 1  # la vidéo n'existe pas : seule la pente parle
    rows = [tuple(r) for r in conn.execute("SELECT owner, source FROM point_owner")]
    assert rows and all(r == ("A", "score") for r in rows)


def test_carte_a_trois_points_et_carte_sans_boites_n_ecrivent_rien(tmp_path):
    conn = make_game(tmp_path, "Atlantis")
    assert po.compute(conn, 1, frames=synthetic_frames((0.4, 0.4, 0.6, 0.6), [ORANGE] * 10)) == 0
    assert conn.execute("SELECT COUNT(*) FROM stats_meta WHERE module = 'point_owner'").fetchone()[0] == 1  # calculé, rien à écrire
    conn = make_game(tmp_path / "autre", "Outlaw")
    assert po.compute(conn, 1, frames=synthetic_frames((0.4, 0.4, 0.6, 0.6), [ORANGE] * 10)) == 0  # pas de capture_boxes : rien à lire


def test_outlaw_lit_chaque_boite_dans_sa_plage(tmp_path):
    conn = make_game(tmp_path, "Outlaw", end=160.0)
    box1, box2 = {"x": 0.3, "y": 0.3, "w": 0.2, "h": 0.2}, {"x": 0.7, "y": 0.7, "w": 0.2, "h": 0.2}
    db.replace_capture_boxes(conn, 1, [dict(t0=0.0, t1=9.0, **box1), dict(t0=10.0, t1=19.0, **box2)], lambda x, y: "C" if x < 0.5 else "B")
    frames = []
    for t in range(20):
        im = image(GREY, po.box_rect(box1) if t < 10 else po.box_rect(box2))
        if t >= 5:  # la boîte courante change de propriétaire en cours de plage
            im = image(ORANGE if t < 10 else BLUE, po.box_rect(box1) if t < 10 else po.box_rect(box2))
        frames.append((float(t), im))
    assert po.compute(conn, 1, frames=frames) == 3
    rows = [tuple(r) for r in conn.execute("SELECT point, t0, t1, owner FROM point_owner ORDER BY t0")]
    assert rows == [("C", 0.0, 5.0, "none"), ("C", 5.0, 10.0, "A"), ("B", 10.0, 20.0, "B")]


def test_la_ligne_de_commande_ecrit_dans_la_base_donnee(tmp_path):
    make_game(tmp_path, "Atlantis").close()
    assert po.main(["--game", "1", "--db", str(tmp_path / "t.db")]) == 0


def test_aucune_periode_de_point_actif_sur_une_carte_sans_changement_de_point():
    import sqlite3
    from pathlib import Path

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript((Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8"))
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'v.mp4', 300, 60, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, 0, 200, 'Engine')")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (2, 1, 300, 500, 'Atlantis')")
    active = [{"point": "A", "t0": 0.0, "t1": 90.0, "source": "hud"}]
    po._write(conn, 1, [], active)
    po._write(conn, 2, [], active)
    assert conn.execute("SELECT COUNT(*) FROM point_active WHERE game_id = 1").fetchone()[0] == 0  # Engine : les trois hexagones sont toujours allumés, ce n'est pas un point actif
    assert conn.execute("SELECT COUNT(*) FROM point_active WHERE game_id = 2").fetchone()[0] == 1  # Atlantis garde sa période
