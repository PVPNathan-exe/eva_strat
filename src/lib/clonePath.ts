// Trajet du clone (Echo) dans une note de review : ligne droite du joueur vers le point visé, arrêtée par le PREMIER obstacle (mur de n'importe quel type, joueur) ou à la portée voulue.
// Fonctions pures (tests/clonePath.test.ts). Positions en fractions de la minimap (0 à 1), distances en mètres (ARENA_M de pathCut.ts).

import { ARENA_M, metres } from './pathCut.ts';
import { BLOCK_FRACTION, CLASS_CODES, type BlockGrid, type GraySource } from './visibility.ts';

/** Rayon de contact (mètres) : le clone s'arrête à ce que son centre soit à cette distance du centre d'un joueur vivant. Hypothèse (un joueur fait environ 1 m de large), le vrai rayon du jeu n'est pas connu. */
export const CLONE_CONTACT_M = 0.5;
/** Pas (mètres) de la marche le long du trajet : l'arrêt est précis à ce pas près. */
export const CLONE_STEP_M = 0.05;
/** Si le joueur est lu dans une case de mur (position imprécise), le clone ignore les murs pendant cette distance (mètres) au départ au lieu de s'arrêter à 0 m. */
export const CLONE_START_GRACE_M = 0.4;
/** Côté de la grille d'obstacles (le masque fait 400 sur 400), comme la grille des zones de tir. */
export const CLONE_GRID = 200;

export type CloneStop = 'mur' | 'joueur' | 'portee';

export interface Point {
  x: number;
  y: number;
}

/** Joueur vivant sur lequel le clone peut buter (position lue à l'instant de la note). */
export interface CloneObstacle extends Point {
  slot: number;
}

export interface ClonePathInput {
  /** Départ : position lue du joueur. */
  from: Point;
  /** Point visé : donne la direction et la distance voulue. */
  aim: Point;
  /** Cases qui bloquent (`blocked[j * w + i]` vaut 1), voir buildObstacleGrid. */
  grid: Pick<BlockGrid, 'w' | 'h' | 'blocked'>;
  players: CloneObstacle[];
  /** Portée maximale (mètres) : vitesse du clone x sa durée de vie (lib/gadgetParams.cloneParams). */
  maxRangeM: number;
  /** Joueur qui lance le clone (jamais un obstacle pour lui-même). */
  ignoreSlot?: number | null;
  contactM?: number;
}

export interface ClonePathResult {
  /** Où le clone s'arrête. */
  stop: Point;
  /** mur : un pixel non praticable ou le bord de la carte ; joueur : un joueur vivant ; portee : la distance voulue (ou la portée maximale) est atteinte librement. */
  reason: CloneStop;
  /** Distance parcourue (mètres). */
  distanceM: number;
  /** Distance voulue par la direction visée (mètres), avant le plafond de portée. */
  wantedM: number;
  /** Vrai quand la distance voulue dépasse la portée maximale (le trajet est raccourci). */
  capped: boolean;
  /** Joueur touché quand la raison est `joueur`. */
  hitSlot: number | null;
}

/** Intervalle de pixels d'une source couvert par la case i d'une grille de n cases (au moins un pixel). */
function span(i: number, n: number, size: number): [number, number] {
  const a = Math.min(size - 1, Math.floor((i * size) / n));
  return [a, Math.max(a + 1, Math.min(size, Math.ceil(((i + 1) * size) / n)))];
}

/** Classes qui arrêtent un clone : tout sauf le sol (mur, tir par-dessus, vue = fenêtre, porte, porte vitrée, hors map). */
const isObstacleClass = (c: number) => c >= CLASS_CODES.mur && c <= CLASS_CODES.hors;

/**
 * Grille d'obstacles du clone : une case bloque si au moins BLOCK_FRACTION de ses pixels ne sont pas praticables dans le masque, ou si autant de pixels de l'image des classes
 * sont un obstacle (vitre, fenêtre, porte, bloc de tir par-dessus). Plus stricte que la grille des balles de visibility.ts (qui laisse passer le tir par-dessus) : le clone ne passe nulle part.
 */
export function buildObstacleGrid(walk: GraySource, classes: GraySource | null, size = CLONE_GRID): BlockGrid {
  const blocked = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    const [wy0, wy1] = span(j, size, walk.h);
    for (let i = 0; i < size; i++) {
      const [wx0, wx1] = span(i, size, walk.w);
      let open = 0;
      for (let y = wy0; y < wy1; y++) for (let x = wx0; x < wx1; x++) if (walk.data[y * walk.w + x] > 127) open++;
      let wall = 1 - open / ((wy1 - wy0) * (wx1 - wx0)) >= BLOCK_FRACTION;
      if (!wall && classes) {
        const [cy0, cy1] = span(j, size, classes.h);
        const [cx0, cx1] = span(i, size, classes.w);
        let hit = 0;
        for (let y = cy0; y < cy1; y++) for (let x = cx0; x < cx1; x++) if (isObstacleClass(classes.data[y * classes.w + x])) hit++;
        wall = hit / ((cy1 - cy0) * (cx1 - cx0)) >= BLOCK_FRACTION;
      }
      blocked[j * size + i] = wall ? 1 : 0;
    }
  }
  return { w: size, h: size, blocked };
}

/** Vrai si le point est dans une case bloquée, ou hors de la minimap. */
export function isBlockedAt(grid: Pick<BlockGrid, 'w' | 'h' | 'blocked'>, p: Point): boolean {
  if (p.x < 0 || p.x >= 1 || p.y < 0 || p.y >= 1) return true;
  return grid.blocked[Math.floor(p.y * grid.h) * grid.w + Math.floor(p.x * grid.w)] === 1;
}

/** Trajet du clone : marche en ligne droite vers le point visé, au plus jusqu'à la portée maximale, et s'arrête au premier mur ou joueur rencontré. */
export function clonePath(input: ClonePathInput): ClonePathResult {
  const { from, aim, grid, players, maxRangeM, ignoreSlot = null, contactM = CLONE_CONTACT_M } = input;
  const dxM = (aim.x - from.x) * ARENA_M[0];
  const dyM = (aim.y - from.y) * ARENA_M[1];
  const wantedM = Math.hypot(dxM, dyM);
  const capped = wantedM > maxRangeM;
  const targetM = Math.min(wantedM, maxRangeM);
  const none = { capped, hitSlot: null, wantedM };
  if (wantedM < 1e-9 || targetM <= 0) return { stop: { ...from }, reason: 'portee', distanceM: 0, ...none };

  const at = (d: number): Point => ({ x: from.x + ((dxM / wantedM) * d) / ARENA_M[0], y: from.y + ((dyM / wantedM) * d) / ARENA_M[1] });
  const others = players.filter((p) => p.slot !== ignoreSlot);
  const startInWall = isBlockedAt(grid, from);
  const touching = new Set(others.filter((p) => metres(from, p) <= contactM).map((p) => p.slot)); // déjà au contact au départ : ignorés tant qu'on ne s'en est pas éloigné

  let last = 0;
  for (let d = CLONE_STEP_M; ; d += CLONE_STEP_M) {
    const dist = Math.min(d, targetM);
    const p = at(dist);
    if (isBlockedAt(grid, p) && !(startInWall && dist <= CLONE_START_GRACE_M)) return { stop: at(last), reason: 'mur', distanceM: last, ...none };
    for (const o of others) {
      const near = metres(p, o) <= contactM;
      if (touching.has(o.slot)) {
        if (!near) touching.delete(o.slot);
      } else if (near) return { stop: p, reason: 'joueur', distanceM: dist, ...none, hitSlot: o.slot };
    }
    last = dist;
    if (dist >= targetM) return { stop: p, reason: 'portee', distanceM: dist, ...none };
  }
}

/** Où est le clone `elapsedS` secondes après son lancement : il avance à `speedMs` le long du trajet puis reste à l'arrêt. `arrived` : il a atteint son point d'arrêt. */
export function cloneAlong(from: Point, result: ClonePathResult, elapsedS: number, speedMs: number): { at: Point; arrived: boolean } {
  const traveled = Math.min(result.distanceM, Math.max(0, elapsedS) * speedMs);
  const k = result.distanceM > 0 ? traveled / result.distanceM : 1;
  return { at: { x: from.x + (result.stop.x - from.x) * k, y: from.y + (result.stop.y - from.y) * k }, arrived: traveled >= result.distanceM };
}

/** « arrêt sur un mur à 8,2 m » : la phrase du texte prérempli et de la légende. */
export function stopText(result: ClonePathResult, formatM: (m: number) => string): string {
  if (result.reason === 'mur') return `arrêt sur un mur à ${formatM(result.distanceM)}`;
  if (result.reason === 'joueur') return `arrêt sur un joueur à ${formatM(result.distanceM)}`;
  return result.capped ? `portée maximale atteinte (${formatM(result.distanceM)})` : `distance voulue atteinte (${formatM(result.distanceM)})`;
}
