"""État du gadget (secondaire) de chaque joueur au cours d'une game (table Stats : gadget_state), lu sur la case gadget du bandeau.

Indice (mesuré sur images isolées, voir `docs/PLAN_STATS_2.md` et l'en-tête de mesure plus bas) : la case gadget d'un bandeau VIVANT contient une icône noire quand le gadget est
disponible et une icône à peine plus sombre que le fond (« grise », fantôme) quand il est utilisé, jusqu'à ce qu'il revienne noir. Sur un bandeau mort, toute l'icône est un gris moyen
(sans rapport avec l'état) : aucun état n'est lu. Contraste lu par case = relief (loadout._dark : de combien chaque pixel est plus sombre que le fond de sa ligne) : 95e centile et maximum.

Mesures (10 kills de gadget DX3 et STICKY, dont un vu en mp4 et en YouTube, sur 3 cartes ; 215 bandeaux vivants tirés au hasard sur 5 games ; gadgets vus : DX3, STICKY, SONAR, bouclier) :
  - utilisé : relief 95e centile 14 à 36 sur les kills (jusqu'à 44 au hasard), maximum 28 à 55 ; disponible : 55 à 125 selon l'icône (DX3 107 à 125, STICKY 64 à 90), maximum 100 à 152 ;
  - 3 bandeaux sur 215 (1,4 %) tombent entre les seuils (« ambigu »), aucun n'est classé de force ;
  - sur 10 kills, l'icône devient grise 2 à 5 s AVANT le kill dans 9 cas (grenade lancée avant l'impact) et 0 à 2 s APRÈS dans 1 cas (DX3, game 16 à 986 s) : d'où la tolérance de 2 s ;
  - un gadget utilisé le reste jusqu'à la mort pendant au moins 26 à 32 s ; il est disponible à chaque réapparition ; délai de recharge : 45,0 s (game 26, joueur 3, bouclier, lecture à 0,5 s),
    42 à 48 s et 42 à 54 s sur deux autres cycles lus à 3 et 6 s ; seulement 3 cycles : ce n'est pas un chiffre établi.

Segments : un par période, en secondes depuis le début de la game (la vidéo se lit à `games.start_s` plus ce temps). `ready`, `used` ; `unknown` = bandeau mort ou illisible
(écran noir) ou contraste ambigu. Les lectures brutes sont gardées dans `data/cache/gadget_<game>.json` : changer un seuil ne demande pas de relire la vidéo.

Bilan par vie (`life_stats`, rien d'écrit) : utilisations, `unused_at_death` (mort gadget encore disponible), temps disponible, plus longue période sans usage, utilisations possibles
compte tenu du délai de recharge mesuré sur la game (`cooldown_s`, sinon DEFAULT_COOLDOWN_S).

  python analysis/gadget_state.py --game 25 [--db chemin] [--refresh] [--summary]   (lit la vidéo une fois : 14 s de vidéo lues en 1 s, une game entière non mesurée ; `--summary` n'écrit rien)
"""

import argparse
import json
import statistics
import sys
from pathlib import Path

MODULE = "gadget_state"
REVISION = 2  # 2 : les utilisations ne sont plus les segments « utilisé » mais les passages de « disponible » à « utilisé » (life_stats.uses)

STEP_S = 0.5  # une image toutes les 0,5 s : précision des bornes de segment
# Seuils de lecture (relief de la case gadget, bandeau vivant). Deux conditions chacun : le 95e centile ET le maximum.
USED_P95_MAX, USED_MAX_MAX = 45.0, 60.0
READY_P95_MIN, READY_MAX_MIN = 55.0, 70.0
FLICKER_S = 1.5  # un état de moins de cette durée entouré du même état des deux côtés est un clignotement (règle des bandeaux : moins de 1,5 s)
AMBIGUOUS_MAX_S = 1.5  # un contraste ambigu de cette durée au plus entre deux états différents est le passage de l'un à l'autre
DEFAULT_COOLDOWN_S = 45.0  # délai de recharge par défaut (mesuré : entre 42 et 48 s sur une game, 42 et 54 s sur l'autre ; deux cycles seulement)
MIN_COOLDOWN_CYCLES = 3  # en dessous, le délai de la game est trop peu mesuré : on garde la valeur par défaut
HOLD_WARN_S = 60.0  # gadget gardé sans usage plus longtemps que cela dans une vie (valeur par défaut du plan, à ajuster)
KILL_TOLERANCE_S = 2.0  # un kill de gadget doit tomber dans un segment « utilisé » à cette tolérance près
GADGET_KILL_NAMES = ("DX3", "STICKY")  # seules ces grenades comptent comme gadget d'un kill (CLAUDE.md)
BAR_ZONES = ("team_a_bar", "team_b_bar")


# ---------------------------------------------------------------- lecture d'une image

def classify_reading(p95, peak, fill):
    """Classe d'une lecture : « ready », « used », « amb » (contraste entre les seuils) ou « dead » (bandeau mort : l'icône n'indique rien)."""
    import banners

    if fill < banners.MIN_FILL:
        return "dead"
    if p95 < USED_P95_MAX and peak < USED_MAX_MAX:
        return "used"
    if p95 >= READY_P95_MIN and peak >= READY_MAX_MIN:
        return "ready"
    return "amb"


def measure_team(crop):
    """Pour les 4 bandeaux de la barre d'une équipe (image BGR) : [(relief 95e centile, relief maximum, remplissage)], ou 4 fois None si l'écran est noir."""
    import numpy as np

    import banners
    import loadout

    if crop is None or float(crop.mean()) < banners.MIN_BAR_BRIGHTNESS:
        return [None] * 4
    out = []
    for i, st in enumerate(banners.read_team(crop)):
        dark = loadout._dark(loadout.box_piece(crop, i, "gadget"))
        out.append((float(np.percentile(dark, 95)), float(dark.max()), float(st["fill"])))
    return out


def read_measures(video, zones, width, height, start_s, end_s, step_s=STEP_S):
    """Lit la vidéo en un seul passage de ffmpeg (les deux barres d'équipe dans un seul recadrage) : {slot: [(t, p95, max, fill) ou (t, None, None, None)]}, t en secondes de game."""
    import names
    import timer

    boxes = {key: timer.timer_box(zones[key], width, height) for key in BAR_ZONES}
    ux = min(b[0] for b in boxes.values())
    uy = min(b[1] for b in boxes.values())
    uw = (max(b[0] + b[2] for b in boxes.values()) - ux + 1) // 2 * 2
    uh = (max(b[1] + b[3] for b in boxes.values()) - uy + 1) // 2 * 2
    union = {"x": ux / width, "y": uy / height, "w": uw / width, "h": uh / height}
    out = {slot: [] for slots in names.TEAM_SLOTS.values() for slot in slots}
    for t, image in timer.iter_crops(video, union, width, height, step_s=step_s, t0=start_s, t1=end_s):
        for key, (bx, by, bw, bh) in boxes.items():
            piece = image[by - uy : by - uy + bh, bx - ux : bx - ux + bw]
            for slot, m in zip(names.TEAM_SLOTS[key], measure_team(piece)):
                out[slot].append((round(t - start_s, 2),) + (m if m else (None, None, None)))
    return out


# ---------------------------------------------------------------- du contraste aux segments

def _runs(classes):
    """[(classe, i0, i1)] : suites de lectures identiques."""
    out = []
    for i, c in enumerate(classes):
        if out and out[-1][0] == c:
            out[-1][2] = i
        else:
            out.append([c, i, i])
    return out


def smooth(classes, step_s=STEP_S):
    """Retire les clignotements : une suite plus courte que FLICKER_S dont les deux voisines sont la même classe prend cette classe ; un contraste ambigu court entre deux états
    différents (passage de l'un à l'autre) est partagé entre eux. Renvoie une nouvelle liste."""
    cl = list(classes)
    for _ in range(len(cl) + 1):  # point fixe : chaque passage supprime au moins une suite
        runs = _runs(cl)
        change = False
        for k in range(1, len(runs) - 1):
            c, i0, i1 = runs[k]
            before, after = runs[k - 1][0], runs[k + 1][0]
            if (i1 - i0 + 1) * step_s >= FLICKER_S:
                continue
            if before == after and c != before:
                cl[i0 : i1 + 1] = [before] * (i1 - i0 + 1)
                change = True
                break
            if c == "amb" and before != after and "amb" not in (before, after) and "dead" not in (before, after) and (i1 - i0 + 1) * step_s <= AMBIGUOUS_MAX_S:
                half = (i1 - i0 + 1) // 2
                cl[i0 : i0 + half], cl[i0 + half : i1 + 1] = [before] * half, [after] * (i1 - i0 + 1 - half)
                change = True
                break
        if not change:
            break
    return cl


def build_segments(readings, step_s=STEP_S):
    """Segments {t0, t1, state} d'un joueur à partir de ses lectures [(t, p95, max, fill)]. Bornes au milieu entre deux lectures de classes différentes ; dernier segment arrêté
    une demi-pas après la dernière lecture. Un bandeau illisible (écran noir : None) compte comme mort."""
    if not readings:
        return []
    classes = smooth([classify_reading(p, m, f) if p is not None else "dead" for _t, p, m, f in readings], step_s)
    states = {"ready": "ready", "used": "used", "amb": "unknown", "dead": "unknown"}
    segments = []
    for c, i0, i1 in _runs(classes):
        state = states[c]
        t0 = readings[i0][0] if i0 == 0 else (readings[i0 - 1][0] + readings[i0][0]) / 2
        t1 = readings[i1][0] + step_s / 2 if i1 == len(readings) - 1 else (readings[i1][0] + readings[i1 + 1][0]) / 2
        if segments and segments[-1]["state"] == state:  # « ambigu » puis « mort » : un seul segment inconnu
            segments[-1]["t1"] = round(t1, 2)
        else:
            segments.append({"t0": round(t0, 2), "t1": round(t1, 2), "state": state})
    return segments


# ---------------------------------------------------------------- base de données

def _gadget_of(conn, game_id):
    """(fonction (slot, t) -> identifiant d'icône du gadget de la vie qui contient t, sinon celui de la game ou None)."""
    lives = {}
    for r in conn.execute("SELECT l.slot, l.t0, l.t1, o.gadget FROM lives l LEFT JOIN life_loadouts o ON o.game_id = l.game_id AND o.slot = l.slot AND o.life_idx = l.idx WHERE l.game_id = ?", (game_id,)):
        lives.setdefault(r["slot"], []).append((r["t0"], r["t1"], r["gadget"]))
    whole = {r["slot"]: r["gadget"] for r in conn.execute("SELECT slot, gadget FROM loadouts WHERE game_id = ?", (game_id,))}

    def of(slot, t):
        for t0, t1, gadget in lives.get(slot, []):
            if t0 - 1.0 <= t <= t1 + 1.0 and gadget:
                return gadget
        return whole.get(slot)
    return of


def _cache_path(game_id):
    import paths

    return Path(paths.cache_dir()) / f"gadget_{game_id}.json"


def _load_measures(conn, game_id, refresh=False):
    """Lectures brutes d'une game : du cache si les paramètres sont les mêmes, sinon relues sur la vidéo (durée d'une game non mesurée). None si la vidéo est absente."""
    import db

    g = conn.execute("SELECT g.map, g.start_s, g.end_s, v.path AS path, v.width AS vw, v.height AS vh FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (game_id,)).fetchone()
    if g is None:
        return None
    zones = {key: db.zone_for(conn, g["map"], key) for key in BAR_ZONES}
    key = json.dumps({"zones": zones, "step": STEP_S, "start": g["start_s"], "end": g["end_s"], "size": [g["vw"], g["vh"]]}, sort_keys=True)
    cache = _cache_path(game_id)
    if cache.exists() and not refresh:
        try:
            data = json.loads(cache.read_text(encoding="utf-8"))
            if data.get("key") == key:
                return {int(s): [tuple(r) for r in rows] for s, rows in data["measures"].items()}
        except (ValueError, KeyError):
            pass
    if not g["path"] or not Path(g["path"]).exists():
        print(f"vidéo absente : {g['path']}", file=sys.stderr)
        return None
    measures = read_measures(g["path"], zones, g["vw"], g["vh"], g["start_s"], g["end_s"])
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps({"key": key, "measures": measures}), encoding="utf-8")
    return measures


def compute(conn, game_id, measures=None, refresh=False):
    """Efface puis réécrit les segments `gadget_state` de la game ; renvoie leur nombre. `measures` : lectures déjà faites ({slot: [(t, p95, max, fill)]}, tests). Sans vidéo ni cache : 0, rien d'effacé."""
    if measures is None:
        measures = _load_measures(conn, game_id, refresh)
    if not measures:
        return 0
    gadget_of = _gadget_of(conn, game_id)
    conn.execute("DELETE FROM gadget_state WHERE game_id = ?", (game_id,))
    n = 0
    for slot, readings in sorted(measures.items()):
        for seg in build_segments(readings):
            conn.execute(
                "INSERT INTO gadget_state (game_id, slot, t0, t1, gadget, state) VALUES (?, ?, ?, ?, ?, ?)",
                (game_id, slot, seg["t0"], seg["t1"], gadget_of(slot, (seg["t0"] + seg["t1"]) / 2) if seg["state"] != "unknown" else None, seg["state"]),
            )
            n += 1
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, MODULE, REVISION))
    conn.commit()
    return n


# ---------------------------------------------------------------- bilans (lecture de la table, rien d'écrit)

def _segments_by_slot(conn, game_id):
    out = {}
    for r in conn.execute("SELECT slot, t0, t1, gadget, state FROM gadget_state WHERE game_id = ? ORDER BY slot, t0", (game_id,)):
        out.setdefault(r["slot"], []).append(dict(r))
    return out


def cooldowns(segments):
    """Délais de recharge mesurés (s) : durée d'un segment « utilisé » compris entre deux segments « disponible » collés à lui (la borne est le milieu entre deux lectures :
    précision d'une demi-période à chaque bout). `segments` : {slot: [segments]}."""
    out = []
    for segs in segments.values():
        for k in range(1, len(segs) - 1):
            if segs[k]["state"] == "used" and segs[k - 1]["state"] == "ready" and segs[k + 1]["state"] == "ready":
                out.append(round(segs[k]["t1"] - segs[k]["t0"], 2))
    return out


def cooldown_of(segments):
    """Délai de recharge de la game : médiane des délais mesurés si au moins MIN_COOLDOWN_CYCLES, sinon DEFAULT_COOLDOWN_S. Renvoie (délai, nombre de cycles mesurés)."""
    values = cooldowns(segments)
    return (statistics.median(values) if len(values) >= MIN_COOLDOWN_CYCLES else DEFAULT_COOLDOWN_S), len(values)


def _overlap(seg, t0, t1):
    return max(0.0, min(seg["t1"], t1) - max(seg["t0"], t0))


def count_uses(segments):
    """Nombre d'utilisations dans des segments d'une vie : chaque entrée dans l'état « utilisé » depuis « disponible » (ou depuis le début de la vie) ; « inconnu » est ignoré, il ne sépare pas deux utilisations."""
    uses, prev = 0, None
    for s in sorted(segments, key=lambda x: x["t0"]):
        if s["state"] == "unknown":
            continue
        if s["state"] == "used" and prev != "used":
            uses += 1
        prev = s["state"]
    return uses


def life_stats(conn, game_id, cooldown_s=None):
    """Une ligne par vie (table `lives`) : {slot, idx, t0, t1, ended, gadget, readable (part de la vie lisible), uses, first_use_s, ready_s, used_s, max_ready_run_s,
    held_too_long, unused_at_death (1, 0 ou None : mort sans que l'état soit lu, ou fin de game), possible_uses}.

    uses : utilisations de la vie = passages de « disponible » à « utilisé » (les trous illisibles « inconnu » entre deux segments « utilisé » ne font pas une nouvelle utilisation : avant, `uses` comptait
    les segments « utilisé » et une utilisation coupée par des trous illisibles comptait plusieurs fois, jusqu'à dépasser la borne haute) ; une vie qui commence déjà « utilisé » compte une utilisation (un bandeau mort
    coupe les segments, donc aucun ne passe d'une vie à l'autre). possible_uses : au plus 1 + vie / délai (usage dès l'apparition,
    puis un à chaque recharge) : une borne haute, pas une attente."""
    segments = _segments_by_slot(conn, game_id)
    cooldown = cooldown_s if cooldown_s is not None else cooldown_of(segments)[0]
    gadget_of = _gadget_of(conn, game_id)
    out = []
    for r in conn.execute("SELECT slot, idx, t0, t1, ended FROM lives WHERE game_id = ? ORDER BY slot, idx", (game_id,)):
        slot, t0, t1, length = r["slot"], r["t0"], r["t1"], max(r["t1"] - r["t0"], 0.0)
        inside = [s for s in segments.get(slot, []) if _overlap(s, t0, t1) > 0]
        ready_s = sum(_overlap(s, t0, t1) for s in inside if s["state"] == "ready")
        used_s = sum(_overlap(s, t0, t1) for s in inside if s["state"] == "used")
        used = [s for s in inside if s["state"] == "used"]
        uses = count_uses(inside)
        run = max([_overlap(s, t0, t1) for s in inside if s["state"] == "ready"], default=0.0)
        unused = None
        if r["ended"] == "death":
            last = [s for s in inside if s["state"] != "unknown" and s["t1"] >= t1 - 3.0]
            unused = (1 if last[-1]["state"] == "ready" else 0) if last else None
        out.append({
            "slot": slot, "idx": r["idx"], "t0": t0, "t1": t1, "ended": r["ended"], "gadget": gadget_of(slot, (t0 + t1) / 2),
            "readable": round((ready_s + used_s) / length, 3) if length else 0.0, "uses": uses,
            "first_use_s": round(max(used[0]["t0"] - t0, 0.0), 2) if used else None,
            "ready_s": round(ready_s, 2), "used_s": round(used_s, 2), "max_ready_run_s": round(run, 2),
            "held_too_long": run >= HOLD_WARN_S and not used, "unused_at_death": unused,
            "possible_uses": 1 + int(length // cooldown) if length >= 3.0 else 0,
        })
    return out


def check_gadget_kills(conn, game_id):
    """Kills de gadget (DX3, STICKY) de la game : {n, hit, misses}. Un kill est « trouvé » si le tueur a un segment « utilisé » qui le contient à KILL_TOLERANCE_S près.
    Le temps d'un kill est en temps de vidéo : on retire `games.start_s`."""
    import weapons

    names = weapons.display_names()
    start = conn.execute("SELECT start_s FROM games WHERE id = ?", (game_id,)).fetchone()["start_s"]
    segments = _segments_by_slot(conn, game_id)
    n, hit, misses = 0, 0, []
    for r in conn.execute("SELECT t, killer_slot, weapon FROM kills WHERE game_id = ? AND weapon IS NOT NULL AND killer_slot IS NOT NULL ORDER BY t", (game_id,)):
        if names.get(r["weapon"]) not in GADGET_KILL_NAMES:
            continue
        t = r["t"] - start
        n += 1
        if any(s["state"] == "used" and s["t0"] - KILL_TOLERANCE_S <= t <= s["t1"] + KILL_TOLERANCE_S for s in segments.get(r["killer_slot"], [])):
            hit += 1
        else:
            state = next((s["state"] for s in segments.get(r["killer_slot"], []) if s["t0"] <= t <= s["t1"]), None)
            misses.append({"t": round(t, 1), "slot": r["killer_slot"], "weapon": names.get(r["weapon"]), "state_at_kill": state})
    return {"n": n, "hit": hit, "misses": misses}


def summary(conn, game_id):
    """Chiffres de contrôle d'une game (lit la table gadget_state)."""
    segments = _segments_by_slot(conn, game_id)
    cooldown, cycles = cooldown_of(segments)
    lives = life_stats(conn, game_id, cooldown)
    known = [lf for lf in lives if lf["readable"] >= 0.5]
    deaths = [lf for lf in lives if lf["unused_at_death"] is not None]
    return {
        "segments": sum(len(v) for v in segments.values()), "lives": len(lives), "lives_readable_half": len(known),
        "uses": sum(lf["uses"] for lf in lives), "lives_without_use": sum(1 for lf in known if not lf["uses"]),
        "deaths_read": len(deaths), "unused_at_death": sum(lf["unused_at_death"] for lf in deaths),
        "cooldown_s": cooldown, "cooldown_cycles_measured": cycles, "cooldowns": cooldowns(segments), "gadget_kills": check_gadget_kills(conn, game_id),
    }


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Calcule l'état du gadget de chaque joueur d'une game.")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--refresh", action="store_true", help="Relit la vidéo même si des lectures sont en cache")
    parser.add_argument("--summary", action="store_true", help="Affiche les chiffres de contrôle de la table existante, sans rien calculer")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    if args.summary:
        print(json.dumps(summary(conn, args.game), ensure_ascii=False))
        return 0
    print(json.dumps({MODULE: compute(conn, args.game, refresh=args.refresh)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
