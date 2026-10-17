"""Tableau de fin de game (scoreboard.py) : images synthétiques (chiffres dessinés à la chasse du jeu, icônes hexagonales), lecture des cases, repérage du tableau, rattachement des pseudos, table et idempotence."""

import sqlite3
from pathlib import Path

import cv2
import numpy as np

import scoreboard as S

SCHEMA = (Path(__file__).resolve().parent.parent / "schema.sql").read_text(encoding="utf-8")


def put_number(frame, value, cx, cy, team="A"):
    """Dessine un nombre centré en (cx, cy), un chiffre tous les PITCH pixels, texte clair (ou bleu pour l'équipe B observée si team == 'Bblue')."""
    text = str(value)
    colour = (255, 140, 30) if team == "Bblue" else (235, 235, 235)
    for k, ch in enumerate(text):
        x = int(round(cx - len(text) * S.PITCH / 2 + k * S.PITCH + 1))
        cv2.putText(frame, ch, (x, int(cy + 10)), cv2.FONT_HERSHEY_SIMPLEX, 0.85, colour, 3, cv2.LINE_AA)


def board_frame(values, observed=None, seed=0):
    """Image 1920 par 1080 : décor de bruit, 24 icônes hexagonales, chiffres de `values` {(équipe, colonne): {kills, deaths, assists, score}}."""
    rng = np.random.default_rng(seed)
    frame = np.clip(rng.normal(90, 12, (S.REF_H, S.REF_W, 3)), 0, 255).astype(np.uint8)
    for team_dy in (0, S.BLUE_DY):
        for cols in S.ICON_X:
            for x in cols:
                c = (int(round(x)), S.ICON_Y + team_dy)
                pts = np.array([[c[0] + 15 * np.cos(a), c[1] + 15 * np.sin(a)] for a in np.linspace(0.5, 6.78, 6, endpoint=False)], np.int32)
                cv2.polylines(frame, [pts], True, (235, 235, 235), 2, cv2.LINE_AA)
                cv2.putText(frame, "K", (c[0] - 6, c[1] + 6), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (235, 235, 235), 2, cv2.LINE_AA)
    for (team, col), cell in values.items():
        team_dy = S.BLUE_DY if team == "B" else 0
        cx = S.COL_X0 + S.COL_DX * col
        mark = "Bblue" if observed == (team, col) and team == "B" else team
        for kind in ("kills", "deaths", "assists"):
            put_number(frame, cell[kind], cx + S.KDA_DX[kind] + 1, S.KDA_Y + team_dy, mark)
        put_number(frame, cell["score"], cx, S.SCORE_Y + team_dy, mark)
    return frame


def truth(offset=0):
    out = {}
    for team in ("A", "B"):
        for col in range(4):
            n = offset + col + (4 if team == "B" else 0)
            out[(team, col)] = {"kills": (n * 3) % 17 + 1, "deaths": (n * 5) % 12 + 1, "assists": (n * 7) % 10, "score": 25 * (8 + n * 3)}
    return out


LEARN = {  # une image qui contient tous les chiffres, plusieurs fois (vérité d'apprentissage)
    ("A", 0): {"kills": 10, "deaths": 23, "assists": 45, "score": 6789},
    ("A", 1): {"kills": 67, "deaths": 89, "assists": 1, "score": 1025},
    ("A", 2): {"kills": 38, "deaths": 52, "assists": 94, "score": 2750},
    ("A", 3): {"kills": 16, "deaths": 70, "assists": 83, "score": 4950},
    ("B", 0): {"kills": 21, "deaths": 36, "assists": 47, "score": 5805},
    ("B", 1): {"kills": 59, "deaths": 0, "assists": 12, "score": 3475},
    ("B", 2): {"kills": 84, "deaths": 61, "assists": 25, "score": 9100},
    ("B", 3): {"kills": 97, "deaths": 30, "assists": 76, "score": 8625},
}


def models_from(tmp_path):
    path = tmp_path / "models.npz"
    S.learn_models([(board_frame(LEARN), LEARN, None)], path)
    return S.load_models(path)


def test_lecture_des_cases_sur_image_synthetique(tmp_path):
    models = models_from(tmp_path)
    assert models["icon"] is not None and set(models["digits"]) == set("0123456789")
    values = truth(2)
    got = S.read_cells(board_frame(values, seed=3), models)
    exact = wrong = 0
    for k, cell in values.items():
        for kind, v in cell.items():
            if got[k][kind] == v:
                exact += 1
            elif got[k][kind] is not None:
                wrong += 1
    assert wrong == 0  # une lecture douteuse est n/d (None), jamais un chiffre faux
    assert exact == 32


def test_un_score_qui_n_est_pas_multiple_de_25_est_refuse(tmp_path):
    models = models_from(tmp_path)
    values = truth(0)
    values[("A", 0)]["score"] = 710
    got = S.read_cells(board_frame(values, seed=4), models)
    assert got[("A", 0)]["score"] is None


def test_reperage_du_tableau(tmp_path):
    models = models_from(tmp_path)
    present = S.board_score(board_frame(truth(0)), models["icon"])
    blank = S.board_score(np.full((S.REF_H, S.REF_W, 3), 90, np.uint8), models["icon"])
    assert present > S.BOARD_MIN > blank


def test_plages_du_tableau():
    series = [(0.0, 0.1), (0.5, 0.9), (1.0, 0.9), (1.5, 0.1), (2.0, 0.9), (2.5, 0.9), (3.0, 0.9), (9.0, 0.9)]
    runs = S.runs_of(series)
    assert runs[0][:2] == (0.5, 3.0) and runs[0][2] == 5  # le trou de 0,5 s est toléré
    assert runs[1][:2] == (9.0, 9.0)
    assert S.runs_of([(0.0, 0.2), (0.5, 0.3)]) == []
    assert S.sample_times({"first": 5.0, "last": 5.5, "frames": 2}) == [5.25]
    assert S.sample_times({"first": 4.0, "last": 8.0, "frames": 9}) == [5.0, 6.0, 7.0]


def test_rattachement_des_pseudos():
    known = {1: "SNVXPRIME", 2: "SNVXLAIDEEN", 3: "SNVXGLENS", 4: "SNVXALEXO"}
    reads = {0: "SNVXGLEN5", 1: "SNVXALEXOPS2", 2: "SNVXPRIMEHONE", 3: "SNVXLAIDEEN"}
    assert S.assign_slots(reads, known, "A") == {0: 3, 1: 4, 2: 1, 3: 2}
    # un nom illisible est trouvé par élimination
    reads2 = {**reads, 1: ""}
    assert S.assign_slots(reads2, known, "A") == {0: 3, 1: 4, 2: 1, 3: 2}
    # deux colonnes illisibles : deux permutations se valent, rien n'est rattaché
    reads3 = {**reads, 1: "", 3: ""}
    assert S.assign_slots(reads3, known, "A") == {}
    # équipe B : slots 5 à 8
    known_b = {5: "NCTXVEX", 6: "NCTXMARM", 7: "NCTXSPIRIT", 8: "NCTX7TAKAA"}
    assert S.assign_slots({0: "NCTX7TAKAA", 1: "NCTXSPIRIT", 2: "NCTXMARMOOTTE", 3: "NCTXVEX"}, known_b, "B") == {0: 8, 1: 7, 2: 6, 3: 5}


def test_carte_et_vote():
    assert S.map_matches("POLARISDOMINATION", "Polaris")
    assert S.map_matches("REEFPOINTDOMINATION", "Reef Point")
    assert not S.map_matches("POLARISDOMINATION", "Atlantis")
    assert S.map_matches("", "Atlantis")  # rien de lisible : pas de contrôle possible
    a = {("A", 0): {"kills": 3, "deaths": 1, "assists": None, "score": 100}}
    b = {("A", 0): {"kills": 3, "deaths": 2, "assists": 4, "score": None}}
    voted = S.vote_cells([a, b])[("A", 0)]
    assert voted == {"kills": 3, "deaths": None, "assists": 4, "score": 100}  # deux lectures sûres qui se contredisent : n/d


def make_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    conn.execute("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, 'absente.mp4', 400, 30, 1920, 1080)")
    conn.execute("INSERT INTO games (id, video_id, start_s, end_s, map) VALUES (1, 1, 10, 110, 'Polaris')")
    return conn


def fake_result(map_read="POLARISDOMINATION"):
    rows = [{"slot": 1, "name_read": "SNVXPRIME", "kills": 8, "deaths": 7, "assists": 4, "score": 675}, {"slot": 5, "name_read": "NCTXVEX", "kills": 3, "deaths": 9, "assists": None, "score": 200}]
    return {"rows": rows, "t": 120.5, "map_read": map_read, "map": "Polaris"}


def test_table_ecrite_idempotente_et_vide_sans_video(tmp_path):
    conn = make_conn()
    assert S.compute(conn, 1) == 0  # vidéo absente : 0 ligne, pas d'erreur
    assert conn.execute("SELECT COUNT(*) FROM scoreboard").fetchone()[0] == 0
    assert S.compute(conn, 1, fake_result()) == 2
    assert S.compute(conn, 1, fake_result()) == 2
    rows = conn.execute("SELECT slot, kills, deaths, assists, score, t_video, source FROM scoreboard ORDER BY slot").fetchall()
    assert [tuple(r) for r in rows] == [(1, 8, 7, 4, 675, 120.5, "ecran_de_fin"), (5, 3, 9, None, 200, 120.5, "ecran_de_fin")]
    # un tableau d'une autre carte est ignoré : les lignes déjà écrites restent, rien n'est réécrit
    assert S.compute(conn, 1, fake_result("ATLANTISDOMINATION")) == 0
    assert conn.execute("SELECT COUNT(*) FROM scoreboard").fetchone()[0] == 2
    assert conn.execute("SELECT revision FROM stats_meta WHERE game_id = 1 AND module = 'scoreboard'").fetchone()[0] == S.REVISION


def test_aucun_pseudo_rattache_garde_les_lignes_existantes():
    conn = make_conn()
    assert S.compute(conn, 1, fake_result()) == 2
    empty = {"rows": [], "t": 1.0, "map_read": "POLARISDOMINATION", "map": "Polaris"}
    assert S.compute(conn, 1, empty) == 0
    assert conn.execute("SELECT COUNT(*) FROM scoreboard").fetchone()[0] == 2
