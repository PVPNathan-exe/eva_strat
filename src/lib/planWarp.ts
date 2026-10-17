// Alignement par sections de la minimap du jeu sur le plan stratégique (cartes dont les deux ne sont pas homothétiques : Artefact).
// Le maillage vient de analysis/map_warp.json (repères minimap et plan, triangles, calculé par analysis/map_warp.py) : transformation affine par triangle
// (coordonnées barycentriques) dans les deux sens, tracé d'une image de la minimap déformée vers le plan, et les fonctions `projectInset` / `unprojectInset`
// qui choisissent entre le maillage et le cadre affine de planInsets.ts. Fonctions pures (tests/planWarp.test.ts) : les données se branchent par `registerWarps`
// (fait par planInsets.ts, seul à lire le JSON), pour que node puisse charger ce fichier sans attribut d'import.
// Même règle hors maillage que analysis/map_warp.py `to_plan` : triangle le plus proche prolongé à moins de EXTRAPOLATE_MARGIN, sinon affine global.

import type { Inset } from './planInsets.ts';

export type Pt = [number, number];

export interface WarpPoint {
  mini: Pt;
  plan: Pt;
}

/** Entrée d'une carte de map_warp.json : repères (fractions de la minimap et du plan) et triangles (indices de repères). */
export interface WarpEntry {
  plan_size: Pt;
  mini_size: Pt;
  points: WarpPoint[];
  triangles: [number, number, number][];
}

/** Au-delà de cette distance (fraction de l'image) du maillage, on revient à l'affine global. */
export const EXTRAPOLATE_MARGIN = 0.08;

type Space = 'mini' | 'plan';

interface Tri {
  /** Sommets dans chaque espace. */
  v: Record<Space, [Pt, Pt, Pt]>;
  /** Inverse de la matrice [[x1 - x3, x2 - x3], [y1 - y3, y2 - y3]] par espace (null : triangle plat). */
  inv: Record<Space, [number, number, number, number] | null>;
  box: Record<Space, [number, number, number, number]>;
}

interface Warp {
  entry: WarpEntry;
  tris: Tri[];
  grid: Record<Space, number[][]>;
  /** Affine global minimap vers plan et son inverse : [a, b, c, d, e, f] avec x' = a x + b y + c, y' = d x + e y + f. */
  affine: Record<Space, [number, number, number, number, number, number]>;
}

const GRID = 24;
const warps = new Map<string, WarpEntry>();
const built = new Map<string, Warp>();

/** Branche les maillages (contenu de map_warp.json). Remplace les précédents. */
export function registerWarps(data: Record<string, WarpEntry>): void {
  warps.clear();
  built.clear();
  for (const [map, entry] of Object.entries(data)) warps.set(map, entry);
}

/** Vrai si la carte a un maillage minimap vers plan. */
export const hasWarp = (map: string | null | undefined): boolean => !!map && warps.has(map);

/** Moindres carrés d'une affine pt -> pt' (3 inconnues par axe, équations normales). */
function leastSquaresAffine(src: Pt[], dst: Pt[]): [number, number, number, number, number, number] {
  const n = src.length;
  let sxx = 0, sxy = 0, sx = 0, syy = 0, sy = 0;
  let bx0 = 0, bx1 = 0, bx2 = 0, by0 = 0, by1 = 0, by2 = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    sxx += x * x; sxy += x * y; sx += x; syy += y * y; sy += y;
    bx0 += x * u; bx1 += y * u; bx2 += u;
    by0 += x * v; by1 += y * v; by2 += v;
  }
  const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const solve = (b: number[]): number[] => {
    // règle de Cramer (matrice 3 x 3 symétrique)
    const det = (a: number[][]) => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
    const d = det(m);
    return [0, 1, 2].map((c) => det(m.map((row, r) => row.map((val, k) => (k === c ? b[r] : val)))) / d);
  };
  const [a, b, c] = solve([bx0, bx1, bx2]);
  const [d, e, f] = solve([by0, by1, by2]);
  return [a, b, c, d, e, f];
}

function invertAffine([a, b, c, d, e, f]: [number, number, number, number, number, number]): [number, number, number, number, number, number] {
  const det = a * e - b * d;
  return [e / det, -b / det, (b * f - c * e) / det, -d / det, a / det, (c * d - a * f) / det];
}

function buildWarp(entry: WarpEntry): Warp {
  const tris: Tri[] = entry.triangles.map(([i, j, k]) => {
    const mk = (s: Space): [Pt, Pt, Pt] => [entry.points[i][s], entry.points[j][s], entry.points[k][s]];
    const v = { mini: mk('mini'), plan: mk('plan') };
    const inv = {} as Tri['inv'];
    const box = {} as Tri['box'];
    for (const s of ['mini', 'plan'] as const) {
      const [a, b, c] = v[s];
      const d = (a[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (a[1] - c[1]); // déterminant de [[x1 - x3, x2 - x3], [y1 - y3, y2 - y3]]
      inv[s] = Math.abs(d) < 1e-12 ? null : [(b[1] - c[1]) / d, -(b[0] - c[0]) / d, -(a[1] - c[1]) / d, (a[0] - c[0]) / d];
      box[s] = [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1])];
    }
    return { v, inv, box };
  });
  const grid = { mini: Array.from({ length: GRID * GRID }, () => [] as number[]), plan: Array.from({ length: GRID * GRID }, () => [] as number[]) };
  const cell = (t: number) => Math.min(GRID - 1, Math.max(0, Math.floor(t * GRID)));
  tris.forEach((t, n) => {
    for (const s of ['mini', 'plan'] as const) {
      const [x0, y0, x1, y1] = t.box[s];
      for (let cy = cell(y0); cy <= cell(y1); cy++) for (let cx = cell(x0); cx <= cell(x1); cx++) grid[s][cy * GRID + cx].push(n);
    }
  });
  const mini = entry.points.map((p) => p.mini);
  const plan = entry.points.map((p) => p.plan);
  const toPlan = leastSquaresAffine(mini, plan);
  return { entry, tris, grid, affine: { mini: toPlan, plan: invertAffine(toPlan) } };
}

function warpOf(map: string): Warp | null {
  let w = built.get(map);
  if (!w) {
    const entry = warps.get(map);
    if (!entry) return null;
    w = buildWarp(entry);
    built.set(map, w);
  }
  return w;
}

/** Coordonnées barycentriques (u, v, w) d'un point dans un triangle, ou null si le triangle est plat. */
function barycentric(t: Tri, s: Space, x: number, y: number): [number, number, number] | null {
  const m = t.inv[s];
  if (!m) return null;
  const c = t.v[s][2];
  const dx = x - c[0];
  const dy = y - c[1];
  const u = m[0] * dx + m[1] * dy;
  const v = m[2] * dx + m[3] * dy;
  return [u, v, 1 - u - v];
}

/** Distance (fraction de l'image) d'un point au bord du triangle le plus proche. */
function edgeDistance(t: Tri, s: Space, x: number, y: number): number {
  const [a, b, c] = t.v[s];
  let best = Infinity;
  for (const [p, q] of [[a, b], [b, c], [c, a]] as [Pt, Pt][]) {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = dx * dx + dy * dy;
    const k = len > 0 ? Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(x - (p[0] + k * dx), y - (p[1] + k * dy)));
  }
  return best;
}

function transform(map: string, from: Space, x: number, y: number): Pt {
  const w = warpOf(map);
  if (!w) return [x, y];
  const to: Space = from === 'mini' ? 'plan' : 'mini';
  const apply = (t: Tri, b: [number, number, number]): Pt => [b[0] * t.v[to][0][0] + b[1] * t.v[to][1][0] + b[2] * t.v[to][2][0], b[0] * t.v[to][0][1] + b[1] * t.v[to][1][1] + b[2] * t.v[to][2][1]];
  const cx = Math.min(GRID - 1, Math.max(0, Math.floor(x * GRID)));
  const cy = Math.min(GRID - 1, Math.max(0, Math.floor(y * GRID)));
  const inGrid = x >= 0 && x <= 1 && y >= 0 && y <= 1;
  if (inGrid) {
    for (const n of w.grid[from][cy * GRID + cx]) {
      const t = w.tris[n];
      const b = barycentric(t, from, x, y);
      if (b && Math.min(b[0], b[1], b[2]) >= -1e-9) return apply(t, b);
    }
  }
  // hors maillage : triangle le plus proche prolongé (à moins de la marge), sinon affine global
  let best: Tri | null = null;
  let bestB: [number, number, number] | null = null;
  let bestMin = -Infinity;
  for (const t of w.tris) {
    const b = barycentric(t, from, x, y);
    if (!b) continue;
    const m = Math.min(b[0], b[1], b[2]);
    if (m >= -1e-9) return apply(t, b);
    if (m > bestMin) { best = t; bestB = b; bestMin = m; }
  }
  if (best && bestB && edgeDistance(best, from, x, y) <= EXTRAPOLATE_MARGIN) return apply(best, bestB);
  const [a, b, c, d, e, f] = w.affine[from];
  return [a * x + b * y + c, d * x + e * y + f];
}

/** Position de la minimap (fractions 0 à 1) vers le plan (fractions de l'image). Carte sans maillage : identité (appeler hasWarp avant). */
export function warpToPlan(map: string, x: number, y: number): { x: number; y: number } {
  const [px, py] = transform(map, 'mini', x, y);
  return { x: px, y: py };
}

/** Position du plan (fractions de l'image) vers la minimap (fractions 0 à 1), non bornée. */
export function warpToMinimap(map: string, fx: number, fy: number): { x: number; y: number } {
  const [x, y] = transform(map, 'plan', fx, fy);
  return { x, y };
}

/** Échelle locale (fraction du plan par fraction de la minimap, selon x puis selon y) au point de la minimap : longueur de l'image du vecteur unité de chaque axe. */
export function localScale(map: string, x: number, y: number): { sx: number; sy: number } {
  const h = 0.01;
  const a = warpToPlan(map, x - h, y);
  const b = warpToPlan(map, x + h, y);
  const c = warpToPlan(map, x, y - h);
  const d = warpToPlan(map, x, y + h);
  return { sx: Math.hypot(b.x - a.x, b.y - a.y) / (2 * h), sy: Math.hypot(d.x - c.x, d.y - c.y) / (2 * h) };
}

/** Triangles du maillage de la carte (sommets en fractions de la minimap et du plan), pour tracer une image déformée ; [] sans maillage. */
export function warpTriangles(map: string): { src: [Pt, Pt, Pt]; dst: [Pt, Pt, Pt] }[] {
  const w = warpOf(map);
  return w ? w.tris.map((t) => ({ src: t.v.mini, dst: t.v.plan })) : [];
}

/** Dimensions du plan en pixels (image d'origine) pour une carte avec maillage. */
export const planSizeOf = (map: string): Pt | null => warps.get(map)?.plan_size ?? null;

/** Matrice [a, b, c, d, e, f] (x' = a x + b y + c, y' = d x + e y + f) qui envoie les trois points `src` sur `dst`. */
export function triangleAffine(src: [Pt, Pt, Pt], dst: [Pt, Pt, Pt]): [number, number, number, number, number, number] {
  const [[x1, y1], [x2, y2], [x3, y3]] = src;
  const det = x1 * (y2 - y3) - y1 * (x2 - x3) + (x2 * y3 - x3 * y2);
  const solve = (u1: number, u2: number, u3: number): [number, number, number] => [
    (u1 * (y2 - y3) + u2 * (y3 - y1) + u3 * (y1 - y2)) / det,
    (u1 * (x3 - x2) + u2 * (x1 - x3) + u3 * (x2 - x1)) / det,
    (u1 * (x2 * y3 - x3 * y2) + u2 * (x3 * y1 - x1 * y3) + u3 * (x1 * y2 - x2 * y1)) / det,
  ];
  const [a, b, c] = solve(dst[0][0], dst[1][0], dst[2][0]);
  const [d, e, f] = solve(dst[0][1], dst[1][1], dst[2][1]);
  return [a, b, c, d, e, f];
}

/** Triangle repoussé de `by` (même unité que les points) hors de son centre : recouvre les coutures entre triangles voisins quand on les peint un à un. */
export function growTriangle(tri: [Pt, Pt, Pt], by: number): [Pt, Pt, Pt] {
  const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
  const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
  return tri.map(([x, y]) => {
    const d = Math.hypot(x - cx, y - cy) || 1;
    return [x + ((x - cx) / d) * by, y + ((y - cy) / d) * by] as Pt;
  }) as [Pt, Pt, Pt];
}

// ---------------------------------------------------------------- cadre affine ou maillage

/** Cadre d'une carte : un cadre affine (l, t, r, b) et, si la carte a un maillage, son nom (le maillage prime). */
export type FrameInset = Inset;

/** Position de la minimap (0 à 1) vers un pourcentage de l'image du plan : par le maillage si le cadre en porte un, sinon par le cadre affine. */
export function projectInset(inset: Inset, x: number, y: number): { x: number; y: number } {
  if (inset.warp && hasWarp(inset.warp)) {
    const p = warpToPlan(inset.warp, x, y);
    return { x: p.x * 100, y: p.y * 100 };
  }
  return { x: (inset.l + x * (1 - inset.l - inset.r)) * 100, y: (inset.t + y * (1 - inset.t - inset.b)) * 100 };
}

/** Inverse de projectInset : fraction du plan (0 à 1) vers la position de la minimap (non bornée). */
export function unprojectInset(inset: Inset, fx: number, fy: number): { x: number; y: number } {
  if (inset.warp && hasWarp(inset.warp)) return warpToMinimap(inset.warp, fx, fy);
  return { x: (fx - inset.l) / (1 - inset.l - inset.r), y: (fy - inset.t) / (1 - inset.t - inset.b) };
}

/** Vrai si le cadre passe par un maillage (les couches en pixels doivent alors être tracées déformées, pas étirées). */
export const isWarped = (inset: Inset): boolean => !!inset.warp && hasWarp(inset.warp);

/** Position et taille (pourcentages de l'image du plan) du rectangle où se pose une couche exprimée en fractions de la minimap : le cadre affine, ou tout le plan quand la couche est déjà tracée dans le plan (maillage). */
export function frameBox(inset: Inset): { left: string; top: string; width: string; height: string } {
  if (isWarped(inset)) return { left: '0%', top: '0%', width: '100%', height: '100%' };
  return { left: `${inset.l * 100}%`, top: `${inset.t * 100}%`, width: `${(1 - inset.l - inset.r) * 100}%`, height: `${(1 - inset.t - inset.b) * 100}%` };
}

/** Points d'une ligne brisée de la minimap, projetés, avec des points intermédiaires tous les `step` (fraction de la minimap) quand la carte a un maillage (une ligne droite devient courbe), sinon sommets seuls. */
export function projectPath(inset: Inset, pts: Pt[], step = 0.02): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const warped = isWarped(inset);
  pts.forEach((p, i) => {
    if (warped && i > 0) {
      const q = pts[i - 1];
      const n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / step));
      for (let k = 1; k < n; k++) out.push(projectInset(inset, q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n));
    }
    out.push(projectInset(inset, p[0], p[1]));
  });
  return out;
}

/** Rayon en mètres vers les demi-axes d'une ellipse en pourcentages de l'image du plan : échelle du cadre affine, ou échelle locale du maillage au point `at` (centre de la minimap sans point). */
export function radiusPercent(inset: Inset, metresRadius: number, arena: Pt, at?: { x: number; y: number }): { rx: number; ry: number } {
  if (isWarped(inset)) {
    const { sx, sy } = localScale(inset.warp!, at?.x ?? 0.5, at?.y ?? 0.5);
    return { rx: (metresRadius / arena[0]) * sx * 100, ry: (metresRadius / arena[1]) * sy * 100 };
  }
  return { rx: (metresRadius / arena[0]) * (1 - inset.l - inset.r) * 100, ry: (metresRadius / arena[1]) * (1 - inset.t - inset.b) * 100 };
}
