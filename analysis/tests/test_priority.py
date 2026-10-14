import os
import subprocess
import sys

import pytest

import priority


@pytest.fixture(autouse=True)
def restore(monkeypatch):
    """Chaque test repart sans niveau choisi et rend au processus de test sa priorité d'origine."""
    before = priority.current()
    monkeypatch.delenv(priority.ENV, raising=False)
    yield
    if before:
        priority._set_current(before)


def test_niveau_inconnu_refuse():
    with pytest.raises(ValueError):
        priority.apply("turbo")


def test_environnement_ignore_un_niveau_inconnu(monkeypatch):
    monkeypatch.setenv(priority.ENV, "turbo")
    assert priority.from_env() is None
    assert priority.creation_flags() == 0


def test_sans_niveau_choisi_rien_ne_change():
    assert priority.from_env() is None
    assert priority.creation_flags() == 0


@pytest.mark.skipif(sys.platform != "win32", reason="priorités Windows")
@pytest.mark.parametrize("level", priority.LEVELS)
def test_apply_pose_la_classe_et_l_environnement(level):
    assert priority.apply(level) is True
    assert priority.current() == level
    assert priority.from_env() == level
    assert priority.creation_flags() == priority.WINDOWS_CLASS[level]


@pytest.mark.skipif(sys.platform != "win32", reason="priorités Windows")
def test_processus_enfant_recoit_la_priorite_haute():
    """Windows ne fait pas hériter une priorité haute : le drapeau de création la donne au sous-processus."""
    priority.apply("high")
    code = "import sys; sys.path.insert(0, %r); import priority; print(priority.current())" % os.path.dirname(priority.__file__)
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, creationflags=priority.creation_flags()).stdout.strip()
    assert out == "high"


@pytest.mark.skipif(sys.platform != "win32", reason="priorités Windows")
def test_processus_de_lecture_basse_par_defaut_et_niveau_choisi():
    priority.apply_worker()
    assert priority.current() == "low"
    os.environ[priority.ENV] = "normal"
    priority.apply_worker()
    assert priority.current() == "normal"
