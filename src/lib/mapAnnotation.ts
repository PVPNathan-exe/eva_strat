// Cartographie à la main d'une carte : types de l'annotation (même format que analysis/map_annotations.py), classement des pixels par couleur et calcul de l'alignement sur le plan.
// Fonctions pures, sans navigateur, pour pouvoir les tester.

import type { Inset } from './planInsets';

export type ClassName = 'sol' | 'mur' | 'tir' | 'vue' | 'tp' | 'porte' | 'porte_vitre';
export type Team = 'A' | 'B';
export type Point = [number, number]; // fractions de l'image (0 à 1)
export type Rect = [number, number, number, number]; // x0, y0, x1, y1

export interface PickedColor {
  rgb: [number, number, number];
  tol: number; // distance maximale dans RGB
  cls: ClassName;
}
export interface Segment {
  from: Point;
  to: Point;
}
export interface Door extends Segment {
  glass: boolean;
}
export interface LandmarkPair {
  minimap: Point;
  plan: Point;
}
export interface MapAnnotation {
  colors: PickedColor[];
  tps: Segment[];
  doors: Door[];
  spawns: Record<Team, Rect[]>;
  pairs: LandmarkPair[];
  inset: Inset | null;
}

export const MAX_SPAWNS_PER_TEAM = 2;
export const DEFAULT_TOLERANCE = 10;
export const MAX_TOLERANCE = 120;

/** Classes de couleur : code enregistré dans l'image de classes (comme CODES de map_annotations.py), libellé, aide et couleur de l'aperçu. */
export const CLASS_INFO: { name: ClassName; label: string; help: string; preview: [number, number, number] }[] = [
  { name: 'sol', label: 'Sol', help: 'zone praticable', preview: [53, 224, 122] },
  { name: 'mur', label: 'Mur', help: 'ni passage, ni vue, ni tir', preview: [255, 59, 59] },
  { name: 'tir', label: 'Tir par-dessus', help: 'on tire au-dessus mais on ne passe pas', preview: [255, 159, 28] },
  { name: 'vue', label: 'Vue seulement', help: 'on voit à travers : ni tir, ni passage', preview: [61, 139, 255] },
  { name: 'tp', label: 'Chemin de tyrolienne', help: 'ignoré : ce n\'est pas un mur', preview: [190, 120, 255] },
  { name: 'porte', label: 'Porte (hachures)', help: 'on la traverse', preview: [255, 214, 10] },
  { name: 'porte_vitre', label: 'Porte vitrée', help: 'on la traverse et on voit à travers', preview: [90, 220, 235] },
];

export const classCode = (name: ClassName) => CLASS_INFO.findIndex((c) => c.name === name) + 1; // 0 : aucune classe

export const emptyAnnotation = (): MapAnnotation => ({ colors: [], tps: [], doors: [], spawns: { A: [], B: [] }, pairs: [], inset: null });

const isPoint = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && v >= 0 && v <= 1);
const isRect = (r: unknown): r is Rect => Array.isArray(r) && r.length === 4 && r.every((v) => typeof v === 'number' && v >= 0 && v <= 1) && r[0] < r[2] && r[1] < r[3];

/** Annotation lue du serveur, débarrassée de tout ce qui est invalide (une version plus ancienne ou abîmée ne doit pas faire planter l'outil). */
export function sanitize(raw: unknown): MapAnnotation {
  const out = emptyAnnotation();
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const names = new Set<string>(CLASS_INFO.map((c) => c.name));
  for (const c of Array.isArray(r.colors) ? r.colors : []) {
    const rgb = (c as PickedColor)?.rgb;
    if (Array.isArray(rgb) && rgb.length === 3 && rgb.every((v) => Number.isInteger(v) && v >= 0 && v <= 255) && names.has((c as PickedColor).cls)) {
      out.colors.push({ rgb: rgb as PickedColor['rgb'], tol: clampTolerance((c as PickedColor).tol), cls: (c as PickedColor).cls });
    }
  }
  for (const t of Array.isArray(r.tps) ? r.tps : []) if (isPoint(t?.from) && isPoint(t?.to)) out.tps.push({ from: t.from, to: t.to });
  for (const d of Array.isArray(r.doors) ? r.doors : []) if (isPoint(d?.from) && isPoint(d?.to)) out.doors.push({ from: d.from, to: d.to, glass: Boolean(d.glass) });
  const sp = (r.spawns ?? {}) as Record<string, unknown>;
  for (const team of ['A', 'B'] as const) out.spawns[team] = (Array.isArray(sp[team]) ? (sp[team] as unknown[]) : []).filter(isRect).slice(0, MAX_SPAWNS_PER_TEAM);
  for (const p of Array.isArray(r.pairs) ? r.pairs : []) if (isPoint(p?.minimap) && isPoint(p?.plan)) out.pairs.push({ minimap: p.minimap, plan: p.plan });
  const i = r.inset as Inset | null | undefined;
  if (i && ['l', 't', 'r', 'b'].every((k) => typeof (i as unknown as Record<string, unknown>)[k] === 'number')) out.inset = { l: i.l, t: i.t, r: i.r, b: i.b };
  return out;
}

export const hex = (rgb: number[]) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Couleur exacte d'un pixel d'une image (RVB). */
export function pixelColor(image: { data: ArrayLike<number>; width: number }, x: number, y: number): [number, number, number] {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2]];
}

export const clampTolerance = (tol: unknown) => Math.max(0, Math.min(Number.isFinite(Number(tol)) ? Math.round(Number(tol)) : DEFAULT_TOLERANCE, MAX_TOLERANCE));

/** Ajoute une couleur, ou change la classe de la même couleur si elle est déjà dans la liste. */
export function upsertColor(colors: PickedColor[], rgb: PickedColor['rgb'], cls: ClassName): PickedColor[] {
  const i = colors.findIndex((c) => c.rgb[0] === rgb[0] && c.rgb[1] === rgb[1] && c.rgb[2] === rgb[2]);
  if (i < 0) return [...colors, { rgb, tol: DEFAULT_TOLERANCE, cls }];
  return colors.map((c, j) => (j === i ? { ...c, cls } : c));
}

/** Classe (code 1 et plus) de chaque pixel d'une image RGBA : couleur choisie la plus proche, à moins de sa tolérance ; 0 si aucune. Même règle que classify() de map_annotations.py. */
export function classifyImage(rgba: Uint8ClampedArray, colors: PickedColor[]): Uint8Array {
  const n = rgba.length / 4;
  const labels = new Uint8Array(n);
  const best = new Float64Array(n).fill(Infinity);
  for (const c of colors) {
    const code = classCode(c.cls);
    const limit = c.tol * c.tol;
    for (let p = 0; p < n; p++) {
      const dr = rgba[p * 4] - c.rgb[0];
      const dg = rgba[p * 4 + 1] - c.rgb[1];
      const db = rgba[p * 4 + 2] - c.rgb[2];
      const d = dr * dr + dg * dg + db * db;
      if (d <= limit && d < best[p]) {
        best[p] = d;
        labels[p] = code;
      }
    }
  }
  return labels;
}

/** Rectangle normalisé (coins dans l'ordre) à partir de deux points du glisser ; null s'il est trop petit pour être voulu. */
export function rectFrom(a: Point, b: Point, minSide = 0.01): Rect | null {
  const r: Rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  return r[2] - r[0] < minSide || r[3] - r[1] < minSide ? null : r;
}

/** Ajoute une zone de départ à une équipe ; null si elle en a déjà MAX_SPAWNS_PER_TEAM. */
export function addSpawn(spawns: Record<Team, Rect[]>, team: Team, rect: Rect): Record<Team, Rect[]> | null {
  if (spawns[team].length >= MAX_SPAWNS_PER_TEAM) return null;
  return { ...spawns, [team]: [...spawns[team], rect] };
}

const MIN_SPREAD = 0.05; // écart minimal des repères sur un axe pour en tirer une échelle

/** Régression affine sur un axe : plan = a * minimap + b. */
function fitAxis(xs: number[], ys: number[]): { a: number; b: number } | null {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  const sxx = xs.reduce((s, v) => s + (v - mx) ** 2, 0);
  if (Math.sqrt(sxx / n) < MIN_SPREAD / 2) return null;
  const sxy = xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - my), 0);
  const a = sxy / sxx;
  return { a, b: my - a * mx };
}

/**
 * Cadre de la minimap sur le plan (même modèle que planInsets.ts : échelle et décalage par axe) tiré de repères (point de la minimap, même point sur le plan).
 * Il faut au moins 2 repères écartés sur chaque axe ; renvoie null sinon, ou si le cadre n'a pas de sens (bords inversés).
 */
export function solveAlignment(pairs: LandmarkPair[]): Inset | null {
  if (pairs.length < 2) return null;
  const fx = fitAxis(pairs.map((p) => p.minimap[0]), pairs.map((p) => p.plan[0]));
  const fy = fitAxis(pairs.map((p) => p.minimap[1]), pairs.map((p) => p.plan[1]));
  if (!fx || !fy || fx.a <= 0 || fy.a <= 0) return null;
  const inset = { l: fx.b, t: fy.b, r: 1 - fx.a - fx.b, b: 1 - fy.a - fy.b };
  return inset.l + inset.r < 0.9 && inset.t + inset.b < 0.9 ? inset : null;
}

/** Écart moyen (en fraction du plan) entre les repères posés et ceux que le cadre calculé prédit : mesure la cohérence des repères. */
export function alignmentError(pairs: LandmarkPair[], inset: Inset): number {
  if (pairs.length === 0) return 0;
  const total = pairs.reduce((s, p) => {
    const x = inset.l + p.minimap[0] * (1 - inset.l - inset.r);
    const y = inset.t + p.minimap[1] * (1 - inset.t - inset.b);
    return s + Math.hypot(x - p.plan[0], y - p.plan[1]);
  }, 0);
  return total / pairs.length;
}
