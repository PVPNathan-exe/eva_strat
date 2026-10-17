"""Note de chaque kill et de chaque mort (table `kill_scores`, module `kill_scores`, REVISION 2) : `python analysis/kill_scores.py --game N [--db chemin] [--measure]`.

Règles de l'utilisateur du 17 octobre 2026 (une CONVENTION, pas une vérité terrain ; chaque critère est une constante modifiable). Un kill donne DEUX notes indépendantes :
- `impact` : la note du KILL, du point de vue de l'équipe du tueur (travail individuel) ;
- `death_impact` : la note de la MORT, du point de vue de la victime (colonne ajoutée par `_ensure_column` aux bases plus anciennes ; NULL = ancien calcul, la mort valait alors `-impact`).
`reasons` : JSON, liste de phrases en clair (une par critère appliqué ; celles qui concernent la mort commencent par « mort : »).

**Note du kill** (cumulée, puis bornée à [SCORE_MIN, SCORE_MAX] = [-2, 3] : l'échelle documentée est gardée, mais plus aucun malus n'existe, le minimum réel est +1 et un kill qui cumule tout vaut 4 borné à 3) :
- +`BASE_KILL` (1) : une menace éliminée. « Tuer une menace en duel et rester en vie, c'est ton travail individuel fait, même si le teamfight est perdu au final » : AUCUN malus (ni teamfight perdu, ni échange).
- +`SUPERIORITY` (1) : le kill CRÉE ou ÉTEND une supériorité numérique locale. Joueurs comptés : le tueur, la victime et les vivants à `kill_series.HELP_R` (10 m) du lieu de la mort, `PRE_KILL_S` avant la mort (équipe du tueur : n,
  équipe de la victime : m). Après le kill, la victime n'est plus là (m - 1) et le tueur non plus s'il meurt à moins de `TRADE_S` (1,0 s) de sa victime (échange : n - 1). Bonus si n_après > m_après, c'est-à-dire si l'équipe du
  tueur n'était pas en supériorité et l'est après (4 contre 4 devient 4 contre 3), OU l'était déjà et l'écart augmente d'un cran (un kill sans échange agrandit toujours l'écart d'un). « 3 contre 3 vaut moins que 4 contre 3 » :
  un échange 4 contre 4 qui devient 3 contre 3 ne donne rien. Un joueur sans position lue n'est pas compté (seuls le tueur et la victime le sont toujours).
- +`FIRST_WAVE_KILL` (1) : le kill est le premier contact d'une vague (`waves.find_waves`, `t_contact`), conservé de l'ancienne règle.
- +`POINT_FOLLOW` (1) : bonus de capture, SEULEMENT si le kill a créé ou étendu une supériorité numérique ET que l'équipe du tueur PREND le point (changement de propriétaire ou première prise, `retakes.instance_contexts`)
  ou le TIENT (propriétaire au kill et encore `POINT_WINDOW_S` = 20 s plus tard) dans les 20 s qui suivent, la victime étant morte à moins de `POINT_KILL_R_M` du cadre du point (« il faut une capture de point derrière pour
  profiter de son avantage numérique »). Cartes dont le propriétaire n'est pas lu (Ceres, Atlantis et Engine sans `point_owner`) : critère jamais appliqué.
- Le teamfight gagné ou perdu (`kill_series.fight_from`, kind `teamfight`, écart de pertes d'au moins `FIGHT_MIN_MARGIN`) est une note d'ÉQUIPE : une phrase de contexte, SANS effet sur `impact`.
Kills sans tueur adverse connu (suicide, décor, tueur illisible) : PAS de ligne (rien à noter).

**Note de la mort** (`death_impact`, du point de vue de la victime, indépendante de celle du kill) :
- base `DEATH_BASE` (-1) ; échange (le tueur meurt à moins de `TRADE_S` de sa victime) : `DEATH_TRADE` (-0,5) au lieu de -1 ;
- **bouclier humain** : +`SHIELD_BONUS` (2) si la victime a attiré sur elle la pression adverse (au moins `SHIELD_MIN_ENEMIES` = 2 ennemis vivants à moins de HELP_R d'elle à un des instants, pris tous les `SHIELD_STEP_S`, des
  `SHIELD_LOOKBACK_S` = 3 s qui précèdent sa mort) ET que son équipe est ensuite en supériorité numérique (`SHIELD_AFTER_S` = 0,5 s après la mort : coéquipiers vivants à moins de HELP_R du lieu de la mort plus nombreux que les
  ennemis vivants à moins de HELP_R) ET gagne le teamfight (série classée teamfight par kill_series, pertes de l'adversaire supérieures aux siennes d'au moins `FIGHT_MIN_MARGIN`). Note finale -1 + 2 = +1 : « tu as attiré au moins 2
  ennemis sur toi, ce qui laisse ton équipe en supériorité, même si ta mort est négative, ton positionnement rapporte ». Les `reasons` disent « bouclier humain ». Aucune vérité terrain : les seuils sont des conventions.
Temps en secondes depuis le début de la game (même clé que `kills` une fois `games.start_s` retranché). Contrat commun : `compute(conn, game_id) -> int`, `stats_meta` (module `kill_scores`)."""

import argparse
import json
import sys

import episode_common as ec
import kill_links
import kill_series
import retakes
import waves as waves_mod

MODULE = "kill_scores"
REVISION = 2
SCORE_MIN, SCORE_MAX = -2, 3
BASE_KILL = 1
SUPERIORITY = 1
FIRST_WAVE_KILL = 1
POINT_FOLLOW = 1
FIGHT_MIN_MARGIN = 1  # écart de pertes minimal pour parler de victoire ou de défaite d'un teamfight (1 : « perd le moins » au sens strict)
POINT_WINDOW_S = 20.0  # prise ou tenue du point dans les 20 s qui suivent le kill
POINT_KILL_R_M = kill_series.NEAR_M  # la victime meurt à 7 m au plus du cadre du point
TRADE_S = kill_links.TRADE_S  # le tueur meurt à moins de 1 s de sa victime : échange
PRE_KILL_S = 0.3  # joueurs comptés 0,3 s avant la mort de la victime
HELP_R = kill_series.HELP_R  # « local » : à 10 m au plus du lieu du kill (5 à 6 s de marche)
# Mort
DEATH_BASE = -1.0
DEATH_TRADE = -0.5
SHIELD_BONUS = 2.0
SHIELD_MIN_ENEMIES = 2
SHIELD_LOOKBACK_S = 3.0
SHIELD_STEP_S = 0.5
SHIELD_AFTER_S = 0.5


def _ensure_column(conn):
    """Les bases créées avant la note de la mort n'ont pas `death_impact` : la colonne est ajoutée (une seule fois, données conservées, NULL pour les anciennes lignes)."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info(kill_scores)")]
    if cols and "death_impact" not in cols:
        with conn:
            conn.execute("ALTER TABLE kill_scores ADD COLUMN death_impact REAL")


def _wave_reason(game, t, waves):
    """Phrase si le kill est le premier contact d'une vague, sinon None."""
    mine = [w for w in waves if w["t_contact"] is not None and abs(w["t_contact"] - t) < 1e-3]
    if not mine:
        return None
    return "premier kill de la vague de l'équipe " + " et ".join(f"{w['team']} (départ {ec.mmss(w['t_start'])})" for w in mine)


def _fight_context(fight, team):
    """(gagné, perdu, phrase de contexte) du teamfight pour l'équipe `team` : gagné si elle perd au moins FIGHT_MIN_MARGIN joueurs de moins que l'autre, perdu si elle en perd davantage ; duel ou égalité : (False, False, None)."""
    if fight is None or fight["kind"] != "teamfight":
        return False, False, None
    own, other = fight["losses"][team], fight["losses"][ec.other_team(team)]
    pertes = f"pertes {fight['losses']['A']} pour A, {fight['losses']['B']} pour B"
    if other - own >= FIGHT_MIN_MARGIN:
        return True, False, f"teamfight de {ec.mmss(fight['t_first'])} gagné par son équipe ({pertes})"
    if own - other >= FIGHT_MIN_MARGIN:
        return False, True, f"teamfight de {ec.mmss(fight['t_first'])} perdu par son équipe ({pertes})"
    return False, False, None


def _point_effect(game, ctxs, t, team, pos):
    """(points, phrase) si l'équipe du tueur prend ou tient un point dans POINT_WINDOW_S après le kill, avec la victime morte près du cadre ; sinon (0, None)."""
    near = [c for c in ctxs if c["timeline"] and c["inst"]["t0"] - 1 <= t <= c["inst"]["t1"] + 1
            and (d := ec.dist_rect_m(pos, c["inst"]["rect"])) is not None and d <= POINT_KILL_R_M]
    for c in near:  # une prise d'abord
        for tc, _old, new in c["caps"]:
            if new == team and t <= tc <= t + POINT_WINDOW_S:
                return POINT_FOLLOW, f"son équipe prend le point {c['inst']['point']} {tc - t:.0f} s plus tard"
    for c in near:
        end = min(t + POINT_WINDOW_S, c["timeline"][-1][1] - 0.01, c["inst"]["t1"] - 0.01)
        if end > t and ec.holder_at(c["timeline"], t) == team and ec.holder_at(c["timeline"], end) == team:
            return POINT_FOLLOW, f"son équipe tient le point {c['inst']['point']} dans les {POINT_WINDOW_S:.0f} s qui suivent"
    return 0, None


# ---------------------------------------------------------------- supériorité numérique locale

def _death_time(game, victim, t):
    """Instant de la mort de la victime d'un kill du killfeed à t : fin de la vie qui s'arrête à DEATH_MATCH_S du kill, None si aucune vie ne finit là (ligne du killfeed répétée ou décalée : la victime était déjà morte)."""
    for v in game["lives"].get(victim, []):
        if v["ended"] == "death" and abs(v["t1"] - t) <= kill_series.DEATH_MATCH_S:
            return v["t1"]
    return None


def _killer_death_dt(game, killer, t_death):
    """Écart (secondes, positif) entre la mort de la victime et celle du tueur si le tueur meurt à moins de TRADE_S (échange), sinon None."""
    for v in game["lives"].get(killer, []):
        if v["ended"] == "death" and abs(v["t1"] - t_death) <= TRADE_S:
            return abs(v["t1"] - t_death)
    return None


def _counts_near(game, centre, t, forced=(), excluded=()):
    """{A: n, B: n} : joueurs de `forced` (toujours comptés) plus les vivants à HELP_R de `centre` à l'instant t, moins ceux de `excluded`."""
    out = {team: 0 for team in ec.TEAMS}
    for s in range(1, 9):
        if s in excluded:
            continue
        near = s in forced
        if not near and ec.alive_at(game, s, t) and centre is not None:
            d = ec.dist_m(ec.pos_at(game, s, t), centre)
            near = d is not None and d <= HELP_R
        if near:
            out[ec.team_of(s)] += 1
    return out


def _superiority(game, killer, victim, t_death, centre, trade):
    """(points, phrase) : +SUPERIORITY si le kill crée ou étend une supériorité numérique locale de l'équipe du tueur (voir l'en-tête), sinon (0, None). `trade` : tueur mort à moins de TRADE_S."""
    team, other = ec.team_of(killer), ec.team_of(victim)
    before = _counts_near(game, centre, t_death - PRE_KILL_S, forced=(killer, victim))
    n0, m0 = before[team], before[other]
    n1, m1 = n0 - (1 if trade else 0), m0 - 1
    shown = f"{n0} contre {m0} avant le kill, {n1} contre {m1} après"
    if n1 > m1:
        verb = "étend" if n0 > m0 else "crée"
        return SUPERIORITY, f"le kill {verb} une supériorité numérique locale ({shown})"
    if trade:
        return 0, f"pas de supériorité numérique après l'échange ({shown})"
    return 0, None


# ---------------------------------------------------------------- note de la mort

def _human_shield(game, victim, t_death, fight, centre):
    """(vrai, phrase) si la mort est un bouclier humain : pression de SHIELD_MIN_ENEMIES ennemis dans les SHIELD_LOOKBACK_S avant, équipe de la victime en supériorité juste après, teamfight gagné."""
    team, other = ec.team_of(victim), ec.other_team(ec.team_of(victim))
    pressure, t = 0, t_death - SHIELD_LOOKBACK_S
    while t <= t_death + 1e-9:
        pos = ec.pos_at(game, victim, t) or centre
        if pos is not None:
            n = sum(1 for s in ec.team_slots(other) if ec.alive_at(game, s, t) and (d := ec.dist_m(ec.pos_at(game, s, t), pos)) is not None and d <= HELP_R)
            pressure = max(pressure, n)
        t += SHIELD_STEP_S
    if pressure < SHIELD_MIN_ENEMIES:
        return False, None
    after = _counts_near(game, centre, t_death + SHIELD_AFTER_S, excluded=(victim,))
    if after[team] <= after[other]:
        return False, None
    won, _lost, _phrase = _fight_context(fight, team)
    if not won:
        return False, None
    return True, (f"mort : bouclier humain, {pressure} ennemis à moins de {HELP_R:.0f} m dans les {SHIELD_LOOKBACK_S:.0f} s avant la mort, puis son équipe en supériorité ({after[team]} contre {after[other]}) "
                  f"et gagne le teamfight de {ec.mmss(fight['t_first'])} : sa mort est négative mais son positionnement rapporte")


def score_kills(game):
    """[{t, killer, victim, impact, death_impact, reasons}] pour les kills notables de la game chargée (episode_common.load_game)."""
    waves = waves_mod.find_waves(game)
    ctxs = retakes.instance_contexts(game)
    fights, out = {}, []
    for i, (t, killer, victim, _weapon, _kind) in enumerate(game["kills"]):
        team = ec.team_of(killer)
        t_death = _death_time(game, victim, t)
        matched = t_death is not None
        t_death = t if t_death is None else t_death
        centre = kill_series.death_pos(game, victim, t)
        i0 = kill_series.chain_start(game["kills"], i)
        if i0 not in fights:
            fights[i0] = kill_series.fight_from(game, i0)
        fight = fights[i0]
        reasons, score = ["une menace éliminée"], BASE_KILL
        # supériorité numérique locale (et échange)
        dt = _killer_death_dt(game, killer, t_death) if matched else None
        pts_sup, phrase = _superiority(game, killer, victim, t_death, centre, dt is not None) if matched else (0, None)
        if not matched:
            reasons.append(f"aucune mort de la victime à {kill_series.DEATH_MATCH_S:.0f} s de la ligne du killfeed (ligne répétée ou décalée) : supériorité numérique, échange et bouclier humain non évalués")
        score += pts_sup
        if phrase:
            reasons.append(phrase)
        if dt is not None:
            reasons.append(f"échange : le tueur meurt à {dt:.1f} s de sa victime, son travail individuel est fait, aucun malus sur le kill")
        # premier kill de la vague
        phrase = _wave_reason(game, t, waves)
        if phrase:
            score += FIRST_WAVE_KILL
            reasons.append(phrase)
        # bonus de capture : seulement avec une supériorité numérique créée ou étendue
        pts_cap, phrase = _point_effect(game, ctxs, t, team, centre)
        if pts_cap and pts_sup:
            score += pts_cap
            reasons.append(phrase + " (le kill a créé ou étendu une supériorité numérique)")
        elif pts_cap:
            reasons.append(phrase + ", mais le kill n'a pas créé de supériorité numérique : pas de bonus de capture")
        # contexte d'équipe : sans effet sur la note du kill
        _won, _lost, phrase = _fight_context(fight, team)
        if phrase:
            reasons.append("contexte d'équipe, sans effet sur la note du kill : " + phrase)
        # note de la mort (point de vue de la victime)
        death = DEATH_TRADE if dt is not None else DEATH_BASE
        if dt is not None:
            reasons.append(f"mort : échange (le tueur meurt à {dt:.1f} s), {DEATH_TRADE:g} au lieu de {DEATH_BASE:g}")
        shield, phrase = _human_shield(game, victim, t_death, fight, centre) if matched else (False, None)
        if shield:
            death += SHIELD_BONUS
            reasons.append(phrase)
        out.append({"t": round(t, 3), "killer": killer, "victim": victim, "impact": float(max(SCORE_MIN, min(SCORE_MAX, score))), "death_impact": float(death), "reasons": reasons})
    return out


def compute(conn, game_id):
    """Efface puis réécrit les notes de la game ; renvoie leur nombre. Écrit aussi stats_meta."""
    _ensure_column(conn)
    game = ec.load_game(conn, game_id)
    rows = score_kills(game) if game else []
    conn.execute("DELETE FROM kill_scores WHERE game_id = ?", (game_id,))
    for r in rows:
        conn.execute("INSERT OR REPLACE INTO kill_scores (game_id, t, killer_slot, victim_slot, impact, reasons, death_impact) VALUES (?, ?, ?, ?, ?, ?, ?)",
                     (game_id, r["t"], r["killer"], r["victim"], r["impact"], json.dumps(r["reasons"], ensure_ascii=False), r["death_impact"]))
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, MODULE, REVISION))
    conn.commit()
    return len(rows)


def measure(conn, game_id):
    """Distribution des notes du kill et de la mort de la game, nombre de boucliers humains et de kills sans ligne."""
    game = ec.load_game(conn, game_id)
    rows = score_kills(game) if game else []
    dist, ddist = {}, {}
    for r in rows:
        dist[r["impact"]] = dist.get(r["impact"], 0) + 1
        ddist[r["death_impact"]] = ddist.get(r["death_impact"], 0) + 1
    total = conn.execute("SELECT COUNT(*) FROM kills WHERE game_id = ?", (game_id,)).fetchone()[0]
    shields = sum(1 for r in rows if any(x.startswith("mort : bouclier humain") for x in r["reasons"]))
    return {"kills": total, "notes": len(rows), "sans_note": total - len(rows), "mort_non_retrouvee": sum(1 for r in rows if any("aucune mort de la victime" in x for x in r["reasons"])), "distribution": dict(sorted(dist.items())), "distribution_mort": dict(sorted(ddist.items())), "boucliers_humains": shields}


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Calcule la note des kills et des morts d'une game.")
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
