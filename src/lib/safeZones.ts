// Zones couvertes par chaque équipe à un instant, et zones sûres : une zone est « sûre » pour une équipe quand elle est couverte par elle seule.
// Un joueur vivant couvre les cases qu'il voit (ligne de vue sur la grille, lib/visibility.ts) à moins de sa portée utile (lib/weaponRange.ts), dans toutes les directions
// (le regard n'est pas utilisé). Les positions viennent des lignes de suivi en temps de game.

import { castView, viewPolygon, withClosedDoors, withRotors, type BlockGrid, type Segment, type SightMode, type View } from './visibility.ts';
import type { RotorModel } from './rotors.ts';
import { medianRange, rangeOfPlayer, type IconNames } from './weaponRange.ts';

/** Écart (s) au plus entre l'instant demandé et la ligne de suivi d'un joueur. */
export const MAX_GAP_S = 1.5;
/** Cache : nombre d'instants gardés. */
export const CACHE_SIZE = 32;

/** Ligne de suivi, temps de game. */
export interface PositionSample {
  t: number;
  slot: number;
  team: 'A' | 'B';
  x: number;
  y: number;
  alive: number;
}

/** Un joueur qui couvre : position, portée (mètres) et si elle est estimée. */
export interface Shooter {
  slot: number;
  team: 'A' | 'B';
  x: number;
  y: number;
  rangeM: number;
  estimated: boolean;
  /** Arme qui donne la portée (null quand elle est estimée) et portée sans limite. */
  weapon?: string | null;
  open?: boolean;
}

/** Lignes de suivi rangées par joueur et triées par temps (à faire une fois par game). */
export function indexSamples(samples: PositionSample[]): Map<number, PositionSample[]> {
  const by = new Map<number, PositionSample[]>();
  for (const s of samples) {
    const list = by.get(s.slot);
    if (list) list.push(s);
    else by.set(s.slot, [s]);
  }
  for (const list of by.values()) list.sort((a, b) => a.t - b.t);
  return by;
}

/** Ligne la plus proche de t dans une liste triée (recherche par dichotomie). */
function nearest(list: PositionSample[], t: number): PositionSample | null {
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = list[lo];
  const b = lo > 0 ? list[lo - 1] : null;
  return a && b ? (Math.abs(b.t - t) <= Math.abs(a.t - t) ? b : a) : (a ?? b);
}

/** Joueurs vivants à l'instant t : la ligne de suivi la plus proche (à MAX_GAP_S près), qui doit être vivante. */
export function positionsAt(index: Map<number, PositionSample[]>, t: number, maxGapS = MAX_GAP_S): PositionSample[] {
  const out: PositionSample[] = [];
  for (const list of index.values()) {
    const s = nearest(list, t);
    if (s && s.alive && Math.abs(s.t - t) <= maxGapS) out.push(s);
  }
  return out.sort((a, b) => a.slot - b.slot);
}

/** Joueurs vivants et leur portée : arme lue du joueur (la plus longue des deux), sinon médiane des armes lues dans la game (marquée estimée). */
export function shootersAt(positions: PositionSample[], players: { slot: number; weapon1: string | null; weapon2: string | null }[], names: IconNames = {}): Shooter[] {
  const fallback = medianRange(players.flatMap((p) => [p.weapon1, p.weapon2]), names);
  return positions.map((p) => {
    const mine = players.find((q) => q.slot === p.slot);
    const r = rangeOfPlayer(mine?.weapon1, mine?.weapon2, fallback, names);
    return { slot: p.slot, team: p.team, x: p.x, y: p.y, rangeM: r.rangeM, estimated: r.estimated, weapon: r.weapon, open: r.open };
  });
}

/** Bits de l'état d'une case. */
export const COVER_A = 1;
export const COVER_B = 2;

export interface ZoneResult {
  w: number;
  h: number;
  /** Par case : COVER_A et/ou COVER_B (0 : personne ne couvre). Les cases de mur ne sont jamais couvertes. */
  state: Uint8Array;
  shooters: Shooter[];
  views: View[];
}

/** Zones couvertes à partir des joueurs : union des vues de chaque équipe. */
export function computeZones(grid: BlockGrid, shooters: Shooter[]): ZoneResult {
  const marks = { A: new Uint8Array(grid.w * grid.h), B: new Uint8Array(grid.w * grid.h) };
  const views = shooters.map((s) => castView(grid, s.x, s.y, s.rangeM, marks[s.team]));
  const state = new Uint8Array(grid.w * grid.h);
  for (let i = 0; i < state.length; i++) state[i] = (marks.A[i] ? COVER_A : 0) | (marks.B[i] ? COVER_B : 0);
  return { w: grid.w, h: grid.h, state, shooters, views };
}

/** Surfaces en nombre de cases libres : sûres pour A, sûres pour B, couvertes par les deux, non couvertes (hors murs). */
export function zoneCounts(result: ZoneResult, grid: BlockGrid): { safeA: number; safeB: number; contested: number; uncovered: number; open: number } {
  const c = { safeA: 0, safeB: 0, contested: 0, uncovered: 0, open: 0 };
  for (let i = 0; i < result.state.length; i++) {
    if (grid.blocked[i]) continue;
    c.open++;
    const s = result.state[i];
    if (s === COVER_A) c.safeA++;
    else if (s === COVER_B) c.safeB++;
    else if (s === (COVER_A | COVER_B)) c.contested++;
    else c.uncovered++;
  }
  return c;
}

export type Rgb = [number, number, number];

/** Couleurs de la couche (jetons de tokens.css lus par l'appelant) et opacité 0 à 255. */
export interface ZoneColors {
  a: Rgb;
  b: Rgb;
  contested: Rgb;
  alpha: number;
}

/** Pixels RGBA de la couche : zone sûre de A, sûre de B, couverte par les deux (moins opaque). `only` limite à une équipe (la zone contestée reste montrée). */
export function zonePixels(result: ZoneResult, colors: ZoneColors, only: 'A' | 'B' | 'all' = 'all'): Uint8ClampedArray {
  const px = new Uint8ClampedArray(result.w * result.h * 4);
  for (let i = 0; i < result.state.length; i++) {
    const s = result.state[i];
    let color: Rgb | null = null;
    let alpha = colors.alpha;
    if (s === COVER_A && only !== 'B') color = colors.a;
    else if (s === COVER_B && only !== 'A') color = colors.b;
    else if (s === (COVER_A | COVER_B)) {
      color = colors.contested;
      alpha = colors.alpha * 0.55;
    }
    if (!color) continue;
    px[i * 4] = color[0];
    px[i * 4 + 1] = color[1];
    px[i * 4 + 2] = color[2];
    px[i * 4 + 3] = alpha;
  }
  return px;
}

/** Contours (fractions de la minimap) de la vue de chaque joueur de l'instant. */
export const outlinesOf = (result: ZoneResult): { slot: number; team: 'A' | 'B'; points: [number, number][] }[] =>
  result.views.map((v, i) => ({ slot: result.shooters[i].slot, team: result.shooters[i].team, points: viewPolygon(v) }));

/** Petit cache par instant (le plus ancien sorti en premier). */
export function createCache<T>(max = CACHE_SIZE) {
  const map = new Map<string, T>();
  return {
    get(key: string): T | undefined {
      const v = map.get(key);
      if (v !== undefined) {
        map.delete(key); // le plus récemment lu passe en dernier
        map.set(key, v);
      }
      return v;
    },
    set(key: string, value: T) {
      map.set(key, value);
      if (map.size > max) map.delete(map.keys().next().value as string);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}

/** Ce qu'il faut pour calculer un instant. */
export interface InstantInput {
  base: BlockGrid;
  mode: SightMode;
  /** Portes à bouton fermées (segments), ou null : portes ouvertes. */
  doors: Segment[] | null;
  /** Anneaux tournants de la carte (Engine), ou null. */
  rotors: RotorModel | null;
  /** Instant de game (s), utile aux anneaux. */
  t: number;
  shooters: Shooter[];
}

export interface Instant {
  result: ZoneResult;
  counts: ReturnType<typeof zoneCounts>;
  /** Durée du calcul en millisecondes (grille de l'instant comprise). */
  ms: number;
}

/** Calcul complet d'un instant : grille (portes, anneaux), vues, zones et surfaces. */
export function computeInstant(input: InstantInput): Instant {
  const t0 = performance.now();
  let grid = input.base;
  if (input.doors && input.doors.length > 0) grid = withClosedDoors(grid, input.doors);
  if (input.rotors) grid = withRotors(grid, input.rotors, input.t, input.mode);
  const result = computeZones(grid, input.shooters);
  const counts = zoneCounts(result, grid);
  return { result, counts, ms: performance.now() - t0 };
}
