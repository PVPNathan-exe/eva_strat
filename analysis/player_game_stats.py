"""Bilan de chaque joueur sur une game (table `player_game_stats`, module `player_game_stats`, REVISION 1) : `python analysis/player_game_stats.py --game N [--db chemin] [--measure]`.

Une ligne par joueur présent dans les `samples` de la game. Temps en secondes depuis le début de la game (les `samples` et les `kills` sont en temps de VIDÉO : `games.start_s` retranché).
- **kills, deaths** : lus dans `lives` (les mêmes événements des deux côtés, donc un rapport K/D cohérent) : une mort = une vie `ended = death` ; un kill = une vie d'un adversaire terminée par ce tueur
  (`killer_slot` du killfeed), hors suicide et décor. Le killfeed brut compte parfois deux fois la mort d'un joueur qui attend sa réapparition (moins de `MIN_RESPAWN_S`), `lives` l'écarte.
- **alive_s** : lignes vivantes multipliées par le pas réel de la game (médiane des écarts de `t`, jamais codé en dur).
- **Vitesse** (docs/PLAN_STATS_2.md, section 2) : mètres par seconde entre deux lectures vivantes distantes de `PAIR_S` (0,5 s, à `PAIR_TOL_S` près, sans trou), sur la minimap de `episode_common.ARENA_M`.
  Pourquoi 0,5 s et non deux lignes voisines (0,1 s) : le bruit de lecture d'une position est de quelques dizaines de centimètres, divisé par 0,1 s il gonfle la vitesse. Tyroliennes exclues : une paire dont
  les deux bouts sont sur les deux stations d'une paire de `map_teleports.json` (rayon `TP_R`, en fraction de la minimap) ; sauts exclus : une paire à plus de `JUMP_V` (14 m/s, plafond du suivi) ET plus de
  `JUMP_M` (2 m). `v_mean` = distance parcourue / temps des paires (moyenne pondérée par le temps, immobile compris), `v_p98` = 98e centile des vitesses de paires, `v_max` = maximum brut (« peut contenir des
  erreurs de lecture »). `dist_m` = somme des déplacements des paires (une borne basse : les trous de lecture et les tyroliennes n'y sont pas).
- **Gadget** (lu dans `gadget_state` et `lives`, jamais la vidéo) : `gadget_uses` = segments « utilisé » de ses vies ; `gadget_unused_at_death` = morts avec le gadget encore disponible (parmi les morts dont l'état est lu) ;
  `gadget_possible` = somme sur ses vies de 1 + vie / délai DU GADGET de la vie (une borne haute : usage dès l'apparition puis un à chaque recharge). Le délai de chaque gadget est la médiane des cycles
  prêt, utilisé, prêt mesurés dans `gadget_state` sur TOUTES les games de la base (`gadget_delays`), groupés par NOM d'icône (plusieurs icônes G12, G20, G27 sont le même DX3). Pas de délai si moins de
  `MIN_CYCLES` cycles, ou si moins de `MIN_CYCLES` cycles tombent à `CYCLE_TOL` du délai médian (un gadget dont les cycles sont dispersés n'a pas de délai établi). `gadget_possible` est NULL dès qu'une vie de
  plus de `MIN_LIFE_S` n'a ni gadget connu ni délai établi (jamais de somme partielle), et `gadget_uses`/`gadget_unused_at_death` sont NULL si la game n'a aucune lecture de gadget pour ce joueur.
  Le résultat dépend donc des autres games de la base : le recalculer quand de nouvelles games sont lues.
- **Duels** (table `duels`) : gagné si `winner_slot` est le joueur, perdu si c'est son adversaire, autre sinon (trade ou indécis : `winner_slot` NULL). Une game sans ligne dans `duels` donne 0 partout.
Contrat commun : `compute(conn, game_id) -> int` (idempotent), `stats_meta`."""

import argparse
import bisect
import json
import math
import statistics
import sys

import episode_common as ec

MODULE = "player_game_stats"
REVISION = 1
PAIR_S = 0.5  # écart de temps des deux lectures d'une vitesse
PAIR_TOL_S = 0.06  # tolérance sur cet écart (les lignes arrivent toutes les 0,1 s)
TP_R = 0.07  # une paire dont chaque bout est à moins de 0,07 (fraction de la minimap) d'une station de la paire est une tyrolienne (un joueur entre en marchant, ressort 0,4 s plus tard)
JUMP_V = 14.0  # plafond de vitesse du suivi (tracking) : au-dessus, ce n'est pas un déplacement
JUMP_M = 2.0
MIN_CYCLES = 3  # cycles prêt, utilisé, prêt pour établir le délai d'un gadget
# Délais donnés par l'utilisateur (16/10/2026), faute de mesure établie ni de valeur dans les patch notes : le shield (45 s de recharge, 10 s de durée, 400 PV ; voir analysis/patch_reference.json).
# Servent seulement quand la mesure sur les vidéos n'établit pas de délai ; une mesure établie l'emporte.
KNOWN_DELAYS_S = {"SHIELD": 45.0}
CYCLE_TOL = 0.25  # un cycle est « proche » du délai médian à 25 % près
MIN_LIFE_S = 3.0  # une vie plus courte n'est pas comptée dans les utilisations possibles (comme gadget_state.life_stats)
NOT_KILLS = ("suicide", "environment")  # genres de killfeed qui ne sont pas un kill de joueur


# ---------------------------------------------------------------- vitesse

def _is_tp(a, b, stations):
    """Vrai si le trajet a -> b rejoint les deux stations d'une paire (dans un sens ou dans l'autre)."""
    for p, q in stations:
        for s, e in ((p, q), (q, p)):
            if math.hypot(a[0] - s[0], a[1] - s[1]) <= TP_R and math.hypot(b[0] - e[0], b[1] - e[1]) <= TP_R:
                return True
    return False


def speed_pairs(rows, stations=()):
    """Paires de lectures vivantes à PAIR_S : [(durée, distance en m)] tyroliennes et sauts exclus. `rows` : [(t, x, y)] vivants triés par t ; renvoie aussi le nombre d'exclusions {tp, jump}."""
    ts = [r[0] for r in rows]
    out, excluded = [], {"tp": 0, "jump": 0}
    for i, a in enumerate(rows):
        j = bisect.bisect_left(ts, a[0] + PAIR_S - PAIR_TOL_S)
        if j >= len(rows) or ts[j] - a[0] > PAIR_S + PAIR_TOL_S:
            continue  # trou : pas de seconde lecture à PAIR_S
        b = rows[j]
        d = math.hypot((b[1] - a[1]) * ec.ARENA_M[0], (b[2] - a[2]) * ec.ARENA_M[1])
        dt = b[0] - a[0]
        if _is_tp((a[1], a[2]), (b[1], b[2]), stations):
            excluded["tp"] += 1
        elif d > JUMP_M and d / dt > JUMP_V:
            excluded["jump"] += 1
        else:
            out.append((dt, d))
    return out, excluded


def movement(rows, stations=()):
    """(dist_m, v_mean, v_p98, v_max) d'un joueur, None pour chaque valeur sans paire. La distance somme des paires qui se chevauchent (chaque ligne en ouvre une) : elle est ramenée au temps réel
    en la multipliant par le pas moyen / PAIR_S, sinon elle serait comptée PAIR_S / pas fois (cinq fois à 0,1 s)."""
    pairs, _ = speed_pairs(rows, stations)
    if not pairs:
        return None, None, None, None
    speeds = sorted(d / dt for dt, d in pairs)
    mean = sum(d for _dt, d in pairs) / sum(dt for dt, _d in pairs)
    steps = [b[0] - a[0] for a, b in zip(rows, rows[1:]) if 0 < b[0] - a[0] <= PAIR_S]
    step = statistics.median(steps) if steps else PAIR_S
    dist = sum(d * step / dt for dt, d in pairs)
    return round(dist, 2), round(mean, 3), round(speeds[min(len(speeds) - 1, int(0.98 * len(speeds)))], 3), round(speeds[-1], 3)


def alive_rows(conn, game_id):
    """({slot: [(t, x, y)] vivants triés}, pas réel de la game) avec t en secondes de vidéo (seuls les écarts servent)."""
    rows, all_dt = {}, []
    prev = {}
    for t, slot, alive, x, y in conn.execute("SELECT t, slot, alive, x, y FROM samples WHERE game_id = ? ORDER BY slot, t", (game_id,)):
        rows.setdefault(slot, [])
        if slot in prev and 0 < t - prev[slot] < 1.0:
            all_dt.append(t - prev[slot])
        prev[slot] = t
        if alive and x is not None and y is not None:
            rows[slot].append((t, x, y))
    return rows, (statistics.median(all_dt) if all_dt else None)


# ---------------------------------------------------------------- gadget : délais de recharge par gadget

def _gadget_name(names, gadget):
    """Nom affiché d'une icône de gadget (plusieurs icônes peuvent être le même gadget), sinon l'identifiant."""
    return str(names.get(gadget) or gadget) if gadget else None


def gadget_cycles(conn):
    """{nom du gadget: [durées de cycle en s]} sur toutes les games de la base : un segment « utilisé » entre deux segments « prêt » contigus (aucun segment inconnu entre eux : la mort coupe)."""
    import weapons

    names = weapons.display_names()
    segs = {}
    for r in conn.execute("SELECT game_id, slot, t0, t1, gadget, state FROM gadget_state ORDER BY game_id, slot, t0"):
        segs.setdefault((r["game_id"], r["slot"]), []).append(r)
    out = {}
    for rows in segs.values():
        for k in range(1, len(rows) - 1):
            if rows[k]["state"] == "used" and rows[k - 1]["state"] == "ready" and rows[k + 1]["state"] == "ready":
                name = _gadget_name(names, rows[k]["gadget"])
                if name:
                    out.setdefault(name, []).append(round(rows[k]["t1"] - rows[k]["t0"], 2))
    return out


def delay_of(cycles):
    """Délai établi d'un gadget (médiane de ses cycles) ou None : moins de MIN_CYCLES cycles, ou moins de MIN_CYCLES cycles proches (CYCLE_TOL) de cette médiane."""
    if len(cycles) < MIN_CYCLES:
        return None
    med = statistics.median(cycles)
    close = sum(1 for c in cycles if abs(c - med) <= CYCLE_TOL * med)
    return med if close >= MIN_CYCLES else None


def gadget_delays(conn):
    """{nom du gadget: délai en s ou None} : mesuré quand il est établi, sinon le délai connu (KNOWN_DELAYS_S), sinon None."""
    delays = {name: delay_of(c) for name, c in gadget_cycles(conn).items()}
    for name, known in KNOWN_DELAYS_S.items():
        if delays.get(name) is None:
            delays[name] = known
    return delays


def gadget_totals(conn, game_id, delays):
    """{slot: (utilisations, morts avec gadget disponible, utilisations possibles)} avec None quand non établi. Sans lecture de gadget pour la game, {}."""
    import gadget_state
    import weapons

    if not conn.execute("SELECT 1 FROM gadget_state WHERE game_id = ? LIMIT 1", (game_id,)).fetchone():
        return {}
    names = weapons.display_names()
    read = {r["slot"] for r in conn.execute("SELECT DISTINCT slot FROM gadget_state WHERE game_id = ? AND state <> 'unknown'", (game_id,))}
    out = {}
    for lf in gadget_state.life_stats(conn, game_id, cooldown_s=1.0):
        slot = lf["slot"]
        if slot not in read:
            continue
        uses, unused, possible = out.get(slot, (0, None, 0.0))
        uses += lf["uses"]
        if lf["unused_at_death"] is not None:
            unused = (unused or 0) + lf["unused_at_death"]
        if lf["t1"] - lf["t0"] >= MIN_LIFE_S and possible is not None:
            delay = delays.get(_gadget_name(names, lf["gadget"]))
            possible = None if delay is None else possible + 1 + int((lf["t1"] - lf["t0"]) // delay)
        out[slot] = (uses, unused, possible)
    return out


# ---------------------------------------------------------------- kills, morts, duels

def kills_deaths(conn, game_id):
    """({slot: kills}, {slot: morts}) d'après `lives`."""
    kills, deaths = {}, {}
    for r in conn.execute("SELECT slot, killer_slot, kill_kind FROM lives WHERE game_id = ? AND ended = 'death'", (game_id,)):
        deaths[r["slot"]] = deaths.get(r["slot"], 0) + 1
        k = r["killer_slot"]
        if k and k != r["slot"] and ec.team_of(k) != ec.team_of(r["slot"]) and r["kill_kind"] not in NOT_KILLS:
            kills[k] = kills.get(k, 0) + 1
    return kills, deaths


def duel_counts(conn, game_id):
    """{slot: [gagnés, perdus, autres]}."""
    out = {}
    for r in conn.execute("SELECT slot_a, slot_b, winner_slot FROM duels WHERE game_id = ?", (game_id,)):
        for me, other in ((r["slot_a"], r["slot_b"]), (r["slot_b"], r["slot_a"])):
            c = out.setdefault(me, [0, 0, 0])
            c[0 if r["winner_slot"] == me else 1 if r["winner_slot"] == other else 2] += 1
    return out


# ---------------------------------------------------------------- base de données

def build(conn, game_id):
    """Lignes du bilan : [{slot, kills, deaths, alive_s, dist_m, v_mean, v_p98, v_max, gadget_uses, gadget_unused_at_death, gadget_possible, duels_won, duels_lost, duels_other}]."""
    import db

    game = conn.execute("SELECT map FROM games WHERE id = ?", (game_id,)).fetchone()
    stations = db.teleports_for(game["map"]) if game else []
    rows, step = alive_rows(conn, game_id)
    kills, deaths = kills_deaths(conn, game_id)
    gadget = gadget_totals(conn, game_id, gadget_delays(conn))
    duels = duel_counts(conn, game_id)
    out = []
    for slot in sorted(rows):
        dist, mean, p98, vmax = movement(rows[slot], stations)
        g = gadget.get(slot, (None, None, None))
        d = duels.get(slot, [0, 0, 0])
        out.append({
            "slot": slot, "kills": kills.get(slot, 0), "deaths": deaths.get(slot, 0),
            "alive_s": round(len(rows[slot]) * step, 2) if step else None, "dist_m": dist, "v_mean": mean, "v_p98": p98, "v_max": vmax,
            "gadget_uses": g[0], "gadget_unused_at_death": g[1] if g[0] is not None else None, "gadget_possible": g[2],
            "duels_won": d[0], "duels_lost": d[1], "duels_other": d[2],
        })
    return out


COLUMNS = ("slot", "kills", "deaths", "alive_s", "dist_m", "v_mean", "v_p98", "v_max", "gadget_uses", "gadget_unused_at_death", "gadget_possible", "duels_won", "duels_lost", "duels_other")


def compute(conn, game_id):
    """Efface puis réécrit le bilan de la game ; renvoie le nombre de lignes (un joueur par ligne)."""
    lines = build(conn, game_id)
    conn.execute("DELETE FROM player_game_stats WHERE game_id = ?", (game_id,))
    for ln in lines:
        conn.execute(f"INSERT INTO player_game_stats (game_id, {', '.join(COLUMNS)}) VALUES (?, {', '.join('?' for _ in COLUMNS)})", (game_id,) + tuple(ln[c] for c in COLUMNS))
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, MODULE, REVISION))
    conn.commit()
    return len(lines)


def measure(conn, game_id):
    """Chiffres de contrôle d'une game, rien d'écrit : vitesses en marche franche, exclusions, délais de gadget de la base, accord des morts avec le killfeed."""
    import db

    game = conn.execute("SELECT map, start_s FROM games WHERE id = ?", (game_id,)).fetchone()
    stations = db.teleports_for(game["map"])
    rows, _step = alive_rows(conn, game_id)
    walk, excl = [], {"tp": 0, "jump": 0}
    for slot_rows in rows.values():
        pairs, e = speed_pairs(slot_rows, stations)
        walk += [d / dt for dt, d in pairs if d / dt >= 0.5]
        excl = {k: excl[k] + e[k] for k in excl}
    cycles = gadget_cycles(conn)
    feed = conn.execute("SELECT COUNT(*) FROM kills WHERE game_id = ?", (game_id,)).fetchone()[0]
    return {"marche_franche_mediane_ms": round(statistics.median(walk), 2) if walk else None, "marche_n": len(walk), "exclus": excl,
            "delais": {n: {"cycles": len(c), "mediane": statistics.median(c), "etabli": delay_of(c)} for n, c in cycles.items()},
            "morts_lives": sum(kills_deaths(conn, game_id)[1].values()), "victimes_killfeed": feed}


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Calcule le bilan de chaque joueur d'une game.")
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
