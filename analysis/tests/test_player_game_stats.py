"""Bilan par joueur (player_game_stats.py) : parties synthétiques en mémoire (vitesses, tyroliennes et sauts, délais de gadget par gadget, kills, morts, duels, idempotence)."""

import sqlite3
from pathlib import Path

import db
import episode_common as ec
import player_game_stats as P
import weapons

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8")
START = 100.0  # début de la game dans la vidéo
STEP = 0.1
NAMES = {"G5": "STICKY", "G10": "DX3", "G12": "DX3", "G7": "SONAR", "G8": "SHIELD"}
M_PER_X = ec.ARENA_M[0]  # un déplacement de 1/31 en x fait 1 m


def make_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'v.mp4', 400, 30, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, ?, ?, 'Polaris')", (START, START + 100))
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (2, 1, ?, ?, 'Polaris')", (START, START + 100))
    return conn


def walk(conn, slot, t0, t1, speed_ms, x0=0.2, y=0.5, game=1, alive=1):
    """Lignes de samples toutes les 0,1 s : marche en x à `speed_ms` m/s."""
    n = int(round((t1 - t0) / STEP))
    for i in range(n + 1):
        t = t0 + i * STEP
        conn.execute("INSERT INTO samples (game_id, frame, t, slot, team, x, y, alive) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     (game, int(t * 100) + slot * 100000, START + t, slot, ec.team_of(slot), x0 + speed_ms * (t - t0) / M_PER_X, y, alive))


def rows_of(speed_ms, seconds=10, x0=0.2):
    return [(round(i * STEP, 3), x0 + speed_ms * i * STEP / M_PER_X, 0.5) for i in range(int(seconds / STEP) + 1)]


# ---------------------------------------------------------------- vitesse

def test_la_vitesse_d_une_marche_reguliere_est_la_vitesse_vraie():
    pairs, excl = P.speed_pairs(rows_of(1.5))
    assert pairs and excl == {"tp": 0, "jump": 0}
    assert all(abs(d / dt - 1.5) < 1e-6 for dt, d in pairs)
    assert all(abs(dt - 0.5) < 1e-6 for dt, _d in pairs)


def test_la_distance_n_est_pas_comptee_cinq_fois():
    dist, mean, p98, vmax = P.movement(rows_of(1.5, seconds=10))
    assert abs(dist - 15.0) < 0.6  # 1,5 m/s pendant 10 s (les 0,5 dernières secondes n'ont pas de paire)
    assert abs(mean - 1.5) < 1e-3 and abs(p98 - 1.5) < 1e-3 and abs(vmax - 1.5) < 1e-3


def test_un_trou_de_lecture_ne_donne_pas_de_vitesse():
    rows = [r for r in rows_of(1.5, seconds=10) if not 3.0 < r[0] < 6.0]  # 3 s sans ligne
    pairs, _ = P.speed_pairs(rows)
    assert all(abs(dt - 0.5) < 0.06 for dt, _d in pairs)
    assert len(pairs) < len(rows_of(1.5, seconds=10)) - 20


def test_une_tyrolienne_est_exclue():
    a, b = db.teleports_for("Polaris")[0]
    rows = [(0.0, a[0], a[1]), (0.1, a[0], a[1]), (0.5, b[0], b[1]), (0.6, b[0], b[1])]
    pairs, excl = P.speed_pairs(rows, [(a, b)])
    assert pairs == [] and excl["tp"] >= 1


def test_un_saut_est_exclu_mais_pas_une_course_rapide():
    rows = [(0.0, 0.2, 0.5), (0.5, 0.2 + 10 / M_PER_X, 0.5), (1.0, 0.2 + 10 / M_PER_X, 0.5)]  # 10 m en 0,5 s = 20 m/s
    pairs, excl = P.speed_pairs(rows)
    assert excl["jump"] == 1 and len(pairs) == 1 and pairs[0][1] == 0.0
    fast, excl2 = P.speed_pairs(rows_of(6.0))  # 6 m/s : improbable mais sous le plafond de 14 m/s, gardé (c'est le 98e centile qui le tempère)
    assert excl2["jump"] == 0 and fast


def test_le_maximum_brut_depasse_le_98e_centile_quand_un_pic_existe():
    rows = rows_of(1.5, seconds=30)
    t, x, y = rows[150]
    rows[150] = (t, x + 4 / M_PER_X, y)  # une lecture fausse de 4 m
    _dist, _mean, p98, vmax = P.movement(rows)
    assert vmax > 6 and p98 < 2.0


# ---------------------------------------------------------------- délais de gadget

def test_un_gadget_a_moins_de_3_cycles_n_a_pas_de_delai():
    assert P.delay_of([]) is None and P.delay_of([45.0, 45.0]) is None
    assert P.delay_of([45.0, 44.5, 45.5]) == 45.0


def test_des_cycles_dispersés_n_etablissent_pas_de_delai():
    assert P.delay_of([7.0, 25.0, 45.0]) is None  # médiane 25, un seul cycle proche
    assert P.delay_of([4.0, 40.0, 40.0, 40.0, 9.0]) == 40.0


def add_cycles(conn, game, slot, gadget, delays, t=5.0):
    """Segments prêt, utilisé (durée `delay`), prêt, répétés."""
    conn.execute("INSERT INTO gadget_state (game_id, slot, t0, t1, gadget, state) VALUES (?, ?, ?, ?, ?, 'ready')", (game, slot, t, t + 5, gadget))
    t += 5
    for d in delays:
        conn.execute("INSERT INTO gadget_state (game_id, slot, t0, t1, gadget, state) VALUES (?, ?, ?, ?, ?, 'used')", (game, slot, t, t + d, gadget))
        conn.execute("INSERT INTO gadget_state (game_id, slot, t0, t1, gadget, state) VALUES (?, ?, ?, ?, ?, 'ready')", (game, slot, t + d, t + d + 5, gadget))
        t += d + 5
    return t


def test_les_cycles_sont_groupes_par_nom_de_gadget_sur_toutes_les_games(monkeypatch):
    monkeypatch.setattr(weapons, "display_names", lambda folder=weapons.ICON_DIR: NAMES)
    conn = make_conn()
    add_cycles(conn, 1, 1, "G10", [45.0, 45.0])  # DX3 sous deux icônes différentes, deux games différentes
    add_cycles(conn, 2, 2, "G12", [45.0])
    add_cycles(conn, 1, 3, "G5", [20.0, 20.0, 20.0])
    add_cycles(conn, 1, 4, "G7", [10.0, 45.0])  # deux cycles seulement
    assert P.gadget_delays(conn) == {"DX3": 45.0, "STICKY": 20.0, "SONAR": None, "SHIELD": 45.0}  # SHIELD : délai donné par l'utilisateur, sans cycle mesuré


def test_une_mort_coupe_le_cycle(monkeypatch):
    monkeypatch.setattr(weapons, "display_names", lambda folder=weapons.ICON_DIR: NAMES)
    conn = make_conn()
    conn.execute("INSERT INTO gadget_state (game_id, slot, t0, t1, gadget, state) VALUES (1, 1, 0, 5, 'G5', 'ready')")
    conn.execute("INSERT INTO gadget_state (game_id, slot, t0, t1, gadget, state) VALUES (1, 1, 5, 12, 'G5', 'used')")
    conn.execute("INSERT INTO gadget_state (game_id, slot, t0, t1, gadget, state) VALUES (1, 1, 12, 30, NULL, 'unknown')")
    conn.execute("INSERT INTO gadget_state (game_id, slot, t0, t1, gadget, state) VALUES (1, 1, 30, 40, 'G5', 'ready')")
    assert P.gadget_cycles(conn) == {}


# ---------------------------------------------------------------- bilan complet

def build_game(conn):
    """Joueur 1 (A) : deux vies (mort à 40 s tué par le 5, gadget STICKY encore disponible) ; joueur 5 (B) : une vie de 100 s tué une fois le 1 ; duel gagné par 1."""
    walk(conn, 1, 0.0, 40.0, 1.5)
    walk(conn, 1, 55.0, 100.0, 1.0, x0=0.5)
    walk(conn, 5, 0.0, 100.0, 0.5, x0=0.3, y=0.7)
    conn.execute("INSERT INTO lives (game_id, slot, idx, t0, t1, ended, killer_slot, kill_kind) VALUES (1, 1, 0, 0, 40, 'death', 5, 'kill')")
    conn.execute("INSERT INTO lives (game_id, slot, idx, t0, t1, ended) VALUES (1, 1, 1, 55, 100, 'end')")
    conn.execute("INSERT INTO lives (game_id, slot, idx, t0, t1, ended) VALUES (1, 5, 0, 0, 100, 'end')")
    conn.execute("INSERT INTO lives (game_id, slot, idx, t0, t1, ended, killer_slot, kill_kind) VALUES (1, 6, 0, 0, 30, 'death', 1, 'kill')")
    conn.execute("INSERT INTO lives (game_id, slot, idx, t0, t1, ended, killer_slot, kill_kind) VALUES (1, 6, 1, 45, 60, 'death', NULL, 'suicide')")
    conn.execute("INSERT INTO lives (game_id, slot, idx, t0, t1, ended, killer_slot, kill_kind) VALUES (1, 7, 0, 0, 20, 'death', 8, 'kill')")  # coéquipier : pas un kill
    walk(conn, 6, 0.0, 30.0, 0.5, x0=0.4)
    conn.execute("INSERT INTO loadouts (game_id, slot, gadget) VALUES (1, 1, 'G5')")
    conn.execute("INSERT INTO loadouts (game_id, slot, gadget) VALUES (1, 5, 'G7')")
    conn.execute("INSERT INTO duels (game_id, t0, t1, slot_a, slot_b, winner_slot, outcome) VALUES (1, 30, 40, 1, 5, 5, 'kill')")
    conn.execute("INSERT INTO duels (game_id, t0, t1, slot_a, slot_b, winner_slot, outcome) VALUES (1, 60, 62, 1, 5, 1, 'kill')")
    conn.execute("INSERT INTO duels (game_id, t0, t1, slot_a, slot_b, winner_slot, outcome) VALUES (1, 70, 72, 2, 6, NULL, 'trade')")
    conn.commit()


def stat(conn, slot):
    return dict(conn.execute("SELECT * FROM player_game_stats WHERE game_id = 1 AND slot = ?", (slot,)).fetchone())


def test_kills_morts_duels_et_temps_vivant(monkeypatch):
    monkeypatch.setattr(weapons, "display_names", lambda folder=weapons.ICON_DIR: NAMES)
    conn = make_conn()
    build_game(conn)
    assert P.compute(conn, 1) == 3  # joueurs 1, 5 et 6 (les seuls avec des lignes)
    s1, s5, s6 = stat(conn, 1), stat(conn, 5), stat(conn, 6)
    assert (s1["kills"], s1["deaths"]) == (1, 1)  # tué par le 5, a tué le 6
    assert (s5["kills"], s5["deaths"]) == (1, 0)
    assert (s6["kills"], s6["deaths"]) == (0, 2)  # le suicide compte comme une mort, pas comme un kill
    assert (s1["duels_won"], s1["duels_lost"], s1["duels_other"]) == (1, 1, 0)
    assert (s5["duels_won"], s5["duels_lost"], s5["duels_other"]) == (1, 1, 0)
    assert abs(s1["alive_s"] - (401 + 451) * STEP) < 1e-6  # 852 lignes à 0,1 s
    assert abs(s1["v_mean"] - (1.5 * 400 + 1.0 * 450) / 850) < 0.05  # moyenne pondérée par le temps
    assert abs(s5["v_mean"] - 0.5) < 0.01 and abs(s5["v_p98"] - 0.5) < 0.01
    assert abs(s5["dist_m"] - 50.0) < 1.0


def test_sans_lecture_de_gadget_les_champs_gadget_sont_nuls(monkeypatch):
    monkeypatch.setattr(weapons, "display_names", lambda folder=weapons.ICON_DIR: NAMES)
    conn = make_conn()
    build_game(conn)
    P.compute(conn, 1)
    s = stat(conn, 1)
    assert s["gadget_uses"] is None and s["gadget_unused_at_death"] is None and s["gadget_possible"] is None


def test_gadget_utilisations_morts_avec_gadget_et_possibles(monkeypatch):
    monkeypatch.setattr(weapons, "display_names", lambda folder=weapons.ICON_DIR: NAMES)
    conn = make_conn()
    build_game(conn)
    add_cycles(conn, 2, 2, "G5", [20.0, 20.0, 20.0])  # une autre game établit le délai du STICKY à 20 s
    # joueur 1 de la game 1 : prêt à la mort (40 s), une utilisation dans la seconde vie
    for t0, t1, state in ((0, 40, "ready"), (40, 55, "unknown"), (55, 70, "ready"), (70, 90, "used"), (90, 100, "ready")):
        conn.execute("INSERT INTO gadget_state (game_id, slot, t0, t1, gadget, state) VALUES (1, 1, ?, ?, ?, ?)", (t0, t1, None if state == "unknown" else "G5", state))
    conn.commit()
    P.compute(conn, 1)
    s = stat(conn, 1)
    assert s["gadget_uses"] == 1 and s["gadget_unused_at_death"] == 1
    assert s["gadget_possible"] == (1 + 40 // 20) + (1 + 45 // 20)  # 3 + 3
    assert stat(conn, 5)["gadget_uses"] is None  # pas de lecture pour ce joueur


def test_gadget_sans_delai_etabli_donne_un_possible_nul_et_pas_une_somme_partielle(monkeypatch):
    monkeypatch.setattr(weapons, "display_names", lambda folder=weapons.ICON_DIR: NAMES)
    conn = make_conn()
    build_game(conn)
    add_cycles(conn, 1, 5, "G7", [10.0, 45.0])  # SONAR : deux cycles, délai non établi
    P.compute(conn, 1)
    s = stat(conn, 5)
    assert s["gadget_uses"] == 2 and s["gadget_possible"] is None


def test_le_calcul_est_idempotent_et_ecrit_la_version(monkeypatch):
    monkeypatch.setattr(weapons, "display_names", lambda folder=weapons.ICON_DIR: NAMES)
    conn = make_conn()
    build_game(conn)
    P.compute(conn, 1)
    first = [tuple(r) for r in conn.execute("SELECT * FROM player_game_stats ORDER BY slot")]
    P.compute(conn, 1)
    assert [tuple(r) for r in conn.execute("SELECT * FROM player_game_stats ORDER BY slot")] == first
    assert conn.execute("SELECT revision FROM stats_meta WHERE game_id = 1 AND module = 'player_game_stats'").fetchone()[0] == P.REVISION
    assert conn.execute("SELECT COUNT(*) FROM player_game_stats WHERE game_id = 2").fetchone()[0] == 0


def test_une_game_sans_aucune_ligne_ne_donne_rien():
    conn = make_conn()
    assert P.compute(conn, 1) == 0


def test_le_delai_du_shield_donne_par_l_utilisateur_sert_sans_mesure_etablie_et_une_mesure_etablie_l_emporte(monkeypatch):
    monkeypatch.setattr(weapons, "display_names", lambda folder=weapons.ICON_DIR: NAMES)
    conn = make_conn()
    add_cycles(conn, 1, 1, "G8", [10.0, 45.0])  # deux cycles : non établi, le délai connu (45 s) s'applique
    assert P.gadget_delays(conn)["SHIELD"] == 45.0
    add_cycles(conn, 2, 2, "G8", [30.0, 30.0, 30.0])  # trois cycles proches de 30 s : la mesure établie l'emporte
    assert P.gadget_delays(conn)["SHIELD"] == 30.0
