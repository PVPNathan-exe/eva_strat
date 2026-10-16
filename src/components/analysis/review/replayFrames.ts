// Fonctions pures du replay : lignes de suivi regroupées par image, instant interpolé, traînées.
// Aucune dépendance au navigateur : testé dans tests/replayFrames.test.ts.

import { formatTime } from '../../../lib/timeline.ts';
import type { Sample } from '../../../types/analysis.ts';

export const TRAIL_S = 12;
export const MAX_JUMP = 0.3; // au-delà, pas d'interpolation ni de trait (réapparition)
export const MAX_GAP_S = 2.5; // trou entre deux lectures au-delà duquel on ne relie plus les points

/** Numéro affiché dans le jeu : le créneau 5 à 8 de l'équipe B s'affiche 6 à 9. */
export const numberOfSlot = (slot: number) => (slot <= 4 ? slot : slot + 1);

/** Couleur d'une équipe : jeton de tokens.css, à poser en style (jamais de couleur en dur). */
export const teamVar = (team: 'A' | 'B') => (team === 'A' ? 'var(--c-team-a)' : 'var(--c-team-b)');

export interface Frame {
  t: number;
  bySlot: Map<number, Sample>;
}

/** Une image par instant de lecture, triées dans le temps. */
export function groupFrames(samples: Sample[]): Frame[] {
  const frames = new Map<number, Frame>();
  for (const s of samples) {
    let f = frames.get(s.frame);
    if (!f) frames.set(s.frame, (f = { t: s.t, bySlot: new Map() }));
    f.bySlot.set(s.slot, s);
  }
  return [...frames.values()].sort((a, b) => a.t - b.t);
}

/** Indice de la dernière image dont l'instant est au plus t (0 si t précède tout). */
export function frameIndexAt(frames: Frame[], t: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export interface Shown {
  frame: number;
  slot: number;
  team: 'A' | 'B';
  x: number;
  y: number;
  angle: number | null;
  alive: boolean;
  confidence: number | null;
  coherence: number | null;
}

/** Angle intermédiaire par le plus court chemin (359° -> 1° ne fait pas le tour). */
export function lerpAngle(a: number, b: number, k: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * k + 360) % 360;
}

/** Joueurs à l'instant t, positions et regards interpolés entre deux images voisines (jamais à travers une mort, un trou ou une réapparition). */
export function shownAt(frames: Frame[], t: number): Shown[] {
  if (frames.length === 0) return [];
  const i = frameIndexAt(frames, t);
  const a = frames[i];
  const b = frames[i + 1];
  const k = b && b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  const out: Shown[] = [];
  for (const [slot, s] of a.bySlot) {
    let { x, y } = s;
    let angle = s.angle;
    const n = b?.bySlot.get(slot);
    if (n && s.alive && n.alive && n.t - s.t <= MAX_GAP_S && Math.hypot(n.x - s.x, n.y - s.y) < MAX_JUMP) {
      x = s.x + (n.x - s.x) * k;
      y = s.y + (n.y - s.y) * k;
      if (s.angle !== null && n.angle !== null) angle = lerpAngle(s.angle, n.angle, k);
    }
    out.push({ frame: s.frame, slot, team: s.team, x, y, angle, alive: !!s.alive, confidence: s.confidence, coherence: s.gaze_coh ?? null });
  }
  return out;
}

/** Instant avec le dixième de seconde (0:12.3) : les boutons « image » avancent de moins d'une seconde. */
export function formatFine(sec: number): string {
  const t = Math.max(0, sec);
  return `${formatTime(Math.floor(t))}.${Math.floor((t % 1) * 10)}`;
}

export interface Trail {
  key: string;
  team: 'A' | 'B';
  points: string;
}

/**
 * Traînées des TRAIL_S dernières secondes. Une traînée s'interrompt à une mort, une disparition (combat, pastille cachée) ou une réapparition :
 * on ne relie jamais deux points séparés, sinon le trait traverserait les murs. `place` : position de la minimap vers le plan (pourcentages).
 */
export function computeTrails(frames: Frame[], time: number, hidden: Set<number>, place: (x: number, y: number) => { x: number; y: number }): Trail[] {
  if (frames.length === 0) return [];
  const i = frameIndexAt(frames, time);
  const first = Math.max(0, frameIndexAt(frames, time - TRAIL_S));
  const out: Trail[] = [];
  // Position affichée du point (interpolée entre deux échantillons) : la traînée finit exactement dessus, sinon le point devance le bout du trait et le trait saute d'un segment à chaque nouvel échantillon
  const current = new Map(shownAt(frames, time).map((p) => [p.slot, p]));
  const slots = new Set<number>();
  for (let j = i; j >= 0 && frames[j].t >= time - TRAIL_S; j--) for (const s of frames[j].bySlot.keys()) slots.add(s);
  for (const slot of slots) {
    let run: string[] = [];
    let prev: Sample | null = null;
    let team: 'A' | 'B' = slot <= 4 ? 'A' : 'B';
    let n = 0;
    const flush = () => {
      if (run.length > 1) out.push({ key: `${slot}-${n++}`, team, points: run.join(' ') });
      run = [];
    };
    for (let j = first; j <= i; j++) {
      const s = frames[j].bySlot.get(slot);
      if (!s || !s.alive || hidden.has(slot)) {
        flush();
        prev = null;
        continue;
      }
      if (prev && (s.t - prev.t > MAX_GAP_S || Math.hypot(s.x - prev.x, s.y - prev.y) > MAX_JUMP)) flush();
      team = s.team;
      const p = place(s.x, s.y);
      run.push(`${p.x},${p.y}`);
      prev = s;
    }
    const now = current.get(slot);
    if (prev && now && now.alive && prev === frames[i].bySlot.get(slot) && (now.x !== prev.x || now.y !== prev.y)) {
      const p = place(now.x, now.y);
      run.push(`${p.x},${p.y}`);
    }
    flush();
  }
  return out;
}
