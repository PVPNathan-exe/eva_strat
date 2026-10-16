// Pose d'une correction à la main sur le plan du replay : du pointeur à la minimap, regard d'un geste, corrections visibles à l'instant.
// Fonctions pures (tests/markPlacement.test.ts) : le cadre de la minimap dans le plan vient de lib/planInsets.ts.

import type { CSSProperties } from 'react';
import type { Inset } from '../../../lib/planInsets.ts';
import type { UserMark } from '../../../types/analysis.ts';

/** Une correction se voit à ce temps près de son instant (secondes de vidéo). */
export const MARK_SHOWN_S = 1;

/** Geste en cours : départ (la position) et pointeur actuel (la direction de la pointe donne le regard), en fractions du plan. */
export interface Drag {
  slot: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Position du pointeur dans un rectangle, en fractions (0 à 1, bornées). */
export function stageFraction(rect: { left: number; top: number; width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp((clientX - rect.left) / rect.width), y: clamp((clientY - rect.top) / rect.height) };
}

/** Inverse de planInsets.project : fraction du plan (0 à 1) vers position normalisée de la minimap (0 à 1, bornée). */
export function planToMinimap(inset: Inset, fx: number, fy: number): { x: number; y: number } {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return { x: clamp((fx - inset.l) / (1 - inset.l - inset.r)), y: clamp((fy - inset.t) / (1 - inset.t - inset.b)) };
}

/** Regard (degrés, 0 = droite, 90 = bas) d'un geste en pixels de l'écran ; null si le geste est trop court pour viser une direction. */
export function gazeAngle(dx: number, dy: number, minPixels = 10): number | null {
  return Math.hypot(dx, dy) < minPixels ? null : (Math.atan2(dy, dx) * 180) / Math.PI + (dy < 0 ? 360 : 0);
}

/** Style qui place un élément exactement sur la minimap dans le plan (pourcentages de l'image du plan). */
export function boxStyleOf(inset: Inset): CSSProperties {
  return { left: `${inset.l * 100}%`, top: `${inset.t * 100}%`, width: `${(1 - inset.l - inset.r) * 100}%`, height: `${(1 - inset.t - inset.b) * 100}%` };
}

/** Corrections posées à `seconds` près de l'instant t (vidéo), pour les montrer sur le plan. */
export function marksNear(marks: UserMark[], t: number, seconds = MARK_SHOWN_S): UserMark[] {
  return marks.filter((m) => Math.abs(m.t - t) <= seconds);
}
