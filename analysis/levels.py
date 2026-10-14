"""Niveau des joueurs sur Atlantis et The Cliff (table `player_levels`) : `python analysis/levels.py --game N [--db chemin] [--dry-run] [--measure]`.

Ces deux cartes ont un étage : une plate-forme au-dessus du rez-de-chaussée (Atlantis : les deux salles sombres au bas de la carte, The Cliff : les deux coins du haut). Le niveau
(`dessous` = rez-de-chaussée, `etage`) ne se lit pas sur la minimap, mais un joueur qui passe SOUS la plate-forme y est dessiné grisé (pastille creuse ou ternie, que le suivi ne lit
pas et dont il devine alors la position), et un joueur sur la plate-forme est dessiné normalement. Constat vérifié sur la vidéo (Atlantis, game 31) : le 2 reste creux dans la salle
de 92 s à 100 s ; le 6 est creux dans la salle et plein dès qu'il longe son bord haut ; le 9 est plein dans la salle de 180 s à 200 s, après une tyrolienne à 179,5 s.

Règles (celles de l'utilisateur) :
- Niveau initial `dessous` (source `default`), à chaque apparition : la mort remet `dessous`. Les lignes couvrent les VIES (temps vivant), temps en secondes depuis le début de la game.
- Une tyrolienne dont l'arrivée est à l'étage donne `etage` (source `tp`) ; une tyrolienne vers le bas donne `dessous` (source `tp`).
- Un joueur à l'étage qui sort durablement de l'emprise de la plate-forme (ZONE_OUT_S) est `dessous` (source `zone`) : hors de l'emprise il n'y a que le rez-de-chaussée. Dans l'emprise le
  niveau précédent est gardé (les deux niveaux y existent). La source `grey` est réservée à une lecture directe des pastilles grisées, non branchée : voir `measure`.

Géométrie, constats sur les fichiers de cartes : `map_masks/<Carte>_dessous.png` n'est PAS un masque du rez-de-chaussée, c'est la couche « passage possible en dessous » (le sol que les
zones tracées gardent praticable) : elle dessine les salles sous la plate-forme (Atlantis 4 400 pixels sur 114 000, The Cliff 1 500 sur 74 000, grille de la médiane). L'emprise est cette
couche fermée (fermeture, trous bouchés) et élargie de ZONE_MARGIN. Extrémité à l'étage d'une paire de `map_teleports.json` : la plus proche de l'emprise. Mesuré : Atlantis 9 et 10 pixels
contre 62 et 65 (franc), The Cliff paire de droite 1,4 contre 13,8 (franc), paire de gauche 7,6 contre 10,7 (ambigu : on prend le symétrique de la paire de droite). Les 8 corrections
« etage » de la game 25 (The Cliff, 197 à 211 s) sont dans l'emprise, 10 s après la tyrolienne de 186,8 s qui arrive à l'extrémité haute. Les flèches triangulaires du plan d'Atlantis
(haut au départ, bas à l'arrivée) vont dans le même sens.

Lecture des tyroliennes dans `samples` : le suivi les dessine par un saut de position (une ou deux lignes à plus de FAST_STEP) entre deux stations d'une paire. Faux sauts écartés : confiance
d'une extrémité sous RIDE_MIN_CONF (les lignes à 0,3 sont des positions devinées : le 2 de la game 31 « traversait » à 95,7 s alors qu'il restait creux dans la salle) et aller-retour
de moins de BOUNCE_S (disque blanc d'un joueur mort qui attend, pastille qui saute d'une station à l'autre)."""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

REVISION = 1
MODULE = "levels"
HERE = Path(__file__).parent
MAPS = ("Atlantis", "The Cliff")  # cartes à deux niveaux (src/lib/twoLevelMaps.ts)
FAST_STEP = 0.04  # saut de position entre deux lignes (0,1 s) qui trahit une tyrolienne : un joueur à pied fait au plus 0,016
FAST_DT = 0.25  # les deux lignes du saut sont voisines (s)
RIDE_NEAR = 0.08  # le départ et l'arrivée du saut sont à moins de cela de leurs stations (fraction de la minimap)
RIDE_SPAN = 0.55  # le saut fait au moins cette part de l'écart entre les deux stations
RIDE_MIN_CONF = 0.4  # confiance minimale des deux lignes du saut (0,3 = position devinée)
BOUNCE_S = 3.0  # deux sauts en sens contraire sur la même paire à moins de cela s'annulent
ZONE_MARGIN = 0.03  # marge autour de la couche « dessous » (fraction de la largeur) : la station et son couloir sont sur la plate-forme
ZONE_OUT_S = 0.5  # durée hors de l'emprise pour conclure que le joueur est descendu
ZONE_MIN_CONF = 0.4  # lignes prises en compte pour sortir de l'emprise (pas les positions devinées)
CLOSE_PX = 9  # fermeture de la couche « dessous » (pixels de la grille de la médiane)
AMBIGUOUS = 0.6  # rapport des deux distances à l'emprise au-delà duquel une paire est ambiguë
MIRROR_TOL = 0.05  # distance maximale entre une station et le symétrique (gauche, droite) de l'extrémité haute de l'autre paire
DEEP_PX = 4  # profondeur dans l'emprise d'une ligne « au cœur » de la plate-forme (mesure)


class Geometry:
    """Paires de stations, emprise de la plate-forme et extrémité haute de chaque paire d'une carte. `core` : tableau booléen (grille de la médiane)."""

    def __init__(self, pairs, core):
        self.pairs = [(tuple(a), tuple(b)) for a, b in pairs]
        self.core = core
        self.h, self.w = core.shape
        self.out = cv2.distanceTransform((~core).astype(np.uint8), cv2.DIST_L2, 3)  # distance à l'emprise (0 dedans)
        self.inside = cv2.distanceTransform(core.astype(np.uint8), cv2.DIST_L2, 3)  # profondeur dans l'emprise
        self.upper = self._upper_ends()

    def _ij(self, p):
        return min(self.h - 1, max(0, round(p[1] * (self.h - 1)))), min(self.w - 1, max(0, round(p[0] * (self.w - 1))))

    def dist(self, p):
        """Distance de p à l'emprise, en fraction de la largeur de la minimap (0 dans l'emprise)."""
        return float(self.out[self._ij(p)]) / self.w

    def deep(self, p):
        return float(self.inside[self._ij(p)]) >= DEEP_PX

    def _upper_ends(self):
        """Pour chaque paire, l'indice (0 ou 1) de l'extrémité à l'étage : la plus proche de l'emprise ; une paire ambiguë prend l'extrémité proche du symétrique de celle d'une paire franche."""
        ends, sure = [], []
        for pair in self.pairs:
            d = [self.dist(p) for p in pair]
            k = 0 if d[0] <= d[1] else 1
            ok = max(d) > 0 and min(d) / max(d) < AMBIGUOUS
            ends.append(k)
            sure.append(ok)
        for i, ok in enumerate(sure):
            if ok:
                continue
            for j, good in enumerate(sure):
                if not good:
                    continue
                u = self.pairs[j][ends[j]]
                mirror = (1.0 - u[0], u[1])
                near = [math_dist(p, mirror) for p in self.pairs[i]]
                if min(near) <= MIRROR_TOL:
                    ends[i] = near.index(min(near))
                    break
            else:
                ends[i] = None  # ni franche ni symétrique d'une franche : les sauts de cette paire sont ignorés
        return ends


def math_dist(p, q):
    return float(np.hypot(p[0] - q[0], p[1] - q[1]))


def footprint(layer):
    """Emprise de la plate-forme : la couche « dessous » fermée, trous bouchés (booléen)."""
    layer = (layer > 0).astype(np.uint8)
    closed = cv2.morphologyEx(layer, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (CLOSE_PX, CLOSE_PX)))
    _n, labels = cv2.connectedComponents(1 - closed)
    return labels != labels[0, 0]


def load_geometry(map_name):
    """Géométrie d'une carte à deux niveaux d'après analysis/map_teleports.json et map_masks/<Carte>_dessous.png, ou None si un des deux manque."""
    tp, under = HERE / "map_teleports.json", HERE / "map_masks" / f"{map_name}_dessous.png"
    pairs = json.loads(tp.read_text(encoding="utf-8")).get(map_name) if tp.exists() else None
    layer = cv2.imread(str(under), cv2.IMREAD_GRAYSCALE) if under.exists() else None
    return Geometry(pairs, footprint(layer)) if pairs and layer is not None and layer.any() else None


def detect_rides(rows, geom):
    """Tyroliennes d'un joueur. rows : lignes vivantes [(t, x, y, conf)] triées. Renvoie [{"t": instant d'arrivée, "pair": i, "to": 'etage' ou 'dessous'}], sauts aller-retour retirés."""
    rides, i = [], 0
    while i < len(rows) - 1:
        if _step(rows, i) is None:
            i += 1
            continue
        j = i
        while j + 1 < len(rows) - 1 and _step(rows, j + 1) is not None:
            j += 1
        ride = _as_ride(rows[i], rows[j + 1], geom)
        if ride:
            rides.append(ride)
        i = j + 1
    return _drop_bounces(rides)


def _step(rows, i):
    """Longueur du pas de la ligne i à la suivante s'il est un saut (FAST_STEP, lignes voisines), sinon None."""
    (t0, x0, y0, _c0), (t1, x1, y1, _c1) = rows[i], rows[i + 1]
    d = math_dist((x0, y0), (x1, y1))
    return d if d >= FAST_STEP and t1 - t0 <= FAST_DT else None


def _as_ride(a, b, geom):
    """Le saut de la ligne a à la ligne b (t, x, y, conf) comme tyrolienne d'une paire, ou None."""
    if min(a[3] or 0, b[3] or 0) < RIDE_MIN_CONF:
        return None
    best = None
    for i, (p, q) in enumerate(geom.pairs):
        if geom.upper[i] is None or math_dist(p, q) * RIDE_SPAN > math_dist(a[1:3], b[1:3]):
            continue
        for k, (entry, exit_) in enumerate(((p, q), (q, p))):
            d0, d1 = math_dist(a[1:3], entry), math_dist(b[1:3], exit_)
            if d0 <= RIDE_NEAR and d1 <= RIDE_NEAR and (best is None or d0 + d1 < best[0]):
                best = (d0 + d1, i, 1 - k)  # 1 - k : indice de l'extrémité d'arrivée
    if best is None:
        return None
    _d, pair, arrival = best
    return {"t": b[0], "pair": pair, "to": "etage" if arrival == geom.upper[pair] else "dessous"}


def _drop_bounces(rides):
    """Retire les couples de sauts en sens contraire sur la même paire à moins de BOUNCE_S l'un de l'autre (le suivant du couple compris)."""
    dead = set()
    for k in range(len(rides) - 1):
        a, b = rides[k], rides[k + 1]
        if a["pair"] == b["pair"] and a["to"] != b["to"] and b["t"] - a["t"] <= BOUNCE_S:
            dead.update((k, k + 1))
    return [r for k, r in enumerate(rides) if k not in dead]


def level_segments(t0, t1, rows, rides, geom):
    """Segments de niveau d'une vie [t0, t1] : [(t0, t1, niveau, source)] contigus. rows : lignes vivantes [(t, x, y, conf)] de la vie, rides : tyroliennes du joueur."""
    segs, level, source, start = [], "dessous", "default", t0
    outside = None  # début de la sortie en cours de l'emprise

    def switch(t, new, src):
        nonlocal level, source, start, outside
        outside = None
        if new == level:
            return
        if t <= start:  # changement dès la première ligne : le segment courant change de niveau
            level, source = new, src
            return
        segs.append((start, t, level, source))
        level, source, start = new, src, t

    pending = sorted((r for r in rides if t0 <= r["t"] <= t1), key=lambda r: r["t"])
    for t, x, y, conf in rows:
        while pending and pending[0]["t"] <= t:
            switch(pending[0]["t"], pending.pop(0)["to"], "tp")
        if level != "etage" or (conf or 0) < ZONE_MIN_CONF:
            continue
        if geom.dist((x, y)) <= ZONE_MARGIN:
            outside = None
        else:
            outside = t if outside is None else outside
            if t - outside >= ZONE_OUT_S:
                switch(outside, "dessous", "zone")
    for r in pending:
        switch(r["t"], r["to"], "tp")
    segs.append((start, t1, level, source))
    return segs


def read_game(conn, game_id):
    """(géométrie, vies par joueur {slot: [vie]}, lignes {slot: [(t, alive, x, y, conf)]}, début de la game) ; géométrie None hors des deux cartes ou sans fichiers. Temps depuis le début de la game."""
    import lives

    row = conn.execute("SELECT map, start_s FROM games WHERE id = ?", (game_id,)).fetchone()
    if row is None or row[0] not in MAPS:
        return None, {}, {}, 0.0
    start, duration, rows4, kills = lives.read_rows(conn, game_id)
    by_slot = {}
    for t, slot, alive, x, y, conf in conn.execute("SELECT t, slot, alive, x, y, confidence FROM samples WHERE game_id = ? ORDER BY slot, t", (game_id,)):
        by_slot.setdefault(slot, []).append((round(t - start, 3), 1 if alive else 0, x, y, conf))
    return load_geometry(row[0]), lives.build(rows4, kills, duration)[0], by_slot, start


def build(geom, lives_by_slot, rows):
    """({slot: [[segments de chaque vie]]}, {slot: tyroliennes}) pour toute la game."""
    out, rides = {}, {}
    for slot, items in lives_by_slot.items():
        alive = [(t, x, y, c) for t, a, x, y, c in rows.get(slot, []) if a and x is not None]
        rides[slot] = detect_rides(alive, geom) if geom else []
        out[slot] = []
        for v in items:
            mine = [r for r in alive if v["t0"] <= r[0] <= v["t1"]]
            out[slot].append(level_segments(v["t0"], v["t1"], mine, rides[slot], geom) if geom else [(v["t0"], v["t1"], "dessous", "default")])
    return out, rides


def compute(conn, game_id):
    """Efface puis réécrit les niveaux de la game ; renvoie le nombre de lignes (0 hors Atlantis et The Cliff). Écrit aussi stats_meta."""
    geom, lives_by_slot, rows, _start = read_game(conn, game_id)
    segs, _rides = build(geom, lives_by_slot, rows)
    conn.execute("DELETE FROM player_levels WHERE game_id = ?", (game_id,))
    n = 0
    for slot, lives_ in segs.items():
        for life in lives_:
            for t0, t1, level, source in life:
                conn.execute("INSERT OR REPLACE INTO player_levels (game_id, slot, t0, t1, level, source) VALUES (?, ?, ?, ?, ?, ?)", (game_id, slot, t0, t1, level, source))
                n += 1
    conn.execute("INSERT OR REPLACE INTO stats_meta (game_id, module, revision) VALUES (?, ?, ?)", (game_id, MODULE, REVISION))
    conn.commit()
    return n


def level_at(segs, t):
    """Niveau à l'instant t (secondes depuis le début de la game) d'après les segments d'un joueur [[(t0, t1, niveau, source)]], ou None hors vie."""
    found = None
    for life in segs:
        for t0, t1, level, _src in life:
            if t0 <= t < t1 or (t == t1 and found is None):  # intervalle ouvert à droite : à la frontière de deux segments, le suivant l'emporte
                found = level
    return found


def measure(conn, game_id):
    """Chiffres de contrôle d'une game : temps vivant par niveau, changements par joueur, tyroliennes, accord avec les corrections à la main, lecture au cœur de la plate-forme par niveau."""
    geom, lives_by_slot, rows, start = read_game(conn, game_id)
    if not lives_by_slot:
        return {"game": game_id, "note": "pas de positions ou carte à un seul niveau"}
    segs, rides = build(geom, lives_by_slot, rows)
    time_by = {"etage": 0.0, "dessous": 0.0}
    for lives_ in segs.values():
        for life in lives_:
            for t0, t1, level, _s in life:
                time_by[level] += t1 - t0
    total = sum(time_by.values()) or 1.0
    changes = {s: sum(len(life) - 1 for life in lives_) for s, lives_ in segs.items()}
    out = {
        "game": game_id, "geometrie": geom is not None, "extremites_hautes": geom.upper if geom else None,
        "part_etage": round(time_by["etage"] / total, 4), "secondes_vivant": round(total, 1),
        "changements_par_joueur": changes, "tyroliennes": {s: [(round(r["t"], 1), r["to"]) for r in rs] for s, rs in rides.items() if rs},
        "sources": _count(c[3] for lives_ in segs.values() for life in lives_ for c in life),
    }
    out["corrections"] = _marks_agreement(conn, game_id, start, segs)
    if geom:
        out["lecture_sure_au_coeur"] = _core_reads(geom, rows, segs)
    return out


def _count(items):
    out = {}
    for it in items:
        out[it] = out.get(it, 0) + 1
    return out


def _marks_agreement(conn, game_id, start, segs):
    """Accord avec user_marks.level. Seules les valeurs `etage` posées à la main sont fiables ; `dessous` est le défaut (et la valeur donnée à la reprise des anciennes corrections)."""
    out = {"etage": [0, 0], "dessous": [0, 0]}  # [d'accord, total]
    for slot, t, level in conn.execute("SELECT slot, t, level FROM user_marks WHERE game_id = ? AND level IS NOT NULL", (game_id,)):
        mine = level_at(segs.get(slot, []), t - start)
        if mine is None:
            continue
        out[level][1] += 1
        out[level][0] += mine == level
    return out


def _core_reads(geom, rows, segs):
    """Indice sans vidéo, indépendant des tyroliennes : au cœur de la plate-forme (au moins DEEP_PX pixels dedans) le suivi lit surtout les pastilles pleines (à l'étage) et devine les
    pastilles creuses (en dessous). Part des lignes à confiance d'au moins 0,7, par niveau déduit : {niveau: [lignes sûres, lignes]}."""
    out = {"etage": [0, 0], "dessous": [0, 0]}
    for slot, items in rows.items():
        for t, alive, x, y, conf in items:
            if not alive or x is None or not geom.deep((x, y)):
                continue
            level = level_at(segs.get(slot, []), t)
            if level:
                out[level][1] += 1
                out[level][0] += (conf or 0) >= 0.7
    return out


def grey_check(conn, game_id, step=1.0):
    """Contrôle à la vraie minimap (lit la vidéo : quelques dizaines d'images, une game à la fois) : une ligne par joueur et par pas au cœur de la plate-forme ; la pastille autour de la
    position est `pleine` (couleur de l'équipe), `blanche` (joueur observé) ou `autre` (creuse ou absente : grisée). Renvoie {niveau déduit: {classe: nombre}}. Un joueur voisin peut fournir la
    pastille pleine : indice, pas preuve."""
    import names

    geom, lives_by_slot, rows, start = read_game(conn, game_id)
    if geom is None:
        return {}
    segs, _rides = build(geom, lives_by_slot, rows)
    row = conn.execute("SELECT g.map, v.path, v.width, v.height FROM games g JOIN videos v ON v.id = g.video_id WHERE g.id = ?", (game_id,)).fetchone()
    zone = json.loads((HERE / "map_zones.json").read_text(encoding="utf-8"))[row[0]]["minimap"]
    wanted = {}
    for slot, items in rows.items():
        for t, alive, x, y, _c in items:
            if alive and x is not None and geom.deep((x, y)):
                wanted.setdefault((round(t / step), slot), (t, x, y))
    out = {"etage": {}, "dessous": {}}
    for k in sorted({k for k, _s in wanted}):
        picks = [(s, v) for (kk, s), v in wanted.items() if kk == k]
        im = names._grab(row[1], start + picks[0][1][0], zone, row[2], row[3])
        if im is None:
            continue
        hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV).astype(int)
        h, w = hsv.shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        for slot, (t, x, y) in picks:
            best = {"pleine": 0.0, "blanche": 0.0}
            for dy in range(-7, 8, 2):
                for dx in range(-7, 8, 2):
                    m = (xx - (x * (w - 1) + dx)) ** 2 + (yy - (y * (h - 1) + dy)) ** 2 <= 5.5 ** 2
                    hh, ss, vv = hsv[..., 0][m], hsv[..., 1][m], hsv[..., 2][m]
                    team = ((hh >= 3) & (hh <= 25) & (ss >= 130) & (vv >= 120)) if slot <= 4 else ((hh >= 95) & (hh <= 125) & (ss >= 110) & (vv >= 110))
                    best["pleine"] = max(best["pleine"], float(team.mean()))
                    best["blanche"] = max(best["blanche"], float(((ss <= 60) & (vv >= 200)).mean()))
            cls = "pleine" if best["pleine"] >= 0.55 else ("blanche" if best["blanche"] >= 0.55 else "autre")
            level = level_at(segs.get(slot, []), t) or "dessous"
            out[level][cls] = out[level].get(cls, 0) + 1
    return out


def main(argv=None):
    import db
    import paths

    parser = argparse.ArgumentParser(description="Calcule le niveau des joueurs d'une game (Atlantis, The Cliff).")
    parser.add_argument("--game", type=int, required=True)
    parser.add_argument("--db", default=str(paths.db_path()))
    parser.add_argument("--dry-run", action="store_true", help="Calcule et affiche les segments sans rien écrire")
    parser.add_argument("--measure", action="store_true", help="Affiche les chiffres de contrôle sans rien écrire")
    parser.add_argument("--grey", action="store_true", help="Contrôle à la vraie minimap (lit la vidéo) : pastilles pleines ou creuses au cœur de la plate-forme")
    args = parser.parse_args(argv)
    conn = db.connect(args.db)
    if args.grey:
        print(json.dumps(grey_check(conn, args.game), ensure_ascii=False))
    elif args.measure:
        print(json.dumps(measure(conn, args.game), ensure_ascii=False))
    elif args.dry_run:
        geom, lives_by_slot, rows, _start = read_game(conn, args.game)
        segs, _rides = build(geom, lives_by_slot, rows)
        print(json.dumps({str(s): [[(round(a, 1), round(b, 1), lv, src) for a, b, lv, src in life] for life in lives_] for s, lives_ in segs.items()}, ensure_ascii=False))
    else:
        print(json.dumps({MODULE: compute(conn, args.game)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.exit(main())
