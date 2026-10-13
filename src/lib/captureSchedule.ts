// Rapproche le calendrier des points de capture (Outlaw) des points que le programme a vus sur la minimap d'une game.

import capturePoints from '../../analysis/map_capture_points.json' with { type: 'json' };
import type { CaptureBox } from '../types/analysis';

const MATCH_S = 8; // un point vu commence à cet écart (secondes) d'un changement du calendrier au plus

/** Point vu dans la game pour un changement du calendrier (début du segment à MATCH_S secondes près, le plus proche), ou undefined. */
export function seenAt(boxes: CaptureBox[], t: number): CaptureBox | undefined {
  return boxes.filter((b) => Math.abs(b.t0 - t) <= MATCH_S).sort((a, b) => Math.abs(a.t0 - t) - Math.abs(b.t0 - t))[0];
}

/** Changements de point de capture d'une carte à points mobiles (Outlaw) : chrono restant, secondes depuis le début de la game, d'où vient l'instant. null pour les autres cartes. */
export interface CaptureCalendar {
  durationS: number;
  schedule: { restant: string; t: number; source: 'indique' | 'deduit' }[];
  points: Record<string, { x: number; y: number; vu: boolean }>; // vu : position lue sur la minimap ; sinon seulement indiquée à la main
}

export function captureCalendarOf(map: string): CaptureCalendar | null {
  const entry = (capturePoints as Record<string, { duree_s: number; calendrier: CaptureCalendar['schedule']; points: CaptureCalendar['points'] }>)[map];
  return entry ? { durationS: entry.duree_s, schedule: entry.calendrier, points: entry.points } : null;
}
