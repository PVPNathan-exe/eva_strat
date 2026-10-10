"""Relit l'équipement (armes et gadget) des games d'une vidéo avec l'algorithme actuel, puis retire les icônes devenues inutiles.

  python analysis/reread_loadouts.py --video 3

Utile après une amélioration de la lecture des bandeaux (fond, boîte de lecture, images nettes seulement) : les équipements déjà en base ont été lus avec
l'ancien code. Les kills et les positions ne sont pas touchés. Sont retirées seulement les icônes qui n'ont pas de nom, ne sont ni verrouillées ni
signalées, n'ont pas de nom deviné, et que plus aucun équipement ni kill n'utilise : une icône nommée par l'utilisateur est toujours gardée."""

import argparse
import json
import shutil
import sys
from pathlib import Path

import analyze
import db
import ingest
import weapons


def unused_icons(folder, used, names, reviews):
    """Identifiants (B…, G…) des icônes à retirer : sans nom, ni verrou, ni signalement, ni nom deviné, et absentes de `used`."""
    out = []
    for path in sorted(Path(folder).glob("[BG]*.png")):
        icon = path.stem
        review = reviews.get(icon, {})
        if icon in used or names.get(icon) or review.get("locked") or review.get("reported") or review.get("guess"):
            continue
        out.append(icon)
    return out


def purge(folder, icons):
    """Supprime les fichiers de ces icônes (modèle, aperçu, images candidates)."""
    folder = Path(folder)
    for icon in icons:
        for path in (folder / f"{icon}.png", folder / "previews" / f"{icon}.png"):
            path.unlink(missing_ok=True)
        shutil.rmtree(folder / "candidates" / icon, ignore_errors=True)
    weapons._cache.pop(str(folder), None)
    weapons._native_cache.pop(str(folder), None)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Relit l'équipement des games d'une vidéo et retire les icônes devenues inutiles.")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--video", type=int, required=True)
    parser.add_argument("--keep-icons", action="store_true", help="Ne retirer aucune icône")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    video = conn.execute("SELECT id, path FROM videos WHERE id = ?", (args.video,)).fetchone()
    if video is None:
        parser.error("vidéo inconnue")
    meta = ingest.probe(Path(video["path"]))
    conn.execute("DELETE FROM loadouts WHERE game_id IN (SELECT id FROM games WHERE video_id = ?)", (args.video,))
    conn.commit()
    n = analyze.extract_loadouts(conn, args.video, Path(video["path"]), meta, lambda e: print(json.dumps(e), flush=True))
    print(f"équipement relu pour {n} game(s)")
    if not args.keep_icons:
        used = {v for r in conn.execute("SELECT weapon1, weapon2, gadget FROM loadouts") for v in r if v}
        used |= {r[0] for r in conn.execute("SELECT DISTINCT weapon FROM kills WHERE weapon IS NOT NULL")}
        names = weapons.display_names()
        reviews_path = weapons.ICON_DIR / "reviews.json"
        reviews = json.loads(reviews_path.read_text(encoding="utf-8")) if reviews_path.exists() else {}
        gone = unused_icons(weapons.ICON_DIR, used, names, reviews)
        purge(weapons.ICON_DIR, gone)
        print("icônes retirées :", ", ".join(gone) or "aucune")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
