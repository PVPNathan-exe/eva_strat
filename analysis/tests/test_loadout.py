"""Lecture des icônes d'équipement sur les bandeaux (loadout.py) : géométrie des cases, arme tenue par comparaison des deux cases, armes fines."""

import cv2
import numpy as np

import loadout
import names

H, W = 104, 594  # recadrage d'une équipe (3 % de l'écran en hauteur, 31 % en largeur sur une vidéo 1920 x 1080)


def blank(value=200):
    return np.full((H, W, 3), value, np.uint8)


def draw(crop, index, kind, x0f=0.1, x1f=0.9, y0f=0.33, y1f=0.43, value=0):
    """Rectangle (arme synthétique) dans la case `kind` du bandeau `index`, placé avec la même géométrie que loadout.box_piece."""
    a, b, _c, _d = loadout.BOXES[kind]
    left = (loadout.BANNER_OFFSET + index * loadout.BANNER_PITCH) * W
    bw = loadout.BANNER_WIDTH * W
    xa, xb = left + (a + (b - a) * x0f) * bw, left + (a + (b - a) * x1f) * bw
    cv2.rectangle(crop, (int(xa), int(y0f * H)), (int(xb), int(y1f * H)), (value, value, value), -1)
    return crop


def test_la_case_du_quatrieme_bandeau_suit_le_pas_reel_des_bandeaux():
    crop = draw(blank(), 3, "arme1")
    piece = loadout.box_piece(crop, 3, "arme1")
    assert (piece < 100).any() and loadout._shape(piece).sum() > 100
    # la division en quatre parts égales (ancienne méthode) tombait 4 pixels trop à gauche pour le bandeau 4 : la forme y était coupée
    bw_old = W / 4
    a, b, c, d = (0.30, 0.54, 0.29, 0.52)
    old = crop[int(c * H) : int(d * H), int(3 * bw_old + a * bw_old) : int(3 * bw_old + b * bw_old)]
    assert loadout._shape(old).sum() < loadout._shape(piece).sum()


def test_les_trois_cases_ne_se_chevauchent_pas_et_restent_dans_le_bandeau():
    for kind_a, kind_b in (("arme1", "arme2"), ("arme2", "gadget")):
        assert loadout.BOXES[kind_a][1] <= loadout.BOXES[kind_b][0]
    assert all(0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1 for x0, x1, y0, y1 in loadout.BOXES.values())
    for index in range(4):  # le dernier bandeau finit dans le recadrage (à un pixel près)
        assert (loadout.BANNER_OFFSET + index * loadout.BANNER_PITCH + loadout.BANNER_WIDTH * loadout.BOXES["gadget"][1]) * W <= W + 1


def row_of(held_value, other_value, held="arme1", thin=False):
    """Ligne icons_of_banners(tones=True) d'un bandeau synthétique : une arme tenue (noire) et une rangée (pâle)."""
    crop = blank()
    other = "arme2" if held == "arme1" else "arme1"
    draw(crop, 0, held, 0.1, 0.9, 0.38 if thin else 0.33, 0.42 if thin else 0.43, value=held_value)
    draw(crop, 0, other, 0.1, 0.9, 0.38 if thin else 0.33, 0.42 if thin else 0.43, value=other_value)
    return loadout.icons_of_banners(crop, n=4, tones=True)[0]


def test_l_arme_tenue_est_la_case_la_plus_sombre():
    row = row_of(0, 165, held="arme2")
    kind, shape, tone = loadout.read_held(row)
    assert kind == "arme2" and shape.any() and np.percentile(tone, 95) > 100


def test_une_arme_fine_tenue_de_relief_modeste_est_acceptee_mais_pas_l_ancien_seuil_absolu():
    row = row_of(140, 170, held="arme1", thin=True)  # relief 60 contre 30 : pistolet fin
    tone = row["arme1"][1]
    assert 55 <= np.percentile(tone, 95) < loadout.HELD_TONE
    assert loadout.read_held(row)[0] == "arme1"
    assert not loadout.usable_weapon_read(*row["arme1"])  # l'ancien test absolu (90) la refusait : 48 % des bandeaux étaient perdus


def test_deux_armes_rangees_ou_trop_proches_ne_donnent_pas_de_tenue():
    assert loadout.read_held(row_of(170, 172)) is None  # aucune n'est tenue (joueur mort, changement d'arme)
    assert loadout.read_held(row_of(130, 140)) is None  # reliefs 70 et 60 : écart de 10 sous les 20 requis
    assert loadout.read_held(row_of(120, 150)) is not None  # reliefs 80 et 50 : écart de 30, tenue nette


def test_une_arme_qui_touche_le_bas_de_la_case_n_est_pas_lue():
    crop = blank()
    draw(crop, 1, "arme1", 0.1, 0.9, 0.33, 0.505, value=0)  # dépasse en bas de la case : coupée
    row = loadout.icons_of_banners(crop, tones=True)[1]
    assert loadout.read_held(row) is None


def test_usable_shape_refuse_vide_trop_petit_ou_trop_haut():
    assert not loadout.usable_shape(np.zeros((24, 34), np.uint8))
    small = np.zeros((24, 34), np.uint8)
    small[10:12, 10:15] = 1
    assert not loadout.usable_shape(small)
    tall = np.zeros((24, 34), np.uint8)
    tall[6:18, 12:20] = 1  # plus haute que longue
    assert not loadout.usable_shape(tall)
    ok = np.zeros((24, 34), np.uint8)
    ok[8:16, 4:30] = 1
    assert loadout.usable_shape(ok)


def test_identify_pale_ignore_une_forme_vide(tmp_path):
    assert loadout.identify_pale(np.zeros((24, 34), np.uint8), np.zeros((24, 34), np.uint8), tmp_path) is None


def test_held_weapon_lit_la_bonne_case_du_quatrieme_bandeau(monkeypatch):
    crop = blank()
    draw(crop, 3, "arme2", 0.1, 0.9, 0.34, 0.44, value=0)  # arme 2 tenue (noire), arme 1 absente
    draw(crop, 3, "arme1", 0.1, 0.9, 0.34, 0.44, value=170)
    monkeypatch.setattr(names, "_grab", lambda video, t, zone, width, height: crop)
    zones = {"team_a_bar": {"x": 0, "y": 0, "w": 1, "h": 1}, "team_b_bar": {"x": 0, "y": 0, "w": 1, "h": 1}}
    assert loadout.held_weapon("v.mp4", zones, 1920, 1080, 10.0, 4) == "arme2"
    assert loadout.held_weapon("v.mp4", zones, 1920, 1080, 10.0, 8) == "arme2"  # même géométrie pour l'équipe B


def test_held_weapon_ne_tranche_pas_quand_les_deux_armes_sont_pales(monkeypatch):
    crop = blank()
    draw(crop, 0, "arme1", value=170)
    draw(crop, 0, "arme2", value=175)
    monkeypatch.setattr(names, "_grab", lambda video, t, zone, width, height: crop)
    zones = {"team_a_bar": {"x": 0, "y": 0, "w": 1, "h": 1}, "team_b_bar": {"x": 0, "y": 0, "w": 1, "h": 1}}
    assert loadout.held_weapon("v.mp4", zones, 1920, 1080, 10.0, 1) is None


def test_banner_crop_a_la_largeur_d_un_bandeau():
    crop = blank()
    assert abs(loadout.banner_crop(crop, 0).shape[1] - loadout.BANNER_WIDTH * W) <= 1
    assert abs(loadout.banner_crop(crop, 3).shape[1] - loadout.BANNER_WIDTH * W) <= 3  # le dernier peut perdre un pixel au bord du recadrage
