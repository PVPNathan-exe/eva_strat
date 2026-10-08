"""Réglage automatique du suivi des joueurs.

Principe : les numéros lus sur les pastilles servent de vérité terrain gratuite. On en cache une partie au hasard, on relance
le suivi, et on regarde s'il retrouve le bon joueur. Les réglages (tracking_params.json, rangés dans le dépôt) sont ensuite
améliorés par essais successifs : on ne garde un essai que s'il fait mieux, et on repart toujours des meilleurs réglages
sauvegardés, donc on peut relancer sur de nouvelles vidéos sans rien perdre.

Les jeux de données (analysis/datasets/*.json.gz) contiennent les détections de la minimap, sans la vidéo : le réglage se
refait donc sur n'importe quel PC avec un simple `git pull`.

  python tune.py build --video "chemin.mp4" --name ceres-2     # extrait les détections des games de la vidéo (base SQLite)
  python tune.py eval                                          # note des réglages actuels sur tous les jeux de données
  python tune.py search --iterations 200                       # cherche de meilleurs réglages, sauvegardés s'ils sont meilleurs
"""

import argparse
import gzip
import json
import math
import random
import time
from datetime import datetime, timezone
from pathlib import Path

import tracking

HERE = Path(__file__).parent
DATASETS_DIR = HERE / "datasets"
HISTORY_PATH = HERE / "tracking_params.history.jsonl"
MASK_P = 0.7  # part des numéros lus qu'on cache pour tester le suivi
POS_TOL = 0.02  # distance pour dire « c'est la même pastille »

# Bornes de recherche de chaque réglage.
BOUNDS = {
    "GATE_BASE": (0.01, 0.12),
    "GATE_SPEED": (0.08, 0.6),
    "MAX_MISS_S": (0.4, 2.5),
    "ASSIGN_GAP_S": (0.4, 3.0),
    "ASSIGN_GAP_DIST": (0.06, 0.35),
    "X_LINK_S": (1.0, 5.0),
    "X_LINK_DIST": (0.05, 0.3),
    "SMOOTH_S": (0.2, 1.5),
    "VOTE_MISMATCH": (0.02, 0.3),
    "SKEW_FULL": (0.05, 1.5),
    "FLIP_COST": (0.5, 8.0),
}

KEEP = ("team", "x", "y", "number", "slot", "angle", "axis", "skew", "alive", "spectated")


# ---------- jeux de données ----------

def _compact(det):
    out = {}
    for k in KEEP:
        v = det.get(k)
        out[k] = round(v, 4) if isinstance(v, float) else v
    return out


def save_dataset(name, games, step_s, map_name=None, folder=DATASETS_DIR):
    """games : [{"game_id", "frames": [(i, t, [détections])]}]."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    payload = {
        "name": name,
        "map": map_name,
        "step_s": step_s,
        "games": [
            {"game_id": g["game_id"], "frames": [[i, round(t, 3), [_compact(d) for d in dets]] for i, t, dets in g["frames"]]}
            for g in games
        ],
    }
    path = folder / f"{name}.json.gz"
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))
    return path


def load_datasets(folder=DATASETS_DIR):
    out = []
    for path in sorted(Path(folder).glob("*.json.gz")):
        with gzip.open(path, "rt", encoding="utf-8") as f:
            data = json.load(f)
        data["games"] = [{"game_id": g["game_id"], "frames": [(i, t, dets) for i, t, dets in g["frames"]]} for g in data["games"]]
        out.append(data)
    return out


# ---------- notation ----------

def _mask_reads(frames, rng, p=MASK_P):
    """Copie des détections où une part des numéros lus est cachée. Renvoie (frames masquées, vérité {(i, k): slot})."""
    truth, masked = {}, []
    for i, t, dets in frames:
        new = []
        for k, d in enumerate(dets):
            d = dict(d)
            if d.get("alive") and d.get("slot") and rng.random() < p:
                truth[(i, k)] = (d["slot"], d["x"], d["y"])
                d["slot"] = d["number"] = None
            new.append(d)
        masked.append((i, t, new))
    return masked, truth


def _stability(rows):
    """Sauts d'identité probables et demi-tours de direction par 1000 lignes, morts qui revivent aussitôt."""
    by = {}
    for r in rows:
        by.setdefault(r[2], []).append(r)
    jumps = flips = flicker = 0
    for rs in by.values():
        rs.sort(key=lambda r: r[0])
        for a, b in zip(rs, rs[1:]):
            if b[0] - a[0] != 1:
                continue
            if a[7] and b[7]:
                if math.hypot(a[4] - b[4], a[5] - b[5]) > 0.15:
                    jumps += 1
                if a[6] is not None and b[6] is not None and abs((a[6] - b[6] + 180) % 360 - 180) > 150:
                    flips += 1
            elif not a[7] and b[7]:
                flicker += 1
    n = max(len(rows), 1)
    return jumps * 1000 / n, flips * 1000 / n, flicker * 1000 / n


def evaluate(datasets, seed=0):
    """Note des réglages actuels (module tracking) sur des jeux de données."""
    right = wrong = missing = 0
    jumps = flips = flicker = 0.0
    games = 0
    for ds in datasets:
        step = ds["step_s"]
        for g in ds["games"]:
            rng = random.Random(f"{seed}-{ds['name']}-{g['game_id']}")
            masked, truth = _mask_reads(g["frames"], rng)
            rows = tracking.solve(masked, step)
            index = {}
            for r in rows:
                index.setdefault(r[0], []).append(r)
            for (i, _), (slot, x, y) in truth.items():
                near = [r for r in index.get(i, []) if abs(r[4] - x) <= POS_TOL and abs(r[5] - y) <= POS_TOL and r[7]]
                if not near:
                    missing += 1
                elif any(r[2] == slot for r in near):
                    right += 1
                else:
                    wrong += 1
            j, f, k = _stability(tracking.solve(g["frames"], step))
            jumps, flips, flicker, games = jumps + j, flips + f, flicker + k, games + 1
    total = max(right + wrong + missing, 1)
    games = max(games, 1)
    m = {
        "identity_accuracy": right / total,
        "wrong": wrong / total,
        "missing": missing / total,
        "jumps_per_1000": jumps / games,
        "flips_per_1000": flips / games,
        "flicker_per_1000": flicker / games,
        "tested_reads": total,
    }
    m["objective"] = 100 * m["identity_accuracy"] - 2 * m["jumps_per_1000"] - 1 * m["flips_per_1000"] - 1 * m["flicker_per_1000"]
    return m


# ---------- réglages sauvegardés ----------

def save_params(params, metrics, datasets, iterations, path=tracking.PARAMS_PATH):
    old = {}
    if Path(path).exists():
        old = json.loads(Path(path).read_text(encoding="utf-8"))
    record = {
        "version": old.get("version", 0) + 1,
        "saved": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "iterations_total": old.get("iterations_total", 0) + iterations,
        "datasets": sorted(d["name"] for d in datasets),
        "score": {k: round(v, 4) if isinstance(v, float) else v for k, v in metrics.items()},
        "params": {k: round(float(v), 4) for k, v in params.items()},
    }
    Path(path).write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    with open(HISTORY_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return record


def search(datasets, iterations, seed=1, budget_s=None, log=print):
    """Recherche locale : on perturbe 1 à 3 réglages, on garde l'essai s'il améliore la note. Repart des réglages sauvegardés."""
    rng = random.Random(seed)
    best_params = tracking.current_params()
    best = evaluate(datasets)
    log(f"départ : objectif {best['objective']:.2f} | identité {100 * best['identity_accuracy']:.1f} % "
        f"(faux {100 * best['wrong']:.1f} %, manquants {100 * best['missing']:.1f} %) | sauts {best['jumps_per_1000']:.1f} "
        f"demi-tours {best['flips_per_1000']:.1f} morts-vivants {best['flicker_per_1000']:.1f} (pour 1000 lignes)")
    baseline = best
    start = time.time()
    done = 0
    for it in range(iterations):
        if budget_s and time.time() - start > budget_s:
            break
        trial = dict(best_params)
        for name in rng.sample(list(BOUNDS), rng.choice((1, 2, 3))):
            lo, hi = BOUNDS[name]
            trial[name] = min(hi, max(lo, trial[name] * math.exp(rng.gauss(0, 0.3))))
        tracking.configure(trial)
        m = evaluate(datasets)
        done += 1
        if m["objective"] > best["objective"] + 1e-6:
            best, best_params = m, trial
            log(f"essai {it + 1}: objectif {m['objective']:.2f} | identité {100 * m['identity_accuracy']:.1f} % | sauts {m['jumps_per_1000']:.1f} demi-tours {m['flips_per_1000']:.1f}")
    tracking.configure(best_params)
    return best_params, best, done, baseline


# ---------- ligne de commande ----------

def _cmd_build(args):
    import db
    import ingest
    import positions

    conn = db.connect(args.db)
    path = Path(args.video).resolve()
    row = conn.execute("SELECT id, width, height FROM videos WHERE path = ?", (str(path),)).fetchone()
    if not row:
        raise SystemExit("Vidéo inconnue : charge-la d'abord dans l'onglet Analyse.")
    meta = ingest.probe(path)
    step = args.every / meta["fps"]
    games = []
    for g in conn.execute("SELECT id, start_s, end_s, map FROM games WHERE video_id = ? ORDER BY start_s", (row["id"],)).fetchall():
        zone = db.zone_for(conn, g["map"], "minimap")
        frames = positions.detect_frames(path, dict(g), zone, meta["width"], meta["height"], step_s=step)
        print(f"game {g['id']} ({g['map']}) : {len(frames)} lectures")
        games.append({"game_id": g["id"], "frames": frames, "map": g["map"]})
    maps = sorted({g["map"] for g in games if g["map"]})
    out = save_dataset(args.name, games, step, map_name=",".join(maps) or None)
    print("jeu de données enregistré :", out)


def _cmd_eval(args):
    datasets = load_datasets()
    if not datasets:
        raise SystemExit("Aucun jeu de données : lance d'abord « build ».")
    m = evaluate(datasets)
    print(json.dumps({k: round(v, 4) if isinstance(v, float) else v for k, v in m.items()}, indent=2))


def _cmd_search(args):
    datasets = load_datasets()
    if not datasets:
        raise SystemExit("Aucun jeu de données : lance d'abord « build ».")
    params, metrics, done, baseline = search(datasets, args.iterations, seed=args.seed, budget_s=args.minutes * 60 if args.minutes else None)
    # Comparaison sur les jeux de données actuels : les réglages sauvegardés sont d'abord renotés (de nouvelles vidéos ont pu s'ajouter).
    if not tracking.PARAMS_PATH.exists() or metrics["objective"] > baseline["objective"] + 1e-6:
        rec = save_params(params, metrics, datasets, done)
        print(f"réglages sauvegardés (version {rec['version']}) : objectif {baseline['objective']:.2f} -> {metrics['objective']:.2f}")
    else:
        print(f"pas d'amélioration (objectif {baseline['objective']:.2f}) : les réglages sauvegardés ne changent pas")


def main(argv=None):
    p = argparse.ArgumentParser(description="Réglage automatique du suivi des joueurs.")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="extrait les détections d'une vidéo déjà chargée")
    b.add_argument("--video", required=True)
    b.add_argument("--name", required=True)
    b.add_argument("--db", default=str(HERE.parent / "data" / "eva.db"))
    b.add_argument("--every", type=int, default=6, help="une lecture toutes les N images")
    b.set_defaults(fn=_cmd_build)
    e = sub.add_parser("eval", help="note des réglages actuels")
    e.set_defaults(fn=_cmd_eval)
    s = sub.add_parser("search", help="cherche de meilleurs réglages")
    s.add_argument("--iterations", type=int, default=200)
    s.add_argument("--minutes", type=float, default=None, help="temps maximal")
    s.add_argument("--seed", type=int, default=1)
    s.set_defaults(fn=_cmd_search)
    args = p.parse_args(argv)
    args.fn(args)


if __name__ == "__main__":
    main()
