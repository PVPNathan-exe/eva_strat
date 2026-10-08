"""Positions des joueurs d'une game : lecture de la minimap chaque seconde, puis attribution aux slots 1 à 8.

Le numéro sur la pastille donne le slot quand il est lisible. Sinon on rattache la pastille au joueur de la même équipe
dont la dernière position connue est la plus proche, puis, s'il ne reste qu'un candidat, par élimination. La confiance
du suivi baisse à chaque étape, pour signaler les croisements ambigus entre joueurs d'une même équipe.
"""

import math

import minimap
import timer

EVERY_FRAMES = 6  # une lecture de la minimap toutes les 6 images (5 par seconde à 30 i/s) : animation fluide
STEP_S = 0.2  # valeur de repli quand la cadence de la vidéo est inconnue
MAX_JUMP = 0.30  # déplacement maximal (normalisé) entre deux lectures pour rattacher une pastille à un joueur
CONF_READ, CONF_NEAR, CONF_ELIM = 1.0, 0.6, 0.4
SLOTS = {"A": (1, 2, 3, 4), "B": (5, 6, 7, 8)}
MIN_MARKERS_FOR_FRAME = 1


class Tracker:
    """Suit les joueurs d'une game d'une lecture à l'autre."""

    def __init__(self):
        self.last = {}  # slot -> (x, y)

    def assign(self, markers):
        """markers : pastilles d'une lecture (dicts de minimap.find_markers). Renvoie [(slot, marker, confiance)]."""
        out, taken = [], set()
        for team in ("A", "B"):
            mine = [m for m in markers if m["team"] == team]
            # 1. Numéro lu : identité sûre (un doublon dans la même lecture est écarté, c'est une erreur de lecture).
            by_slot = {}
            for m in mine:
                if m["slot"] and m["slot"] in SLOTS[team]:
                    by_slot.setdefault(m["slot"], []).append(m)
            rest = [m for m in mine if not (m["slot"] and m["slot"] in SLOTS[team] and len(by_slot[m["slot"]]) == 1)]
            for slot, ms in by_slot.items():
                if len(ms) == 1:
                    out.append((slot, ms[0], CONF_READ))
                    taken.add(slot)
            # 2. Sans numéro : le plus proche, parmi les joueurs de l'équipe pas encore attribués.
            free = [s for s in SLOTS[team] if s not in taken]
            pairs = []
            for i, m in enumerate(rest):
                for s in free:
                    if s in self.last:
                        d = math.hypot(m["x"] - self.last[s][0], m["y"] - self.last[s][1])
                        if d <= MAX_JUMP:
                            pairs.append((d, i, s))
            pairs.sort()
            used_m = set()
            for d, i, s in pairs:
                if i in used_m or s in taken:
                    continue
                used_m.add(i)
                taken.add(s)
                out.append((s, rest[i], CONF_NEAR))
            # 3. Élimination : une seule pastille et un seul joueur restants.
            left_m = [m for i, m in enumerate(rest) if i not in used_m]
            left_s = [s for s in SLOTS[team] if s not in taken]
            if len(left_m) == 1 and len(left_s) == 1:
                out.append((left_s[0], left_m[0], CONF_ELIM))
                taken.add(left_s[0])
        for slot, m, _ in out:
            if m["alive"]:
                self.last[slot] = (m["x"], m["y"])
        return out


def read_game(video, game, zone, width, height, emit=None, wait=None, step_s=STEP_S):
    """Échantillons d'une game : liste de lignes (frame, t, slot, team, x, y, angle, alive, confiance)."""
    templates = minimap.load_digit_templates()
    tracker = Tracker()
    rows = []
    start, end = game["start_s"], game["end_s"]
    for i, (t, crop) in enumerate(timer.iter_crops(video, zone, width, height, step_s=step_s, t0=start, t1=end)):
        if wait:
            wait()
        markers = minimap.find_markers(crop, templates)
        if len(markers) >= MIN_MARKERS_FOR_FRAME:
            for slot, m, conf in tracker.assign(markers):
                rows.append((i, round(t, 2), slot, m["team"], round(m["x"], 4), round(m["y"], 4), m["angle"], int(m["alive"]), conf))
        if emit:
            emit(min(100, 100 * (t - start) / max(end - start, 1)))
    return rows
