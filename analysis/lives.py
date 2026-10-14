"""Vies des joueurs d'une game (table `lives`) : `python analysis/lives.py --game N [--db chemin] [--measure]`.

Définition (docs/PLAN_STATS_AGENTS.md, section 2) : une **vie** va de l'apparition (première ligne vivante après une mort, ou début de la game) à la mort (dernière ligne vivante)
ou à la fin de la game (`ended = end`). Les temps sont en secondes depuis le début de la game (les `samples` et les `kills` sont en temps de vidéo : on retranche `games.start_s`),
les positions en fractions de la minimap. Le tueur, l'arme et le genre du kill viennent du killfeed (`kills`), rapprochés de la fin de la vie à `KILL_MATCH_S` près.

Lecture des `samples` (une ligne par image et par joueur, `alive` 1 ou 0) : après une mort la minimap garde une croix environ 2 s (lignes `alive = 0`), puis plus aucune ligne jusqu'à la
réapparition (environ 15 à 17 s après la mort). Mesuré sur les games 25, 26 et 27 : le suivi lit parfois une brève ligne vivante (de 1 à 3 s) pendant cette attente (le disque blanc
du joueur mort qui attend), puis une seconde « mort » sans kill. Ces lignes ne sont pas des vies : voir `MIN_RESPAWN_S`."""

import argparse
import json
import sys

REVISION = 1
MODULE = "lives"
GAP_S = 0.35  # un trou plus long entre deux lignes vivantes coupe la suite (le suivi échantillonne tous les 0,1 s)
MIN_RESPAWN_S = 12.0  # une ligne vivante moins de 12 s après une mort confirmée est l'attente du joueur mort, pas une vie
KILL_MATCH_S = 2.0  # un kill du killfeed et la fin d'une vie sont le même événement à 2 s près
DEAD_ROWS_MIN = 10  # dernière vie sans kill : au moins 1 s de lignes mortes après la dernière ligne vivante pour parler de mort
END_TAIL_S = 3.0  # dernière vie qui s'arrête à plus de 3 s de la fin de la game, sans lignes mortes : c'est tout de même une mort perdue
DEATH_CROSS_S = 0.5  # la croix de mort sert de position de mort si elle suit la dernière ligne vivante de 0,5 s au plus


def read_rows(conn, game_id):
    """(début de la game, durée, {slot: [(t, alive, x, y)]}, kills) avec des temps depuis le début de la game ; kills : [(t, killer_slot, victim_slot, weapon, kind)]."""
    start, end = tuple(conn.execute("SELECT start_s, end_s FROM games WHERE id = ?", (game_id,)).fetchone())
    rows = {}
    for t, slot, alive, x, y in conn.execute("SELECT t, slot, alive, x, y FROM samples WHERE game_id = ? ORDER BY slot, t", (game_id,)):
        rows.setdefault(slot, []).append((round(t - start, 3), 1 if alive else 0, x, y))
    kills = [(round(t - start, 3), k, v, w, kind) for t, k, v, w, kind in conn.execute("SELECT t, killer_slot, victim_slot, weapon, kind FROM kills WHERE game_id = ? ORDER BY t", (game_id,))]
    return start, end - start, rows, kills


def _segments(rows):
    """Suites de lignes vivantes sans trou : [(indice de la première ligne, indice de la dernière)]."""
    out, first, prev = [], None, None
    for i, (t, alive, _x, _y) in enumerate(rows):
        if not alive:
            continue
        if first is not None and t - rows[prev][0] > GAP_S:
            out.append((first, prev))
            first = None
        if first is None:
            first = i
        prev = i
    if first is not None:
        out.append((first, prev))
    return out


def _confirmed_by_kill(kills, slot, t, used):
    """Indice du kill de ce joueur le plus proche de t (à KILL_MATCH_S près) et pas encore pris, sinon None."""
    best = None
    for i, k in enumerate(kills):
        if k[2] != slot or i in used or abs(k[0] - t) > KILL_MATCH_S:
            continue
        if best is None or abs(k[0] - t) < abs(kills[best][0] - t):
            best = i
    return best


def build_slot(rows, kills, slot, duration, used):
    """Vies d'un joueur. Une fin de suite vivante est une mort si le killfeed la confirme ou si le joueur ne revit pas avant MIN_RESPAWN_S ; sinon c'est un clignotement du suivi
    et la suite continue la même vie. Une suite vivante qui commence moins de MIN_RESPAWN_S après une mort est ignorée (attente du joueur mort). `used` : indices de kills déjà rapprochés (modifié)."""
    segs = _segments(rows)
    lives, i = [], 0
    while i < len(segs):
        a, b = segs[i]
        while True:
            death_t = rows[b][0]
            kill = _confirmed_by_kill(kills, slot, death_t, used)
            nxt = segs[i + 1] if i + 1 < len(segs) else None
            if kill is not None or nxt is None or rows[nxt[0]][0] - death_t >= MIN_RESPAWN_S:
                break
            i += 1
            b = segs[i][1]
        ended = _ending(rows, b, duration, kill is not None)
        if kill is not None:
            used.add(kill)
        lives.append(_life(rows, a, b, ended, kills[kill] if kill is not None else None))
        i += 1
        while i < len(segs) and rows[segs[i][0]][0] - rows[b][0] < MIN_RESPAWN_S:
            i += 1
    return lives


def _ending(rows, b, duration, confirmed):
    """'death' ou 'end' pour la vie qui finit à l'indice b. Sans kill : mort si au moins 1 s de lignes mortes suivent, ou si les lignes s'arrêtent à plus de END_TAIL_S de la fin de la game."""
    later = rows[b + 1:]
    if confirmed or any(r[1] for r in later):
        return "death"
    if sum(1 for r in later if not r[1]) >= DEAD_ROWS_MIN:
        return "death"
    if not later and duration - rows[b][0] > END_TAIL_S:
        return "death"
    return "end"


def _life(rows, a, b, ended, kill):
    """Ligne de `lives` (sans game_id, slot ni idx). Position de mort : la croix qui suit la dernière ligne vivante si elle est collée à elle."""
    t1, x1, y1 = rows[b][0], rows[b][2], rows[b][3]
    if ended == "death" and b + 1 < len(rows) and not rows[b + 1][1] and rows[b + 1][0] - t1 <= DEATH_CROSS_S and rows[b + 1][2] is not None:
        x1, y1 = rows[b + 1][2], rows[b + 1][3]
    return {
        "t0": rows[a][0], "t1": t1, "x0": rows[a][2], "y0": rows[a][3], "x1": x1, "y1": y1, "ended": ended,
        "killer_slot": kill[1] if kill else None, "weapon": kill[3] if kill else None, "kill_kind": kill[4] if kill else None,
    }


def build(rows, kills, duration):
    """({slot: [vies]}, indices des kills rapprochés d'une fin de vie) pour toute la game."""
    used = set()
    out = {slot: build_slot(r, kills, slot, duration, used) for slot, r in sorted(rows.items())}
    return out, used


def compute(conn, game_id):
    """Efface puis réécrit les vies de la game ; renvoie leur nombre. Écrit aussi stats_meta."""
    _start, duration, rows, kills = read_rows(conn, game_id)
    lives, _used = build(rows, kills, duration)
    conn.execute("DELETE FROM lives WHERE game_id = ?", (game_id,))
    n = 0
    for slot, items in lives.items():
        for idx, v in enumerate(items):
            conn.execute(
                "INSERT INTO lives (game_id, slot, idx, t0, t1, x0, y0, x1, y1, ended, killer_slot, weapon, kill_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (game_id, slot, idx, v["t0"], v["t1"], v["x0"], v["y0"], v["x1"], v["y1"], v["ended"], v["killer_slot"], v["weapon"], v["kill_kind"]),
            )
            n += 1
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, MODULE, REVISION))
    conn.commit()
    return n


def measure(conn, game_id):
    """Chiffres de contrôle d'une game : part des kills du killfeed qui tombent sur une fin de vie, vies par joueur, durées de vie et d'attente."""
    _start, duration, rows, kills = read_rows(conn, game_id)
    lives, used = build(rows, kills, duration)
    deaths = [v for items in lives.values() for v in items if v["ended"] == "death"]
    durations = sorted(v["t1"] - v["t0"] for items in lives.values() for v in items)
    waits = sorted(items[i + 1]["t0"] - items[i]["t1"] for items in lives.values() for i in range(len(items) - 1))
    return {
        "kills": len(kills), "kills_sur_fin_de_vie": len(used), "morts_sans_kill": sum(1 for v in deaths if v["kill_kind"] is None),
        "vies_par_joueur": {s: len(items) for s, items in lives.items()}, "vies": len(durations),
        "duree_vie_mediane": durations[len(durations) // 2] if durations else None,
        "attente_min": waits[0] if waits else None, "attente_mediane": waits[len(waits) // 2] if waits else None, "attente_max": waits[-1] if waits else None,
        "vies_de_moins_de_3_s": sum(1 for d in durations if d < 3.0),
    }


def main(argv=None):
    import db
    import paths
    parser = argparse.ArgumentParser(description="Calcule les vies d'une game.")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--measure", action="store_true", help="Affiche les chiffres de contrôle sans rien écrire")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    print(json.dumps(measure(conn, args.game) if args.measure else {MODULE: compute(conn, args.game)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
