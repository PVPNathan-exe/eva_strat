// Moments où le point actif n'appartient à personne (propriétaire « none » de /api/stats/owners), pour la frise zoomée d'Outlaw.
// Un point qui vient de s'allumer est neutre jusqu'à la première prise, et redevient neutre quand une équipe le perd ou qu'il est disputé.

import type { PointOwner } from '../types/stats.ts';

/** Plus petit trou affiché (secondes) : en dessous c'est une coupure de lecture. */
export const MIN_UNCAPTURED_S = 1;

/** Un morceau sans propriétaire, en secondes de game. */
export interface UncapturedPeriod {
  point: string;
  t0: number;
  t1: number;
}

/** Cartes où la frise montre ces moments (un seul point actif à la fois qui change : Outlaw). */
export function showsUncaptured(map: string | null): boolean {
  return map !== null && map.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase() === 'outlaw';
}

/** Périodes « none » triées, recollées quand elles se suivent sur le même point (trou de 1 s au plus), sans celles de moins de MIN_UNCAPTURED_S. */
export function uncapturedPeriods(owners: PointOwner[], durationS: number): UncapturedPeriod[] {
  const none = owners
    .filter((o) => o.owner === 'none' && o.t1 > o.t0 && o.t0 < durationS)
    .sort((a, b) => a.t0 - b.t0)
    .map((o) => ({ point: o.point, t0: Math.max(0, o.t0), t1: Math.min(durationS, o.t1) }));
  const merged: UncapturedPeriod[] = [];
  for (const p of none) {
    const last = merged[merged.length - 1];
    if (last && last.point === p.point && p.t0 - last.t1 <= 1) last.t1 = Math.max(last.t1, p.t1);
    else merged.push({ ...p });
  }
  return merged.filter((p) => p.t1 - p.t0 >= MIN_UNCAPTURED_S);
}
