"""Tests de map_warp : stations du plan retrouvées et appariées par la structure, maillage minimap vers plan d'Artefact (repères exacts, aucun triangle retourné, contrôles gardés à part)."""

import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent.parent))
import map_warp as mw  # noqa: E402

WARP = json.loads(mw.OUT.read_text(encoding="utf-8"))["Artefact"]


def test_les_20_disques_du_plan_sont_trouves_et_ranges_en_six_rangees():
    plan = cv2.imread(str(mw.PLANS / "Artefact.png"))
    discs = mw.plan_station_discs(plan)
    assert len(discs) == 20
    rows = mw.rows_of(discs, mw.ROW_SIZES)
    assert [len(r) for r in rows] == mw.ROW_SIZES
    for r in rows:  # chaque rangée est triée de gauche à droite
        assert list(discs[r, 0]) == sorted(discs[r, 0])


def test_appariement_par_la_structure_ignore_l_ordre_des_points_et_l_echelle():
    rng = np.random.default_rng(3)
    rows_y = [0.1, 0.3, 0.5, 0.65, 0.85, 0.95]
    xs = [[0.2, 0.4, 0.6, 0.8], [0.2, 0.4, 0.6, 0.8], [0.05, 0.95], [0.2, 0.4, 0.6, 0.8], [0.2, 0.4, 0.6, 0.8], [0.4, 0.6]]
    mini = np.array([[x, y] for y, row in zip(rows_y, xs) for x in row])
    plan = mini * [2.0, 3.0] + [0.1, 0.2]  # même structure, autre échelle
    shuffle = rng.permutation(len(plan))
    pairs = mw.match_stations(mini, plan[shuffle])
    for i, j in pairs:
        assert np.allclose(plan[shuffle][j], mini[i] * [2.0, 3.0] + [0.1, 0.2])
    assert len(pairs) == 20


def test_rangees_de_taille_inattendue_refusees():
    pts = np.array([[0.1 * i, 0.1 * (i % 3)] for i in range(10)])
    try:
        mw.rows_of(pts, mw.ROW_SIZES)
    except ValueError as e:
        assert "rangées" in str(e)
    else:
        raise AssertionError("des rangées de taille inattendue doivent être refusées")


def test_chaque_repere_tombe_exactement_sur_son_repere_du_plan():
    for p in WARP["points"]:
        fx, fy = mw.to_plan(WARP, *p["mini"])
        assert abs(fx - p["plan"][0]) < 1e-6 and abs(fy - p["plan"][1]) < 1e-6


def test_aucun_triangle_retourne_et_le_fichier_est_celui_que_le_script_reconstruit():
    mini = [p["mini"] for p in WARP["points"]]
    plan = [p["plan"] for p in WARP["points"]]
    assert mw.orientation_ok(mini, plan, WARP["triangles"])
    entry, report = mw.build("Artefact")
    assert json.loads(json.dumps(entry)) == WARP  # reproductible : le JSON versionné vient de map_warp.py
    assert len(WARP["points"]) == len(entry["points"]) and len(WARP["triangles"]) > 400


def test_controles_gardes_a_part_et_validation_croisee():
    _, report = mw.build("Artefact")
    gaps = [c["ecart_maillage_px"] for c in report["checks"]]
    assert np.median(gaps) < 8 and max(gaps) < 25  # pixels du plan (850 x 670) ; les quatre coins de départ tout près des stations sont les pires
    loo = [v for k, v in report["leave_one_out"].items() if not k.startswith("st2.")]
    assert max(loo) < 15 and np.median(loo) < 8
    # le cadre affine actuel est très loin des blocs du haut et du bas (c'est la raison du maillage)
    far = [c["ecart_cadre_actuel_px"] for c in report["checks"] if "fente" in c["nom"]]
    assert min(far) > 80


def test_les_blocs_du_haut_et_du_bas_sont_au_bon_endroit_du_plan():
    # centre du bloc du haut de la minimap : dans le bloc du haut du plan (y sous 80 px), celui du bas : sous 597 px
    assert mw.to_plan(WARP, 0.5, 0.12)[1] * 670 < 80
    assert mw.to_plan(WARP, 0.5, 0.88)[1] * 670 > 597


def test_les_lectures_des_trois_blocs_tombent_dans_le_praticable_du_plan_avec_le_maillage():
    plan = cv2.imread(str(mw.PLANS / "Artefact.png"))
    wall, walk = mw.plan_walkable(plan)
    # un point par bloc de la minimap (haut, milieu, bas), loin des murs
    for x, y in [(0.3, 0.12), (0.5, 0.52), (0.3, 0.88), (0.7, 0.12), (0.7, 0.88)]:
        fx, fy = mw.to_plan(WARP, x, y)
        assert walk[int(fy * 670), int(fx * 850)], (x, y)


def test_triangulation_de_quatre_points_et_hors_maillage_loin_affine_global():
    pts = np.array([[0, 0], [10, 0], [0, 10], [10, 10]], float)
    tris = mw.triangulate(pts)
    assert len(tris) == 2
    entry = {"points": [{"mini": [0.0, 0.0], "plan": [0.0, 0.0]}, {"mini": [0.1, 0.0], "plan": [0.2, 0.0]}, {"mini": [0.0, 0.1], "plan": [0.0, 0.3]}, {"mini": [0.1, 0.1], "plan": [0.2, 0.3]}], "triangles": [list(t) for t in tris]}
    assert np.allclose(mw.to_plan(entry, 0.05, 0.05), (0.1, 0.15))  # dedans
    assert np.allclose(mw.to_plan(entry, 0.12, 0.05), (0.24, 0.15))  # tout près du bord : prolongé
    assert np.allclose(mw.to_plan(entry, 0.9, 0.9), (1.8, 2.7))  # loin : affine global (même ici, la transformation est affine)
