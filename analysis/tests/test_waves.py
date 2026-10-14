"""Vagues (waves.py) : base en mémoire, game de Polaris synthétique (un seul point, zones de départ de map_spawns.json). Les joueurs 1 à 4 (équipe A) apparaissent en A_SPAWN, 5 à 8 (équipe B) en B_SPAWN."""

import sqlite3
from pathlib import Path

import episode_common as ec
import waves

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8")
START = 100.0  # début de la game dans la vidéo : les samples et les kills sont en temps de vidéo
DURATION = 200.0
A_SPAWN = (0.15, 0.6)  # dans la zone de départ de l'équipe A de Polaris
B_SPAWN = (0.80, 0.6)  # dans celle de l'équipe B
MID = (0.485, 0.54)  # dans le cadre du point de Polaris


def track(points):
    """Fonction t -> (x, y) qui suit des repères [(t, (x, y))] en ligne droite et reste au premier ou au dernier repère en dehors."""
    def f(t):
        if t <= points[0][0]:
            return points[0][1]
        for (t0, p0), (t1, p1) in zip(points, points[1:]):
            if t <= t1:
                k = (t - t0) / (t1 - t0) if t1 > t0 else 1.0
                return (p0[0] + k * (p1[0] - p0[0]), p0[1] + k * (p1[1] - p0[1]))
        return points[-1][1]
    return f


def leave(spawn, t_leave, t_arrive, dest=MID):
    """Reste au spawn jusqu'à t_leave puis rejoint dest en ligne droite à t_arrive."""
    return track([(t_leave, spawn), (t_arrive, dest)])


def stay(p):
    return lambda t: p


def make_conn(players, kills=(), owners=(), map_name="Polaris"):
    """players : {slot: [(t0, t1, ended, chemin)]} (défaut : vivant toute la game au spawn de son équipe) ; kills : [(t, tueur, victime)] en secondes de game ;
    owners : [(t0, t1, 'A'|'B'|'none')] du point A. Une ligne de samples toutes les 0,5 s pendant chaque vie, positions d'apparition et de mort dans `lives`."""
    conn = sqlite3.connect(":memory:")
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'v.mp4', 400, 30, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, ?, ?, ?)", (START, START + DURATION, map_name))
    for o in owners:
        conn.execute("INSERT INTO point_owner (game_id, point, t0, t1, owner, source) VALUES (1, 'A', ?, ?, ?, 'box')", o)
    frame = 0
    for slot in range(1, 9):
        spawn = A_SPAWN if slot <= 4 else B_SPAWN
        killer_of = {v: k for t, k, v in kills}
        for idx, (t0, t1, ended, path) in enumerate(players.get(slot, [(0.0, DURATION, "end", stay(spawn))])):
            p0, p1 = path(t0), path(t1)
            conn.execute("INSERT INTO lives (game_id, slot, idx, t0, t1, x0, y0, x1, y1, ended, killer_slot) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         (slot, idx, t0, t1, p0[0], p0[1], p1[0], p1[1], ended, killer_of.get(slot) if ended == "death" else None))
            t = t0
            while t <= t1 + 1e-9:
                x, y = path(t)
                conn.execute("INSERT INTO samples (game_id, frame, t, slot, team, x, y, alive) VALUES (1, ?, ?, ?, ?, ?, ?, 1)", (frame, START + t, slot, ec.team_of(slot), x, y))
                frame += 1
                t += 0.5
    for t, killer, victim in kills:
        conn.execute("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon, kind) VALUES (1, ?, ?, ?, 'x', 'kill')", (START + t, killer, victim))
    conn.commit()
    return conn


def game_of(conn):
    return ec.load_game(conn, 1)


def team_a_leaves(times, dest=MID, arrive_after=10.0):
    """Joueurs 1, 2, 3... de l'équipe A qui quittent leur spawn aux instants donnés (un instant par joueur)."""
    return {slot: [(0.0, DURATION, "end", leave(A_SPAWN, t, t + arrive_after, dest))] for slot, t in enumerate(times, start=1)}


# ---------------------------------------------------------------- détection

def test_deux_joueurs_qui_sortent_ensemble_font_une_vague():
    game = game_of(make_conn(team_a_leaves([20.0, 24.0])))
    [w] = waves.find_waves(game)
    assert w["team"] == "A" and w["size"] == 2
    assert 20.0 <= w["t_start"] <= 26.0 and w["t_full"] > w["t_start"]  # la sortie suit de quelques secondes le départ : la zone fait plusieurs mètres
    assert [m["slot"] for m in w["members"]] == [1, 2]


def test_un_joueur_seul_ou_des_sorties_espacees_ne_font_pas_de_vague():
    assert waves.find_waves(game_of(make_conn(team_a_leaves([20.0])))) == []
    assert waves.find_waves(game_of(make_conn(team_a_leaves([20.0, 60.0])))) == []  # 40 s d'écart


def test_deux_departs_separes_font_deux_vagues():
    players = team_a_leaves([20.0, 22.0, 100.0, 103.0])
    ws = waves.find_waves(game_of(make_conn(players)))
    assert [(w["team"], w["size"]) for w in ws] == [("A", 2), ("A", 2)]
    assert ws[1]["t_start"] > 100.0


def test_cluster_exits_prend_les_sorties_dans_la_fenetre():
    exits = [(1.0, 1, 0, {}), (5.0, 2, 0, {}), (9.5, 3, 0, {}), (30.0, 4, 0, {})]
    groups = waves.cluster_exits(exits, join_s=8.0)
    assert [[e[1] for e in g] for g in groups] == [[1, 2]]  # le 3 est à 8,5 s de la première sortie, le 4 est seul
    assert [[e[1] for e in g] for g in waves.cluster_exits(exits, join_s=9.0)] == [[1, 2, 3]]


def test_carte_sans_zone_de_depart_donne_zero_vague():
    game = game_of(make_conn(team_a_leaves([20.0, 22.0]), map_name="Carte inconnue"))
    assert waves.find_waves(game) == []


def test_vie_qui_apparait_hors_zone_na_pas_de_sortie():
    players = {1: [(0.0, DURATION, "end", track([(0.0, (0.3, 0.3)), (50.0, MID)]))], 2: [(0.0, DURATION, "end", leave(A_SPAWN, 20.0, 30.0))]}
    assert waves.find_waves(game_of(make_conn(players))) == []  # le 1 apparait hors zone : une seule sortie


# ---------------------------------------------------------------- contact

def test_contact_est_le_premier_kill_dun_membre_de_la_vague():
    players = team_a_leaves([20.0, 22.0])
    conn = make_conn(players, kills=[(15.0, 5, 6), (30.0, 1, 5)])  # un kill entre B avant le départ ne compte pas
    [w] = waves.find_waves(game_of(conn))
    assert w["t_contact"] == 30.0 and abs(w["to_contact_s"] - (30.0 - w["t_start"])) < 0.1


def test_vague_sans_kill_na_pas_de_contact():
    [w] = waves.find_waves(game_of(make_conn(team_a_leaves([20.0, 22.0]))))
    assert w["t_contact"] is None and w["fight"] is None


def test_un_kill_dune_vague_suivante_nest_pas_emprunte():
    players = team_a_leaves([20.0, 22.0, 60.0, 62.0])
    w1, w2 = waves.find_waves(game_of(make_conn(players, kills=[(70.0, 1, 5)])))
    assert w1["t_contact"] is None  # le 1 est de la première vague, mais le kill tombe après le départ de la suivante
    assert w2["t_contact"] is None  # et il n'est pas membre de la seconde
    w1, w2 = waves.find_waves(game_of(make_conn(players, kills=[(70.0, 3, 5)])))
    assert w1["t_contact"] is None and w2["t_contact"] == 70.0


# ---------------------------------------------------------------- vitesse

def test_vague_qui_avance_sans_sarreter_est_rapide():
    players = {s: [(0.0, DURATION, "end", leave(A_SPAWN, 20.0, 40.0))] for s in (1, 2)}
    [w] = waves.find_waves(game_of(make_conn(players, kills=[(40.0, 1, 5)])))
    assert w["speed"] == "rapide" and w["n_stops"] == 0


def test_vague_qui_sarrete_est_progressive():
    path = track([(20.0, A_SPAWN), (24.0, (0.30, 0.6)), (32.0, (0.30, 0.6)), (36.0, MID)])  # 8 s d'arrêt à mi-chemin
    players = {s: [(0.0, DURATION, "end", path)] for s in (1, 2)}
    [w] = waves.find_waves(game_of(make_conn(players, kills=[(36.0, 1, 5)])))
    assert w["speed"] == "progressif" and w["n_stops"] == 1 and w["stop_s"] >= 6.0


def test_stop_runs_sur_une_trace_fabriquee():
    trace = [(i * 0.5, (0.1, 0.1)) for i in range(21)]
    spd = [0.0] * 21
    assert waves.stop_runs(trace, spd) == [(0.0, 10.0)]
    assert waves.stop_runs(trace, [2.0] * 21) == []
    assert waves.stop_runs(trace[:4], [0.0] * 4) == []  # 2 s seulement : sous STOP_MIN_S
