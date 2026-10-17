"""Régénération (regen.py) : fonctions pures sur des séries de points de vie synthétiques (une valeur toutes les 0,1 s), plus la lecture d'un cache de bandeaux minimal."""

import json

import regen

STEP = 0.1


def serie(points, n=400):
    """Série hp de n images : interpolation linéaire entre des repères [(t, hp)], constante avant et après ; None si le repère vaut None (joueur mort)."""
    times = [round(i * STEP, 3) for i in range(n)]

    def value(t):
        if t <= points[0][0]:
            return points[0][1]
        for (t0, v0), (t1, v1) in zip(points, points[1:]):
            if t <= t1:
                if v0 is None or v1 is None:
                    return None
                return v0 + (v1 - v0) * (t - t0) / (t1 - t0)
        return points[-1][1]

    return times, [value(t) for t in times]


def test_perte_remontee_delai_et_vitesse():
    times, hp = serie([(10.0, 1.0), (10.5, 0.4), (15.0, 0.4), (16.5, 1.0)])  # perte de 60 points en 0,5 s, palier 4,5 s, remontée de 0,4 par seconde
    eps, cens = regen.measure_series(times, hp)
    assert cens == {} and len(eps) == 1
    e = eps[0]
    assert abs(e["delay"] - 4.5) < 0.3 and abs(e["speed"] - 0.4) < 0.03 and abs(e["plateau"] - 0.4) < 0.02 and abs(e["top"] - 1.0) < 0.02


def test_une_mort_ou_une_nouvelle_perte_avant_la_remontee_censure_l_episode():
    times, hp = serie([(10.0, 1.0), (10.5, 0.4), (12.0, 0.4), (12.1, None)])  # mort : valeurs illisibles ensuite
    assert regen.measure_series(times, hp) == ([], {"trou": 1})
    times, hp = serie([(10.0, 1.0), (10.5, 0.6), (13.0, 0.6), (13.4, 0.2), (20.0, 0.2)])  # deuxième perte à 3 s : l'épisode (espacé de plus de 2 s) est censuré, le suivant n'a pas de remontée
    eps, cens = regen.measure_series(times, hp)
    assert eps == [] and cens["nouvelle_perte"] == 1 and cens["aucune"] == 1


def test_petite_remontee_donne_un_delai_sans_vitesse():
    times, hp = serie([(10.0, 1.0), (10.5, 0.9), (15.0, 0.9), (16.0, 0.97)])
    eps, _cens = regen.measure_series(times, hp)
    assert len(eps) == 1 and eps[0]["speed"] is None and abs(eps[0]["delay"] - 4.5) < 0.3


def test_pertes_proches_forment_un_seul_episode():
    times, hp = serie([(10.0, 1.0), (10.3, 0.7), (11.5, 0.7), (11.8, 0.4), (16.3, 0.4), (17.5, 1.0)])
    eps, _cens = regen.measure_series(times, hp)
    assert len(eps) == 1 and abs(eps[0]["t_loss"] - 11.8) < 0.5 and abs(eps[0]["delay"] - 4.5) < 0.4


def test_hit_indices_et_group_hits():
    hp = [1.0, 1.0, 0.8, 0.6, 0.6, 0.6, 0.6, 0.6, 0.6, 0.3]
    hits = regen.hit_indices(hp, 4, 0.07)
    assert hits[0] == 2 and 9 in hits and regen.group_hits([2, 3, 4, 9, 20], 2) == [[2, 3, 4], [9], [20]]


def test_regen_start_motifs():
    hp = [0.4] * 5 + [0.41, 0.42] + [0.6, 0.9]
    assert regen.regen_start(hp, 0, len(hp)) == (5, "ok")  # fin de la zone plate : dernier point à moins de 1,5 point du palier (0,41), la remontée est constatée à 0,6
    assert regen.regen_start([0.4] * 5, 0, 5) == (None, "aucune")
    assert regen.regen_start([0.4, None, 0.4], 0, 3) == (None, "trou")


def test_quartiles():
    assert regen.quartiles([]) == {"n": 0, "median": None, "q1": None, "q3": None}
    q = regen.quartiles([1, 2, 3, 4, 5])
    assert (q["n"], q["median"], q["q1"], q["q3"]) == (5, 3, 2, 4)


def test_constante_de_delai_alimentee_par_la_mesure():
    assert regen.REGEN_DELAY_FALLBACK is False and 3.0 < regen.REGEN_DELAY_S < 6.0 and regen.REGEN_SPEED is not None


def test_mesure_sur_un_cache_de_bandeaux(tmp_path):
    n = 300
    frames = [[i, 100.0 + i * STEP, []] for i in range(n)]
    fill = lambda i: 0.83 if i < 100 else (0.33 if i < 150 else 0.33 + (i - 150) * 0.033)  # perte de 60 % à 10 s, palier de 5 s, remontée
    states = {str(i): {"1": {"alive": True, "spectated": False, "fill": min(0.83, fill(i))}} for i in range(n)}
    path = tmp_path / "eval_1.json"
    path.write_text(json.dumps({"frames": frames, "states": states}), encoding="utf-8")
    eps, _cens = regen.measure_cache(path)
    assert len(eps) == 1 and eps[0]["slot"] == 1 and abs(eps[0]["delay"] - 5.0) < 0.5
    out = regen.measure_all(tmp_path)
    assert out["episodes_mesures"] == 1 and out["delai_s"]["n"] == 1
