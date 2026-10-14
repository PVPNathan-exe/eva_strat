// Visibilité à 360 degrés sur une grille de la minimap : la grille dit ce qui bloque (murs), un lancer de rayons donne le polygone vu depuis un point.
// Tout est pur (aucun navigateur) : les images du masque et des classes sont décodées ailleurs (StatsSafe) et passées ici en tableaux d'octets.
// Hypothèses de docs/PLAN_STATS_AGENTS.md section 6, en constantes ci-dessous. Même logique que tracking.sight_blocked : un pixel non praticable bloque, sauf
// les pixels « tir par-dessus », « vue seulement » et « porte vitrée » qui laissent voir (db.see_through_for).

import { ARENA_M } from './pathCut.ts';
import type { RotorModel, RotorRing } from './rotors.ts';

/** Codes de l'image `<Carte>_classes.png` (analysis/map_annotations.py, CLASSES : 1 sol, 2 mur, 3 tir, 4 vue, 5 porte, 6 porte vitrée, 7 hors map). */
export const CLASS_CODES = { sol: 1, mur: 2, tir: 3, vue: 4, porte: 5, porte_vitre: 6, hors: 7 } as const;

/** Ce qui est testé : `balles` (une balle passe ?) ou `vue` (voit-on à travers ?). */
export type SightMode = 'balles' | 'vue';

/** Tir par-dessus : laisse passer les balles et la vue (indiqué par l'utilisateur). */
export const SHOT_OVER_PASSES = true;
/** Vitres et fenêtres (classes vue et porte vitrée) : laissent voir, bloquent les balles (hypothèse à confirmer). */
export const GLASS_BLOCKS_BULLETS = true;
/** Part de pixels non praticables au-delà de laquelle une case de la grille bloque (0,5 : un trait de mur de 1 à 2 pixels sur un masque de 400 garde sa case). */
export const BLOCK_FRACTION = 0.5;
/** Côté de la grille de calcul par défaut (le masque fait 400 sur 400). */
export const DEFAULT_GRID = 200;
/** Rayons lancés par case de périmètre du cercle de portée : 1 donne au moins un rayon par case à la limite de portée. */
export const RAYS_PER_CELL = 1;
/** Nombre de rayons au plus (portée sans limite sur une grande grille). */
export const MAX_RAYS = 6000;
/** Un point de départ dans un mur est ramené à la case libre la plus proche, dans ce nombre de cases. */
export const NUDGE_CELLS = 4;

/** Image en niveaux de gris : un octet par pixel, rangée par rangée. */
export interface GraySource {
  w: number;
  h: number;
  data: ArrayLike<number>;
}

/** Grille de calcul : `blocked[y * w + x]` vaut 1 quand la case bloque. Chaque case couvre ARENA_M[0] / w mètres sur ARENA_M[1] / h. */
export interface BlockGrid {
  w: number;
  h: number;
  blocked: Uint8Array;
}

/** Taille d'une case en mètres. */
export const cellMetres = (g: { w: number; h: number }): [number, number] => [ARENA_M[0] / g.w, ARENA_M[1] / g.h];

/** Intervalle de pixels d'une source couvert par la case i d'une grille de n cases (au moins un pixel). */
function span(i: number, n: number, size: number): [number, number] {
  const a = Math.min(size - 1, Math.floor((i * size) / n));
  return [a, Math.max(a + 1, Math.min(size, Math.ceil(((i + 1) * size) / n)))];
}

/**
 * Grille de blocage d'une carte. `walk` : masque des couloirs (blanc, au-dessus de 127, = praticable). `classes` : image des classes (ou null).
 * Une case bloque si au moins BLOCK_FRACTION de ses pixels de masque ne sont pas praticables, sauf si un pixel « tir par-dessus » la touche (fine ligne de visée,
 * elle passe toujours) ; une case aux deux tiers de vitre ou de fenêtre laisse voir (mode vue) ou bloque les balles (mode balles).
 */
export function buildGrid(walk: GraySource, classes: GraySource | null, mode: SightMode, size = DEFAULT_GRID): BlockGrid {
  const blocked = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    const [wy0, wy1] = span(j, size, walk.h);
    const [cy0, cy1] = classes ? span(j, size, classes.h) : [0, 0];
    for (let i = 0; i < size; i++) {
      const [wx0, wx1] = span(i, size, walk.w);
      let open = 0;
      for (let y = wy0; y < wy1; y++) for (let x = wx0; x < wx1; x++) if (walk.data[y * walk.w + x] > 127) open++;
      const nonWalk = 1 - open / ((wy1 - wy0) * (wx1 - wx0));
      let wall = nonWalk >= BLOCK_FRACTION;
      let glass = false;
      if (classes) {
        const [cx0, cx1] = span(i, size, classes.w);
        let tir = 0;
        let panes = 0;
        for (let y = cy0; y < cy1; y++)
          for (let x = cx0; x < cx1; x++) {
            const c = classes.data[y * classes.w + x];
            if (c === CLASS_CODES.tir) tir++;
            else if (c === CLASS_CODES.vue || c === CLASS_CODES.porte_vitre) panes++;
          }
        const total = (cy1 - cy0) * (cx1 - cx0);
        if (SHOT_OVER_PASSES && tir > 0) wall = false;
        glass = panes / total >= BLOCK_FRACTION;
      }
      // vue : la vitre laisse voir ; balles : la vitre bloque même sur du sol praticable (porte vitrée)
      blocked[j * size + i] = mode === 'vue' ? (wall && !glass ? 1 : 0) : wall || (GLASS_BLOCKS_BULLETS && glass) ? 1 : 0;
    }
  }
  return { w: size, h: size, blocked };
}

/** Segment [début, fin] en fractions de la minimap. */
export type Segment = [[number, number], [number, number]];

/** Copie de la grille avec des portes fermées (segments en fractions de la minimap, une case d'épaisseur). */
export function withClosedDoors(grid: BlockGrid, doors: Segment[]): BlockGrid {
  const blocked = grid.blocked.slice();
  for (const [[x0, y0], [x1, y1]] of doors) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0) * grid.w, Math.abs(y1 - y0) * grid.h) * 2));
    for (let k = 0; k <= steps; k++) {
      const i = Math.min(grid.w - 1, Math.max(0, Math.floor((x0 + ((x1 - x0) * k) / steps) * grid.w)));
      const j = Math.min(grid.h - 1, Math.max(0, Math.floor((y0 + ((y1 - y0) * k) / steps) * grid.h)));
      blocked[j * grid.w + i] = 1;
    }
  }
  return { ...grid, blocked };
}

/** Anneau d'un modèle de rotors avec la bande graphique entière (trou_min, trou_max de map_rotors.json). */
type FullRing = RotorRing & { trou_min?: number; trou_max?: number };

/** Angle en degrés (0 à 360) de la direction du centre vers (dx, dy), dx déjà multiplié par le rapport largeur sur hauteur de la minimap. */
const angleDeg = (dx: number, dy: number) => ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;

/** Vrai si l'angle `phi` (degrés, repère de l'anneau à t_ref) est dans un intervalle [début, fin] (degrés, fin éventuellement au-delà de 360). */
const inGap = (phi: number, [a, b]: [number, number]) => ((phi - a) % 360 + 360) % 360 <= b - a;

/**
 * Anneaux tournants d'Engine à l'instant de game `t` : la bande graphique entière est un trou du masque (sol qui change). On la rend au sol, puis on y pose les arcs pleins
 * (anneau dans [r_min, r_max], hors des ouvertures, tournés de omega x (t - t_ref)). Une fenêtre laisse voir (mode vue) mais bloque les balles.
 */
export function withRotors(grid: BlockGrid, model: RotorModel, t: number, mode: SightMode): BlockGrid {
  const blocked = grid.blocked.slice();
  for (const ring of model.anneaux as FullRing[]) {
    const lo = ring.trou_min ?? ring.r_min;
    const hi = ring.trou_max ?? ring.r_max;
    const shift = ring.omega * (t - model.t_ref);
    for (let j = 0; j < grid.h; j++) {
      const dy = (j + 0.5) / grid.h - model.centre[1];
      for (let i = 0; i < grid.w; i++) {
        const dx = ((i + 0.5) / grid.w - model.centre[0]) * model.aspect;
        const r = Math.hypot(dx, dy);
        if (r < lo || r > hi) continue;
        let wall = false;
        if (r >= ring.r_min && r <= ring.r_max) {
          const phi = (((angleDeg(dx, dy) - shift) % 360) + 360) % 360;
          wall = !ring.ouvertures.some((g) => inGap(phi, g));
          if (wall && mode === 'vue' && (ring.fenetres ?? []).some(([c, half]) => Math.abs(((phi - c + 540) % 360) - 180) <= half)) wall = false;
        }
        blocked[j * grid.w + i] = wall ? 1 : 0;
      }
    }
  }
  return { ...grid, blocked };
}

/** Ce que voit un point : une distance (mètres) par rayon, le rayon i partant à l'angle 2 pi i / n (y vers le bas, comme l'image). */
export interface View {
  /** Position de départ réellement utilisée (fractions de la minimap), après avoir ramené un point tombé dans un mur. */
  x: number;
  y: number;
  rangeM: number;
  /** Distances en mètres, une par rayon ; vide si le point est enfermé dans un mur. */
  dist: Float32Array;
}

/** Case libre la plus proche de (cx, cy) dans NUDGE_CELLS cases, ou null. */
function nearestOpen(grid: BlockGrid, cx: number, cy: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let dj = -NUDGE_CELLS; dj <= NUDGE_CELLS; dj++)
    for (let di = -NUDGE_CELLS; di <= NUDGE_CELLS; di++) {
      const i = cx + di;
      const j = cy + dj;
      if (i < 0 || j < 0 || i >= grid.w || j >= grid.h || grid.blocked[j * grid.w + i]) continue;
      const d = di * di + dj * dj;
      if (d < bestD) {
        bestD = d;
        best = [i, j];
      }
    }
  return best;
}

/** Nombre de rayons pour une portée donnée. */
export function rayCount(grid: BlockGrid, rangeM: number): number {
  const [cw, ch] = cellMetres(grid);
  return Math.max(64, Math.min(MAX_RAYS, Math.ceil(((2 * Math.PI * rangeM) / Math.min(cw, ch)) * RAYS_PER_CELL)));
}

/**
 * Polygone de visibilité depuis (x, y) (fractions de la minimap) : lancer de rayons à 360 degrés dans la grille (parcours de cases, Amanatides et Woo), chaque rayon
 * s'arrête au premier mur ou à la portée. Si `mark` est donné (w x h octets), les cases libres vues y sont mises à 1.
 * Un point hors de la grille est ramené dedans ; un point dans un mur est ramené à la case libre la plus proche (NUDGE_CELLS), sinon la vue est vide.
 */
export function castView(grid: BlockGrid, x: number, y: number, rangeM: number, mark?: Uint8Array): View {
  const { w, h, blocked } = grid;
  const empty: View = { x, y, rangeM, dist: new Float32Array(0) };
  let px = Math.min(w - 1e-6, Math.max(0, x * w));
  let py = Math.min(h - 1e-6, Math.max(0, y * h));
  let ox = Math.floor(px);
  let oy = Math.floor(py);
  if (blocked[oy * w + ox]) {
    const open = nearestOpen(grid, ox, oy);
    if (!open) return empty;
    [ox, oy] = open;
    px = ox + 0.5;
    py = oy + 0.5;
  }
  const [cw, ch] = cellMetres(grid);
  const n = rayCount(grid, rangeM);
  const dist = new Float32Array(n);
  if (mark) mark[oy * w + ox] = 1;
  for (let r = 0; r < n; r++) {
    const a = (2 * Math.PI * r) / n;
    const vx = Math.cos(a) / cw; // cases par mètre
    const vy = Math.sin(a) / ch;
    const stepX = vx > 0 ? 1 : -1;
    const stepY = vy > 0 ? 1 : -1;
    const deltaX = vx === 0 ? Infinity : 1 / Math.abs(vx); // mètres pour traverser une case
    const deltaY = vy === 0 ? Infinity : 1 / Math.abs(vy);
    let tx = vx === 0 ? Infinity : (vx > 0 ? ox + 1 - px : px - ox) * deltaX;
    let ty = vy === 0 ? Infinity : (vy > 0 ? oy + 1 - py : py - oy) * deltaY;
    let mx = ox;
    let my = oy;
    let reached = rangeM;
    for (;;) {
      let t: number;
      if (tx < ty) {
        t = tx;
        tx += deltaX;
        mx += stepX;
      } else {
        t = ty;
        ty += deltaY;
        my += stepY;
      }
      if (t >= rangeM) break;
      if (mx < 0 || my < 0 || mx >= w || my >= h || blocked[my * w + mx]) {
        reached = t;
        break;
      }
      if (mark) mark[my * w + mx] = 1;
    }
    dist[r] = reached;
  }
  return { x: px / w, y: py / h, rangeM, dist };
}

/** Sommets du polygone d'une vue (fractions de la minimap), au plus `maxVertices` (un rayon sur k). Vide si la vue est vide. */
export function viewPolygon(view: View, maxVertices = 720): [number, number][] {
  const n = view.dist.length;
  if (n === 0) return [];
  const stride = Math.max(1, Math.ceil(n / maxVertices));
  const out: [number, number][] = [];
  for (let r = 0; r < n; r += stride) {
    const a = (2 * Math.PI * r) / n;
    out.push([view.x + (view.dist[r] * Math.cos(a)) / ARENA_M[0], view.y + (view.dist[r] * Math.sin(a)) / ARENA_M[1]]);
  }
  return out;
}
