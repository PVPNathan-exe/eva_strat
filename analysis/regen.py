"""Régénération des points de vie (module `regen`, fonctions pures + mesure : `python analysis/regen.py [--cache dossier] [--games 16,22,...]`, aucune écriture, aucune lecture de vidéo).

Règle de l'utilisateur du 17 octobre 2026 : un duel dure de la première perte de points de vie du couple jusqu'à la mort de l'un des deux OU jusqu'au début de la RÉGÉNÉRATION. Ce module mesure, dans le cache des bandeaux
(`data/cache/eval_<game>.json`, une valeur de `fill` par image, hp = fill / HP_FULL_FILL plafonné à 1, voir duels.py), deux grandeurs :
- le DÉLAI : temps entre la dernière perte d'un épisode de dégâts et le début de la remontée (`REGEN_DELAY_S` : la constante vient de la médiane mesurée ici) ;
- la VITESSE de remontée en points de vie par seconde (fraction du maximum par seconde : 0,4 = 40 % de la vie par seconde ; la vie maximale en points du jeu n'est pas lue, la vitesse est donc relative).
Les fonctions travaillent sur deux listes de même longueur : `times` (secondes) et `hp` (0 à 1, None quand le joueur n'est pas vivant ou illisible). Un épisode n'est mesuré que s'il est COMPLET : pas de mort, pas de nouvelle perte
et pas de trou de lecture entre la dernière perte et le début de la remontée (sinon il est compté dans `censures`, jamais dans la médiane).
Schéma d'un épisode mesuré : {t_loss, plateau, t_start, delay, speed (None si la remontée ne dépasse pas MIN_GAIN), top}."""

import argparse
import json
import statistics
import sys
from pathlib import Path

HIT_DROP = 0.07  # baisse de points de vie (fraction du maximum) en HIT_WINDOW_S qui compte comme une perte (tracking.HP_DROP : 0,06 de remplissage)
HIT_WINDOW_S = 0.4
HIT_GAP_S = 2.0  # deux pertes espacées de moins de 2 s sont un même épisode de dégâts
REGEN_RISE = 0.05  # la remontée est constatée quand les points de vie dépassent le palier de 5 points sur 100
PLATEAU_TOL = 0.015  # tant que la valeur est à 1,5 point du palier, la remontée n'a pas commencé (quantification du bandeau : environ 1 point)
REGEN_MAX_DELAY_S = 15.0  # début de remontée cherché 15 s au plus après la dernière perte (au-delà : censuré)
MIN_GAIN = 0.20  # une vitesse n'est mesurée que si la remontée gagne au moins 20 points (sinon trop imprécis à 0,1 s d'image)
RISE_WINDOW_S = 8.0  # la remontée est suivie 8 s au plus
TOP_TOL = 0.02  # la remontée finit à la première valeur à 2 points du sommet atteint

# Délai entre la dernière image comptée comme perte et le début de la remontée, MESURÉ par `python analysis/regen.py` le 17 octobre 2026 : médiane 4,6 s (quartiles 3,4 et 4,6 ; 284 épisodes sur 404 entre 4,5 et 5,0 s,
# 294 épisodes à 4 s ou plus : quartiles 4,6 et 4,6) sur les 19 fichiers de cache de bandeaux (404 remontées complètes d'au moins 20 points, 607 épisodes de dégâts complets au total, 8 joueurs par cache).
# `REGEN_DELAY_FALLBACK` vrai : valeur de REPLI posée à la main faute de mesure, à remplacer. Vitesse : médiane 0,40 de la vie maximale par seconde (quartiles 0,34 et 0,43).
REGEN_DELAY_S = 4.6
REGEN_DELAY_FALLBACK = False
REGEN_SPEED = 0.40  # fraction du maximum par seconde (None : non mesurée)


# ---------------------------------------------------------------- pertes

def hit_indices(hp, w, drop=HIT_DROP):
    """Indices des images où les points de vie ont baissé d'au moins `drop` par rapport au maximum des `w` images précédentes (une perte)."""
    out = []
    for i, v in enumerate(hp):
        before = [x for x in hp[max(0, i - w):i + 1] if x is not None]
        if v is not None and before and max(before) - v >= drop:
            out.append(i)
    return out


def group_hits(indices, gap):
    """Regroupe les indices de pertes espacés de `gap` images au plus : liste de listes (un épisode de dégâts chacune)."""
    groups = []
    for i in indices:
        if groups and i - groups[-1][-1] <= gap:
            groups[-1].append(i)
        else:
            groups.append([i])
    return groups


# ---------------------------------------------------------------- régénération

def regen_start(hp, i_last, i_limit):
    """Début de remontée après la dernière perte à l'indice `i_last` : (indice du dernier point du palier, motif).
    Motif : "ok" (indice trouvé), "perte" (une nouvelle perte arrive à `i_limit` avant la remontée), "trou" (valeur illisible : mort ou fin de lecture), "aucune" (pas de remontée avant `i_limit` ou la fin des données).
    Le palier est le minimum atteint depuis la dernière perte ; la remontée commence à la fin de la zone plate (valeurs à PLATEAU_TOL du palier) qui précède la première valeur à REGEN_RISE au-dessus."""
    if hp[i_last] is None:
        return None, "trou"
    plateau = hp[i_last]
    last_flat = i_last
    for j in range(i_last + 1, min(i_limit, len(hp))):
        v = hp[j]
        if v is None:
            return None, "trou"
        plateau = min(plateau, v)
        if v >= plateau + REGEN_RISE:
            return last_flat, "ok"
        if v <= plateau + PLATEAU_TOL:
            last_flat = j
    return None, "aucune"


def rise_speed(times, hp, i_start, i_limit):
    """(vitesse, sommet) de la remontée qui commence à l'indice i_start : pente moyenne entre le palier et la première valeur à TOP_TOL du sommet (sommet cherché sur RISE_WINDOW_S, jusqu'à `i_limit`).
    Vitesse None si la remontée gagne moins de MIN_GAIN."""
    end = i_start
    while end + 1 < min(i_limit, len(hp)) and times[end + 1] - times[i_start] <= RISE_WINDOW_S and hp[end + 1] is not None:
        end += 1
    seg = hp[i_start:end + 1]
    top = max(seg)
    if top - hp[i_start] < MIN_GAIN:
        return None, round(top, 2)
    i_top = next(i for i in range(i_start, end + 1) if hp[i] >= top - TOP_TOL)
    return (hp[i_top] - hp[i_start]) / (times[i_top] - times[i_start]), round(top, 2)


def measure_series(times, hp, step=None):
    """(épisodes complets mesurés, censurés par motif) sur la série d'un joueur. Un épisode de dégâts finit à sa dernière perte ; mort ou trou de lecture avant la remontée, nouvelle perte avant la remontée : censuré."""
    step = step or ((times[-1] - times[0]) / max(len(times) - 1, 1) if times else 0.1)
    groups = group_hits(hit_indices(hp, max(1, round(HIT_WINDOW_S / step))), round(HIT_GAP_S / step))
    out, cens = [], {}
    for n, g in enumerate(groups):
        i_last = g[-1]
        nxt = groups[n + 1][0] if n + 1 < len(groups) else len(hp)
        limit = min(nxt, i_last + 1 + round(REGEN_MAX_DELAY_S / step))
        i_flat, why = regen_start(hp, i_last, limit)
        if why != "ok":
            key = "nouvelle_perte" if why == "aucune" and limit == nxt and nxt < len(hp) else why
            cens[key] = cens.get(key, 0) + 1
            continue
        speed, top = rise_speed(times, hp, i_flat, nxt)
        out.append({"t_loss": times[i_last], "plateau": round(min(x for x in hp[i_last:i_flat + 1] if x is not None), 2), "t_start": times[i_flat],
                    "delay": round(times[i_flat] - times[i_last], 2), "speed": None if speed is None else round(speed, 3), "top": top})
    return out, cens


def quartiles(values):
    """{n, median, q1, q3} (None si vide) d'une liste de nombres."""
    v = sorted(values)
    if not v:
        return {"n": 0, "median": None, "q1": None, "q3": None}
    q = statistics.quantiles(v, n=4, method="inclusive") if len(v) >= 2 else [v[0]] * 3
    return {"n": len(v), "median": round(statistics.median(v), 3), "q1": round(q[0], 3), "q3": round(q[2], 3)}


# ---------------------------------------------------------------- mesure sur le cache

def series_from_cache(path, hp_full=0.83):
    """{slot: (times, hp)} depuis un cache de bandeaux (eval_<id>.json) : hp = fill / hp_full plafonné à 1, None si le bandeau n'est pas vivant.
    Ne lit que le cache (pas la base) : un mort est une image « alive faux » du bandeau. Médiane sur 3 images comme duels.load_hp."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    frames = sorted(raw["frames"], key=lambda f: f[0])
    times = [f[1] for f in frames]
    out = {}
    for slot in range(1, 9):
        h = []
        for f in frames:
            st = raw["states"].get(str(f[0]), {}).get(str(slot))
            h.append(min(1.0, st["fill"] / hp_full) if st and st.get("alive") and st.get("fill") is not None else None)
        med = list(h)
        for i in range(1, len(h) - 1):
            trio = h[i - 1:i + 2]
            if None not in trio:
                med[i] = sorted(trio)[1]
        out[slot] = (times, med)
    return out


def measure_cache(path):
    """Épisodes complets mesurés (tous joueurs) et censurés d'un cache."""
    eps, cens = [], {}
    for slot, (times, hp) in series_from_cache(path).items():
        got, c = measure_series(times, hp)
        eps += [{**e, "slot": slot} for e in got]
        for k, n in c.items():
            cens[k] = cens.get(k, 0) + n
    return eps, cens


def measure_all(cache_dir, games=None):
    """Résumé sur les caches du dossier : délai, vitesse, nombre d'épisodes mesurés et censurés, et le détail par cache."""
    per, all_eps, all_cens = {}, [], {}
    for p in sorted(Path(cache_dir).glob("eval_*.json"), key=lambda q: q.name):
        gid = p.stem.split("_", 1)[1]
        if games and gid not in games:
            continue
        eps, cens = measure_cache(p)
        per[gid] = {"delai": quartiles([e["delay"] for e in eps]), "episodes": len(eps), "censures": cens}
        all_eps += eps
        for k, n in cens.items():
            all_cens[k] = all_cens.get(k, 0) + n
    full = [e for e in all_eps if e["speed"] is not None]  # remontées d'au moins MIN_GAIN : seules vraies remontées (les autres sont du bruit de quantification près de zéro)
    return {"delai_s": quartiles([e["delay"] for e in full]), "delai_tous_episodes_s": quartiles([e["delay"] for e in all_eps]), "vitesse_par_s": quartiles([e["speed"] for e in all_eps if e["speed"] is not None]),
            "plateau": quartiles([e["plateau"] for e in all_eps]), "episodes_mesures": len(all_eps), "remontees_completes": len(full), "censures": all_cens, "par_cache": per}


def main(argv=None):
    import paths

    parser = argparse.ArgumentParser(description="Mesure le délai et la vitesse de régénération dans les caches des bandeaux.")
    parser.add_argument("--cache", default=str(paths.cache_dir()))
    parser.add_argument("--games", default="", help="identifiants de cache séparés par des virgules (par défaut tous)")
    args = parser.parse_args(argv)
    games = [g for g in args.games.split(",") if g]
    print(json.dumps(measure_all(args.cache, games), ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
