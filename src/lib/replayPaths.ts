// Rejeu du parcours d'une game à un instant donné : pour chaque joueur, seul le trajet de sa vie EN COURS est tracé, jusqu'à l'instant, avec le point du joueur au bout.
// À la mort le trajet disparaît (le joueur n'a plus de vie en cours), une croix reste quelques secondes à l'endroit de la mort, puis un nouveau trajet commence à la réapparition.
// Fonctions pures : temps en secondes depuis le début de la game (comme les vies), positions en fractions de la minimap.

import type { LifePath, PathPoint } from './pathCut.ts';

/** Durée (s) pendant laquelle la croix de mort reste affichée. */
export const CROSS_S = 2.5;

/** Une vie, réduite à ce dont le rejeu a besoin (compatible avec Life de types/stats). */
export interface ReplayLife {
  slot: number;
  idx: number;
  t0: number;
  t1: number;
  ended: 'death' | 'end';
  x1: number | null;
  y1: number | null;
}

/** Trajet d'un joueur jusqu'à l'instant : morceaux continus (au moins 2 points) et position actuelle. */
export interface PlayerFrame {
  slot: number;
  idx: number;
  trail: PathPoint[][];
  head: PathPoint | null;
}

/** Croix de mort : `age` va de 0 (à la mort) à 1 (disparition). */
export interface DeathCross {
  slot: number;
  idx: number;
  x: number;
  y: number;
  age: number;
}

export interface ReplayFrame {
  players: PlayerFrame[];
  crosses: DeathCross[];
}

/** Vie en cours d'un joueur à l'instant t (de l'apparition à la mort comprises) ; null s'il est mort ou pas encore réapparu. */
export function lifeAt<L extends { slot: number; t0: number; t1: number }>(lives: L[], slot: number, t: number): L | null {
  return lives.find((l) => l.slot === slot && l.t0 <= t && t <= l.t1) ?? null;
}

/**
 * Trajet jusqu'à t : chaque morceau est coupé à t (le dernier point est interpolé entre les deux lectures voisines), les morceaux commencés après t sont ignorés.
 * La position actuelle est le bout du dernier morceau commencé ; entre deux morceaux (tyrolienne, trou de lecture) le point reste à la dernière position connue.
 */
export function trailAt(segments: PathPoint[][], t: number): { trail: PathPoint[][]; head: PathPoint | null } {
  const trail: PathPoint[][] = [];
  let head: PathPoint | null = null;
  for (const seg of segments) {
    if (seg.length === 0 || seg[0].t > t) break;
    const part: PathPoint[] = [];
    for (let i = 0; i < seg.length; i++) {
      const p = seg[i];
      if (p.t <= t) {
        part.push(p);
        continue;
      }
      const q = seg[i - 1]; // i >= 1 : le premier point du morceau est avant t
      const f = (t - q.t) / (p.t - q.t);
      if (f > 0) part.push({ t, x: q.x + (p.x - q.x) * f, y: q.y + (p.y - q.y) * f });
      break;
    }
    head = part[part.length - 1];
    if (part.length >= 2) trail.push(part);
  }
  return { trail, head };
}

/** Trajets en cours et croix de mort visibles à l'instant t. `paths` : un trajet par vie (pathsOfLives de la game) ; `lives` : les vies de la game retenues. */
export function frameAt(paths: LifePath[], lives: ReplayLife[], t: number, crossS: number = CROSS_S): ReplayFrame {
  const pathOf = new Map(paths.map((p) => [`${p.slot}:${p.idx}`, p]));
  const players: PlayerFrame[] = [];
  const crosses: DeathCross[] = [];
  for (const life of lives) {
    if (life.t0 <= t && t <= life.t1) {
      const { trail, head } = trailAt(pathOf.get(`${life.slot}:${life.idx}`)?.segments ?? [], t);
      players.push({ slot: life.slot, idx: life.idx, trail, head });
    } else if (life.ended === 'death' && life.x1 !== null && life.y1 !== null && t > life.t1 && t <= life.t1 + crossS) {
      crosses.push({ slot: life.slot, idx: life.idx, x: life.x1, y: life.y1, age: (t - life.t1) / crossS });
    }
  }
  return { players, crosses };
}
