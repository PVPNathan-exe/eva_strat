"""Contamination de couleur de la minimap : les effets lumineux du jeu (stries jaunes et oranges au début d'une game, reflets) ressemblent à des joueurs.

À chaque lecture, une carte grossière des pixels de la couleur de chaque équipe est gardée (minimap.coarse_colour_map). Les cases qui sont toujours de
cette couleur (zones de départ, plan) forment le fond : la médiane de la game. Ce qui dépasse le fond et n'est pas expliqué par une pastille trouvée
est de la « couleur sans joueur » : mesurée en équivalents de pastille. Une image où il y en a beaucoup est contaminée : le suivi n'y crée pas de nouvelle
trajectoire et n'y récupère aucune pastille sans numéro."""

import numpy as np

MARKER_CELLS = 4.0  # cases de la grille grossière couvertes par une pastille (environ 200 pixels pour des cases de 50 pixels)
EXPLAINED_RADIUS = 2  # cases autour d'une pastille trouvée dont la couleur est expliquée (pastille et sa pointe)


def frame_noise(coarse, frames):
    """coarse : tableau (images, hauteur, largeur, 2) uint8 (orange, bleu) ; frames : [(indice, t, pastilles)] dans le même ordre.
    Renvoie, par image, la couleur d'équipe non expliquée par une pastille, en équivalents de pastille (0 : image propre)."""
    if len(coarse) == 0:
        return []
    cells = coarse.astype(np.float32) / 255.0
    background = np.median(cells, axis=0)
    residual = np.clip(cells - background, 0.0, 1.0)
    height, width = residual.shape[1:3]
    out = []
    for i, (_, _, dets) in enumerate(frames):
        r = residual[i].copy()
        for d in dets:
            cx, cy = int(d["x"] * width), int(d["y"] * height)
            k = 0 if d["team"] == "A" else 1
            r[max(cy - EXPLAINED_RADIUS, 0) : cy + EXPLAINED_RADIUS + 1, max(cx - EXPLAINED_RADIUS, 0) : cx + EXPLAINED_RADIUS + 1, k] = 0.0
        out.append(round(float(r.sum()) / MARKER_CELLS, 3))
    return out
