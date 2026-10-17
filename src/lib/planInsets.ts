// Cadre de la minimap du jeu dans l'image du plan d'une carte (fractions des bords du plan), pour dessiner les positions au bon endroit.
// Les cartes alignées par analysis/plan_align.py (traits de murs de la minimap recalés sur les contours du plan) ont leur cadre dans map_plan_insets.json ;
// les autres gardent un cadre approximatif réglable à la main.

import aligned from '../../analysis/map_plan_insets.json';
import warpData from '../../analysis/map_warp.json';
import { hasWarp, projectInset, registerWarps, unprojectInset, type WarpEntry } from './planWarp';

registerWarps(warpData as unknown as Record<string, WarpEntry>);

export interface Inset {
  l: number;
  t: number;
  r: number;
  b: number;
  /** Nom de la carte quand elle a un maillage minimap vers plan (analysis/map_warp.json, planWarp.ts) : il prime sur le cadre affine (l, t, r, b). */
  warp?: string;
}

export const APPROX_INSET: Inset = { l: 0.01, t: 0.022, r: 0.01, b: 0.045 };

const known = aligned as Record<string, Inset & { correlation: number | null }>; // correlation : null pour un cadre posé à la main (cartographie)

/** Cadre par défaut d'une carte : aligné sur le plan s'il l'est, sinon approximatif ; porte le nom de la carte quand elle a un maillage (le cadre affine reste le repli). */
export function defaultInset(map: string): Inset {
  const a = known[map];
  const inset = a ? { l: a.l, t: a.t, r: a.r, b: a.b } : APPROX_INSET;
  return hasWarp(map) ? { ...inset, warp: map } : inset;
}

export const isAligned = (map: string) => map in known;

/** Clé de mémorisation du réglage manuel : un réglage fait avant l'alignement automatique ne masque pas le cadre aligné. */
export const insetStorageKey = (map: string) => `eva_strat:replay-inset${isAligned(map) ? ':aligned' : ''}:${map}`;

/** Position normalisée de la minimap (0 à 1) vers un pourcentage de l'image du plan (maillage si la carte en a un, sinon cadre affine). */
export const project = projectInset;

/** Inverse de `project` : fraction du plan (0 à 1) vers la position de la minimap (non bornée). */
export const unproject = unprojectInset;
