"""Bilan de qualité d'une vidéo analysée : pour chaque game, ce qui paraît fiable et ce qu'il faut vérifier.

  python analysis/recap.py --video 2            (ou --source "chemin de la vidéo")

Les contrôles sont des indices, pas une vérité : un seuil dépassé veut dire « regarde ici », pas « c'est faux »."""

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import db
import tracking
import weapons

# Seuils des contrôles
MIN_COVERAGE = 0.6  # part des images où un joueur a une ligne (vivant ou croix) ; en dessous, il est souvent perdu
MAX_FILLED = 0.25  # part des lignes vivantes comblées par interpolation ou élimination (confiance <= 0,5)
JUMP = 0.3  # saut de position (relatif à la minimap) d'une ligne à la suivante, en dessous d'une seconde : suspect
FROZEN_S = 40.0  # un joueur vivant qui ne bouge pas aussi longtemps est suspect (pastille figée, mal rattachée)
MAX_UNKNOWN_KILLERS = 0.25
MIN_SLOTS = 8


def _names():
    return {k: str(v) for k, v in weapons.display_names().items()}


def game_report(conn, g, names, current_version):
    """Contrôles d'une game : renvoie (lignes de texte, liste de problèmes)."""
    gid = g["id"]
    problems, lines = [], []
    duration = g["end_s"] - g["start_s"]
    head = f"Game {g['rank']} · {g['map'] or 'carte inconnue'} · {int(duration // 60)}:{int(duration % 60):02d}"

    # --- joueurs et équipement
    players = {r["slot"]: r["name"] for r in conn.execute("SELECT slot, name FROM players WHERE game_id = ?", (gid,))}
    if len(players) < MIN_SLOTS:
        problems.append(f"{len(players)} pseudos lus sur 8")
    loads = db.loadouts_of(conn, gid)
    unnamed, dup = set(), []
    for slot, row in loads.items():
        for field in ("arme1", "arme2", "gadget"):
            if row[field] and not names.get(row[field]):
                unnamed.add(row[field])
        if row["arme1"] and row["arme1"] == row["arme2"]:
            dup.append(slot)
    if len(loads) < MIN_SLOTS:
        problems.append(f"équipement lu pour {len(loads)} joueurs sur 8")
    if dup:
        problems.append(f"même arme deux fois chez {dup}")
    if unnamed:
        problems.append(f"icônes sans nom : {', '.join(sorted(unnamed))}")

    # --- positions
    meta = conn.execute("SELECT params_version FROM samples_meta WHERE game_id = ?", (gid,)).fetchone()
    rows = conn.execute("SELECT frame, t, slot, x, y, alive, confidence FROM samples WHERE game_id = ? ORDER BY slot, t", (gid,)).fetchall()
    if not rows:
        problems.append("aucune position lue")
        frames = 0
    else:
        frames = len({r["frame"] for r in rows})
        if meta and meta["params_version"] != current_version:
            problems.append("positions lues avec une ancienne version de l'algorithme")
        by_slot = defaultdict(list)
        for r in rows:
            by_slot[r["slot"]].append(r)
        weak, jumpy, frozen = [], {}, []
        filled_total = alive_total = 0
        for slot, rs in by_slot.items():
            if len(rs) / max(frames, 1) < MIN_COVERAGE:
                weak.append((slot, round(len(rs) / frames, 2)))
            alive = [r for r in rs if r["alive"]]
            alive_total += len(alive)
            filled_total += sum(1 for r in alive if r["confidence"] is not None and r["confidence"] <= 0.5)
            jumps = 0
            for a, b in zip(alive, alive[1:]):
                if b["t"] - a["t"] <= 1.0 and math.hypot(b["x"] - a["x"], b["y"] - a["y"]) > JUMP:
                    jumps += 1
            if jumps:
                jumpy[slot] = jumps
            still_from = None
            for a, b in zip(alive, alive[1:]):
                if math.hypot(b["x"] - a["x"], b["y"] - a["y"]) < 0.004:
                    still_from = a["t"] if still_from is None else still_from
                    if b["t"] - still_from >= FROZEN_S:
                        frozen.append((slot, round(still_from)))
                        break
                else:
                    still_from = None
        missing = [s for s in range(1, 9) if s not in by_slot]
        if missing:
            problems.append(f"aucune position pour les joueurs {missing}")
        if weak:
            problems.append("joueurs souvent perdus (part des images avec une ligne) : " + ", ".join(f"{s} ({c})" for s, c in weak))
        if alive_total and filled_total / alive_total > MAX_FILLED:
            problems.append(f"{round(100 * filled_total / alive_total)} % des positions vivantes sont comblées (interpolées ou par élimination)")
        if jumpy:
            problems.append("sauts de position suspects : " + ", ".join(f"joueur {s} ×{n}" for s, n in sorted(jumpy.items())))
        if frozen:
            problems.append("joueur vivant figé plus de 40 s : " + ", ".join(f"{s} (dès {t} s)" for s, t in frozen))
        lines.append(f"positions : {len(rows)} lignes sur {frames} images, {round(100 * filled_total / max(alive_total, 1))} % comblées")

    # --- kills
    kills = db.kills_of(conn, gid)
    kinds = Counter(k["kind"] for k in kills)
    withkiller = [k for k in kills if k["killer_slot"] is not None and k["kind"] in ("kill", "inferred")]
    no_weapon = [k for k in withkiller if not k["weapon"]]
    unknown = kinds.get("unknown", 0)
    scored = len(kills) - kinds.get("environment", 0)
    if not kills:
        problems.append("aucun kill lu")
    else:
        if scored and unknown / scored > MAX_UNKNOWN_KILLERS:
            problems.append(f"{unknown} kills sur {scored} sans tueur identifié")
        if withkiller and no_weapon:
            problems.append(f"{len(no_weapon)} kills sur {len(withkiller)} sans arme (bandeau ambigu)")
        unnamed_used = {k["weapon"] for k in withkiller if k["weapon"] and not names.get(k["weapon"])}
        if unnamed_used:
            problems.append(f"armes de kills sans nom : {', '.join(sorted(unnamed_used))}")
        lines.append(f"kills : {len(kills)} ({', '.join(f'{n} {k}' for k, n in sorted(kinds.items(), key=lambda kv: str(kv[0])))})")

    # --- capture
    cap = conn.execute("SELECT COUNT(*) AS n, MAX(pct) AS top FROM capture_state WHERE game_id = ?", (gid,)).fetchone()
    if not cap["n"]:
        problems.append("score de capture non lu")
    else:
        lines.append(f"capture : {cap['n']} lectures, maximum {round(cap['top'] or 0)} %")
    return head, lines, problems


def main(argv=None):
    parser = argparse.ArgumentParser(description="Bilan de qualité d'une vidéo analysée.")
    parser.add_argument("--db", default="data/eva.db")
    parser.add_argument("--video", type=int, default=None, help="Identifiant de la vidéo")
    parser.add_argument("--source", default=None, help="Chemin de la vidéo")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    if args.video is None:
        row = conn.execute("SELECT id FROM videos WHERE path = ?", (str(Path(args.source).resolve()),)).fetchone() if args.source else None
        if not row and args.source:
            row = conn.execute("SELECT id FROM videos WHERE path LIKE ?", ("%" + Path(args.source).name,)).fetchone()
        if not row:
            print("Vidéo inconnue : indique --video ou --source")
            return 1
        args.video = row["id"]
    names = _names()
    games = [dict(r) for r in conn.execute("SELECT id, start_s, end_s, map FROM games WHERE video_id = ? ORDER BY start_s", (args.video,))]
    for i, g in enumerate(games, 1):
        g["rank"] = i
    ok = 0
    out = []
    for g in games:
        head, lines, problems = game_report(conn, g, names, tracking.PARAMS_VERSION)
        ok += not problems
        out.append(f"{'OK ' if not problems else 'A VERIFIER'}  {head}")
        out += [f"      {line}" for line in lines]
        out += [f"      ! {p}" for p in problems]
    print(f"Bilan : {ok} game(s) sans point à vérifier sur {len(games)}")
    print("\n".join(out))
    unnamed_all = [w for w in sorted(Path(weapons.ICON_DIR).glob("[BG]*.png")) if not names.get(w.stem)]
    if unnamed_all:
        print(f"Icônes d'armes sans nom : {', '.join(w.stem for w in unnamed_all)}")
    reviews = Path(weapons.ICON_DIR) / "reviews.json"
    if reviews.exists():
        flagged = [k for k, v in json.loads(reviews.read_text(encoding="utf-8")).items() if v.get("reported")]
        if flagged:
            print(f"Icônes signalées à recalculer : {', '.join(flagged)}")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
