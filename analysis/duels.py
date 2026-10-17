"""Duels (table `duels`, module `duels`, REVISION 2) : `python analysis/duels.py --game N [--db chemin] [--measure]`.

**Règle de l'utilisateur du 17 octobre 2026** : « un duel est une INITIATION au fight jusqu'à la RÉGÉNÉRATION des joueurs ». Un duel commence à la première perte de points de vie du couple (initiation) et se termine à la
mort de l'un des deux OU quand la régénération commence (délai mesuré `regen.REGEN_DELAY_S` après la dernière perte, ou début de remontée lu quand il est lisible) ; le gagnant est celui qui a le plus de points de vie à la fin
(au moins `HP_WIN_MARGIN` de plus, 10 points sur 100), sinon `indecis`. Un kill entre les deux duellistes : victoire de celui qui tue (outcome `kill`). Les deux meurent à moins de 1 s (`kill_links.TRADE_S`) : `trade`.
**Un kill porté par un TROISIÈME joueur sur l'un des deux duellistes pendant le duel INTERROMPT le duel** (outcome `interrompu`, winner NULL : le coéquipier qui fait le kill n'est pas crédité d'une victoire en duel, c'est
bien pour l'équipe mais ce n'est pas un duel à proprement parler). Un kill seul de ce coéquipier, sans dégât subi de la victime en retour (le tueur n'a pas perdu `DUEL_MIN_LOSS` de vie face à elle), n'est plus un duel avec kill
(il est retiré de la liste quand les points de vie permettent de voir l'interruption). Sans le cache des bandeaux, aucune interruption n'est visible : seuls les duels avec kill existent (`data.hp_source` = `aucun`).

Même définition de l'aide proche que `kill_series.py` (`HELP_R` 10 m, `ENGAGED_MIN` 2 : un duel est un combat où l'une des deux équipes a moins de 2 engagés, un teamfight où les deux en ont au moins 2 ou deux foyers de kills).
Deux sources :
- **duels avec kill** (`data.source` = `kill`) : chaque série de kills (kill_series : kills à 10 s au plus l'un de l'autre) que `kind_of` classe duel ET dont une équipe a moins de `ENGAGED_MIN` engagés ; une ligne par
  paire (tueur, victime) ; un kill seul avec de l'aide proche des deux côtés (escarmouche, `kind_of` dit « duel » faute de 2 kills) n'est PAS un duel (`KEEP_HELPED_SINGLE_KILLS` pour l'accepter) ; début = première perte de
  points de vie de l'un des deux dans les `DUEL_LOOKBACK_S` qui précèdent le kill ;
- **duels aux points de vie** (`data.source` = `hp`) : deux ennemis qui perdent chacun au moins `DUEL_MIN_LOSS` de leurs points de vie en même temps (à `DUEL_PAIR_GAP_S` près), à `DUEL_MAX_M` l'un de l'autre,
  sans aide proche des deux côtés. Fin : mort de l'un des deux (kill d'un tiers : `interrompu` ; mort sans kill lu : `indecis` ; kill de l'autre duelliste : déjà un duel avec kill, ligne ignorée ici) ou début de la
  régénération (`ended_by` = `regeneration`). Les combats où un duelliste TUE quelqu'un d'autre autour de l'épisode (`KILL_CONTEXT_S`) ne sont pas des duels aux points de vie.
**Points de vie** : la colonne `samples.hp` n'est jamais remplie. La seule lecture est le remplissage du bandeau du joueur (`banners.read_team`, part de la hauteur colorée depuis le bas), gardé dans le cache
`data/cache/eval_<game>.json` (clé `states`, une valeur par image à 0,1 s, `fill` de 0 à environ 0,84 en pleine forme) ; lu ici directement (JSON, aucune lecture de vidéo). Points de vie = `fill / HP_FULL_FILL`
plafonné à 1 (un halo de dégât fait monter le remplissage à 0,98 juste avant une mort), médiane sur 3 images, vide pour un joueur pas vivant d'après `lives` (le bandeau d'un mort affiche 0,1 de décompte).
Un point de vie perdu est une BAISSE du remplissage d'au moins `HIT_DROP` en `HIT_WINDOW_S` (fonctions de `regen.py`) ; les baisses espacées de `HIT_GAP_S` au plus font un épisode de dégâts. Le bandeau ne dit pas qui a tiré : l'adversaire
d'un duel aux points de vie est le joueur ennemi qui perd des points de vie en même temps, à moins de `DUEL_MAX_M` (règle de `tracking.duel_gaze`).
Temps en secondes depuis le début de la game (les `samples` et `kills` sont en temps de vidéo : `games.start_s` retranché par episode_common). `slot_a` est toujours un joueur de l'équipe A (1 à 4), `slot_b` de la B (5 à 8).
Schéma de `data` : source, hp_source, kills [{t, killer, victim}], engaged {A, B}, hp_start, hp_end, hp_lost ({slot: points de vie de 0 à 1, None si illisibles}), series_kills (nombre de kills de la série),
ended_by (`kill`, `trade`, `kill_tiers`, `mort_sans_kill`, `regeneration`), regen {slot: {t, source: `lu` ou `mesure`}} (duels aux points de vie sans mort), interrupted_by {slot, victim, t} (outcome `interrompu`)."""

import argparse
import bisect
import json
import sys
from pathlib import Path

import episode_common as ec
import kill_series
import regen

MODULE = "duels"
REVISION = 2
AUTO = "auto"  # `hp` de compute/build : lire le cache des bandeaux ; None : aucun point de vie

# Points de vie (bandeau)
HP_FULL_FILL = 0.83  # remplissage d'un bandeau en pleine forme (médiane 0,81 à 0,84 sur les games 25, 26, 27, 8 joueurs)
HIT_DROP = regen.HIT_DROP  # baisse de points de vie (fraction du maximum) en HIT_WINDOW_S qui compte comme un dégât (tracking.HP_DROP : 0,06 de remplissage)
HIT_WINDOW_S = regen.HIT_WINDOW_S
HIT_GAP_S = regen.HIT_GAP_S  # deux baisses espacées de moins de 2 s sont un même épisode de dégâts
DEATH_JOIN_S = 2.5  # un épisode qui finit à 2,5 s au plus avant la fin d'une vie par mort est la mort du joueur
# Régénération (mesurée dans regen.py : délai médian 4,6 s, voir son en-tête)
REGEN_DELAY_S = regen.REGEN_DELAY_S  # fin d'un duel sans mort : dernière perte + ce délai (repli quand le début de remontée n'est pas lisible)
REGEN_MIN_OBSERVED_S = 1.0  # un début de remontée lu à moins de 1 s de la dernière perte est une fluctuation de lecture (11 % des remontées mesurées), ignoré
# Duels
KEEP_HELPED_SINGLE_KILLS = False  # True : un kill seul avec de l'aide proche des deux côtés compte aussi comme un duel
DUEL_LOOKBACK_S = 6.0  # le début d'un duel avec kill est cherché dans les 6 s qui précèdent le kill (dégâts des deux joueurs)
DUEL_MIN_S = 1.0  # sans dégât lu, un duel avec kill dure 1 s avant le kill
DUEL_MIN_LOSS = 0.15  # duel aux points de vie : chacun perd au moins 15 % de sa vie (seuil à régler avec l'utilisateur : « petit duel »)
DUEL_PAIR_GAP_S = 1.0  # les dégâts des deux joueurs se chevauchent à 1 s près
DUEL_MAX_M = 14.0  # deux ennemis plus éloignés (m) ne sont pas en duel (tracking.DUEL_MAX_M)
HP_WIN_MARGIN = 0.10  # écart de points de vie restants (fraction du maximum) pour désigner un gagnant sans kill : 10 points
KILL_CONTEXT_S = (1.0, 3.0)  # un joueur qui tue de 1 s avant à 3 s après son épisode est dans un combat à kills, pas dans un duel aux points de vie
KILL_MATCH_S = (1.0, 3.0)  # le kill d'une mort se cherche de 1 s avant à 3 s après la fin de la vie (la ligne du killfeed arrive après)
HP_SETTLE_S = 0.3  # points de vie restants lus 0,3 s avant la fin du duel
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
    """Épisodes de dégâts du joueur : [{slot, t0, t1, before, after, loss, died, death_t, regen_t}] (points de vie de 0 à 1 ; `died` : la vie finit par une mort dans DEATH_JOIN_S, `after` vaut alors 0 et
    `death_t` est l'instant de la mort ; `regen_t` : début de remontée lu quand il est lisible (au moins REGEN_MIN_OBSERVED_S après la dernière perte, avant la perte suivante), sinon None)."""
    h, times, w = track.hp[slot], track.times, max(1, round(HIT_WINDOW_S / track.step))
    groups = regen.group_hits(regen.hit_indices(h, w, HIT_DROP), round(HIT_GAP_S / track.step))
    deaths = [v["t1"] for v in game["lives"].get(slot, []) if v["ended"] == "death"]
    out = []
    for n, g in enumerate(groups):
        i0, i1 = g[0], g[-1]
        window = [(j, h[j]) for j in range(max(0, i0 - 2 * w), i0 + 1) if h[j] is not None]
        jmax, before = max(window, key=lambda p: (p[1], p[0]))
        after = min(x for x in h[i0:i1 + 1] if x is not None)
        death_t = next((d for d in deaths if times[i1] - 0.5 <= d <= times[i1] + DEATH_JOIN_S), None)
        died = death_t is not None
        regen_t = None
        if not died:
            nxt = groups[n + 1][0] if n + 1 < len(groups) else len(h)
            i_flat, why = regen.regen_start(h, i1, min(nxt, i1 + 1 + round(regen.REGEN_MAX_DELAY_S / track.step)))
            if why == "ok" and times[i_flat] - times[i1] >= REGEN_MIN_OBSERVED_S:
                regen_t = times[i_flat]
        out.append({"slot": slot, "t0": times[jmax], "t1": times[i1], "before": round(before, 2), "after": 0.0 if died else round(after, 2),
                    "loss": round(before - (0.0 if died else after), 2), "died": died, "death_t": death_t, "regen_t": regen_t})
    return out


def regen_time(e):
    """(instant du début de la régénération d'un épisode sans mort, source) : début lu si lisible, sinon dernière perte + REGEN_DELAY_S."""
    if e["regen_t"] is not None:
        return e["regen_t"], "lu"
    return e["t1"] + REGEN_DELAY_S, "mesure"


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

def _hp_block(track, a, b, t0, t1, died):
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
            data = {"source": "kill", "kills": [{"t": round(kills[i][0], 1), "killer": kills[i][1], "victim": kills[i][2]} for i in idxs], "engaged": eng, "series_kills": i1 - i0 + 1,
                    "ended_by": "trade" if trade else "kill"}
            data.update(_hp_block(track, a, b, t0, t_last, died))
            out.append({"t0": round(t0, 2), "t1": round(t_last, 2), "slot_a": min(a, b), "slot_b": max(a, b), "winner": winner, "outcome": "trade" if trade else "kill", "data": data})
    return out, helped


# ---------------------------------------------------------------- duels aux points de vie

def _kill_context(game, e):
    """Le joueur de l'épisode TUE quelqu'un (killfeed) autour de l'épisode, ou meurt sans que l'épisode soit sa mort : combat à kills, pas un duel aux points de vie."""
    lo, hi = e["t0"] - KILL_CONTEXT_S[0], e["t1"] + KILL_CONTEXT_S[1]
    return any(lo <= k[0] <= hi and (k[1] == e["slot"] or (k[2] == e["slot"] and not e["died"])) for k in game["kills"])


def _killer_of(game, slot, t_death):
    """(tueur, instant du kill) de la mort du joueur à t_death d'après le killfeed (de KILL_MATCH_S[0] avant à KILL_MATCH_S[1] après), (None, None) sans kill lu."""
    near = [k for k in game["kills"] if k[2] == slot and t_death - KILL_MATCH_S[0] <= k[0] <= t_death + KILL_MATCH_S[1]]
    if not near:
        return None, None
    k = min(near, key=lambda k: abs(k[0] - t_death))
    return k[1], k[0]


def _fought(eps, killer, victim):
    """Le tueur a perdu au moins DUEL_MIN_LOSS de vie en même temps que la victime (épisodes qui se chevauchent à DUEL_PAIR_GAP_S près) : il a duellé avec elle, son kill n'est pas « derrière »."""
    for ek in eps.get(killer, []):
        if ek["loss"] < DUEL_MIN_LOSS:
            continue
        if any(min(ek["t1"], ev["t1"]) + DUEL_PAIR_GAP_S >= max(ek["t0"], ev["t0"]) for ev in eps.get(victim, [])):
            return True
    return False


def hp_duels(game, track, eps, kill_windows):
    """Duels lus sur les points de vie : (duels, kills portés « derrière » par un tiers [(tueur, victime)]). `kill_windows` : fenêtres des duels avec kill déjà trouvés [(frozenset({a, b}), t0, t1)]."""
    cands = []
    for ea in (e for s in range(1, 5) for e in eps.get(s, [])):
        for eb in (e for s in range(5, 9) for e in eps.get(s, [])):
            lo, hi = max(ea["t0"], eb["t0"]), min(ea["t1"], eb["t1"])
            if hi + DUEL_PAIR_GAP_S < lo or min(ea["loss"], eb["loss"]) < DUEL_MIN_LOSS:
                continue
            cands.append((hi - lo, ea, eb))
    out, behind, used = [], [], set()
    for overlap, ea, eb in sorted(cands, key=lambda c: -c[0]):
        keys = [(e["slot"], e["t0"]) for e in (ea, eb)]
        pair, t0 = frozenset((ea["slot"], eb["slot"])), min(ea["t0"], eb["t0"])
        if any(k in used for k in keys) or _kill_context(game, ea) or _kill_context(game, eb) or any(pair == p and t0 - 1.0 <= u1 and u0 <= max(ea['t1'], eb['t1']) + 1.0 for p, u0, u1 in kill_windows):
            continue
        tm = (max(ea["t0"], eb["t0"]) + min(ea["t1"], eb["t1"])) / 2
        pa, pb = ec.pos_at(game, ea["slot"], tm), ec.pos_at(game, eb["slot"], tm)
        eng = engaged_at(game, ea["slot"], eb["slot"], tm)
        d = ec.dist_m(pa, pb)
        if eng is None or d is None or d > DUEL_MAX_M or min(eng.values()) >= kill_series.ENGAGED_MIN:
            continue
        data = {"source": "hp", "kills": [], "engaged": eng, "series_kills": 0, "dist_m": round(d, 1)}
        dead = sorted((e["death_t"], e["slot"]) for e in (ea, eb) if e["died"])
        if dead:  # la première mort termine le duel
            t_end, victim = dead[0]
            killer, t_kill = _killer_of(game, victim, t_end)
            if killer in pair:
                continue  # un duelliste tue l'autre : c'est un duel avec kill, déjà compté (ou écarté pour cause d'aide)
            used.update(keys)
            data.update(_hp_block(track, ea["slot"], eb["slot"], t0, t_end, {victim}))
            if killer is None:
                data["ended_by"] = "mort_sans_kill"
                winner, outcome = None, "indecis"
            else:
                data["ended_by"] = "kill_tiers"
                data["interrupted_by"] = {"slot": killer, "victim": victim, "t": round(t_kill, 1)}
                data["kills"] = [{"t": round(t_kill, 1), "killer": killer, "victim": victim}]
                winner, outcome = None, "interrompu"
                behind.append((killer, victim))
        else:  # fin à la régénération du premier des deux, jamais avant la dernière perte
            (ta, sa), (tb, sb) = regen_time(ea), regen_time(eb)
            t_end = max(max(ea["t1"], eb["t1"]), min(ta, tb, game["duration"] - END_BLANK_S))  # la game peut finir avant la régénération (bandeaux illisibles dans les dernières secondes)
            used.update(keys)
            data.update(_hp_block(track, ea["slot"], eb["slot"], t0, t_end, set()))
            data["ended_by"] = "regeneration"
            data["regen"] = {str(ea["slot"]): {"t": round(ta, 2), "source": sa}, str(eb["slot"]): {"t": round(tb, 2), "source": sb}}
            ha, hb = data["hp_end"][str(ea["slot"])], data["hp_end"][str(eb["slot"])]
            winner = None
            if ha is not None and hb is not None and abs(ha - hb) >= HP_WIN_MARGIN:
                winner = ea["slot"] if ha > hb else eb["slot"]
            outcome = "points_de_vie" if winner else "indecis"
        out.append({"t0": round(t0, 2), "t1": round(t_end, 2), "slot_a": ea["slot"], "slot_b": eb["slot"], "winner": winner, "outcome": outcome, "data": data})
    return out, behind


# ---------------------------------------------------------------- calcul et écriture

def build(conn, game_id, hp=AUTO, cache_dir=None):
    """(duels triés par t0, chiffres de contrôle) d'une game, sans rien écrire. `hp` : AUTO (cache des bandeaux), None, ou un HpTrack (tests)."""
    game = ec.load_game(conn, game_id)
    if game is None:
        return [], {}
    track = load_hp(game, cache_dir) if hp == AUTO else hp
    eps = {s: hp_episodes(track, game, s) for s in range(1, 9)} if track else {}
    kd, helped = kill_duels(game, track, eps)
    hd, behind = hp_duels(game, track, eps, [(frozenset((d["slot_a"], d["slot_b"])), d["t0"], d["t1"]) for d in kd]) if track else ([], [])
    # le kill d'un coéquipier « derrière » (la victime duellait avec un autre, le tueur n'a pas perdu de vie face à elle) interrompt un duel : ce n'est pas un duel avec kill
    behind_dropped = [d for d in kd if d["outcome"] == "kill" and (d["winner"], d["slot_b"] if d["winner"] == d["slot_a"] else d["slot_a"]) in behind
                      and not _fought(eps, d["winner"], d["slot_b"] if d["winner"] == d["slot_a"] else d["slot_a"])]
    kd = [d for d in kd if not any(d is x for x in behind_dropped)]
    duels = sorted(kd + hd, key=lambda d: d["t0"])
    for d in duels:
        d["data"]["hp_source"] = "cache" if track else "aucun"
    return duels, {"avec_kill": len(kd), "aux_points_de_vie": len(hd), "kills_derriere_retires": len(behind_dropped), "escarmouches_ecartees": helped, "points_de_vie": track is not None}


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
