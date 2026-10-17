"""Équipement par vie (loadout_life.py) : instants lus, vote par case, repli, écriture idempotente. Base en mémoire, images synthétiques."""

import sqlite3
from pathlib import Path

import numpy as np

import loadout_life as L
import weapons

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8")


def make_conn(video_path="v.mp4"):
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, ?, 300, 30, 1920, 1080)", (video_path,))
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, 100, 200, 'The Cliff')")
    return conn


def add_life(conn, slot, idx, t0, t1, ended="death"):
    conn.execute("INSERT INTO lives (game_id, slot, idx, t0, t1, ended) VALUES (1, ?, ?, ?, ?, ?)", (slot, idx, t0, t1, ended))


# --- instants lus -----------------------------------------------------------------------------------------------------------------------------------------

def test_instants_d_une_vie_normale_apres_l_apparition_et_avant_la_mort():
    start, end = L.life_times(10.0, 50.0, "death")
    assert start == [10.8, 11.8, 13.0, 14.5, 16.5, 19.0]
    assert end == [48.8, 49.3, 49.7]


def test_une_vie_courte_ne_lit_que_ce_qui_tombe_dans_la_vie():
    start, end = L.life_times(10.0, 12.0, "death")
    assert start == [10.8] and all(10.1 <= t <= 12.0 for t in end)
    start, end = L.life_times(10.0, 10.5, "death")
    assert all(10.0 <= t <= 10.5 for t in start + end)
    assert L.life_times(10.0, 10.1, "death") == ([], [])  # rien de lisible


def test_la_fin_de_game_est_lue_plus_tot_a_cause_de_l_ecran_noir():
    _start, end = L.life_times(10.0, 100.0, "end")
    assert end == [97.0, 97.6, 98.2]


# --- vote -------------------------------------------------------------------------------------------------------------------------------------------------

def read(held=None, pale=None, gadget=None):
    return {"held": held, "pale": pale, "gadget": gadget, "unknown": 0, "banner": None}


def test_le_vote_prend_l_icone_la_plus_frequente_de_chaque_case_et_la_source_dit_la_plus_faible():
    reads = {
        "start": [read(("arme1", "B1"), gadget="G1"), read(("arme1", "B1"), gadget="G1"), read(("arme2", "B2"), gadget="G1")],
        "end": [read(("arme1", "B1"))],
    }
    out = L.vote_life(reads)
    assert (out["weapon1"], out["weapon2"], out["gadget"], out["held"]) == ("B1", "B2", "G1", "B1")
    assert out["origins"] == {"weapon1": "lu", "weapon2": "lu1", "gadget": "lu"}
    assert out["source"] == "lu1"  # la case d'arme 2 n'a été lue que sur une image


def test_une_arme_jamais_tenue_se_lit_en_pale_et_la_source_devient_pale():
    reads = {"start": [read(("arme1", "B1"), pale=("arme2", "B2")), read(("arme1", "B1"), pale=("arme2", "B2"))], "end": []}
    out = L.vote_life(reads)
    assert out["weapon2"] == "B2" and out["origins"]["weapon2"] == "pale" and out["source"] == "pale"


def test_une_lecture_tenue_l_emporte_sur_une_lecture_pale():
    reads = {"start": [read(("arme2", "B2"), pale=("arme2", "B9"))] * 2, "end": []}
    assert L.vote_life(reads)["weapon2"] == "B2"


def test_jamais_deux_fois_la_meme_arme():
    reads = {"start": [read(("arme1", "B1")), read(("arme1", "B1")), read(("arme2", "B1"))], "end": []}
    out = L.vote_life(reads)
    assert out["weapon1"] == "B1" and out["weapon2"] is None  # la moins soutenue cède


def test_icone_inconnue_laisse_la_case_vide_et_une_vie_sans_lecture_n_a_pas_de_source():
    out = L.vote_life({"start": [read(("arme1", None))], "end": []})
    assert out["weapon1"] is None and out["source"] is None
    assert L.vote_life({"start": [], "end": []})["source"] is None


def test_le_repli_sur_la_game_est_facultatif_et_marque_game():
    reads = {"start": [read(("arme1", "B1"), gadget="G1")] * 2, "end": []}
    game = {"weapon1": "B7", "weapon2": "B2", "gadget": "G9"}
    off = L.vote_life(reads, game)
    assert off["weapon2"] is None
    on = L.vote_life(reads, game, use_game=True)
    assert (on["weapon1"], on["weapon2"], on["gadget"]) == ("B1", "B2", "G1")  # seules les cases vides sont reprises
    assert on["origins"]["weapon2"] == "game" and on["source"] == "game"


def test_l_arme_tenue_a_la_mort_vient_des_dernieres_images_seulement():
    reads = {"start": [read(("arme1", "B1"))] * 3, "end": [read(("arme2", "B2")), read(("arme2", "B2"))]}
    assert L.vote_life(reads)["held"] == "B2"
    assert L.vote_life({"start": [read(("arme1", "B1"))], "end": []})["held"] is None


# --- lecture d'une image (icônes synthétiques) ------------------------------------------------------------------------------------------------------------

def gun(width=26, height=9, grip=True):
    """Silhouette d'arme synthétique dans une case de 24 x 34 pixels."""
    shape = np.zeros((24, 34), np.uint8)
    shape[8 : 8 + height, 4 : 4 + width] = 1
    if grip:
        shape[8 + height : 8 + height + 5, 8:12] = 1
    return shape


def make_row(held_shape, held="arme1", stowed_shape=None):
    zero = np.zeros((24, 34), np.uint8)
    row = {"arme1": (zero.copy(), zero.copy()), "arme2": (zero.copy(), zero.copy()), "gadget": (zero.copy(), zero.copy())}
    other = "arme2" if held == "arme1" else "arme1"
    row[held] = (held_shape, held_shape * 140)
    if stowed_shape is not None:
        row[other] = (stowed_shape, stowed_shape * 35)
    row["banner"] = np.zeros((10, 10, 3), np.uint8)
    return row


def test_classify_identifie_l_arme_tenue_dans_les_icones_connues_et_ne_cree_rien_par_defaut(tmp_path):
    shape = gun()
    weapons.identify(shape, folder=tmp_path, prefix="B", create=True, tone=shape * 140)  # le modèle « B1 »
    out = L.classify(make_row(shape, "arme2"), tmp_path)
    assert out["held"] == ("arme2", "B1")
    odd = gun(width=18, height=14, grip=False)  # forme inconnue
    out = L.classify(make_row(odd), tmp_path)
    assert out["held"] == ("arme1", None) and out["unknown"] == 1
    assert sorted(p.name for p in tmp_path.glob("B*.png")) == ["B1.png"]  # create=False : pas de nouvelle icône


def test_classify_sans_arme_tenue_ne_renvoie_rien(tmp_path):
    zero = np.zeros((24, 34), np.uint8)
    row = make_row(zero)
    assert L.classify(row, tmp_path)["held"] is None


# --- calcul d'une game -------------------------------------------------------------------------------------------------------------------------------------

def test_compute_ecrit_une_ligne_par_vie_est_idempotent_et_ecrit_stats_meta(tmp_path):
    shape = gun()
    other = gun(width=14, height=11, grip=False)
    weapons.identify(shape, folder=tmp_path, prefix="B", create=True, tone=shape * 140)
    weapons.identify(other, folder=tmp_path, prefix="B", create=True, tone=other * 140)  # « B2 »
    conn = make_conn()
    add_life(conn, 1, 0, 5.0, 40.0)
    add_life(conn, 5, 0, 5.0, 40.0)
    frames = {
        (1, 0): {"start": [make_row(shape, "arme1", other)] * 3, "end": [make_row(shape, "arme1", other)]},
        (5, 0): {"start": [make_row(other, "arme2", shape)] * 2, "end": []},
    }
    rows, report = L.compute_detail(conn, 1, tmp_path, frames=frames)
    assert report["frames"] == 6 and report["frames_read"] == 6
    by = {(r["slot"], r["life_idx"]): r for r in rows}
    assert (by[(1, 0)]["weapon1"], by[(1, 0)]["weapon2"], by[(1, 0)]["held"]) == ("B1", "B2", "B1")
    assert by[(1, 0)]["origins"]["weapon2"] == "pale"
    assert (by[(5, 0)]["weapon2"], by[(5, 0)]["weapon1"]) == ("B2", "B1")
    L.write(conn, 1, rows)
    L.write(conn, 1, rows)  # idempotent : pas de doublons
    assert conn.execute("SELECT COUNT(*) FROM life_loadouts").fetchone()[0] == 2
    assert conn.execute("SELECT revision FROM stats_meta WHERE game_id = 1 AND module = 'loadout_life'").fetchone()[0] == L.REVISION
    cov = L.coverage(rows, tmp_path)
    assert cov["vies"] == 2 and cov["cases"] == 6 and cov["remplies"] == 4  # pas de gadget lu


def test_compute_sans_video_renvoie_zero_et_n_efface_rien(tmp_path):
    conn = make_conn(str(tmp_path / "absente.mp4"))
    add_life(conn, 1, 0, 5.0, 40.0)
    conn.execute("INSERT INTO life_loadouts (game_id, slot, life_idx, weapon1) VALUES (1, 1, 0, 'B1')")
    assert L.compute(conn, 1, tmp_path) == 0
    assert conn.execute("SELECT weapon1 FROM life_loadouts").fetchone()[0] == "B1"


def test_compute_lit_les_images_de_chaque_vie_a_l_instant_de_la_vie_plus_le_debut_de_la_game(tmp_path, monkeypatch):
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    conn = make_conn(str(video))
    add_life(conn, 2, 3, 20.0, 60.0)
    seen = {}

    def fake_read(path, zones, width, height, start_s, lives):
        seen.update(path=path, start_s=start_s, lives=[(v["slot"], v["idx"]) for v in lives], zones=sorted(zones))
        return {(2, 3): {"start": [None], "end": [None]}}

    monkeypatch.setattr(L, "read_game_frames", fake_read)
    assert L.compute(conn, 1, tmp_path) == 1
    assert seen["path"] == str(video) and seen["start_s"] == 100 and seen["lives"] == [(2, 3)] and seen["zones"] == ["team_a_bar", "team_b_bar"]
    row = conn.execute("SELECT weapon1, weapon2, gadget, held, source FROM life_loadouts WHERE slot = 2 AND life_idx = 3").fetchone()
    assert tuple(row) == (None, None, None, None, None)  # images illisibles : ligne vide, sans source


def test_la_game_au_repli_est_utilisee_seulement_sur_demande(tmp_path):
    shape = gun()
    weapons.identify(shape, folder=tmp_path, prefix="B", create=True, tone=shape * 140)
    conn = make_conn()
    conn.execute("INSERT INTO loadouts (game_id, slot, weapon1, weapon2, gadget) VALUES (1, 1, 'B1', 'B1', 'G1')")
    add_life(conn, 1, 0, 5.0, 40.0)
    frames = {(1, 0): {"start": [make_row(shape, "arme1")] * 2, "end": []}}
    off, _ = L.compute_detail(conn, 1, tmp_path, frames=frames)
    on, _ = L.compute_detail(conn, 1, tmp_path, use_game=True, frames=frames)
    assert off[0]["gadget"] is None and on[0]["gadget"] == "G1" and on[0]["source"] == "game"
    assert on[0]["weapon2"] is None  # B1 est déjà l'arme 1 : jamais deux fois la même


def test_un_gadget_terne_deja_utilise_ne_vote_pas_pour_l_identite_de_l_icone(tmp_path):
    shape = np.zeros((24, 34), np.uint8)
    shape[8:17, 6:26] = 1
    weapons.identify(shape, folder=tmp_path, prefix="G", create=True, tone=shape * 140)  # le modèle « G1 »
    bright = make_row(gun(), "arme2")
    bright["gadget"] = (shape, shape * 140)  # gadget disponible : noir, relief 140
    dim = make_row(gun(), "arme2")
    dim["gadget"] = (shape, shape * 25)  # le même gadget utilisé : terne, relief 25
    assert L.classify(bright, tmp_path)["gadget"] == "G1"
    assert L.classify(dim, tmp_path)["gadget"] is None
    reads = {"start": [L.classify(dim, tmp_path)] * 3, "end": []}
    assert L.vote_life(reads)["gadget"] is None  # aucune image disponible : pas d'identité devinée sur des images ternes


# --- règle d'équipe : un seul SHIELD, SONAR et CLONE par équipe -------------------------------------------------------------------------------------------

def _lv(slot, idx, t0, t1):
    return {"slot": slot, "idx": idx, "t0": t0, "t1": t1}


def _row(slot, idx, gadget, source):
    return {"slot": slot, "life_idx": idx, "gadget": gadget, "source": source}


NAMES_RULE = {"G1": "SHIELD", "G2": "SONAR", "G3": "DX3", "G4": "CLONE", "G5": "SONAR"}


def test_deux_sonar_dans_la_meme_equipe_en_meme_temps_effacent_la_lecture_la_moins_sure():
    lives = [_lv(1, 0, 0, 100), _lv(4, 0, 10, 80)]
    rows = [_row(1, 0, "G2", "lu"), _row(4, 0, "G5", "pale")]  # deux icônes différentes, le même gadget SONAR
    conflicts = L.apply_team_rule(rows, lives, NAMES_RULE)
    assert [c["gadget"] for c in conflicts] == ["SONAR"] and conflicts[0]["perdants"] == [(4, 0)] and conflicts[0]["gardee"] == (1, 0)
    assert rows[0]["gadget"] == "G2" and rows[1]["gadget"] is None


def test_a_egalite_de_source_les_deux_lectures_sont_effacees():
    rows = [_row(2, 0, "G1", "lu1"), _row(3, 0, "G1", "lu1")]
    conflicts = L.apply_team_rule(rows, [_lv(2, 0, 0, 50), _lv(3, 0, 5, 60)], NAMES_RULE)
    assert conflicts[0]["gardee"] is None and rows[0]["gadget"] is None and rows[1]["gadget"] is None


def test_pas_de_conflit_entre_deux_equipes_deux_vies_qui_ne_se_chevauchent_pas_ni_pour_le_dx3():
    # même SONAR dans les deux équipes : normal ; même joueur à deux vies : normal ; vies successives de deux coéquipiers : normal ; DX3 à plusieurs : permis
    rows = [_row(1, 0, "G2", "lu"), _row(5, 0, "G2", "lu"), _row(2, 0, "G2", "lu"), _row(3, 0, "G3", "lu"), _row(4, 0, "G3", "lu")]
    lives = [_lv(1, 0, 0, 30), _lv(5, 0, 0, 100), _lv(2, 0, 40, 90), _lv(3, 0, 0, 100), _lv(4, 0, 0, 100)]
    assert L.apply_team_rule(rows, lives, NAMES_RULE) == []
    assert all(r["gadget"] for r in rows)
