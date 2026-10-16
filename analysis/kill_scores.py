"""Note de chaque kill (table `kill_scores`, module `kill_scores`, REVISION 1) : `python analysis/kill_scores.py --game N [--db chemin] [--measure]`.

Échelle de -2 à +3 (docs/PLAN_STATS_2.md, section 2) : une CONVENTION de l'utilisateur, pas une vérité terrain ; chaque critère est une constante modifiable. `impact` est la note du point de vue de l'ÉQUIPE DU TUEUR ;
vue de l'équipe de la victime, c'est le même kill avec l'impact opposé (`-impact`). `reasons` : JSON, liste de phrases en clair, une par critère appliqué (liste vide : note 0 sans raison).
Critères (cumulés, puis bornés à [SCORE_MIN, SCORE_MAX]) :
- +`FIRST_WAVE_KILL` : le kill est le premier contact d'une vague (`waves.find_waves`, `t_contact` : premier kill d'un membre de la vague) ;
- +`FIGHT_WON` : le kill est dans un teamfight (`kill_series.fight_from`, kind `teamfight`) que l'équipe du tueur gagne (elle perd moins de joueurs que l'autre : égalité des pertes = ni bonus ni malus, les survivants ne départagent pas) ; tous les kills de l'équipe
  gagnante de la série sont notés, pas seulement le dernier (convention à confirmer) ;
- +`POINT_FOLLOW` : dans les `POINT_WINDOW_S` (20 s) qui suivent, l'équipe du tueur PREND le point (changement de propriétaire ou première prise, `retakes.instance_contexts`) ou le TIENT (propriétaire au kill
  et encore 20 s plus tard), à condition que la victime soit morte à moins de `POINT_KILL_R_M` du cadre du point (convention : `kill_series.NEAR_M`, sans cette condition un kill à l'autre bout de la carte recevrait le bonus) ;
  cartes dont le propriétaire n'est pas lu (Ceres, Atlantis et Engine sans `point_owner`) : critère jamais appliqué ;
- -`TRADE_DEATH` : le tueur meurt dans les `TRADE_WINDOW_S` (5 s) qui suivent le kill (échange) SANS SUITE (ni teamfight gagné, ni point) ; un teamfight perdu ne cumule pas ce malus ;
- -`FIGHT_LOST` : l'équipe du tueur perd le teamfight malgré le kill.
Une série à égalité (gagnant None) et un duel ne donnent ni bonus ni malus de teamfight. Kills sans tueur adverse connu (suicide, décor, tueur illisible) : PAS de ligne (rien à noter).
Temps en secondes depuis le début de la game (même clé que `kills` une fois `games.start_s` retranché). Contrat commun : `compute(conn, game_id) -> int`, `stats_meta` (module `kill_scores`)."""

import argparse
import json
import sys

import episode_common as ec
import kill_series
import retakes
import waves as waves_mod

MODULE = "kill_scores"
REVISION = 1
SCORE_MIN, SCORE_MAX = -2, 3
FIRST_WAVE_KILL = 1
FIGHT_WON = 1
POINT_FOLLOW = 1
TRADE_DEATH = 1  # malus (soustrait)
FIGHT_LOST = 2  # malus (soustrait)
FIGHT_MIN_MARGIN = 1  # écart de pertes minimal pour parler de victoire ou de défaite (1 : « perd le moins » au sens strict ; 2 écarterait les séries 6 contre 7)
POINT_WINDOW_S = 20.0  # prise ou tenue du point dans les 20 s qui suivent le kill
POINT_KILL_R_M = kill_series.NEAR_M  # la victime meurt à 7 m au plus du cadre du point
TRADE_WINDOW_S = 5.0  # le tueur meurt dans les 5 s
TRADE_BEFORE_S = 1.0  # une fin de vie du tueur jusqu'à 1 s avant la ligne du killfeed est la même mort (la ligne arrive après)


def _wave_reason(game, t, waves):
    """Phrase si le kill est le premier contact d'une vague, sinon None."""
    mine = [w for w in waves if w["t_contact"] is not None and abs(w["t_contact"] - t) < 1e-3]
    if not mine:
        return None
    return "premier kill de la vague de l'équipe " + " et ".join(f"{w['team']} (départ {ec.mmss(w['t_start'])})" for w in mine)


def _fight_effect(fight, team):
    """(points, phrase) du teamfight pour l'équipe du tueur : bonus si elle perd au moins FIGHT_MIN_MARGIN joueurs de moins que l'autre, malus si elle en perd davantage, 0 sinon (duel, égalité des pertes).
    Seules les pertes comptent (« l'équipe du tueur perd le moins ») : le départage par les survivants de kill_series.winner_of n'est pas utilisé."""
    if fight is None or fight["kind"] != "teamfight":
        return 0, None
    own, other = fight["losses"][team], fight["losses"][ec.other_team(team)]
    pertes = f"pertes {fight['losses']['A']} pour A, {fight['losses']['B']} pour B"
    if other - own >= FIGHT_MIN_MARGIN:
        return FIGHT_WON, f"il fait gagner le teamfight de {ec.mmss(fight['t_first'])} ({pertes})"
    if own - other >= FIGHT_MIN_MARGIN:
        return -FIGHT_LOST, f"son équipe perd le teamfight de {ec.mmss(fight['t_first'])} malgré le kill ({pertes})"
    return 0, None


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


def _killer_dies(game, killer, t):
    """Instant de la mort du tueur si elle tombe de TRADE_BEFORE_S avant à TRADE_WINDOW_S après le kill, sinon None."""
    for v in game["lives"].get(killer, []):
        if v["ended"] == "death" and t - TRADE_BEFORE_S <= v["t1"] <= t + TRADE_WINDOW_S:
            return v["t1"]
    return None


def score_kills(game):
    """[{t, killer, victim, impact, reasons}] pour les kills notables de la game chargée (episode_common.load_game)."""
    waves = waves_mod.find_waves(game)
    ctxs = retakes.instance_contexts(game)
    fights, out = {}, []
    for i, (t, killer, victim, _weapon, _kind) in enumerate(game["kills"]):
        team, reasons, score = ec.team_of(killer), [], 0
        phrase = _wave_reason(game, t, waves)
        if phrase:
            score += FIRST_WAVE_KILL
            reasons.append(phrase)
        i0 = kill_series.chain_start(game["kills"], i)
        if i0 not in fights:
            fights[i0] = kill_series.fight_from(game, i0)
        pts, phrase = _fight_effect(fights[i0], team)
        score += pts
        if phrase:
            reasons.append(phrase)
        fight_pts = pts
        pts, phrase = _point_effect(game, ctxs, t, team, kill_series.death_pos(game, victim, t))
        score += pts
        if phrase:
            reasons.append(phrase)
        died = _killer_dies(game, killer, t)
        if died is not None and fight_pts == 0 and pts == 0:  # sans suite (ni teamfight gagné, ni point) et pas déjà puni par un teamfight perdu
            score -= TRADE_DEATH
            reasons.append(f"le tueur meurt {max(0.0, died - t):.1f} s plus tard, sans suite")
        out.append({"t": round(t, 3), "killer": killer, "victim": victim, "impact": float(max(SCORE_MIN, min(SCORE_MAX, score))), "reasons": reasons})
    return out


def compute(conn, game_id):
    """Efface puis réécrit les notes de la game ; renvoie leur nombre. Écrit aussi stats_meta."""
    game = ec.load_game(conn, game_id)
    rows = score_kills(game) if game else []
    conn.execute("DELETE FROM kill_scores WHERE game_id = ?", (game_id,))
    for r in rows:
        conn.execute("INSERT OR REPLACE INTO kill_scores (game_id, t, killer_slot, victim_slot, impact, reasons) VALUES (?, ?, ?, ?, ?, ?)",
                     (game_id, r["t"], r["killer"], r["victim"], r["impact"], json.dumps(r["reasons"], ensure_ascii=False)))
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, MODULE, REVISION))
    conn.commit()
    return len(rows)


def measure(conn, game_id):
    """Distribution des notes de la game et nombre de kills sans ligne."""
    game = ec.load_game(conn, game_id)
    rows = score_kills(game) if game else []
    dist = {}
    for r in rows:
        dist[int(r["impact"])] = dist.get(int(r["impact"]), 0) + 1
    total = conn.execute("SELECT COUNT(*) FROM kills WHERE game_id = ?", (game_id,)).fetchone()[0]
    return {"kills": total, "notes": len(rows), "sans_note": total - len(rows), "distribution": dict(sorted(dist.items()))}


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Calcule la note des kills d'une game.")
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
