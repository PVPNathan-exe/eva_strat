"""Où vivent les données de l'utilisateur, et sur quel genre de disque.

Trois emplacements, réglables par variables d'environnement (sans elles : le dossier `data/` du projet, comme avant) :
  EVA_DATA_DIR  dossier des données (base `eva.db` et dossier `cache`) ;
  EVA_DB        fichier de la base seul (a priorité sur EVA_DATA_DIR : copie de test, base d'un autre dossier) ;
  EVA_CACHE     dossier du cache seul (vidéos téléchargées, lectures gardées par `evaluate.py`).
La base doit rester sur le disque interne : SQLite y écrit sans cesse (journal WAL) et un débranchement en cours d'écriture peut la corrompre ; une clé USB s'use surtout à l'écriture.
Pour une clé ou un disque externe, passer par l'export JSON (`data_export.py`) : une écriture séquentielle, une seule fois."""

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def data_dir():
    return Path(os.environ.get("EVA_DATA_DIR") or ROOT / "data")


def db_path():
    return Path(os.environ.get("EVA_DB") or data_dir() / "eva.db")


def cache_dir():
    return Path(os.environ.get("EVA_CACHE") or data_dir() / "cache")


DRIVE_TYPES = {2: "removable", 3: "fixed", 4: "network", 5: "cdrom", 6: "ramdisk"}


def drive_type(path):
    """Genre du disque qui porte `path` d'après Windows : 'removable' (clé USB), 'fixed', 'network', ... ou None (hors de Windows, ou inconnu).
    Limite : un SSD ou un disque dur externe branché en USB est le plus souvent déclaré 'fixed' par Windows, il n'est pas reconnu comme amovible."""
    if sys.platform != "win32":
        return None
    try:
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.GetDriveTypeW.argtypes = [wintypes.LPCWSTR]
        kernel.GetDriveTypeW.restype = wintypes.UINT
        root = Path(path).resolve().anchor
        return DRIVE_TYPES.get(kernel.GetDriveTypeW(root))
    except Exception:  # noqa: BLE001 - information facultative
        return None


def storage_warning(path):
    """Phrase d'avertissement si `path` est sur un disque amovible ou réseau, sinon None."""
    kind = drive_type(path)
    if kind == "removable":
        return "La base est sur un disque amovible (clé USB) : écritures incessantes, risque de corruption au débranchement et usure. Garde la base sur le disque interne et utilise l'export JSON."
    if kind == "network":
        return "La base est sur un disque réseau : SQLite y est fragile (verrous). Garde la base sur le disque interne et utilise l'export JSON."
    return None
