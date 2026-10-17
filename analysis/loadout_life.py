"""Équipement d'un joueur à chaque vie (tables Stats : life_loadouts), lu sur les bandeaux de la vidéo.

L'équipement change à chaque réapparition : on lit donc les bandeaux dans les secondes qui suivent le début de chaque vie (table `lives`, temps en
secondes depuis le début de la game ; la vidéo se lit à `games.start_s` plus ce temps), puis on vote par case.
  - arme 1 et arme 2 : seule l'arme TENUE (en noir) se lit bien ; dans chaque image on compare les deux cases du bandeau (loadout.read_held), la case la plus
    sombre est la tenue. Un joueur qui ne change pas d'arme pendant la fenêtre ne donne qu'une des deux armes : l'autre se lit alors en pâle (arme rangée),
    puis à défaut est reprise de l'équipement de la game (table loadouts) ;
  - gadget : toutes les images ;
  - held : l'arme tenue juste avant la mort (ou la fin de la game), lue sur les dernières images de la vie.
`source` d'une ligne dit la lecture la plus faible parmi ses cases remplies : « lu » (au moins 2 images d'accord), « lu1 » (une seule image), « pale »
(arme rangée), « game » (équipement de la game). NULL : rien n'a été lu pour cette vie.

Les noms restent ceux de weapon_icons/names.json : ce module ne nomme rien et, par défaut, ne crée aucune icône (une icône inconnue laisse la case vide ; avec
`--create-icons` elle devient un modèle « B… » à nommer dans l'onglet Armes, comme à l'analyse).

  python analysis/loadout_life.py --game 25 [--db chemin] [--dry-run] [--icons dossier] [--create-icons]
"""

import argparse
import json
import os
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

import loadout
import weapons

MODULE = "loadout_life"
REVISION = 3  # 3 : règle d'équipe (un seul SHIELD, SONAR et CLONE par équipe à un instant) ; 2 : un gadget terne (déjà utilisé) ne vote plus pour l'identité de l'icône (GADGET_MIN_TONE)

START_OFFSETS = (0.8, 1.8, 3.0, 4.5, 6.5, 9.0)  # images lues après l'apparition (secondes) : le joueur a le temps de tenir et de changer d'arme
END_OFFSETS = (-1.2, -0.7, -0.3)  # images lues avant la mort : l'arme tenue au moment de mourir
END_OFFSETS_GAME_END = (-3.0, -2.4, -1.8)  # fin de game : l'écran de fin noircit environ 1,1 s avant la dernière image
MIN_ALIVE_S = 0.3  # une image doit tomber au moins 0,3 s avant la fin de la vie
MAX_WORKERS = 3  # lectures d'images ffmpeg en parallèle (règle du projet : 3 processus de lecture au plus)
UNIQUE_GADGETS = ("SHIELD", "SONAR", "CLONE")  # règle du jeu (information de l'utilisateur, 16/10/2026) : une équipe n'a qu'un SHIELD, un SONAR et un CLONE (DX3, STICKY et MEDPACK peuvent être plusieurs)
TEAM_RULE_MIN_OVERLAP_S = 1.0  # deux vies de joueurs de la même équipe se chevauchent si elles ont plus d'une seconde en commun
ORIGIN_RANK = {"lu": 0, "lu1": 1, "pale": 2, "game": 3}  # du plus fiable au moins fiable
GADGET_MIN_TONE = 55  # relief (95e centile) à partir duquel l'icône du gadget est celle d'un gadget DISPONIBLE (noire) : 55 à 125 mesuré, un gadget utilisé n'a que 14 à 44 (analysis/gadget_state.py)
PALE_MAX_TONE = 50  # relief (95e centile) au-dessus duquel une case n'est plus « rangée » : mesuré 11 à 47 sur 320 bandeaux


def life_times(t0, t1, ended):
    """Instants (temps de la game) à lire pour une vie : (après l'apparition, avant la fin). Une vie très courte est lue en son milieu."""
    end_offsets = END_OFFSETS_GAME_END if ended == "end" else END_OFFSETS
    start = [round(t0 + o, 2) for o in START_OFFSETS if t0 + o <= t1 - MIN_ALIVE_S]
    end = [t1 + o for o in end_offsets if t1 + o >= t0 + 0.1]
    if not start and not end and t1 - t0 >= 2 * MIN_ALIVE_S:
        start = [t0 + (t1 - t0) / 2]
    return start, sorted(set(round(t, 2) for t in end) - set(round(t, 2) for t in start))


def read_row(video, zone, width, height, t_video, index):
    """Les trois cases d'un bandeau à l'instant t (vidéo) : {case: (forme, relief)}, ou None si l'image n'a pas pu être lue."""
    import names  # évite un import circulaire au chargement

    crop = names._grab(video, t_video, zone, width, height)
    if crop is None:
        return None
    row = {}
    for kind in loadout.BOXES:
        piece = loadout.box_piece(crop, index, kind)
        row[kind] = (loadout._shape(piece), loadout._dark(piece))
    row["banner"] = loadout.banner_crop(crop, index)
    return row


def _id(shape, kind, tone, folder, create):
    """Identifiant d'une icône (None si inconnue ou vide). Une icône inconnue n'est créée que si `create` et si elle est nette (comme à l'analyse)."""
    if shape is None or not shape.any():
        return None
    return loadout.identify(shape, kind, folder=folder, tone=tone, create=create and loadout.sharp_enough(tone))


def classify(row, folder, create=False):
    """Lecture d'une image : {"held": (case, icône) ou None, "pale": (case, icône) ou None, "gadget": icône ou None, "unknown": nombre d'icônes inconnues}."""
    out = {"held": None, "pale": None, "gadget": None, "unknown": 0}
    held = loadout.read_held(row)
    if held:
        kind, shape, tone = held
        icon = _id(shape, kind, tone, folder, create)
        out["held"] = (kind, icon)
        out["unknown"] += icon is None
        other = "arme2" if kind == "arme1" else "arme1"
        pshape, ptone = row[other]
        if float(ptone.max()) > 0 and float(np.percentile(ptone, 95)) < PALE_MAX_TONE and pshape.sum() >= weapons.MIN_PIXELS:
            out["pale"] = (other, loadout.identify_pale(pshape, ptone, folder))
    gshape, gtone = row["gadget"]
    # Un gadget utilisé est terne (presque du ton du fond) : son icône est floue et se confondait avec un autre gadget (le shield utilisé lu comme DX3). Seule une icône disponible vote.
    if float(np.percentile(gtone, 95)) >= GADGET_MIN_TONE:
        out["gadget"] = _id(gshape, "gadget", gtone, folder, create)
    return out


def winner(counter):
    """(valeur, voix) la plus fréquente d'un Counter d'identifiants (None ignoré), ou (None, 0)."""
    items = [(v, n) for v, n in counter.most_common() if v is not None]
    return items[0] if items else (None, 0)


def vote_life(reads, game_loadout=None, use_game=False):
    """Équipement d'une vie à partir des lectures d'images.

    reads : {"start": [classify(...)], "end": [classify(...)]}. Renvoie {"weapon1", "weapon2", "gadget", "held", "source", "origins"}."""
    held_votes = {"arme1": Counter(), "arme2": Counter()}
    pale_votes = {"arme1": Counter(), "arme2": Counter()}
    gadget_votes = Counter()
    for c in reads["start"] + reads["end"]:
        if c["held"]:
            held_votes[c["held"][0]][c["held"][1]] += 1
        if c["pale"]:
            pale_votes[c["pale"][0]][c["pale"][1]] += 1
        gadget_votes[c["gadget"]] += 1
    out, origins = {}, {}
    for kind, col in (("arme1", "weapon1"), ("arme2", "weapon2")):
        icon, n = winner(held_votes[kind])
        origin = "lu" if n >= 2 else "lu1"
        if icon is None:
            icon, n = winner(pale_votes[kind])
            origin = "pale"
        out[col], origins[col] = icon, (origin if icon else None)
        out[col + "_votes"] = n
    if out["weapon1"] and out["weapon1"] == out["weapon2"]:  # jamais deux fois la même arme : la moins soutenue cède sa place
        weak = "weapon2" if out["weapon1_votes"] >= out["weapon2_votes"] else "weapon1"
        out[weak], origins[weak] = None, None
    icon, n = winner(gadget_votes)
    out["gadget"], origins["gadget"] = icon, (("lu" if n >= 2 else "lu1") if icon else None)
    if use_game and game_loadout:  # dernier recours : l'équipement de la game (il change à chaque vie : source la moins fiable)
        for col in ("weapon1", "weapon2", "gadget"):
            val = game_loadout.get(col)
            if out[col] is None and val and (col == "gadget" or val not in (out["weapon1"], out["weapon2"])):
                out[col], origins[col] = val, "game"
    # arme tenue à la mort : vote sur les dernières images, repli sur les dernières images de la fenêtre de début
    end_votes = Counter(c["held"][1] for c in reads["end"] if c["held"] and c["held"][1])
    out["held"] = winner(end_votes)[0]
    filled = [o for o in origins.values() if o]
    out["source"] = max(filled, key=ORIGIN_RANK.get) if filled else None
    out["origins"] = origins
    return out


def _workers():
    try:
        return max(1, min(MAX_WORKERS, int(os.environ.get("EVA_WORKERS", MAX_WORKERS))))
    except ValueError:
        return MAX_WORKERS


def _bar_index(slot):
    import names

    for key, slots in names.TEAM_SLOTS.items():
        if slot in slots:
            return key, slots.index(slot)
    raise ValueError(f"slot inconnu : {slot}")


def read_game_frames(video, zones, width, height, start_s, lives):
    """Lit toutes les images nécessaires : {(slot, idx): {"start": [row ou None], "end": [row ou None]}}. Lecture parallèle, ffmpeg une image à la fois par fil."""
    jobs = []  # (clé de vie, phase, instant vidéo, zone, index de bandeau)
    for life in lives:
        key, index = _bar_index(life["slot"])
        start, end = life_times(life["t0"], life["t1"], life["ended"])
        for phase, times in (("start", start), ("end", end)):
            jobs += [((life["slot"], life["idx"]), phase, start_s + t, zones[key], index) for t in times]
    with ThreadPoolExecutor(max_workers=_workers()) as pool:
        rows = list(pool.map(lambda j: read_row(video, j[3], width, height, j[2], j[4]), jobs))
    out = {}
    for job, row in zip(jobs, rows):
        out.setdefault(job[0], {"start": [], "end": []})[job[1]].append(row)
    return out


def compute_detail(conn, game_id, folder=weapons.ICON_DIR, create=False, use_game=False, keep_images=False, frames=None):
    """Calcule l'équipement de chaque vie d'une game sans rien écrire. Renvoie (lignes, rapport).

    frames : lectures déjà faites (read_game_frames) pour rejouer le vote sans relire la vidéo."""
    import db

    g = conn.execute("SELECT g.*, v.path AS video_path, v.width AS vw, v.height AS vh FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (game_id,)).fetchone()
    lives = [dict(r) for r in conn.execute("SELECT slot, idx, t0, t1, ended FROM lives WHERE game_id = ? ORDER BY slot, idx", (game_id,))]
    if g is None or not lives:
        return [], {"error": "game ou vies introuvables"}
    if frames is None:
        if not Path(g["video_path"]).exists():
            return [], {"error": f"vidéo absente : {g['video_path']}"}
        zones = {key: db.zone_for(conn, g["map"], key) for key in ("team_a_bar", "team_b_bar")}
        frames = read_game_frames(g["video_path"], zones, g["vw"], g["vh"], g["start_s"], lives)
    game_rows = db.loadouts_of(conn, game_id)
    rows, report = [], {"lives": len(lives), "frames": 0, "frames_read": 0, "unknown_held": 0, "images": []}
    for life in lives:
        raw = frames.get((life["slot"], life["idx"]), {"start": [], "end": []})
        reads = {"start": [], "end": []}
        for phase in ("start", "end"):
            for row in raw[phase]:
                report["frames"] += 1
                if row is None:
                    continue
                report["frames_read"] += 1
                c = classify(row, folder, create)
                c["banner"] = row["banner"] if keep_images else None
                report["unknown_held"] += c["unknown"]
                reads[phase].append(c)
        mine = game_rows.get(life["slot"]) or {}
        vote = vote_life(reads, {"weapon1": mine.get("arme1"), "weapon2": mine.get("arme2"), "gadget": mine.get("gadget")}, use_game)
        vote["slot"], vote["life_idx"] = life["slot"], life["idx"]
        if keep_images:  # pour la planche de contrôle : une image du bandeau où la case est tenue (armes), à défaut rangée (pâle), ou lue (gadget)
            every = [c for c in reads["start"] + reads["end"] if c["banner"] is not None]
            held_of = lambda kind: next((c["banner"] for c in every if c["held"] and c["held"][0] == kind), None)
            pale_of = lambda kind: next((c["banner"] for c in every if c["pale"] and c["pale"][0] == kind), None)
            vote["banners"] = {
                "arme1": held_of("arme1") if held_of("arme1") is not None else pale_of("arme1"),
                "arme2": held_of("arme2") if held_of("arme2") is not None else pale_of("arme2"),
                "gadget": next((c["banner"] for c in every if c["gadget"]), None),
            }
        rows.append(vote)
    report["team_rule"] = apply_team_rule(rows, lives, weapons.display_names(folder))
    return rows, report


def compute(conn, game_id, folder=weapons.ICON_DIR, create=False, use_game=False):
    """Efface puis réécrit life_loadouts de la game (une ligne par vie) ; renvoie le nombre de lignes. Écrit stats_meta. Vidéo absente : 0, rien n'est effacé."""
    rows, report = compute_detail(conn, game_id, folder, create, use_game)
    if report.get("error"):
        return 0
    write(conn, game_id, rows)
    return len(rows)


def apply_team_rule(rows, lives, names):
    """Règle d'équipe : un seul SHIELD, un seul SONAR et un seul CLONE par équipe à un instant. Quand deux vies qui se chevauchent, de deux joueurs d'une même équipe, ont le même gadget unique, la lecture la
    moins sûre (`source` : lu, lu1, pale, game) est effacée (gadget inconnu plutôt qu'un nom faux) ; à égalité les deux sont effacées (on ne sait pas laquelle est juste). Modifie `rows` sur place et
    renvoie la liste des conflits [{gadget, perdants: [(slot, vie)], gardee: (slot, vie) ou None}]."""
    span = {(l["slot"], l["idx"]): (l["t0"], l["t1"]) for l in lives}
    conflicts, cleared = [], set()
    for team_low in (True, False):
        mine = [r for r in rows if (r["slot"] <= 4) == team_low and r.get("gadget")]
        for name in UNIQUE_GADGETS:
            same = [r for r in mine if names.get(r["gadget"]) == name]
            for i in range(len(same)):
                for j in range(i + 1, len(same)):
                    a, b = same[i], same[j]
                    if a["slot"] == b["slot"]:
                        continue
                    (a0, a1), (b0, b1) = span.get((a["slot"], a["life_idx"]), (0, 0)), span.get((b["slot"], b["life_idx"]), (0, 0))
                    if min(a1, b1) - max(a0, b0) <= TEAM_RULE_MIN_OVERLAP_S:
                        continue
                    ra, rb = ORIGIN_RANK.get(a.get("source"), 4), ORIGIN_RANK.get(b.get("source"), 4)
                    losers = [a, b] if ra == rb else [a] if ra > rb else [b]
                    kept = None if ra == rb else (b if ra > rb else a)
                    conflicts.append({"gadget": name, "perdants": [(r["slot"], r["life_idx"]) for r in losers], "gardee": (kept["slot"], kept["life_idx"]) if kept else None})
                    cleared.update((r["slot"], r["life_idx"]) for r in losers)
    for r in rows:
        if (r["slot"], r["life_idx"]) in cleared:
            r["gadget"] = None
    return conflicts


def write(conn, game_id, rows):
    conn.execute("DELETE FROM life_loadouts WHERE game_id = ?", (game_id,))
    conn.executemany(
        "INSERT INTO life_loadouts (game_id, slot, life_idx, weapon1, weapon2, gadget, held, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(game_id, r["slot"], r["life_idx"], r["weapon1"], r["weapon2"], r["gadget"], r["held"], r["source"]) for r in rows],
    )
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, MODULE, REVISION))
    conn.commit()


def coverage(rows, folder=weapons.ICON_DIR):
    """Chiffres de contrôle : part des cases (arme 1, arme 2, gadget) remplies, part avec un nom connu, répartition des sources."""
    names_ = weapons.display_names(folder)
    cells = [(r[c]) for r in rows for c in ("weapon1", "weapon2", "gadget")]
    filled = [c for c in cells if c]
    held = [r["held"] for r in rows]
    return {
        "vies": len(rows),
        "cases": len(cells),
        "remplies": len(filled),
        "part_remplies": round(len(filled) / len(cells), 3) if cells else None,
        "avec_nom": sum(1 for c in filled if str(names_.get(c, "")).strip()),
        "part_avec_nom": round(sum(1 for c in filled if str(names_.get(c, "")).strip()) / len(cells), 3) if cells else None,
        "held_remplies": sum(1 for h in held if h),
        "sources": dict(Counter(r["source"] for r in rows)),
    }


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Lit l'équipement de chaque vie d'une game sur les bandeaux de la vidéo.")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--dry-run", action="store_true", help="Calcule et affiche les chiffres sans écrire dans la base")
    parser.add_argument("--icons", default=str(weapons.ICON_DIR), help="Dossier des icônes (modèles et names.json)")
    parser.add_argument("--create-icons", action="store_true", help="Créer un modèle pour chaque icône inconnue et nette (à nommer ensuite)")
    parser.add_argument("--game-fallback", action="store_true", help="Reprendre l'équipement de la game (table loadouts) pour les cases restées vides")
    parser.add_argument("--rule-only", action="store_true", help="Applique seulement la règle d'équipe (un SHIELD, un SONAR, un CLONE par équipe) aux lignes déjà écrites, sans relire la vidéo")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    if args.rule_only:
        rows = [dict(r) for r in conn.execute("SELECT slot, life_idx, gadget, source FROM life_loadouts WHERE game_id = ?", (args.game,))]
        lives = [dict(r) for r in conn.execute("SELECT slot, idx, t0, t1 FROM lives WHERE game_id = ?", (args.game,))]
        conflicts = apply_team_rule(rows, lives, weapons.display_names(Path(args.icons)))
        if conflicts and not args.dry_run:
            for slot, life in {p for c in conflicts for p in c["perdants"]}:
                conn.execute("UPDATE life_loadouts SET gadget = NULL WHERE game_id = ? AND slot = ? AND life_idx = ?", (args.game, slot, life))
            conn.commit()
        print(json.dumps({"game": args.game, "conflits": conflicts, "écrit": bool(conflicts) and not args.dry_run}, ensure_ascii=False))
        return 0
    rows, report = compute_detail(conn, args.game, Path(args.icons), args.create_icons, args.game_fallback)
    if report.get("error"):
        print(json.dumps({"game": args.game, "error": report["error"]}, ensure_ascii=False))
        return 1
    if not args.dry_run:
        write(conn, args.game, rows)
    report.pop("images", None)
    print(json.dumps({"game": args.game, MODULE: len(rows), "écrit": not args.dry_run, **report, **coverage(rows, Path(args.icons))}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
