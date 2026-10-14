// Visibilité à 360 degrés sur une grille de la minimap : la grille dit ce qui bloque (murs), un lancer de rayons donne le polygone vu depuis un point.
// Tout est pur (aucun navigateur) : les images du masque et des classes sont décodées ailleurs (StatsSafe) et passées ici en tableaux d'octets.
// Hypothèses de docs/PLAN_STATS_AGENTS.md section 6, en constantes ci-dessous. Même logique que tracking.sight_blocked : un pixel non praticable bloque, sauf
// les pixels « tir par-dessus », « vue seulement » et « porte vitrée » qui laissent voir (db.see_through_for).
// Une grille garde deux couches : celle des BALLES (une vitre bloque) et celle de la VUE (une vitre laisse voir). Les portes sont gérées à part (voir plus bas).

import { ARENA_M } from './pathCut.ts';
import type { RotorModel, RotorRing } from './rotors.ts';

/** Distance (mètres) à laquelle un joueur, de n'importe quelle équipe, ouvre une porte : au-delà elle est fermée (bloque la vue et les balles).
 *  2 m : les portes tracées font de 0,6 à 2,7 m (1,6 m en médiane) et, mesuré sur les traversées de portes des games 27 (Reef Point), 31 (Atlantis), 32 (Outlaw) et 29 (Ceres),
 *  les joueurs marchent vers la porte à 1,3 à 1,9 m/s : à 2 m ils arrivent dans environ 1 s (médiane à 1,1 m une seconde avant, 2,4 m deux secondes avant). Le vrai rayon du jeu n'est pas connu. */
export const DOOR_OPEN_M = 2;

/** Codes de l'image `<Carte>_classes.png` (analysis/map_annotations.py, CLASSES : 1 sol, 2 mur, 3 tir, 4 vue, 5 porte, 6 porte vitrée, 7 hors map). */
export const CLASS_CODES = { sol: 1, mur: 2, tir: 3, vue: 4, porte: 5, porte_vitre: 6, hors: 7 } as const;

/** Ce qui est testé : `balles` (une balle passe ?) ou `vue` (voit-on à travers ?). */
export type SightMode = 'balles' | 'vue';

/** Niveau d'un joueur sur une carte à deux étages (Atlantis, The Cliff), comme `user_marks.level` : `dessous` (rez-de-chaussée) ou `etage`. */
export type Level = 'etage' | 'dessous';

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

/** Les couches d'une carte : balles et vue, et les mêmes pour un joueur à l'étage (cartes à deux étages dont on a l'image « dessous »). */
export interface GridLayers {
  balles: Uint8Array;
  vue: Uint8Array;
  etage?: { balles: Uint8Array; vue: Uint8Array };
}

/** Grille de calcul : `blocked[y * w + x]` vaut 1 quand la case bloque. Chaque case couvre ARENA_M[0] / w mètres sur ARENA_M[1] / h. */
export interface BlockGrid {
  w: number;
  h: number;
  /** Couche du mode demandé à la construction (les calculs à une couche la lisent ; les calculs à deux zones lisent `layers`). */
  blocked: Uint8Array;
  /** Toutes les couches de la carte (absent d'une grille faite à la main ou déjà modifiée par des portes ou des anneaux). */
  layers?: GridLayers;
}

/** Taille d'une case en mètres. */
export const cellMetres = (g: { w: number; h: number }): [number, number] => [ARENA_M[0] / g.w, ARENA_M[1] / g.h];

/** Intervalle de pixels d'une source couvert par la case i d'une grille de n cases (au moins un pixel). */
function span(i: number, n: number, size: number): [number, number] {
  const a = Math.min(size - 1, Math.floor((i * size) / n));
  return [a, Math.max(a + 1, Math.min(size, Math.ceil(((i + 1) * size) / n)))];
}

/** Les deux couches (balles, vue) d'un masque : une case bloque si au moins BLOCK_FRACTION de ses pixels ne sont pas praticables, sauf si un pixel « tir par-dessus » la touche. */
function buildLayers(walk: GraySource, classes: GraySource | null, size: number): { balles: Uint8Array; vue: Uint8Array } {
  const balles = new Uint8Array(size * size);
  const vue = new Uint8Array(size * size);
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
      vue[j * size + i] = wall && !glass ? 1 : 0;
      balles[j * size + i] = wall || (GLASS_BLOCKS_BULLETS && glass) ? 1 : 0;
    }
  }
  return { balles, vue };
}

/** Deux couches identiques partagent le même tableau (les calculs le voient et ne lancent qu'un jeu de rayons). */
function shareEqual<T extends { balles: Uint8Array; vue: Uint8Array }>(layers: T): T {
  const { balles, vue } = layers;
  for (let i = 0; i < balles.length; i++) if (balles[i] !== vue[i]) return layers;
  return { ...layers, vue: balles };
}

/**
 * Grille de blocage d'une carte. `walk` : masque des couloirs (blanc, au-dessus de 127, = praticable). `classes` : image des classes (ou null).
 * `mode` choisit la couche lue par `blocked` ; `layers` garde les deux (balles et vue). `under` : image `<Carte>_dessous.png` des cartes à deux étages (sol praticable
 * seulement par le niveau du dessous, gardé dans le masque) : sans elle les deux niveaux sont mélangés ; avec elle, `layers.etage` donne la grille d'un joueur à l'étage,
 * où ce sol n'est pas praticable (ses traits de mur, fenêtres et tirs par-dessus gardent leur classe).
 * Une case bloque si au moins BLOCK_FRACTION de ses pixels de masque ne sont pas praticables, sauf si un pixel « tir par-dessus » la touche (fine ligne de visée,
 * elle passe toujours) ; une case aux deux tiers de vitre ou de fenêtre laisse voir (mode vue) ou bloque les balles (mode balles).
 */
export function buildGrid(walk: GraySource, classes: GraySource | null, mode: SightMode, size = DEFAULT_GRID, under: GraySource | null = null): BlockGrid {
  const layers: GridLayers = shareEqual(buildLayers(walk, classes, size));
  if (under) {
    // l'image « dessous » a la taille de l'image des classes, pas celle du masque : rééchantillonnage au plus proche
    const data = new Uint8Array(walk.w * walk.h);
    let any = false;
    for (let y = 0; y < walk.h; y++) {
      const uy = Math.min(under.h - 1, Math.floor(((y + 0.5) * under.h) / walk.h));
      for (let x = 0; x < walk.w; x++) {
        const ux = Math.min(under.w - 1, Math.floor(((x + 0.5) * under.w) / walk.w));
        if (under.data[uy * under.w + ux] > 127) any = true;
        else data[y * walk.w + x] = walk.data[y * walk.w + x] > 127 ? 255 : 0;
      }
    }
    if (any) layers.etage = shareEqual(buildLayers({ w: walk.w, h: walk.h, data }, classes, size));
  }
  return { w: size, h: size, blocked: layers[mode], layers };
}

/** Grille d'une couche (`balles` ou `vue`) pour un joueur du niveau donné : l'étage s'il existe pour cette carte, sinon la couche commune (niveau inconnu ou rez-de-chaussée). */
export function layerGrid(base: BlockGrid, kind: SightMode, level: Level | null = null): BlockGrid {
  const l = base.layers;
  if (!l) return { w: base.w, h: base.h, blocked: base.blocked };
  const src = level === 'etage' && l.etage ? l.etage : l;
  return { w: base.w, h: base.h, blocked: src[kind] };
}

/** Segment [début, fin] en fractions de la minimap. */
export type Segment = [[number, number], [number, number]];

/** Indices des cases traversées par un segment (fractions de la minimap), au pas d'un demi-case. */
function rasterSegment(grid: { w: number; h: number }, [[x0, y0], [x1, y1]]: Segment): number[] {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0) * grid.w, Math.abs(y1 - y0) * grid.h) * 2));
  const out: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const i = Math.min(grid.w - 1, Math.max(0, Math.floor((x0 + ((x1 - x0) * k) / steps) * grid.w)));
    const j = Math.min(grid.h - 1, Math.max(0, Math.floor((y0 + ((y1 - y0) * k) / steps) * grid.h)));
    out.push(j * grid.w + i);
  }
  return out;
}

/** Copie de la grille avec des portes fermées (segments en fractions de la minimap, une case d'épaisseur) : elles bloquent la vue et les balles. */
export function withClosedDoors(grid: BlockGrid, doors: Segment[]): BlockGrid {
  const blocked = grid.blocked.slice();
  for (const door of doors) for (const idx of rasterSegment(grid, door)) blocked[idx] = 1;
  return { w: grid.w, h: grid.h, blocked };
}

/**
 * Copie de la couche des balles où les portes vitrées OUVERTES laissent passer : une case voisine du segment (une case autour) qui ne bloque que par sa vitre
 * (elle bloque les balles et pas la vue) est libérée. Une porte vitrée fermée ne change rien : elle bloque les balles et laisse voir.
 */
export function withOpenedGlass(shot: BlockGrid, sight: BlockGrid, openGlassDoors: Segment[]): BlockGrid {
  if (openGlassDoors.length === 0) return shot;
  const blocked = shot.blocked.slice();
  for (const door of openGlassDoors)
    for (const idx of rasterSegment(shot, door)) {
      const cx = idx % shot.w;
      const cy = Math.floor(idx / shot.w);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const i = cx + dx;
          const j = cy + dy;
          if (i < 0 || j < 0 || i >= shot.w || j >= shot.h) continue;
          if (blocked[j * shot.w + i] && !sight.blocked[j * shot.w + i]) blocked[j * shot.w + i] = 0;
        }
    }
  return { w: shot.w, h: shot.h, blocked };
}

/** Distance en mètres d'un point (fractions de la minimap) à un segment. */
export function distanceToSegmentM(x: number, y: number, [[x0, y0], [x1, y1]]: Segment): number {
  const ax = x0 * ARENA_M[0];
  const ay = y0 * ARENA_M[1];
  const dx = x1 * ARENA_M[0] - ax;
  const dy = y1 * ARENA_M[1] - ay;
  const px = x * ARENA_M[0] - ax;
  const py = y * ARENA_M[1] - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
  return Math.hypot(px - t * dx, py - t * dy);
}

/** Pour chaque porte, vrai si un des points (joueurs vivants, toutes équipes) est à `openM` mètres ou moins : la porte est ouverte. */
export function doorsOpenedBy(doors: Segment[], points: { x: number; y: number }[], openM = DOOR_OPEN_M): boolean[] {
  return doors.map((door) => points.some((p) => distanceToSegmentM(p.x, p.y, door) <= openM));
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
  return { w: grid.w, h: grid.h, blocked };
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
 * s'arrête au premier mur ou à la portée. Si `mark` est donné (w x h octets), les cases libres vues y sont mises à 1 (aussi dans `mark2` s'il est donné : un seul jeu
 * de rayons pour deux zones identiques).
 * Un point hors de la grille est ramené dedans ; un point dans un mur est ramené à la case libre la plus proche (NUDGE_CELLS), sinon la vue est vide.
 */
export function castView(grid: BlockGrid, x: number, y: number, rangeM: number, mark?: Uint8Array, mark2?: Uint8Array): View {
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
  if (mark2) mark2[oy * w + ox] = 1;
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
      if (mark2) mark2[my * w + mx] = 1;
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
