"""Duels (table `duels`, module `duels`, REVISION 1) : `python analysis/duels.py --game N [--db chemin] [--measure]`.

Un duel (docs/PLAN_STATS_2.md, section 2) : un joueur en pousse un ou deux SANS AIDE PROCHE, même définition que `kill_series.py` (`HELP_R` 10 m, `ENGAGED_MIN` 2 : un duel est un combat où l'une des deux
équipes a moins de 2 engagés, un teamfight où les deux en ont au moins 2 ou deux foyers de kills). Gagné par celui qui TUE ; sans kill, par le plus de points de vie restants à la fin ; trade (deux kills croisés
dans la même série entre les deux mêmes joueurs) : `winner_slot` NULL et outcome `trade`.
Deux sources :
- **duels avec kill** (`data.source` = `kill`) : chaque série de kills (kill_series : kills à 10 s au plus l'un de l'autre) que `kind_of` classe duel ET dont une équipe a moins de `ENGAGED_MIN` engagés ; une ligne par
  paire (tueur, victime) ; un kill seul avec de l'aide proche des deux côtés (escarmouche, `kind_of` dit « duel » faute de 2 kills) n'est PAS un duel (`KEEP_HELPED_SINGLE_KILLS` pour l'accepter) ;
- **duels aux points de vie** (`data.source` = `hp`) : deux ennemis qui perdent chacun au moins `DUEL_MIN_LOSS` de leurs points de vie en même temps (à `DUEL_PAIR_GAP_S` près), à `DUEL_MAX_M` l'un de l'autre,
  sans aide proche, et dont aucun ne meurt ni ne tue dans la foulée. Gagnant : celui qui a au moins `HP_WIN_MARGIN` de points de vie de plus à la fin, sinon `indecis` (winner_slot NULL).
Sans le cache des bandeaux, seuls les duels avec kill existent (`data.hp_source` = `aucun`).

**Points de vie** : la colonne `samples.hp` n'est jamais remplie. La seule lecture est le remplissage du bandeau du joueur (`banners.read_team`, part de la hauteur colorée depuis le bas), gardé dans le cache
`data/cache/eval_<game>.json` (clé `states`, une valeur par image à 0,1 s, `fill` de 0 à environ 0,84 en pleine forme) ; lu ici directement (JSON, aucune lecture de vidéo). Points de vie = `fill / HP_FULL_FILL`
plafonné à 1 (un halo de dégât fait monter le remplissage à 0,98 juste avant une mort), médiane sur 3 images, vide pour un joueur pas vivant d'après `lives` (le bandeau d'un mort affiche 0,1 de décompte).
Un point de vie perdu est une BAISSE du remplissage d'au moins `HIT_DROP` en `HIT_WINDOW_S` ; les baisses espacées de `HIT_GAP_S` au plus font un épisode de dégâts. Le bandeau ne dit pas qui a tiré : l'adversaire
d'un duel aux points de vie est le joueur ennemi qui perd des points de vie en même temps, à moins de `DUEL_MAX_M` (règle de `tracking.duel_gaze`).
Temps en secondes depuis le début de la game (les `samples` et `kills` sont en temps de vidéo : `games.start_s` retranché par episode_common). `slot_a` est toujours un joueur de l'équipe A (1 à 4), `slot_b` de la B (5 à 8).
Schéma de `data` : source, hp_source, kills [{t, killer, victim}], engaged {A, B}, hp_start, hp_end, hp_lost ({slot: points de vie de 0 à 1, None si illisibles}), series_kills (nombre de kills de la série)."""

import argparse
import bisect
import json
import sys
from pathlib import Path

import episode_common as ec
import kill_series

MODULE = "duels"
REVISION = 1
AUTO = "auto"  # `hp` de compute/build : lire le cache des bandeaux ; None : aucun point de vie

# Points de vie (bandeau)
HP_FULL_FILL = 0.83  # remplissage d'un bandeau en pleine forme (médiane 0,81 à 0,84 sur les games 25, 26, 27, 8 joueurs)
HIT_DROP = 0.07  # baisse de points de vie (fraction du maximum) en HIT_WINDOW_S qui compte comme un dégât (tracking.HP_DROP : 0,06 de remplissage)
HIT_WINDOW_S = 0.4
HIT_GAP_S = 2.0  # deux baisses espacées de moins de 2 s sont un même épisode de dégâts
DEATH_JOIN_S = 2.5  # un épisode qui finit à 2,5 s au plus avant la fin d'une vie par mort est la mort du joueur
# Duels
KEEP_HELPED_SINGLE_KILLS = False  # True : un kill seul avec de l'aide proche des deux côtés compte aussi comme un duel
DUEL_LOOKBACK_S = 6.0  # le début d'un duel avec kill est cherché dans les 6 s qui précèdent le kill (dégâts des deux joueurs)
DUEL_MIN_S = 1.0  # sans dégât lu, un duel avec kill dure 1 s avant le kill
DUEL_MIN_LOSS = 0.15  # duel aux points de vie : chacun perd au moins 15 % de sa vie (seuil à régler avec l'utilisateur : « petit duel »)
DUEL_PAIR_GAP_S = 1.0  # les dégâts des deux joueurs se chevauchent à 1 s près
DUEL_MAX_M = 14.0  # deux ennemis plus éloignés (m) ne sont pas en duel (tracking.DUEL_MAX_M)
HP_WIN_MARGIN = 0.10  # écart de points de vie restants (fraction du maximum) pour désigner un gagnant sans kill
KILL_CONTEXT_S = (1.0, 3.0)  # un joueur qui tue ou meurt de 1 s avant à 3 s après son épisode est dans un combat à kills, pas dans un duel aux points de vie
HP_SETTLE_S = 0.3  # points de vie restants lus 0,3 s après la fin des dégâts
END_BLANK_S = 2.0  # les bandeaux sont illisibles dans les dernières secondes (écran noir de fin de game, tracking.drop_blank_states) : points de vie ignorés


# ---------------------------------------------------------------- points de vie

class HpTrack:
    """Points de vie normalisés (0 à 1) de chaque joueur, une valeur par image du cache (None si le joueur n'est pas vivant ou sans lecture)."""

    def __init__(self, times, hp):
        self.times, self.hp = times, hp
        self.step = (times[-1] - times[0]) / max(len(times) - 1, 1) if times else 0.1

    def index(self, t):
        i = bisect.bisect_left(self.times, t)
        return min(max(i, 0), len(self.times) - 1)

    def span(self, slot, a, b):
        """Valeurs lues du joueur entre a et b (secondes)."""
        h = self.hp.get(slot)
        if not h or not self.times:
            return []
        return [v for v in h[self.index(a):self.index(b) + 1] if v is not None]

    def at(self, slot, t):
        v = self.span(slot, t - self.step, t + self.step)
        return v[len(v) // 2] if v else None


def _median3(h):
    out = list(h)
    for i in range(1, len(h) - 1):
        trio = [v for v in h[i - 1:i + 2] if v is not None]
        if h[i] is not None and len(trio) == 3:
            out[i] = sorted(trio)[1]
    return out


def load_hp(game, cache_dir=None):
    """HpTrack d'une game depuis le cache des bandeaux (`eval_<id>.json`), None si le cache manque. `game` : episode_common.load_game."""
    import paths

    path = Path(cache_dir or paths.cache_dir()) / f"eval_{game['id']}.json"
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    frames = sorted(raw["frames"], key=lambda f: f[0])
    times = [round(f[1] - game["start"], 3) for f in frames]
    states = raw["states"]
    hp = {}
    for slot in range(1, 9):
        lives = [(v["t0"] - 0.2, v["t1"] + 0.2) for v in game["lives"].get(slot, [])]
        series = []
        for fi, t in zip((f[0] for f in frames), times):
            st = states.get(str(fi), {}).get(str(slot))
            alive = any(a <= t <= b for a, b in lives) and t <= game["duration"] - END_BLANK_S
            series.append(min(1.0, st["fill"] / HP_FULL_FILL) if st and alive and st.get("fill") is not None else None)
        hp[slot] = _median3(series)
    return HpTrack(times, hp)


def hp_episodes(track, game, slot):
    """Épisodes de dégâts du joueur : [{slot, t0, t1, before, after, loss, died}] (points de vie de 0 à 1 ; `died` : la vie finit par une mort dans DEATH_JOIN_S, `after` vaut alors 0)."""
    h, times, w = track.hp[slot], track.times, max(1, round(HIT_WINDOW_S / track.step))
    hits = []
    for i, v in enumerate(h):
        before = [x for x in h[max(0, i - w):i + 1] if x is not None]
        if v is not None and before and max(before) - v >= HIT_DROP:
            hits.append(i)
    gap, groups = round(HIT_GAP_S / track.step), []
    for i in hits:
        if groups and i - groups[-1][-1] <= gap:
            groups[-1].append(i)
        else:
            groups.append([i])
    deaths = [v["t1"] for v in game["lives"].get(slot, []) if v["ended"] == "death"]
    out = []
    for g in groups:
        i0, i1 = g[0], g[-1]
        window = [(j, h[j]) for j in range(max(0, i0 - 2 * w), i0 + 1) if h[j] is not None]
        jmax, before = max(window, key=lambda p: (p[1], p[0]))
        after = min(x for x in h[i0:i1 + 1] if x is not None)
        died = any(times[i1] - 0.5 <= d <= times[i1] + DEATH_JOIN_S for d in deaths)
        after = 0.0 if died else after
        out.append({"slot": slot, "t0": times[jmax], "t1": times[i1], "before": round(before, 2), "after": round(after, 2), "loss": round(before - after, 2), "died": died})
    return out


# ---------------------------------------------------------------- aide proche

def engaged_at(game, a, b, t):
    """Engagés par équipe autour du duel de deux joueurs ennemis à l'instant t : lui-même plus les autres vivants à HELP_R du milieu. None si une position manque."""
    pa, pb = ec.pos_at(game, a, t), ec.pos_at(game, b, t)
    if pa is None or pb is None:
        return None
    centre = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
    out = {ec.team_of(a): 1, ec.team_of(b): 1}
    for s in range(1, 9):
        if s in (a, b) or not ec.alive_at(game, s, t):
            continue
        d = ec.dist_m(ec.pos_at(game, s, t), centre)
        if d is not None and d <= kill_series.HELP_R:
            out[ec.team_of(s)] += 1
    return out


# ---------------------------------------------------------------- duels avec kill

def _hp_block(track, eps, a, b, t0, t1, died):
    """{hp_start, hp_end, hp_lost} des deux joueurs sur [t0, t1] ({slot: valeur ou None}). `died` : slots morts à t1 (points de vie finaux 0)."""
    start, end = {}, {}
    for s in (a, b):
        v = track.span(s, t0 - 0.5, t0) if track else []
        start[s] = max(v) if v else None
        w = track.span(s, t1 - HP_SETTLE_S, t1) if track else []
        end[s] = 0.0 if s in died else (min(w) if w else None)
    lost = {s: None if start[s] is None or end[s] is None else max(0.0, start[s] - end[s]) for s in (a, b)}
    fmt = lambda d: {str(s): None if v is None else round(v, 2) for s, v in d.items()}
    return {"hp_start": fmt(start), "hp_end": fmt(end), "hp_lost": fmt(lost)}


def series_chains(game):
    """Séries de kills : [(i0, i1, kind, engaged)] (indices de game['kills'], kind_of de kill_series)."""
    kills, out, i = game["kills"], [], 0
    while i < len(kills):
        i1 = kill_series.chain_end(kills, i)
        kind, _n, eng, _c = kill_series.kind_of(game, i)
        out.append((i, i1, kind, eng))
        i = i1 + 1
    return out


def kill_duels(game, track, eps):
    """(duels avec kill, nombre de séries classées duel par kind_of mais avec de l'aide des deux côtés)."""
    kills, out, helped = game["kills"], [], 0
    for i0, i1, kind, eng in series_chains(game):
        if kind != "duel":
            continue
        if min(eng.values()) >= kill_series.ENGAGED_MIN:
            helped += 1
            if not KEEP_HELPED_SINGLE_KILLS:
                continue
        pairs = {}
        for i in range(i0, i1 + 1):
            pairs.setdefault(tuple(sorted(kills[i][1:3])), []).append(i)
        for (a, b), idxs in pairs.items():
            killers = {kills[i][1] for i in idxs}
            t_last = max(kills[i][0] for i in idxs)
            near = [e for s in (a, b) for e in eps.get(s, []) if t_last - DUEL_LOOKBACK_S <= e["t1"] and e["t0"] <= t_last + 0.5]
            t0 = min([e["t0"] for e in near] + [t_last - DUEL_MIN_S])
            died = {kills[i][2] for i in idxs}
            trade = len(killers) == 2
            winner = None if trade else next(iter(killers))
            data = {"source": "kill", "kills": [{"t": round(kills[i][0], 1), "killer": kills[i][1], "victim": kills[i][2]} for i in idxs], "engaged": eng, "series_kills": i1 - i0 + 1}
            data.update(_hp_block(track, eps, a, b, t0, t_last, died))
            out.append({"t0": round(t0, 2), "t1": round(t_last, 2), "slot_a": min(a, b), "slot_b": max(a, b), "winner": winner, "outcome": "trade" if trade else "kill", "data": data})
    return out, helped


# ---------------------------------------------------------------- duels aux points de vie

def _kill_context(game, e):
    """Le joueur de l'épisode tue ou meurt (kill du killfeed) autour de l'épisode : combat à kills, pas un duel aux points de vie."""
    lo, hi = e["t0"] - KILL_CONTEXT_S[0], e["t1"] + KILL_CONTEXT_S[1]
    return any(lo <= k[0] <= hi and e["slot"] in (k[1], k[2]) for k in game["kills"])


def hp_duels(game, track, eps, taken):
    """Duels sans kill lus sur les points de vie. `taken` : joueurs et fenêtres déjà pris par un duel avec kill [(slot, t0, t1)]."""
    cands = []
    for ea in (e for s in range(1, 5) for e in eps.get(s, [])):
        for eb in (e for s in range(5, 9) for e in eps.get(s, [])):
            lo, hi = max(ea["t0"], eb["t0"]), min(ea["t1"], eb["t1"])
            if hi + DUEL_PAIR_GAP_S < lo or min(ea["loss"], eb["loss"]) < DUEL_MIN_LOSS or ea["died"] or eb["died"]:
                continue
            cands.append((hi - lo, ea, eb))
    out, used = [], set()
    for overlap, ea, eb in sorted(cands, key=lambda c: -c[0]):
        keys = [(e["slot"], e["t0"]) for e in (ea, eb)]
        if any(k in used for k in keys) or _kill_context(game, ea) or _kill_context(game, eb):
            continue
        t0, t1 = min(ea["t0"], eb["t0"]), max(ea["t1"], eb["t1"])
        if any(s in (ea["slot"], eb["slot"]) and t0 - 1.0 <= u1 and u0 <= t1 + 1.0 for s, u0, u1 in taken):
            continue
        tm = (max(ea["t0"], eb["t0"]) + min(ea["t1"], eb["t1"])) / 2
        pa, pb = ec.pos_at(game, ea["slot"], tm), ec.pos_at(game, eb["slot"], tm)
        eng = engaged_at(game, ea["slot"], eb["slot"], tm)
        d = ec.dist_m(pa, pb)
        if eng is None or d is None or d > DUEL_MAX_M or min(eng.values()) >= kill_series.ENGAGED_MIN:
            continue
        used.update(keys)
        data = {"source": "hp", "kills": [], "engaged": eng, "series_kills": 0, "dist_m": round(d, 1)}
        data.update(_hp_block(track, eps, ea["slot"], eb["slot"], t0, t1 + HP_SETTLE_S, set()))
        ha, hb = data["hp_end"][str(ea["slot"])], data["hp_end"][str(eb["slot"])]
        winner = None
        if ha is not None and hb is not None and abs(ha - hb) >= HP_WIN_MARGIN:
            winner = ea["slot"] if ha > hb else eb["slot"]
        out.append({"t0": round(t0, 2), "t1": round(t1, 2), "slot_a": ea["slot"], "slot_b": eb["slot"], "winner": winner, "outcome": "points_de_vie" if winner else "indecis", "data": data})
    return out


# ---------------------------------------------------------------- calcul et écriture

def build(conn, game_id, hp=AUTO, cache_dir=None):
    """(duels triés par t0, chiffres de contrôle) d'une game, sans rien écrire. `hp` : AUTO (cache des bandeaux), None, ou un HpTrack (tests)."""
    game = ec.load_game(conn, game_id)
    if game is None:
        return [], {}
    track = load_hp(game, cache_dir) if hp == AUTO else hp
    eps = {s: hp_episodes(track, game, s) for s in range(1, 9)} if track else {}
    kd, helped = kill_duels(game, track, eps)
    taken = [(s, d["t0"], d["t1"]) for d in kd for s in (d["slot_a"], d["slot_b"])]
    hd = hp_duels(game, track, eps, taken) if track else []
    duels = sorted(kd + hd, key=lambda d: d["t0"])
    for d in duels:
        d["data"]["hp_source"] = "cache" if track else "aucun"
    return duels, {"avec_kill": len(kd), "aux_points_de_vie": len(hd), "escarmouches_ecartees": helped, "points_de_vie": track is not None}


def compute(conn, game_id, hp=AUTO, cache_dir=None):
    """Efface puis réécrit les duels de la game ; renvoie leur nombre. Écrit aussi stats_meta."""
    duels, _stats = build(conn, game_id, hp, cache_dir)
    conn.execute("DELETE FROM duels WHERE game_id = ?", (game_id,))
    for d in duels:
        conn.execute("INSERT INTO duels (game_id, t0, t1, slot_a, slot_b, winner_slot, outcome, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                     (game_id, d["t0"], d["t1"], d["slot_a"], d["slot_b"], d["winner"], d["outcome"], json.dumps(d["data"], ensure_ascii=False)))
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, MODULE, REVISION))
    conn.commit()
    return len(duels)


def measure(conn, game_id, hp=AUTO, cache_dir=None):
    """Chiffres de contrôle : duels par issue et par source, et accord entre « le plus de points de vie 1,5 s avant le kill » et le tueur (valide la règle du duel sans kill)."""
    duels, stats = build(conn, game_id, hp, cache_dir)
    game = ec.load_game(conn, game_id)
    track = load_hp(game, cache_dir) if hp == AUTO else hp
    agree = total = 0
    for d in duels:
        if d["data"]["source"] != "kill" or d["winner"] is None or track is None:
            continue
        a, b = d["slot_a"], d["slot_b"]
        ha, hb = track.at(a, d["t1"] - 1.5), track.at(b, d["t1"] - 1.5)
        if ha is None or hb is None or abs(ha - hb) < 1e-9:
            continue
        total += 1
        agree += (a if ha > hb else b) == d["winner"]
    every = [0, 0]  # tous les kills de la game (teamfights compris) : le tueur avait-il plus de points de vie que sa victime 1,5 s avant ?
    for k in game["kills"] if track else []:
        hk, hv = track.at(k[1], k[0] - 1.5), track.at(k[2], k[0] - 1.5)
        if hk is not None and hv is not None and abs(hk - hv) >= HP_WIN_MARGIN:
            every[0] += hk > hv
            every[1] += 1
    outcomes = {}
    for d in duels:
        key = f"{d['data']['source']}:{d['outcome']}"
        outcomes[key] = outcomes.get(key, 0) + 1
    return {**stats, "duels": len(duels), "issues": outcomes, "plus_de_pv_avant_le_kill_est_le_tueur": [agree, total], "tous_kills_tueur_avec_plus_de_pv_1_5_s_avant": every}


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Calcule les duels d'une game.")
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
