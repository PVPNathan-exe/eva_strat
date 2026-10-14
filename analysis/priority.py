"""Priorité Windows des processus de l'analyse, choisie dans le menu Options de l'interface : basse, normale ou haute.

basse : sous la normale (BELOW_NORMAL), le PC reste fluide pendant l'analyse ; normale : la priorité que Windows donne par défaut ; haute : au-dessus de tout le reste de l'ordinateur (HIGH),
l'analyse avance plus vite quand d'autres applications se partagent le processeur (sans autre application, la priorité ne change pas la vitesse), au prix d'un PC moins réactif.
Le niveau est posé sur le processus principal puis transmis aux processus de lecture et à ffmpeg par la variable d'environnement EVA_PRIORITY : Windows ne fait hériter à un processus enfant
que les priorités basses, une priorité haute doit donc être posée dans chaque processus. Sans niveau choisi (ligne de commande, resolve.py), les processus de lecture restent en priorité basse
comme avant et le reste n'est pas touché. Sans effet hors de Windows."""

import os
import sys

LEVELS = ("low", "normal", "high")
ENV = "EVA_PRIORITY"
WINDOWS_CLASS = {"low": 0x4000, "normal": 0x20, "high": 0x80}  # BELOW_NORMAL, NORMAL, HIGH_PRIORITY_CLASS (SetPriorityClass et drapeau de création de processus)
WORKER_DEFAULT = "low"  # niveau des processus de lecture quand aucun niveau n'a été choisi


def from_env():
    """Niveau choisi (transmis par l'environnement), ou None."""
    level = os.environ.get(ENV)
    return level if level in LEVELS else None


def _kernel():
    """kernel32 avec les types de poignée déclarés : sans eux, ctypes passe la poignée du processus (-1) sur 32 bits et Windows répond « poignée invalide » (erreur 6) avec Python 64 bits."""
    import ctypes
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    kernel.GetCurrentProcess.argtypes = []
    kernel.SetPriorityClass.restype = wintypes.BOOL
    kernel.SetPriorityClass.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.GetPriorityClass.restype = wintypes.DWORD
    kernel.GetPriorityClass.argtypes = [wintypes.HANDLE]
    return kernel


def _set_current(level):
    """Pose la classe de priorité sur le processus courant. False si Windows refuse ou hors de Windows."""
    if sys.platform != "win32":
        return False
    try:
        return bool(_kernel().SetPriorityClass(_kernel().GetCurrentProcess(), WINDOWS_CLASS[level]))
    except Exception:  # noqa: BLE001 - facultatif : l'analyse tourne aussi sans
        return False


def current():
    """Niveau du processus courant ('low', 'normal', 'high'), None si autre ou hors de Windows (sert aux contrôles)."""
    if sys.platform != "win32":
        return None
    try:
        got = _kernel().GetPriorityClass(_kernel().GetCurrentProcess())
    except Exception:  # noqa: BLE001
        return None
    return next((name for name, value in WINDOWS_CLASS.items() if value == got), None)


def apply(level):
    """Pose le niveau sur ce processus et le transmet aux processus lancés ensuite. Un niveau inconnu est refusé (ValueError)."""
    if level not in LEVELS:
        raise ValueError(f"priorité inconnue : {level} (attendu : {', '.join(LEVELS)})")
    os.environ[ENV] = level
    return _set_current(level)


def apply_worker():
    """À appeler au démarrage d'un processus de lecture : niveau choisi, sinon priorité basse."""
    return _set_current(from_env() or WORKER_DEFAULT)


def creation_flags():
    """`creationflags` des sous-processus (ffmpeg, OCR) : le niveau choisi, 0 si aucun (comportement d'avant)."""
    level = from_env()
    return WINDOWS_CLASS[level] if level and sys.platform == "win32" else 0
