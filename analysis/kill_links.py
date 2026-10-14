"""Liens entre kills (table `kill_links`) : trade kills et revenges. `python analysis/kill_links.py --game N [--db chemin] [--measure]`.

Définitions figées (docs/PLAN_STATS_AGENTS.md, section 2). Temps en secondes depuis le début de la game, distances en mètres (`ARENA_M`).
- **Trade kill** : duel où les deux joueurs meurent presque en même temps : deux kills croisés (A tue B et B tue A) à moins de `TRADE_S` (1,0 s) l'un de l'autre.
  Une ligne par victime : `victim_slot` = le joueur mort sur la ligne, `other_slot` = l'autre joueur du duel, `t` = l'heure de sa mort, `dt` = écart entre les deux kills,
  `dist_m` = distance entre les deux lieux de mort.
- **Revenge** (ancien « trade ») : un coéquipier de la victime tue le tueur dans les `REVENGE_S` (5,0 s) qui suivent, à moins de `REVENGE_M` (12 m) du lieu du premier kill.
  Ligne sur le kill vengeur : `t` = son heure, `victim_slot` = le tueur vengé (le mort de ce kill), `other_slot` = le joueur vengé, `dt` = délai entre les deux kills,
  `dist_m` = distance entre le lieu du premier kill (mort du joueur vengé) et celui du kill vengeur (mort du tueur). Un kill ne venge qu'un seul joueur (la clé de la table
  n'a qu'une ligne par mort) : le plus récent.
Seuls comptent les kills avec un tueur lu (`kill` ou `inferred`) d'une autre équipe que la victime. Les lieux sont lus sur les `samples` (la croix de mort reste en place)."""

import argparse
import bisect
import json
import math
import sys

import lives

REVISION = 1
MODULE = "kill_links"
ARENA_M = (31.0, 16.5)  # largeur et hauteur de la minimap en mètres
TRADE_S = 1.0  # deux kills croisés à moins de 1,0 s l'un de l'autre
REVENGE_S = 5.0  # le coéquipier tue le tueur dans les 5,0 s
REVENGE_M = 12.0  # et à moins de 12 m du lieu du premier kill
POS_WINDOW_S = 3.0  # un lieu est lu sur la ligne la plus proche du kill, à 3 s au plus (la croix de mort reste en place)
KILL_KINDS = ("kill", "inferred")


def team_of(slot):
    return "A" if slot <= 4 else "B"


def _valid_kills(kills):
    """Kills utilisables : (t, tueur, victime) avec un tueur d'une autre équipe que la victime."""
    return [(k[0], k[1], k[2]) for k in kills if k[1] is not None and k[4] in KILL_KINDS and k[1] != k[2] and team_of(k[1]) != team_of(k[2])]


def position_index(rows):
    """{slot: (temps, positions)} des lignes avec une position, pour retrouver un lieu par bisection."""
    out = {}
    for slot, items in rows.items():
        pts = [r for r in items if r[2] is not None]
        out[slot] = ([r[0] for r in pts], [(r[2], r[3]) for r in pts])
    return out


def position_at(index, slot, t):
    """Position du joueur à l'instant t (ligne la plus proche, à POS_WINDOW_S au plus), sinon None."""
    times, pos = index.get(slot, ([], []))
    if not times:
        return None
    i = bisect.bisect_left(times, t)
    best = min((j for j in (i - 1, i) if 0 <= j < len(times)), key=lambda j: abs(times[j] - t))
    return pos[best] if abs(times[best] - t) <= POS_WINDOW_S else None


def distance_m(p, q):
    if p is None or q is None:
        return None
    return math.hypot((p[0] - q[0]) * ARENA_M[0], (p[1] - q[1]) * ARENA_M[1])


def find_trades(kills, index, max_dt=TRADE_S):
    """Lignes de trade : [(t, victime, 'trade', autre, dt, dist_m)]. Appariement glouton par écart croissant, un kill dans un seul duel."""
    valid = _valid_kills(kills)
    pairs = []
    for i, (t1, a, b) in enumerate(valid):
        for j in range(i + 1, len(valid)):
            t2, c, d = valid[j]
            if t2 - t1 > max_dt:
                break
            if c == b and d == a:
                pairs.append((round(abs(t2 - t1), 3), i, j))
    out, taken = [], set()
    for dt, i, j in sorted(pairs):
        if i in taken or j in taken:
            continue
        taken.update((i, j))
        (t1, a, b), (t2, _c, _d) = valid[i], valid[j]
        dist = distance_m(position_at(index, b, t1), position_at(index, a, t2))
        out.append((t1, b, "trade", a, dt, dist))
        out.append((t2, a, "trade", b, dt, dist))
    return out


def find_revenges(kills, index, max_dt=REVENGE_S, max_dist=REVENGE_M):
    """Lignes de revenge : [(t, tueur vengé, 'revenge', joueur vengé, dt, dist_m)]. Pour chaque kill, le premier kill vengé le plus récent qui respecte les deux seuils."""
    valid = _valid_kills(kills)
    out = []
    for t2, w, a in valid:
        best = None
        for t1, killer, v in valid:
            if killer != a or v == w or team_of(v) != team_of(w) or not 0 <= t2 - t1 <= max_dt:
                continue
            dist = distance_m(position_at(index, v, t1), position_at(index, a, t2))
            if dist is not None and dist > max_dist:
                continue
            if best is None or t2 - t1 < best[4]:
                best = (t2, a, "revenge", v, round(t2 - t1, 3), dist)
        if best is not None:
            out.append(best)
    return out


def compute(conn, game_id):
    """Efface puis réécrit les liens de la game ; renvoie leur nombre. Écrit aussi stats_meta."""
    _start, _duration, rows, kills = lives.read_rows(conn, game_id)
    index = position_index(rows)
    found = find_trades(kills, index) + find_revenges(kills, index)
    conn.execute("DELETE FROM kill_links WHERE game_id = ?", (game_id,))
    for t, victim, kind, other, dt, dist in found:
        conn.execute("INSERT OR REPLACE INTO kill_links (game_id, t, victim_slot, kind, other_slot, dt, dist_m) VALUES (?, ?, ?, ?, ?, ?, ?)", (game_id, t, victim, kind, other, dt, dist))
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, MODULE, REVISION))
    conn.commit()
    return conn.execute("SELECT COUNT(*) FROM kill_links WHERE game_id = ?", (game_id,)).fetchone()[0]


def measure(conn, game_id):
    """Distributions pour justifier les seuils : écarts des paires de kills croisés (jusqu'à 6 s) et délais et distances des revenges candidats (jusqu'à 15 s, sans seuil de distance)."""
    _start, _duration, rows, kills = lives.read_rows(conn, game_id)
    index = position_index(rows)
    wide_trades = find_trades(kills, index, max_dt=6.0)
    wide_revenges = find_revenges(kills, index, max_dt=15.0, max_dist=1e9)
    return {
        "kills_valides": len(_valid_kills(kills)),
        "trades_dt": sorted(round(r[4], 1) for r in wide_trades[::2]),
        "trades_retenus": sum(1 for r in find_trades(kills, index)) // 2,
        "revenges_dt_et_dist": sorted((round(r[4], 1), None if r[5] is None else round(r[5], 1)) for r in wide_revenges),
        "revenges_retenus": len(find_revenges(kills, index)),
    }


def main(argv=None):
    import db
    import paths
    parser = argparse.ArgumentParser(description="Calcule les trade kills et les revenges d'une game.")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--measure", action="store_true", help="Affiche les distributions de contrôle sans rien écrire")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    print(json.dumps(measure(conn, args.game) if args.measure else {MODULE: compute(conn, args.game)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
