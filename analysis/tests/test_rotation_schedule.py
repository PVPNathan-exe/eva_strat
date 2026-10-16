"""Tests de rotation_schedule : calendrier en chrono, écart chrono et seconde de game, vote du point de chaque période, partie « ouverte », cartes sans calendrier."""

import json

import rotation_schedule as rs


def hud_of(rows, letters="ABC", step=1.0):
    """Fausse lecture du HUD : rows = liste (une par seconde) de la lettre allumée ou d'une chaîne de lettres allumées ('' : aucune)."""
    readings = [{k: {"lit": 1.0 if k in (r or "") else 0.0} for k in letters} for r in rows]
    best = [(r[0] if r else None) for r in rows]
    return {"times": [i * step for i in range(len(rows))], "letters": list(letters), "readings": readings, "best": best, "mode": "active_only"}


def plan(*parts):
    """Suite de secondes à partir de (lettres allumées, nombre de secondes)."""
    out = []
    for lit, n in parts:
        out += [lit] * n
    return out


# ---------------------------------------------------------------- fichier du calendrier

def test_parse_chrono():
    assert rs.parse_chrono("11:25") == 685 and rs.parse_chrono("0:55") == 55


def test_outlaw_a_huit_changements_du_chrono_dans_l_ordre():
    cal = rs.load_calendar("Outlaw")
    assert [r for r, _ in cal["changes"]] == [685, 595, 505, 415, 325, 235, 145, 55]
    assert cal["open_tail"] is False


def test_atlantis_est_mesure_et_garde_une_suite_ouverte():
    cal = rs.load_calendar("Atlantis")
    assert [r for r, _ in cal["changes"]] == [595, 505, 445, 385, 325, 265]  # 90 s puis 60 s
    assert cal["open_tail"] is True and all("mesuré" in s for _, s in cal["changes"])


def test_helios_station_et_les_cartes_sans_calendrier_n_ont_rien():
    assert rs.load_calendar("Helios Station") is None  # aucun changement de point
    assert rs.load_calendar("Engine") is None
    assert rs.load_calendar("Polaris") is None


def test_engine_et_helios_station_sont_explicitement_sans_changement_de_point():
    assert rs.has_no_change("Engine") and rs.has_no_change("Helios Station")
    assert not any(rs.has_no_change(m) for m in ("Outlaw", "Atlantis", "Polaris", "Carte inconnue"))
    data = json.loads(rs.SCHEDULE_FILE.read_text(encoding="utf-8"))
    for name in ("Engine", "Helios Station"):
        assert data[name]["none"] is True and data[name]["changements"] == []


def test_le_fichier_est_du_json_valide_avec_des_sources():
    data = json.loads(rs.SCHEDULE_FILE.read_text(encoding="utf-8"))
    for name, entry in data.items():
        if name.startswith("_"):
            continue
        assert all(c.get("source") for c in entry["changements"]) and (entry["changements"] or entry.get("source"))


# ---------------------------------------------------------------- chrono

def chrono_reads(start=720, n=46, first_hold=2, offset=1):
    """Chrono d'une game dont le chrono reste `first_hold` secondes à sa valeur de départ puis descend : seconde + chrono = start + offset."""
    return [(float(t), start if t < first_hold else start + offset - t) for t in range(n)]


def test_ecart_entre_seconde_de_game_et_chrono():
    assert rs.chrono_offset(chrono_reads()) == 721.0
    assert rs.chrono_offset(chrono_reads(offset=3, first_hold=4)) == 723.0  # début plus tôt dans la vidéo YouTube


def test_une_lecture_fausse_ou_manquante_ne_change_pas_l_ecart():
    reads = chrono_reads()
    reads[10] = (10.0, 650)
    reads[11] = (11.0, None)
    assert rs.chrono_offset(reads) == 721.0


def test_chrono_illisible_ou_incoherent_donne_none():
    assert rs.chrono_offset([]) is None
    assert rs.chrono_offset([(float(t), None) for t in range(40)]) is None
    assert rs.chrono_offset([(float(t), 700 - (t * 7) % 50) for t in range(40)]) is None  # ne descend pas d'une seconde par seconde


def test_instants_en_secondes_de_game_et_seulement_ceux_de_la_game():
    cal = rs.load_calendar("Outlaw")
    got = rs.change_times(cal, 721.0, 300.0)
    assert [(r, t) for r, t, _ in got] == [(685, 36.0), (595, 126.0), (505, 216.0)]  # 415 -> 306 > 300


# ---------------------------------------------------------------- vote

def lit_of(rows, letters="ABCD"):
    return {k: [k in (r or "") for r in rows] for k in letters}


def test_le_point_le_plus_allume_de_la_periode_l_emporte():
    rows = plan(("", 40), ("C", 90))
    v = rs.vote_period(lit_of(rows), [float(i) for i in range(len(rows))], 36.0, 126.0)
    assert v["point"] == "C" and v["share"] > 0.9 and v["window"] == 88


def test_un_reflet_isole_ne_fait_pas_un_point():
    rows = plan(("", 40), ("C", 20), ("CE", 1), ("C", 30), ("", 5))
    v = rs.vote_period(lit_of(rows, "CE"), [float(i) for i in range(len(rows))], 36.0, 126.0)
    assert v["point"] == "C"
    only_noise = plan(("", 36), ("E", 2), ("", 80))
    assert rs.vote_period(lit_of(only_noise, "CE"), [float(i) for i in range(len(only_noise))], 36.0, 126.0)["point"] is None


def test_le_point_d_avant_reste_allume_et_le_nouveau_l_emporte():
    # Outlaw, 3:55 : D reste allumé, B s'allume (deux points en même temps)
    rows = plan(("D", 100), ("DB", 50))
    times = [float(i) for i in range(len(rows))]
    v = rs.vote_period(lit_of(rows), times, 100.0, 150.0, prev="D")
    assert v["point"] == "B"


def test_le_point_d_avant_seul_et_jamais_eteint_n_est_pas_un_nouveau_point():
    rows = plan(("D", 150))
    v = rs.vote_period(lit_of(rows), [float(i) for i in range(150)], 100.0, 150.0, prev="D")
    assert v["point"] is None


def test_le_meme_point_qui_s_eteint_puis_se_rallume_est_garde():
    rows = plan(("D", 98), ("", 2), ("D", 50))
    v = rs.vote_period(lit_of(rows), [float(i) for i in range(150)], 100.0, 150.0, prev="D")
    assert v["point"] == "D"


# ---------------------------------------------------------------- calendrier appliqué

def test_les_bornes_viennent_du_calendrier_et_le_hud_donne_l_identite():
    # Outlaw, off 721 : C allumé 1 s après 36, B après 126, A après 216 (le HUD a 1 s de retard sur le chrono)
    rows = plan(("", 37), ("C", 90), ("B", 90), ("A", 60))
    res = rs.active_from_calendar(rs.load_calendar("Outlaw"), 721.0, hud_of(rows, "ABCDE"))
    assert [(s["point"], s["t0"], s["t1"], s["source"]) for s in res["segments"]] == [("C", 36.0, 126.0, "schedule"), ("B", 126.0, 216.0, "schedule"), ("A", 216.0, 277.0, "schedule")]
    assert res["unread"] == [] and [p["restant"] for p in res["periods"]] == [685, 595, 505]


def test_une_periode_sans_point_lu_n_a_pas_de_ligne_et_est_signalee():
    rows = plan(("", 37), ("C", 90), ("", 90), ("A", 90))
    res = rs.active_from_calendar(rs.load_calendar("Outlaw"), 721.0, hud_of(rows, "ABCDE"))
    assert [(s["point"], s["t0"]) for s in res["segments"]] == [("C", 36.0), ("A", 216.0)]
    assert res["unread"] == [595]


def test_un_changement_manque_par_le_hud_est_comble_par_le_calendrier():
    # le HUD ne montre jamais le retour à B (lettre blanche noyée) mais montre A puis B : 3 périodes, B lue à 6:55
    rows = plan(("", 37), ("B", 90), ("A", 90), ("B", 90))
    res = rs.active_from_calendar(rs.load_calendar("Outlaw"), 721.0, hud_of(rows, "ABCDE"))
    assert [s["point"] for s in res["segments"]] == ["B", "A", "B"] and [s["t0"] for s in res["segments"]] == [36.0, 126.0, 216.0]


def test_atlantis_suite_ouverte_prise_au_hud_apres_le_dernier_instant_connu():
    # off 601 : changements à 6, 96, 156, 216, 276, 336 ; au-delà, le HUD seul (ici B jusqu'à 400 puis C)
    rows = plan(("", 7), ("A", 90), ("B", 60), ("A", 60), ("C", 60), ("B", 60), ("A", 64), ("B", 60))
    res = rs.active_from_calendar(rs.load_calendar("Atlantis"), 601.0, hud_of(rows, "ABC"))
    assert [(s["point"], s["t0"]) for s in res["segments"]] == [("A", 6.0), ("B", 96.0), ("A", 156.0), ("C", 216.0), ("B", 276.0), ("A", 336.0), ("B", 400.0)]
    assert res["tail"] == 2 and res["segments"][-1]["t1"] == 461.0


def test_game_finie_avant_les_derniers_instants_pas_de_suite_ouverte():
    rows = plan(("", 7), ("A", 90), ("C", 60), ("B", 57))  # 214 s : le dernier instant connu (336) est hors de la game
    res = rs.active_from_calendar(rs.load_calendar("Atlantis"), 601.0, hud_of(rows, "ABC"))
    assert [(s["point"], s["t0"], s["t1"]) for s in res["segments"]] == [("A", 6.0, 96.0), ("C", 96.0, 156.0), ("B", 156.0, 214.0)]
    assert res["tail"] == 0


def test_usable_demande_un_calendrier_un_chrono_et_un_hud_a_un_seul_point():
    hud = hud_of(plan(("A", 10)))
    assert rs.usable("Atlantis", hud, 601.0) is not None
    assert rs.usable("Atlantis", hud, None) is None  # chrono illisible : repli sur le HUD seul
    assert rs.usable("Polaris", hud, 601.0) is None  # pas de calendrier
    assert rs.usable("Atlantis", dict(hud, mode="always"), 601.0) is None  # Engine : les trois points sont toujours allumés
    assert rs.usable("Atlantis", None, 601.0) is None
