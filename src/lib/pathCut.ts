// Trajet d'une vie sur la minimap, coupé là où le joueur ne marche pas : tyroliennes (paires de map_teleports.json), trous de lecture, sauts impossibles.
// Fonctions pures (positions en fractions de la minimap, temps en secondes depuis le début de la game), sans lecture de fichier : les paires sont passées en paramètre.

export interface PathPoint {
  t: number;
  x: number;
  y: number;
}

/** Une tyrolienne : [entrée, sortie] en fraction de la minimap (même format que map_teleports.json). */
export type StationPair = [[number, number], [number, number]];

/** Une ligne de suivi, réduite à ce dont le trajet a besoin (compatible avec Sample de types/analysis). */
export interface PathSample {
  t: number;
  slot: number;
  x: number;
  y: number;
  alive: number | boolean;
}

/** Une vie, réduite à ce dont le trajet a besoin (compatible avec Life de types/stats). */
export interface PathLife {
  game_id?: number;
  slot: number;
  idx: number;
  t0: number;
  t1: number;
}

export interface LifePath {
  game_id: number | null;
  slot: number;
  idx: number;
  /** Morceaux continus du trajet (au moins 2 points chacun), coupés aux tyroliennes et aux trous. */
  segments: PathPoint[][];
}

export interface CutOptions {
  /** Rayon autour d'une station pour reconnaître une entrée ou une sortie (fraction de la minimap). */
  stationRadius: number;
  /** Trou de temps (s) au-delà duquel le trajet est coupé. */
  maxGapS: number;
  /** Vitesse maximale d'un joueur (m/s) : un déplacement plus rapide est un saut (tyrolienne non tracée, erreur de suivi). */
  maxSpeedMs: number;
  /** Marge de position (m) ajoutée au calcul de la vitesse (bruit de lecture). */
  slackM: number;
  /** Distance minimale (fraction de la minimap) entre deux points gardés : allège le dessin sans changer la forme. */
  minStep: number;
}

/** Taille de l'arène en mètres (31,0 par 16,5), comme ARENA_M du côté Python. */
export const ARENA_M: [number, number] = [31.0, 16.5];

export const DEFAULT_CUT: CutOptions = { stationRadius: 0.05, maxGapS: 1.5, maxSpeedMs: 14, slackM: 2, minStep: 0.004 };

/** Distance en mètres entre deux points de la minimap. */
export const metres = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot((a.x - b.x) * ARENA_M[0], (a.y - b.y) * ARENA_M[1]);

const near = (p: { x: number; y: number }, s: [number, number], r: number): boolean => Math.hypot(p.x - s[0], p.y - s[1]) <= r;

/**
 * Vrai si le pas de `a` à `b` est un trajet en tyrolienne : `a` près d'une extrémité d'une paire et `b` près de l'autre (dans les deux sens).
 * Une paire dont les extrémités sont à moins de deux rayons l'une de l'autre (Reef Point) est ignorée : on ne peut pas la distinguer d'un arrêt.
 */
export function isRide(a: PathPoint, b: PathPoint, pairs: StationPair[], radius: number): boolean {
  for (const [p, q] of pairs) {
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= 2 * radius) continue;
    if ((near(a, p, radius) && near(b, q, radius)) || (near(a, q, radius) && near(b, p, radius))) return true;
  }
  return false;
}

/** Vrai si le pas de `a` à `b` va plus vite que possible à pied (marge comprise). */
export function isJump(a: PathPoint, b: PathPoint, o: CutOptions): boolean {
  return metres(a, b) > o.maxSpeedMs * Math.max(0, b.t - a.t) + o.slackM;
}

/** Retire les points trop proches du dernier point gardé (le premier et le dernier restent) : trajet plus léger à dessiner, même forme. */
export function decimate(points: PathPoint[], minStep: number): PathPoint[] {
  if (points.length < 3 || minStep <= 0) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minStep) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Coupe une suite de points (triée par temps) aux tyroliennes, aux trous de temps et aux sauts impossibles. Les morceaux d'un seul point sont écartés. */
export function cutPath(points: PathPoint[], pairs: StationPair[], options: Partial<CutOptions> = {}): PathPoint[][] {
  const o = { ...DEFAULT_CUT, ...options };
  const segments: PathPoint[][] = [];
  let current: PathPoint[] = [];
  for (const p of points) {
    const prev = current[current.length - 1];
    if (prev && (p.t - prev.t > o.maxGapS || isRide(prev, p, pairs, o.stationRadius) || isJump(prev, p, o))) {
      segments.push(current);
      current = [];
    }
    current.push(p);
  }
  segments.push(current);
  return segments.filter((s) => s.length >= 2).map((s) => decimate(s, o.minStep));
}

/** Lignes de suivi en temps de game : /api/samples donne des temps de VIDÉO, alors que les vies (lives.t0, t1) sont en secondes depuis le début de la game. */
export function toGameTime<T extends { t: number }>(samples: T[], startS: number): T[] {
  return samples.map((s) => ({ ...s, t: s.t - startS }));
}

/** Trajet de chaque vie d'une game : les lignes vivantes du joueur entre l'apparition et la mort (ou la fin), coupées par cutPath. */
export function pathsOfLives(samples: PathSample[], lives: PathLife[], pairs: StationPair[], options: Partial<CutOptions> = {}): LifePath[] {
  const bySlot = new Map<number, PathPoint[]>();
  for (const s of samples) {
    if (!s.alive) continue;
    const list = bySlot.get(s.slot) ?? [];
    list.push({ t: s.t, x: s.x, y: s.y });
    bySlot.set(s.slot, list);
  }
  for (const list of bySlot.values()) list.sort((a, b) => a.t - b.t);
  const EPS = 0.05; // tolérance (s) sur les bornes de la vie
  return lives.map((life) => {
    const mine = (bySlot.get(life.slot) ?? []).filter((p) => p.t >= life.t0 - EPS && p.t <= life.t1 + EPS);
    return { game_id: life.game_id ?? null, slot: life.slot, idx: life.idx, segments: cutPath(mine, pairs, options) };
  });
}
