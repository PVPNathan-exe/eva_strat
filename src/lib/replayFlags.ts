// Contrôle des positions à la vraie minimap et joueur observé : fonctions pures (voir hooks/useGameFlags et ReliabilityLayer).

import type { GameFlags, Reliability } from '../types/analysis';

/** Clé d'une position (image, joueur) dans l'ensemble des positions non confirmées. */
export const flagKey = (frame: number, slot: number) => `${frame}:${slot}`;

export function unconfirmedSet(flags: GameFlags | null): Set<string> {
  return new Set((flags?.unconfirmed ?? []).map(([frame, slot]) => flagKey(frame, slot)));
}

/** Joueur observé à l'instant t (temps de la vidéo), ou null. */
export function observedAt(flags: GameFlags | null, t: number): number | null {
  const seg = flags?.observed.find((o) => t >= o.t0 && t <= o.t1);
  return seg ? seg.slot : null;
}

export interface ZoneCell {
  x: number;
  y: number;
  w: number;
  h: number;
  pos: boolean;
  gaze: boolean;
}

/** Cases douteuses de la carte de fiabilité, en fractions de la minimap (0 à 1). */
export function zoneCells(rel: Reliability | null): ZoneCell[] {
  if (!rel) return [];
  const size = 1 / rel.grid;
  return rel.cells
    .filter((c) => c.pos_flag || c.gaze_flag)
    .map((c) => ({ x: c.i * size, y: c.j * size, w: size, h: size, pos: c.pos_flag, gaze: c.gaze_flag }));
}
