"""Calendrier des changements du point actif (Outlaw, Atlantis, Helios Station) : les INSTANTS sont connus par carte, seule l'IDENTITÉ du point de chaque période se lit sur le HUD.

Fait établi par l'utilisateur (14 octobre 2026) : sur ces cartes le point actif change toujours aux mêmes instants du chrono, mais le point qui apparaît est aléatoire d'une game à l'autre.
Le fichier `map_rotation_schedule.json` donne ces instants en CHRONO RESTANT (« 11:25 » : le chrono affiche 11:25), la référence stable d'une game à l'autre.

Du chrono aux secondes de game : `timer.py` lit le chrono une fois par seconde. Pour un instant R du chrono (en secondes restantes), la seconde de game T = `off` - R, où `off` est la médiane
de (seconde de game + chrono lu) sur les 45 premières secondes de la game (écart de 1 à 3 s d'une vidéo à l'autre : début de la game coupé différemment, YouTube contre mp4 local). `off`
vaut 1 à 3 de plus que la valeur de départ du chrono et ne dépend pas des bornes de la game (`segments.py`).

Lecture : le HUD s'allume `HUD_LAG_S` après l'instant du chrono (mesuré à 4 images par seconde : 0,5 s sur Outlaw aux deux instants lus, 0,5 à 1 s sur Atlantis ; à une image par seconde le premier
échantillon allumé est toujours celui d'après). L'ancien point s'éteint au même moment, sauf sur Outlaw après 3:55 où il reste allumé (le HUD montre alors deux points). Pour chaque période
[T_k, T_k+1[ on vote sur les échantillons du HUD de T_k + HUD_LAG_S + VOTE_MARGIN_S à T_k+1 + HUD_LAG_S - VOTE_MARGIN_S : le point allumé le plus souvent, en écartant le point de la période
d'avant quand un autre est allumé (jamais le même point deux fois de suite sur les 16 changements lus : Outlaw C B A B D B et C D A D, Atlantis A B A C B A et A C B C) ; le point d'avant seul n'est retenu que s'il s'est éteint puis rallumé. Une période
dont aucun point n'est assez lu n'a pas de ligne (elle est signalée dans les statistiques) : le calendrier fixe les bornes, il n'invente pas l'identité.

Entrée `dernier_ouvert` (Atlantis : seuls les changements jusqu'à 4:25 sont mesurés, les games lues finissent à 4:00 et 5:30) : au-delà du dernier instant connu, les plages viennent du HUD seul
(le point le plus lumineux de chaque seconde, plages d'au moins MIN_TAIL_RUN_S). Une carte sans entrée reste lue par le HUD seul. Une entrée `"none": true` (Engine, Helios Station) dit que la carte n'a AUCUN changement de point (information de l'utilisateur, 16 octobre 2026) :
`has_no_change` la signale, `load_calendar` rend None et rotations.py n'écrit aucune rotation.
Sortie : segments {point, t0, t1, source « schedule »} de la table `point_active` (secondes depuis le début de la game)."""

import json
import os
from pathlib import Path
from statistics import median

SCHEDULE_FILE = Path(__file__).with_name("map_rotation_schedule.json")
HUD_LAG_S = 1.0  # le HUD s'allume au premier échantillon (1 s) qui suit l'instant du chrono : mesuré sur 4 games distinctes, aucun écart d'un échantillon à l'autre
VOTE_MARGIN_S = 1.0  # secondes laissées de chaque côté du changement (lettre blanche fine qui se lit mal juste après l'allumage)
MIN_VOTES = 3  # échantillons allumés au moins pour qu'un point compte
MIN_SHARE = 0.2  # part de la fenêtre allumée au moins (un reflet ou une lettre mal lue allume 1 à 5 % d'une période)
OFFSET_WINDOW_S = 45.0  # secondes de chrono lues au début de la game
OFFSET_MIN_READS = 12  # lectures du chrono qui descendent au moins pour retenir l'écart
OFFSET_TOLERANCE_S = 1.0  # écart toléré autour de la médiane de (seconde + chrono)
OFFSET_MIN_AGREE = 0.7  # part des lectures qui s'accordent à la tolérance près
MIN_TAIL_RUN_S = 10.0  # plage du HUD d'au moins 10 s (le point change au plus toutes les 60 s) dans la partie « ouverte »
STEP_S = 1.0  # une image du HUD par seconde


# ---------------------------------------------------------------- fichier du calendrier

def parse_chrono(text):
    """« 11:25 » en secondes restantes (685)."""
    minutes, seconds = text.strip().split(":")
    return int(minutes) * 60 + int(seconds)


def has_no_change(map_name, path=SCHEDULE_FILE):
    """Vrai si l'entrée de la carte porte `"none": true` : la carte n'a aucun changement de point (Engine, Helios Station), donc ni calendrier ni rotation. Carte sans entrée : faux."""
    entry = json.loads(Path(path).read_text(encoding="utf-8")).get(map_name)
    return isinstance(entry, dict) and entry.get("none") is True


def load_calendar(map_name, path=SCHEDULE_FILE):
    """Calendrier d'une carte : {"changes": [(secondes restantes, source)] triés du plus grand au plus petit, "open_tail": bool} ou None si la carte n'a aucun changement connu."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    entry = data.get(map_name)
    if not isinstance(entry, dict) or not entry.get("changements"):
        return None
    changes = sorted(((parse_chrono(c["restant"]), c.get("source", "")) for c in entry["changements"]), reverse=True)
    return {"changes": changes, "open_tail": bool(entry.get("dernier_ouvert"))}


# ---------------------------------------------------------------- chrono : de la seconde de game au chrono

def chrono_offset(reads):
    """Écart `off` tel que seconde de game + chrono = off, d'après les lectures [(seconde de game, chrono restant ou None)] du début de game. None si moins de OFFSET_MIN_READS lectures
    ne s'accordent pas (chrono illisible ou figé). La valeur de départ du chrono (affichée plusieurs secondes d'affilée) est écartée."""
    vals = [(t, c) for t, c in reads if c is not None]
    if len(vals) < OFFSET_MIN_READS:
        return None
    top = max(c for _, c in vals)
    sums = [t + c for t, c in vals if c < top]
    if len(sums) < OFFSET_MIN_READS:
        return None
    off = median(sums)
    agree = sum(1 for s in sums if abs(s - off) <= OFFSET_TOLERANCE_S)
    return float(off) if agree >= OFFSET_MIN_AGREE * len(sums) else None


def read_chrono(conn, game, seconds=OFFSET_WINDOW_S):
    """Lectures du chrono [(seconde de game, chrono restant ou None)] sur les `seconds` premières secondes d'une game (une lecture ffmpeg courte, même cadence que le HUD). Vide si la vidéo est absente.
    `game` : ligne de point_owner._game."""
    import db
    import timer

    if not game["path"] or not os.path.exists(game["path"]):
        return []
    zone = db.zone_for(conn, game["map"], "timer")
    templates = timer.load_templates()
    t1 = min(game["end_s"], game["start_s"] + seconds)
    return [(t - game["start_s"], timer.read_timer(crop, templates))
            for t, crop in timer.iter_crops(game["path"], zone, game["width"], game["height"], step_s=STEP_S, t0=game["start_s"], t1=t1)]


def change_times(calendar, off, end_t):
    """Instants des changements en secondes de game : [(secondes restantes, T, source)] pour ceux qui laissent assez de secondes avant `end_t` pour être lus (T = off - restant, la seconde où le chrono
    affiche cette valeur ; une période qui commence moins de HUD_LAG_S + VOTE_MARGIN_S + MIN_VOTES secondes avant la fin n'est pas lue)."""
    room = HUD_LAG_S + VOTE_MARGIN_S + MIN_VOTES
    return [(r, round(off - r, 2), src) for r, src in calendar["changes"] if 0 <= off - r and off - r + room <= end_t]


# ---------------------------------------------------------------- vote d'une période

def lit_series(readings, letters):
    """{lettre: [allumé ou non à chaque seconde]} d'après les états lus par hud_points (lit > 0 : colorée ou lettre blanche)."""
    return {k: [s[k]["lit"] > 0 for s in readings] for k in letters}


def vote_period(lit, times, t0, t1, prev=None, lag=HUD_LAG_S, margin=VOTE_MARGIN_S):
    """Point actif de la période [t0, t1[ : {"point": lettre ou None, "votes": {lettre: échantillons allumés}, "window": nombre d'échantillons, "share": part de la fenêtre allumée par le point retenu}.
    Fenêtre : de t0 + lag + margin à t1 + lag - margin. `prev` : point retenu pour la période d'avant (écarté quand un autre point est allumé ; seul, il faut qu'il se soit éteint puis rallumé)."""
    lo, hi = t0 + lag + margin, t1 + lag - margin
    idx = [i for i, t in enumerate(times) if lo <= t < hi]
    n = len(idx)
    votes = {k: sum(1 for i in idx if v[i]) for k, v in lit.items()}
    cands = {k: v for k, v in votes.items() if v >= MIN_VOTES and v >= MIN_SHARE * n}
    if prev in cands and len(cands) > 1:
        cands.pop(prev)
    elif prev in cands:  # seul le point d'avant est allumé : encore le même, ou jamais éteint ?
        around = [i for i, t in enumerate(times) if t0 - 1 <= t <= t0 + lag + 2]
        if not around or all(lit[prev][i] for i in around):
            cands = {}
    if not cands:
        return {"point": None, "votes": votes, "window": n, "share": 0.0}
    best = max(cands, key=cands.get)
    return {"point": best, "votes": votes, "window": n, "share": round(cands[best] / n, 3) if n else 0.0}


def _tail_segments(best, times, t_from, end_t, lag=HUD_LAG_S):
    """Plages du HUD seul après le dernier instant connu : [{point, t0, t1}] (le point le plus lumineux de chaque seconde, `best` déjà lissé). Le début d'une plage est reculé de `lag`
    (le HUD s'allume après l'instant du changement) ; la première plage commence à `t_from` quand elle s'allume dans les 6 s qui suivent le changement attendu."""
    import point_owner as po

    out = []
    for a, b, v in po._runs(best):
        if v is None or (b - a) * STEP_S < MIN_TAIL_RUN_S or times[b - 1] + STEP_S <= t_from + lag:
            continue
        start = max(t_from, times[a] - lag)
        if not out and start - t_from <= 6.0:
            start = t_from
        out.append({"point": v, "t0": round(start, 2), "t1": round(min(times[b - 1] + STEP_S, end_t), 2)})
    for cur, nxt in zip(out, out[1:]):  # les plages se suivent sans trou ni recouvrement
        cur["t1"] = min(cur["t1"], nxt["t0"])
    return out


def active_from_calendar(calendar, off, hud):
    """Point actif de chaque période du calendrier d'après le HUD lu (`hud` : résultat de hud_points.analyse, avec « readings » et « best »).
    Renvoie {"segments": [{point, t0, t1, source « schedule »}], "periods": [{restant, t0, t1, point, votes, window, share}], "unread": [restant des périodes sans point lu], "tail": nombre de plages du HUD seul}."""
    times, letters = hud["times"], hud["letters"]
    end_t = round(times[-1] + STEP_S, 2)
    changes = change_times(calendar, off, end_t)
    lit = lit_series(hud["readings"], letters)
    periods, segments, prev = [], [], None
    tail_from = None
    complete = len(changes) == len(calendar["changes"])  # tous les instants connus tombent dans la game : la suite (« ouverte ») commence après le dernier
    for k, (r, t0, _src) in enumerate(changes):
        last = k == len(changes) - 1
        if last and calendar["open_tail"] and complete:
            tail_from = t0
            break
        t1 = changes[k + 1][1] if not last else end_t
        v = vote_period(lit, times, t0, t1, prev)
        periods.append(dict(v, restant=r, t0=t0, t1=t1))
        if v["point"]:
            segments.append({"point": v["point"], "t0": t0, "t1": t1, "source": "schedule"})
        prev = v["point"]
    tail = []
    if tail_from is not None:
        tail = [dict(s, source="schedule") for s in _tail_segments(hud["best"], times, tail_from, end_t)]
        segments += tail
    return {"segments": segments, "periods": periods, "unread": [p["restant"] for p in periods if not p["point"]], "tail": len(tail)}


def usable(map_name, hud, off):
    """Le calendrier de la carte s'applique : la carte a des changements connus, le HUD est en mode « un seul point lumineux » et le chrono est lu. Renvoie le calendrier ou None."""
    if hud is None or off is None or hud.get("mode") != "active_only" or "readings" not in hud:
        return None
    return load_calendar(map_name)
