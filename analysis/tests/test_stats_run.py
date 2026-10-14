import db
import stats_run

STATS_TABLES = {"lives", "kill_links", "point_owner", "life_loadouts", "episodes", "stats_meta"}


def test_les_tables_stats_sont_creees(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert STATS_TABLES <= names


def test_sans_module_rien_n_est_calcule(tmp_path, monkeypatch):
    monkeypatch.setattr(stats_run, "STEPS", [])
    assert stats_run.run(db.connect(tmp_path / "t.db"), 1) == {}


def test_les_modules_sont_appeles_dans_l_ordre_et_filtres(tmp_path, monkeypatch):
    calls = []

    class Fake:
        def __init__(self, name):
            self.name = name

        def compute(self, conn, game_id):
            calls.append((self.name, game_id))
            return 3

    monkeypatch.setattr(stats_run.importlib, "import_module", lambda name: Fake(name))
    monkeypatch.setattr(stats_run, "STEPS", [("a", "mod_a"), ("b", "mod_b")])
    conn = db.connect(tmp_path / "t.db")
    assert stats_run.run(conn, 7) == {"a": 3, "b": 3} and calls == [("mod_a", 7), ("mod_b", 7)]
    assert stats_run.run(conn, 7, only={"b"}) == {"b": 3}
