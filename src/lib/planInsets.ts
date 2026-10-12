// Cadre de la minimap du jeu dans l'image du plan d'une carte (fractions des bords du plan), pour dessiner les positions au bon endroit.
// Les cartes alignées par analysis/plan_align.py (traits de murs de la minimap recalés sur les contours du plan) ont leur cadre dans map_plan_insets.json ;
// les autres gardent un cadre approximatif réglable à la main.

import aligned from '../../analysis/map_plan_insets.json';

export interface Inset {
  l: number;
  t: number;
  r: number;
  b: number;
}

export const APPROX_INSET: Inset = { l: 0.01, t: 0.022, r: 0.01, b: 0.045 };

const known = aligned as Record<string, Inset & { correlation: number | null }>; // correlation : null pour un cadre posé à la main (cartographie)

/** Cadre par défaut d'une carte : aligné sur le plan s'il l'est, sinon approximatif. */
export function defaultInset(map: string): Inset {
  const a = known[map];
  return a ? { l: a.l, t: a.t, r: a.r, b: a.b } : APPROX_INSET;
}

export const isAligned = (map: string) => map in known;

/** Clé de mémorisation du réglage manuel : un réglage fait avant l'alignement automatique ne masque pas le cadre aligné. */
export const insetStorageKey = (map: string) => `eva_strat:replay-inset${isAligned(map) ? ':aligned' : ''}:${map}`;

/** Position normalisée de la minimap (0 à 1) vers un pourcentage de l'image du plan. */
export function project(inset: Inset, x: number, y: number) {
  return { x: (inset.l + x * (1 - inset.l - inset.r)) * 100, y: (inset.t + y * (1 - inset.t - inset.b)) * 100 };
}
