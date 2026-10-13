// Cartographie à la main d'une carte : types de l'annotation (même format que analysis/map_annotations.py), classement des pixels par couleur et calcul de l'alignement sur le plan.
// Fonctions pures, sans navigateur, pour pouvoir les tester.

import type { Inset } from './planInsets';

export type ClassName = 'sol' | 'mur' | 'tir' | 'vue' | 'porte' | 'porte_vitre';
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
/** Station de tyrolienne : un cercle (centre, rayon en fraction de la largeur) et la direction par laquelle on y entre ou on en sort (degrés, 0 = droite, 90 = bas ; null = aucune). */
export interface Station {
  x: number;
  y: number;
  r: number;
  angle: number | null;
}
/** Une tyrolienne : deux stations, valable dans les deux sens. */
export interface TeleportPair {
  a: Station;
  b: Station;
}
export type OpeningKind = 'porte' | 'fenetre' | 'mur' | 'tir';
/**
 * Porte, fenêtre ou mur tracé en trait. Une porte se traverse (vitrée ou non : on voit à travers) ; une fenêtre ne se traverse pas et ne se tire pas : on voit seulement à travers ;
 * un mur ne se traverse pas (par exemple un mur dans un carré de capture) ; un trait « tir » ne se traverse pas non plus mais on tire par-dessus.
 * side : 0 = visible des deux côtés ; 1 ou -1 = sens unique, on ne voit à travers que depuis le côté où le produit vectoriel (to - from) x (point - from) a ce signe
 * (axes de l'image, y vers le bas).
 */
export interface Opening extends Segment {
  kind: OpeningKind;
  glass: boolean;
  side: -1 | 0 | 1;
}
export interface LandmarkPair {
  minimap: Point;
  plan: Point;
}
/** Zone où une classe de couleur est remplacée par une autre : une même couleur peut désigner une fenêtre ici et une couverture basse ailleurs. from : classe remplacée, ou 'any' (tout pixel de la zone). */
export interface ClassOverride {
  polygon: Point[];
  from: ClassName | 'any';
  to: ClassName;
}
export interface MapAnnotation {
  colors: PickedColor[];
  tps: TeleportPair[];
  doors: Opening[];
  spawns: Record<Team, Rect[]>;
  overrides: ClassOverride[];
  usePlan: boolean; // recouper le masque avec le plan stratégique à l'application (analysis/plan_mask.py)
  capture: Point[][]; // zones des points de capture (forme libre, au moins 3 points) : zones jouables
  pairs: LandmarkPair[];
  inset: Inset | null;
}

export const MAX_SPAWNS_PER_TEAM = 2;
export const MAX_CAPTURE_ZONES = 8;
export const MAX_OVERRIDES = 40;
export const MAX_POLYGON_POINTS = 80;
export const MIN_POLYGON_POINTS = 3;
const CLOSE_DISTANCE = 0.02; // un clic à cette distance du premier point ferme la forme (fraction de la largeur)
export const DEFAULT_STATION_RADIUS = 0.02;
export const MAX_STATION_RADIUS = 0.2;
export const DEFAULT_TOLERANCE = 10;
export const MAX_TOLERANCE = 120;

/** Classes de couleur : code enregistré dans l'image de classes (comme CODES de map_annotations.py), libellé, aide et couleur de l'aperçu. */
export const CLASS_INFO: { name: ClassName; label: string; help: string; preview: [number, number, number] }[] = [
  { name: 'sol', label: 'Sol', help: 'zone praticable', preview: [53, 224, 122] },
  { name: 'mur', label: 'Mur', help: 'ni passage, ni vue, ni tir', preview: [255, 59, 59] },
  { name: 'tir', label: 'Tir par-dessus', help: 'on tire au-dessus mais on ne passe pas', preview: [255, 159, 28] },
  { name: 'vue', label: 'Vue seulement', help: 'on voit à travers : ni tir, ni passage', preview: [61, 139, 255] },
  { name: 'porte', label: 'Porte (hachures)', help: 'on la traverse', preview: [255, 214, 10] },
  { name: 'porte_vitre', label: 'Porte vitrée', help: 'on la traverse et on voit à travers', preview: [90, 220, 235] },
];

export const classCode = (name: ClassName) => CLASS_INFO.findIndex((c) => c.name === name) + 1; // 0 : aucune classe

export const emptyAnnotation = (): MapAnnotation => ({ colors: [], tps: [], doors: [], spawns: { A: [], B: [] }, capture: [], overrides: [], usePlan: false, pairs: [], inset: null });

const isPoint = (p: unknown): p is Point => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === 'number' && v >= 0 && v <= 1);
const isRect = (r: unknown): r is Rect => Array.isArray(r) && r.length === 4 && r.every((v) => typeof v === 'number' && v >= 0 && v <= 1) && r[0] < r[2] && r[1] < r[3];

const readStation = (s: unknown): Station | null => {
  const v = s as Station | undefined;
  if (!v || ![v.x, v.y, v.r].every((n) => typeof n === 'number') || v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1 || v.r <= 0 || v.r > MAX_STATION_RADIUS) return null;
  return { x: v.x, y: v.y, r: v.r, angle: typeof v.angle === 'number' ? ((v.angle % 360) + 360) % 360 : null };
};

/** Tyrolienne lue du serveur : deux stations, ou une ancienne flèche {from, to} (stations sans direction, rayon par défaut). */
function readPair(t: unknown): TeleportPair | null {
  const v = t as { a?: unknown; b?: unknown; from?: unknown; to?: unknown } | undefined;
  if (v?.a) {
    const a = readStation(v.a);
    const b = readStation(v.b);
    return a && b ? balancePair({ a, b }) : null;
  }
  if (isPoint(v?.from) && isPoint(v?.to)) {
    return { a: { x: v.from[0], y: v.from[1], r: DEFAULT_STATION_RADIUS, angle: null }, b: { x: v.to[0], y: v.to[1], r: DEFAULT_STATION_RADIUS, angle: null } };
  }
  return null;
}

/** Les 4 coins d'un rectangle, dans l'ordre. */
export const polygonFromRect = (r: Rect): Point[] => [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]];

const readPolygon = (z: unknown): Point[] | null =>
  Array.isArray(z) && z.length >= MIN_POLYGON_POINTS && z.length <= MAX_POLYGON_POINTS && z.every(isPoint) ? (z as Point[]).map((p) => [p[0], p[1]] as Point) : null;

/** Vrai si le clic `p` est assez près du premier point de la forme pour la fermer (la forme a déjà au moins 3 points). */
export function closesPolygon(points: Point[], p: Point, aspect: number): boolean {
  if (points.length < MIN_POLYGON_POINTS) return false;
  return Math.hypot(p[0] - points[0][0], (p[1] - points[0][1]) / aspect) <= CLOSE_DISTANCE;
}

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
  for (const t of Array.isArray(r.tps) ? r.tps : []) {
    const pair = readPair(t);
    if (pair) out.tps.push(pair);
  }
  for (const d of Array.isArray(r.doors) ? r.doors : []) {
    if (!isPoint(d?.from) || !isPoint(d?.to)) continue;
    const kind: OpeningKind = d.kind === 'fenetre' || d.kind === 'mur' || d.kind === 'tir' ? d.kind : 'porte';
    out.doors.push({ from: d.from, to: d.to, kind, glass: kind === 'porte' && Boolean(d.glass), side: (kind === 'fenetre' || (kind === 'porte' && d.glass)) && (d.side === 1 || d.side === -1) ? d.side : 0 });
  }
  const sp = (r.spawns ?? {}) as Record<string, unknown>;
  for (const team of ['A', 'B'] as const) out.spawns[team] = (Array.isArray(sp[team]) ? (sp[team] as unknown[]) : []).filter(isRect).slice(0, MAX_SPAWNS_PER_TEAM);
  for (const z of Array.isArray(r.capture) ? (r.capture as unknown[]) : []) {
    const polygon = isRect(z) ? polygonFromRect(z) : readPolygon(z);
    if (polygon && out.capture.length < MAX_CAPTURE_ZONES) out.capture.push(polygon);
  }
  for (const o of Array.isArray(r.overrides) ? (r.overrides as ClassOverride[]) : []) {
    const polygon = readPolygon(o?.polygon);
    if (polygon && (o.from === 'any' || names.has(o.from)) && names.has(o.to) && out.overrides.length < MAX_OVERRIDES) out.overrides.push({ polygon, from: o.from, to: o.to });
  }
  out.usePlan = r.usePlan === true;
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

/** Direction opposée (180 degrés d'écart), entre 0 et 360. */
export const oppositeAngle = (angle: number) => (angle + 180) % 360;

/**
 * Tyrolienne à partir de ses deux stations, avec la règle des 180 degrés : les directions des deux stations sont opposées. Si l'une des deux est donnée, l'autre s'en déduit
 * (la première est prioritaire) ; si aucune n'est donnée, la paire n'a pas de direction.
 */
export function completePair(a: Station, b: Station): TeleportPair {
  if (a.angle !== null) return { a, b: { ...b, angle: oppositeAngle(a.angle) } };
  if (b.angle !== null) return { a: { ...a, angle: oppositeAngle(b.angle) }, b };
  return { a, b };
}

/** Moyenne circulaire (degrés, 0 à 360) de deux directions ; la première si elles sont exactement opposées. */
const circularMean = (u: number, v: number) => {
  const x = Math.cos((u * Math.PI) / 180) + Math.cos((v * Math.PI) / 180);
  const y = Math.sin((u * Math.PI) / 180) + Math.sin((v * Math.PI) / 180);
  return Math.abs(x) + Math.abs(y) < 1e-9 ? u : (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
};

/** Même règle pour une paire lue du serveur (deux directions cliquées à la main, jamais exactement opposées) : l'écart est réparti entre les deux stations. */
export function balancePair(pair: TeleportPair): TeleportPair {
  const { a, b } = pair;
  if (a.angle === null || b.angle === null) return completePair(a, b);
  const mean = circularMean(a.angle, oppositeAngle(b.angle));
  return { a: { ...a, angle: mean }, b: { ...b, angle: oppositeAngle(mean) } };
}

/** Rayon (fraction de la largeur) d'un cercle de station tiré du centre au point `edge`, pour une image de `aspect` = largeur / hauteur ; borné ; DEFAULT_STATION_RADIUS si trop petit. */
export function stationRadius(centre: Point, edge: Point, aspect: number): number {
  const r = Math.hypot(edge[0] - centre[0], (edge[1] - centre[1]) / aspect);
  return r < 0.005 ? DEFAULT_STATION_RADIUS : Math.min(r, MAX_STATION_RADIUS);
}

/** Direction (degrés, 0 = droite, 90 = bas) du centre vers `to` dans l'image réelle ; null si `to` est dans le cercle (pas de direction donnée). */
export function stationAngle(centre: Point, to: Point, radius: number, aspect: number): number | null {
  const dx = to[0] - centre[0];
  const dy = (to[1] - centre[1]) / aspect;
  if (Math.hypot(dx, dy) <= radius) return null;
  return (((Math.atan2(dy, dx) * 180) / Math.PI) + 360) % 360;
}

/** Côté (1 ou -1) du trait from-to où se trouve `p`, dans l'image réelle (`aspect` = largeur / hauteur) ; 0 si `p` est sur le trait. */
export function sideOf(from: Point, to: Point, p: Point, aspect: number): -1 | 0 | 1 {
  const cross = (to[0] - from[0]) * aspect * (p[1] - from[1]) - (to[1] - from[1]) * ((p[0] - from[0]) * aspect);
  return cross > 1e-12 ? 1 : cross < -1e-12 ? -1 : 0;
}

/** Flèche de vision d'une porte ou fenêtre à sens unique : de la face d'où l'on voit vers l'autre face, centrée sur le trait ; null si elle se voit des deux côtés. */
export function visionArrow(from: Point, to: Point, side: -1 | 0 | 1, aspect: number, length = 0.03): [Point, Point] | null {
  if (side === 0) return null;
  const tx = (to[0] - from[0]) * aspect;
  const ty = to[1] - from[1];
  const norm = Math.hypot(tx, ty);
  if (norm === 0) return null;
  const nx = (-ty / norm) * side * length;
  const ny = (tx / norm) * side * length;
  const mid: Point = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  return [[mid[0] + nx / aspect, mid[1] + ny], [mid[0] - nx / aspect, mid[1] - ny]];
}

/** Vrai si p est dans le polygone (règle pair-impair). */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Applique les zones de remplacement de classe à l'image de classes (modifiée sur place). Même règle que apply_overrides de map_annotations.py : le centre du pixel décide. */
export function applyOverrides(labels: Uint8Array, width: number, height: number, overrides: ClassOverride[]): Uint8Array {
  for (const o of overrides) {
    const xs = o.polygon.map((p) => p[0]);
    const ys = o.polygon.map((p) => p[1]);
    const x0 = Math.max(0, Math.floor(Math.min(...xs) * width));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(...xs) * width));
    const y0 = Math.max(0, Math.floor(Math.min(...ys) * height));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(...ys) * height));
    const from = o.from === 'any' ? null : classCode(o.from);
    const to = classCode(o.to);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        if ((from === null || labels[i] === from) && pointInPolygon([(x + 0.5) / width, (y + 0.5) / height], o.polygon)) labels[i] = to;
      }
    }
  }
  return labels;
}

/** Deux couleurs de classes différentes dont les tolérances se recouvrent. */
export interface ColorConflict {
  i: number;
  j: number;
  distance: number;
  pixels: number; // pixels de la médiane couverts par les deux
}

/**
 * Pixels couverts par deux couleurs de classes différentes (ambigus : la plus proche l'emporte, mais la décision tient à quelques niveaux de gris), et les paires de couleurs
 * responsables.
 */
export function findConflicts(rgba: Uint8ClampedArray, colors: PickedColor[]): { mask: Uint8Array; pairs: ColorConflict[] } {
  const n = rgba.length / 4;
  const mask = new Uint8Array(n);
  const hits = colors.map((c) => {
    const hit = new Uint8Array(n);
    const limit = c.tol * c.tol;
    for (let p = 0; p < n; p++) {
      const dr = rgba[p * 4] - c.rgb[0];
      const dg = rgba[p * 4 + 1] - c.rgb[1];
      const db = rgba[p * 4 + 2] - c.rgb[2];
      hit[p] = dr * dr + dg * dg + db * db <= limit ? 1 : 0;
    }
    return hit;
  });
  const pairs: ColorConflict[] = [];
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      if (colors[i].cls === colors[j].cls) continue;
      let pixels = 0;
      for (let p = 0; p < n; p++) {
        if (hits[i][p] && hits[j][p]) {
          mask[p] = 1;
          pixels++;
        }
      }
      if (pixels > 0) pairs.push({ i, j, distance: Math.hypot(colors[i].rgb[0] - colors[j].rgb[0], colors[i].rgb[1] - colors[j].rgb[1], colors[i].rgb[2] - colors[j].rgb[2]), pixels });
    }
  }
  return { mask, pairs };
}

/** Tolérances réduites pour qu'aucune couleur ne recouvre une couleur d'une autre classe : au plus la moitié de la distance à la couleur de classe différente la plus proche. */
export function separateTolerances(colors: PickedColor[]): PickedColor[] {
  return colors.map((c, i) => {
    let limit = c.tol;
    colors.forEach((o, j) => {
      if (i !== j && o.cls !== c.cls) limit = Math.min(limit, Math.floor(Math.hypot(c.rgb[0] - o.rgb[0], c.rgb[1] - o.rgb[1], c.rgb[2] - o.rgb[2]) / 2));
    });
    return { ...c, tol: limit };
  });
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
