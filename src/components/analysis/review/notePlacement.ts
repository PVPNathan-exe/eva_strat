// Pose d'une note sur le plan du replay : du pointeur à la minimap, regard d'un geste, cadre de la minimap dans le plan.
// Fonctions pures (tests/notePlacement.test.ts) : le cadre de la minimap dans le plan vient de lib/planInsets.ts.

import type { CSSProperties } from 'react';
import { ARENA_M } from '../../../lib/pathCut.ts';
import type { Inset } from '../../../lib/planInsets.ts';

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

/** Un appui sur un joueur devient un glisser (et non un simple clic) à partir de cette distance en pixels de l'écran. */
export const DRAG_MIN_PX = 6;

/** Vrai si le pointeur s'est assez éloigné de son point d'appui (en pixels de l'écran) pour être un glisser. */
export function isDrag(dx: number, dy: number, minPixels = DRAG_MIN_PX): boolean {
  return Math.hypot(dx, dy) >= minPixels;
}

/** Style qui place un élément exactement sur la minimap dans le plan (pourcentages de l'image du plan). */
export function boxStyleOf(inset: Inset): CSSProperties {
  return { left: `${inset.l * 100}%`, top: `${inset.t * 100}%`, width: `${(1 - inset.l - inset.r) * 100}%`, height: `${(1 - inset.t - inset.b) * 100}%` };
}

/** Rayon en mètres vers les deux demi-axes d'une ellipse, en pourcentages de l'image du plan (un cercle de la carte, étiré comme la minimap l'est dans le plan). */
export function radiusInPlan(inset: Inset, metresRadius: number): { rx: number; ry: number } {
  return { rx: (metresRadius / ARENA_M[0]) * (1 - inset.l - inset.r) * 100, ry: (metresRadius / ARENA_M[1]) * (1 - inset.t - inset.b) * 100 };
}

/** Distance en pixels entre deux points donnés en fractions d'un rectangle (pour savoir si un clic tombe sur le fantôme). */
export function pixelDistance(rect: { width: number; height: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot((a.x - b.x) * rect.width, (a.y - b.y) * rect.height);
}
