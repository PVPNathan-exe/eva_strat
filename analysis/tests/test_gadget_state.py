"""État du gadget (gadget_state.py) : classes de contraste, lissage, segments, lecture d'une barre d'équipe (images synthétiques), écriture idempotente, bilan par vie, kills de gadget."""

import sqlite3
from pathlib import Path

import cv2
import numpy as np

import gadget_state as G
import loadout
import timer
import weapons

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8")
BLUE = (255, 150, 30)  # bandeau vivant (couleur d'équipe, BGR)
GREY = (128, 128, 128)  # bandeau mort


def make_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'absente.mp4', 300, 30, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, 100, 200, 'The Cliff')")
    return conn


def team_crop(states, w=384, h=108):
    """Barre de 4 bandeaux : `states` = 4 valeurs parmi « ready » (icône noire), « used » (icône presque du ton du fond) et « dead » (fond gris, icône gris moyen)."""
    crop = np.zeros((h, w, 3), np.uint8)
    for i, state in enumerate(states):
        x0, x1 = int(i * w / 4), int((i + 1) * w / 4)
        crop[:, x0:x1] = GREY if state == "dead" else BLUE
        a, b, c, d = loadout.BOXES["gadget"]
        bx, bw = (i * loadout.BANNER_PITCH) * w, loadout.BANNER_WIDTH * w
        cx, cy = int(bx + (a + b) / 2 * bw), int((c + d) / 2 * h)
        color = {"ready": (0, 0, 0), "used": (230, 130, 20), "dead": (60, 60, 60)}[state]
        cv2.circle(crop, (cx, cy), 4, color, -1)
    return crop


# --- classes de contraste -------------------------------------------------------------------------------------------------------------------------------

def test_classes_de_contraste_selon_les_seuils_mesures():
    assert G.classify_reading(20.0, 30.0, 0.85) == "used"
    assert G.classify_reading(36.0, 55.0, 0.2) == "used"  # plus grand relief « utilisé » mesuré
    assert G.classify_reading(64.0, 100.0, 0.85) == "ready"  # plus petit relief « disponible » mesuré
    assert G.classify_reading(50.0, 80.0, 0.85) == "amb"  # entre les deux seuils
    assert G.classify_reading(30.0, 90.0, 0.85) == "amb"  # un seul des deux critères ne suffit pas
    assert G.classify_reading(80.0, 120.0, 0.0) == "dead"  # bandeau mort : l'icône n'indique rien, même si elle est sombre


def test_barre_synthetique_lue_bandeau_par_bandeau():
    m = G.measure_team(team_crop(["ready", "used", "dead", "ready"]))
    assert [G.classify_reading(*x) for x in m] == ["ready", "used", "dead", "ready"]


def test_ecran_noir_et_image_absente_ne_donnent_aucune_lecture():
    assert G.measure_team(np.zeros((108, 384, 3), np.uint8)) == [None] * 4
    assert G.measure_team(None) == [None] * 4


# --- lissage et segments ---------------------------------------------------------------------------------------------------------------------------------

def test_un_clignotement_isole_est_efface_mais_un_vrai_changement_reste():
    assert G.smooth(["ready"] * 5 + ["used"] + ["ready"] * 5) == ["ready"] * 11
    assert G.smooth(["used"] * 5 + ["dead"] * 2 + ["used"] * 5) == ["used"] * 12  # clignotement de bandeau de 1 s
    changed = G.smooth(["ready"] * 5 + ["used"] * 5)
    assert changed == ["ready"] * 5 + ["used"] * 5


def test_une_mort_longue_n_est_pas_comblee():
    classes = ["used"] * 4 + ["dead"] * 6 + ["used"] * 4  # 3 s
    assert G.smooth(classes) == classes


def test_un_contraste_ambigu_court_entre_deux_etats_est_partage():
    out = G.smooth(["ready"] * 4 + ["amb"] * 2 + ["used"] * 4)
    assert out == ["ready"] * 5 + ["used"] * 5


def reading(t, kind):
    p95, peak, fill = {"ready": (90.0, 130.0, 0.85), "used": (25.0, 40.0, 0.85), "dead": (70.0, 100.0, 0.0), "amb": (50.0, 80.0, 0.85)}[kind]
    return (t, p95, peak, fill)


def timeline(spec, step=0.5):
    """spec : [(état, durée en s)] -> lectures régulières."""
    out, t = [], 0.0
    for kind, d in spec:
        for _ in range(int(round(d / step))):
            out.append(reading(round(t, 2), kind))
            t += step
    return out


def test_segments_bornes_au_milieu_entre_deux_lectures():
    segs = G.build_segments(timeline([("ready", 10), ("used", 20), ("dead", 15), ("ready", 5)]))
    assert [(s["state"], s["t0"], s["t1"]) for s in segs] == [("ready", 0.0, 9.75), ("used", 9.75, 29.75), ("unknown", 29.75, 44.75), ("ready", 44.75, 49.75)]


def test_ambigu_puis_mort_font_un_seul_segment_inconnu():
    segs = G.build_segments(timeline([("ready", 5), ("amb", 4), ("dead", 6)]))
    assert [s["state"] for s in segs] == ["ready", "unknown"]


def test_lecture_illisible_compte_comme_inconnue():
    segs = G.build_segments([(0.0, None, None, None), (0.5, None, None, None)])
    assert [s["state"] for s in segs] == ["unknown"]
    assert G.build_segments([]) == []


# --- lecture de la vidéo (un seul passage, deux barres dans un recadrage) --------------------------------------------------------------------------------

def test_lecture_des_deux_barres_dans_un_seul_recadrage(monkeypatch):
    width, height = 1920, 1080
    zones = {"team_a_bar": {"x": 0.001, "y": 0.816, "w": 0.2, "h": 0.1}, "team_b_bar": {"x": 0.799, "y": 0.816, "w": 0.2, "h": 0.1}}
    ax, ay, aw, ah = timer.timer_box(zones["team_a_bar"], width, height)
    bx, by, bw, bh = timer.timer_box(zones["team_b_bar"], width, height)
    crops = {"team_a_bar": team_crop(["ready", "used", "dead", "ready"], aw, ah), "team_b_bar": team_crop(["used", "ready", "ready", "dead"], bw, bh)}
    calls = []

    def fake_iter(video, zone, w, h, step_s=1.0, t0=0.0, t1=None):
        calls.append((zone, t0, t1))
        ux, uy, uw, uh = timer.timer_box(zone, w, h)
        image = np.zeros((uh, uw, 3), np.uint8)
        image[ay - uy : ay - uy + ah, ax - ux : ax - ux + aw] = crops["team_a_bar"]
        image[by - uy : by - uy + bh, bx - ux : bx - ux + bw] = crops["team_b_bar"]
        yield t0, image
        yield t0 + step_s, image

    monkeypatch.setattr(timer, "iter_crops", fake_iter)
    out = G.read_measures("v.mp4", zones, width, height, 100.0, 110.0, step_s=0.5)
    assert len(calls) == 1  # un seul passage pour les deux équipes
    assert [r[0] for r in out[1]] == [0.0, 0.5]  # temps en secondes de game
    classes = {slot: G.classify_reading(*rows[0][1:]) for slot, rows in out.items()}
    assert classes == {1: "ready", 2: "used", 3: "dead", 4: "ready", 5: "used", 6: "ready", 7: "ready", 8: "dead"}


# --- écriture ---------------------------------------------------------------------------------------------------------------------------------------------

def fill_life(conn, slot, idx, t0, t1, ended="death", gadget="G14"):
    conn.execute("INSERT INTO lives (game_id, slot, idx, t0, t1, ended) VALUES (1, ?, ?, ?, ?, ?)", (slot, idx, t0, t1, ended))
    conn.execute("INSERT INTO life_loadouts (game_id, slot, life_idx, gadget) VALUES (1, ?, ?, ?)", (slot, idx, gadget))


def test_compute_ecrit_les_segments_avec_le_gadget_de_la_vie_et_reste_idempotent():
    conn = make_conn()
    fill_life(conn, 1, 0, 0.0, 29.75, gadget="G14")
    measures = {1: timeline([("ready", 10), ("used", 20), ("dead", 10)])}
    n = G.compute(conn, 1, measures=measures)
    rows = [dict(r) for r in conn.execute("SELECT slot, t0, t1, gadget, state FROM gadget_state ORDER BY t0")]
    assert n == 3 and [r["state"] for r in rows] == ["ready", "used", "unknown"]
    assert rows[0]["gadget"] == "G14" and rows[2]["gadget"] is None  # un segment inconnu n'a pas de gadget
    assert G.compute(conn, 1, measures=measures) == 3
    assert conn.execute("SELECT COUNT(*) FROM gadget_state").fetchone()[0] == 3
    assert conn.execute("SELECT revision FROM stats_meta WHERE module = 'gadget_state'").fetchone()[0] == G.REVISION


def test_sans_video_ni_cache_rien_n_est_efface(tmp_path, monkeypatch):
    monkeypatch.setenv("EVA_CACHE", str(tmp_path))
    conn = make_conn()
    G.compute(conn, 1, measures={1: timeline([("ready", 5)])})
    assert G.compute(conn, 1) == 0  # vidéo « absente.mp4 » introuvable
    assert conn.execute("SELECT COUNT(*) FROM gadget_state").fetchone()[0] == 1


def test_les_lectures_en_cache_evitent_de_relire_la_video(tmp_path, monkeypatch):
    monkeypatch.setenv("EVA_CACHE", str(tmp_path))
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x")
    conn = make_conn()
    conn.execute("UPDATE videos SET path = ?", (str(video),))
    calls = []
    monkeypatch.setattr(G, "read_measures", lambda *a, **k: calls.append(1) or {1: timeline([("ready", 5), ("used", 5)])})
    assert G.compute(conn, 1) == 2 and len(calls) == 1
    assert G.compute(conn, 1) == 2 and len(calls) == 1  # lu depuis le cache
    assert G.compute(conn, 1, refresh=True) == 2 and len(calls) == 2


# --- bilan par vie ----------------------------------------------------------------------------------------------------------------------------------------

def test_delais_de_recharge_et_valeur_par_defaut():
    segs = {1: [{"state": "ready", "t0": 0, "t1": 10}, {"state": "used", "t0": 10, "t1": 55}, {"state": "ready", "t0": 55, "t1": 70},
                {"state": "used", "t0": 70, "t1": 118}, {"state": "ready", "t0": 118, "t1": 130}, {"state": "used", "t0": 130, "t1": 140}]}
    assert G.cooldowns(segs) == [45, 48]  # le dernier « utilisé » n'est pas suivi d'un « disponible » : pas de délai
    assert G.cooldown_of(segs) == (G.DEFAULT_COOLDOWN_S, 2)  # moins de 3 cycles : valeur par défaut
    segs[1][-1:] = [{"state": "used", "t0": 130, "t1": 172}, {"state": "ready", "t0": 172, "t1": 180}]  # troisième cycle : 42 s
    assert G.cooldown_of(segs) == (45, 3)


def test_bilan_par_vie_utilisations_mort_avec_gadget_et_vie_illisible():
    conn = make_conn()
    fill_life(conn, 1, 0, 0.0, 29.75)  # utilise à 5 s, meurt gadget utilisé
    fill_life(conn, 1, 1, 50.0, 80.0)  # n'utilise jamais, meurt avec le gadget disponible
    fill_life(conn, 2, 0, 0.0, 130.0, ended="end")  # 130 s sans usage, fin de game
    fill_life(conn, 3, 0, 0.0, 20.0)  # bandeau illisible tout du long
    measures = {
        1: timeline([("ready", 5), ("used", 25), ("dead", 20), ("ready", 30)]),
        2: timeline([("ready", 130)]),
        3: timeline([("amb", 20)]),
    }
    G.compute(conn, 1, measures=measures)
    stats = {(r["slot"], r["idx"]): r for r in G.life_stats(conn, 1, cooldown_s=45.0)}
    a, b, c, d = stats[(1, 0)], stats[(1, 1)], stats[(2, 0)], stats[(3, 0)]
    assert (a["uses"], a["first_use_s"], a["unused_at_death"], a["readable"]) == (1, 4.75, 0, 1.0)
    assert (b["uses"], b["unused_at_death"], b["held_too_long"]) == (0, 1, False)
    assert (c["uses"], c["unused_at_death"], c["held_too_long"], c["max_ready_run_s"]) == (0, None, True, 129.75)  # fin de game : pas une mort
    assert (d["readable"], d["unused_at_death"], d["uses"]) == (0.0, None, 0)
    assert a["possible_uses"] == 1 and c["possible_uses"] == 3  # 1 + 130 // 45
    assert a["gadget"] == "G14"


def test_resume_compte_les_morts_lues_et_le_gadget_gardé():
    conn = make_conn()
    fill_life(conn, 1, 0, 0.0, 29.75)
    fill_life(conn, 1, 1, 50.0, 80.0)
    G.compute(conn, 1, measures={1: timeline([("ready", 5), ("used", 25), ("dead", 20), ("ready", 30)])})
    s = G.summary(conn, 1)
    assert (s["lives"], s["uses"], s["deaths_read"], s["unused_at_death"], s["cooldown_s"]) == (2, 1, 2, 1, G.DEFAULT_COOLDOWN_S)


# --- kills de gadget --------------------------------------------------------------------------------------------------------------------------------------

def test_un_kill_de_gadget_tombe_dans_un_segment_utilise_a_2_s_pres(monkeypatch):
    monkeypatch.setattr(weapons, "display_names", lambda folder=weapons.ICON_DIR: {"G5": "STICKY", "G10": "DX3", "G3": "SONAR"})
    conn = make_conn()  # games.start_s = 100 : les kills sont en temps de vidéo
    G.compute(conn, 1, measures={7: timeline([("ready", 10), ("used", 20), ("ready", 20)]), 8: timeline([("ready", 60)])})
    for victim, (t, killer, weapon) in enumerate(((115.0, 7, "G5"), (131.5, 7, "G10"), (140.0, 7, "G10"), (115.0, 8, "G5"), (115.0, 7, "G3"), (115.0, 7, None)), start=1):
        conn.execute("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon, kind) VALUES (1, ?, ?, ?, ?, 'kill')", (t, killer, victim, weapon))
    check = G.check_gadget_kills(conn, 1)
    # utilisé de 9,75 à 29,75 s de game (vidéo 109,75 à 129,75) : 115 dedans, 131,5 à 1,75 s après la fin (toléré), 140 trop tard ; le joueur 8 n'a rien utilisé ; sonar et arme ignorés
    assert (check["n"], check["hit"]) == (4, 2)
    assert {(m["slot"], m["state_at_kill"]) for m in check["misses"]} == {(7, "ready"), (8, "ready")}


def test_une_utilisation_coupee_par_des_trous_illisibles_ne_compte_qu_une_fois():
    seg = lambda t0, t1, state: {"t0": t0, "t1": t1, "state": state}
    # disponible, utilisé, inconnu, utilisé, inconnu, utilisé : une seule utilisation (cas du joueur 1 d'Atlantis, game 31 : 3 segments utilisé pour 1 utilisation)
    assert G.count_uses([seg(0, 8, "ready"), seg(8, 15, "used"), seg(15, 18, "unknown"), seg(18, 23, "used"), seg(23, 25, "unknown"), seg(25, 27, "used")]) == 1
    # deux recharges, deux utilisations
    assert G.count_uses([seg(0, 8, "ready"), seg(8, 15, "used"), seg(15, 55, "ready"), seg(55, 60, "used"), seg(60, 100, "ready")]) == 2
    # une vie qui commence déjà utilisée compte une utilisation ; un trou inconnu entre deux disponibles n'en crée pas
    assert G.count_uses([seg(0, 5, "used"), seg(5, 9, "unknown"), seg(9, 20, "ready")]) == 1
    assert G.count_uses([seg(0, 5, "ready"), seg(5, 9, "unknown"), seg(9, 20, "ready")]) == 0
    assert G.count_uses([]) == 0
