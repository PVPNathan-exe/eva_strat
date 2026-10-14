// Grille de chaleur de présence : cases [colonne, ligne, secondes] de /api/stats/presence mises en grille, lissées, ramenées à 0..1 et converties en pixels.
// Fonctions pures (aucune lecture de la page) : les couleurs viennent de tokens.css, lues par l'appelant puis passées en paramètre.

export type Rgb = [number, number, number];

/** Remplit une grille n par n (ligne par ligne : indice = ligne * n + colonne) ; les cases hors grille ou non finies sont ignorées, les doublons s'additionnent. */
export function gridFromCells(n: number, cells: [number, number, number][]): Float32Array {
  const out = new Float32Array(Math.max(0, n) * Math.max(0, n));
  for (const [ix, iy, seconds] of cells) {
    if (!Number.isInteger(ix) || !Number.isInteger(iy) || ix < 0 || iy < 0 || ix >= n || iy >= n || !Number.isFinite(seconds)) continue;
    out[iy * n + ix] += seconds;
  }
  return out;
}

/** Somme des secondes de la grille. */
export const totalSeconds = (values: Float32Array): number => values.reduce((sum, v) => sum + v, 0);

/** Noyau gaussien normalisé de rayon ceil(3 sigma). */
function kernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float32Array(2 * radius + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    k[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
    sum += k[i + radius];
  }
  return k.map((v) => v / sum);
}

/** Une passe de lissage dans un sens ; aux bords, le poids manquant est renormalisé pour que les bords ne s'assombrissent pas. */
function pass(src: Float32Array, n: number, k: Float32Array, horizontal: boolean): Float32Array {
  const radius = (k.length - 1) / 2;
  const out = new Float32Array(src.length);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      let acc = 0;
      let weight = 0;
      for (let d = -radius; d <= radius; d++) {
        const c = b + d;
        if (c < 0 || c >= n) continue;
        acc += src[horizontal ? a * n + c : c * n + a] * k[d + radius];
        weight += k[d + radius];
      }
      out[horizontal ? a * n + b : b * n + a] = weight > 0 ? acc / weight : 0;
    }
  }
  return out;
}

/** Lissage gaussien (sigma en cases) ; sigma 0 ou négatif : grille inchangée. La somme est conservée à peu près (pas aux bords). */
export function blur(values: Float32Array, n: number, sigma: number): Float32Array {
  if (sigma <= 0 || n <= 0) return values;
  const k = kernel(sigma);
  return pass(pass(values, n, k, true), n, k, false);
}

/** Valeur au rang `p` (0 à 1) parmi les cases strictement positives ; 0 si aucune. */
export function percentile(values: Float32Array, p: number): number {
  const positive = Array.from(values).filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return 0;
  return positive[Math.min(positive.length - 1, Math.max(0, Math.floor(p * (positive.length - 1))))];
}

/** Ramène la grille à 0..1 en divisant par le percentile `p` des cases occupées (les rares cases très chaudes n'écrasent pas le reste), puis écrête à 1. */
export function normalize(values: Float32Array, p = 0.98): Float32Array {
  const top = percentile(values, p);
  if (top <= 0) return new Float32Array(values.length);
  return values.map((v) => Math.min(1, v / top));
}

/** Couleur CSS hexadécimale (#rgb ou #rrggbb) vers [r, g, b] ; null si le texte n'est pas une couleur de ce format. */
export function parseHex(css: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(css.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** Dégradé de `low` (valeur 0) à `high` (valeur 1) ; opacité qui monte avec la valeur (rien sur une case vide), plafonnée à maxAlpha (0 à 1). Renvoie [r, g, b, a] sur 0 à 255. */
export function heatColor(v: number, low: Rgb, high: Rgb, maxAlpha = 0.85): [number, number, number, number] {
  const t = Math.min(1, Math.max(0, v));
  const mix = (i: number) => Math.round(low[i] + (high[i] - low[i]) * t);
  return [mix(0), mix(1), mix(2), Math.round(255 * maxAlpha * Math.sqrt(t))];
}

/** Pixels RGBA (ligne par ligne) d'une grille normalisée n par n, prêts pour un ImageData. */
export function heatPixels(norm: Float32Array, n: number, low: Rgb, high: Rgb, maxAlpha = 0.85): Uint8ClampedArray {
  const px = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) px.set(heatColor(norm[i], low, high, maxAlpha), i * 4);
  return px;
}
