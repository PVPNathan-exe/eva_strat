// Équipe qui capture à chaque instant d'une game, déduite des scores de capture (score_A, score_B de /api/capture).
// Chaque score est le pourcentage cumulé d'une équipe (0 à 100, une lecture par seconde, temps de la vidéo) : il ne monte que
// quand l'équipe capture. Règle : l'équipe dont le score monte entre deux lectures capture ; quand rien ne monte, on garde la
// couleur précédente ; avant la première hausse, neutre.

import type { CaptureSeries } from '../types/analysis';

export type CaptureTeam = 'A' | 'B' | null;

/** Morceau de la barre : de t0 à t1 (secondes de la vidéo), équipe qui capture (null : neutre, inconnu). */
export interface CaptureSegment {
  t0: number;
  t1: number;
  team: CaptureTeam;
}

/** Écart (s) entre deux lectures au-delà duquel le morceau est neutre : aucune lecture, on ne sait pas qui capturait. */
export const CAPTURE_GAP_S = 5;

/** Un morceau plus court que cette durée (s), entouré de la même équipe des deux côtés, est absorbé par elle
 *  (une lecture fausse de +1 ferait sinon clignoter la couleur). 0 : pas de lissage. */
export const CAPTURE_SMOOTH_S = 2;

/** Durée (s) sans aucune hausse après laquelle la barre repasse au neutre (point disputé ou vide).
 *  null : désactivé, la couleur de la dernière équipe dont le score a monté est gardée jusqu'à la hausse suivante.
 *  Pour l'activer, mettre un nombre de secondes, par exemple 10. */
export const CAPTURE_IDLE_S: number | null = null;

export interface CaptureOptions {
  gapS: number;
  smoothS: number;
  idleS: number | null;
}

const DEFAULTS: CaptureOptions = { gapS: CAPTURE_GAP_S, smoothS: CAPTURE_SMOOTH_S, idleS: CAPTURE_IDLE_S };

/** La game a-t-elle des lectures de capture (étape 2 faite) ? */
export function hasCapture(series: CaptureSeries | null): series is CaptureSeries {
  return !!series && series.A.length + series.B.length > 0;
}

/** Instants de lecture des deux équipes entre start et end, plus les deux bornes, triés et sans doublon. */
function readingTimes(series: CaptureSeries, start: number, end: number): number[] {
  const inside = [...series.A, ...series.B].map((p) => p.t).filter((t) => t >= start && t <= end);
  return [...new Set([start, ...inside, end])].sort((a, b) => a - b);
}

/** Dernière lecture d'une équipe (valeur et instant). */
interface LastReading {
  v: number | null;
  t: number;
}

/** Hausse du score d'une équipe à l'instant t par rapport à sa lecture précédente. 0 sans lecture à t, après une
 *  lecture trop ancienne (plus de gapS : on ne sait pas quand la hausse a eu lieu) ou pour une baisse (erreur de lecture). */
function riseAt(byTime: Map<number, number>, last: LastReading, t: number, gapS: number): number {
  const v = byTime.get(t);
  if (v === undefined) return 0;
  const rise = last.v === null || t - last.t > gapS ? 0 : Math.max(0, v - last.v);
  last.v = v;
  last.t = t;
  return rise;
}

/** Ajoute un morceau à la liste, fusionné avec le précédent s'il est de la même équipe. */
function pushSegment(out: CaptureSegment[], seg: CaptureSegment): void {
  const last = out[out.length - 1];
  if (last && last.team === seg.team && last.t1 === seg.t0) last.t1 = seg.t1;
  else out.push({ ...seg });
}

/** Absorbe les morceaux trop courts entourés de la même équipe, puis refusionne. */
function smooth(segments: CaptureSegment[], smoothS: number): CaptureSegment[] {
  if (smoothS <= 0) return segments;
  const marked = segments.map((s, i) => {
    const before = segments[i - 1];
    const after = segments[i + 1];
    const short = s.t1 - s.t0 < smoothS;
    return short && before && after && before.team !== null && before.team === after.team ? { ...s, team: before.team } : s;
  });
  const out: CaptureSegment[] = [];
  for (const s of marked) pushSegment(out, s);
  return out;
}

/** Découpe la game [start, end] en morceaux selon l'équipe qui capture. Liste vide si la game n'a aucune lecture de capture. */
export function captureSegments(series: CaptureSeries | null, start: number, end: number, options: Partial<CaptureOptions> = {}): CaptureSegment[] {
  if (!hasCapture(series) || end <= start) return [];
  const { gapS, smoothS, idleS } = { ...DEFAULTS, ...options };
  const values = { A: new Map(series.A.map((p) => [p.t, p.v])), B: new Map(series.B.map((p) => [p.t, p.v])) };
  const last: Record<'A' | 'B', LastReading> = { A: { v: null, t: start }, B: { v: null, t: start } };
  const times = readingTimes(series, start, end);
  const out: CaptureSegment[] = [];
  let current: CaptureTeam = null; // dernière équipe dont le score a monté
  let lastRise = start;
  riseAt(values.A, last.A, start, gapS); // une lecture pile au début sert de référence
  riseAt(values.B, last.B, start, gapS);
  for (let i = 1; i < times.length; i++) {
    const [t0, t1] = [times[i - 1], times[i]];
    const riseA = riseAt(values.A, last.A, t1, gapS);
    const riseB = riseAt(values.B, last.B, t1, gapS);
    if (riseA > riseB) current = 'A';
    else if (riseB > riseA) current = 'B'; // égalité (aucune hausse, ou deux hausses égales) : on garde la couleur précédente
    if (riseA > 0 || riseB > 0) lastRise = t1;
    const idle = idleS !== null && idleS > 0 && t1 - lastRise > idleS;
    pushSegment(out, { t0, t1, team: t1 - t0 > gapS || idle ? null : current });
  }
  return smooth(out, smoothS);
}
