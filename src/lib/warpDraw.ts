// Tracé d'une image de la minimap (grille de pixels) déformée vers le plan, triangle par triangle (maillage de planWarp.ts).
// Pour les couches en pixels (chaleur, zones sûres, masque des couloirs) des cartes dont la minimap et le plan ne sont pas homothétiques.

import { growTriangle, planSizeOf, triangleAffine, warpTriangles, type Pt } from './planWarp';

/** Écart (pixels du canevas d'arrivée) dont chaque triangle est agrandi pour qu'aucune couture claire ne reste entre deux triangles voisins. */
const SEAM_PX = 0.7;

/**
 * Peint `source` (canevas ou image de srcW x srcH pixels, normalisée sur la minimap) déformée sur `ctx` (dstW x dstH pixels, normalisé sur le plan).
 * `smooth` : interpolation douce (chaleur) ou pixels francs (masques).
 */
export function drawWarped(ctx: CanvasRenderingContext2D, map: string, source: CanvasImageSource, srcW: number, srcH: number, dstW: number, dstH: number, smooth = true): void {
  ctx.imageSmoothingEnabled = smooth;
  for (const t of warpTriangles(map)) {
    const src = t.src.map(([x, y]) => [x * srcW, y * srcH]) as [Pt, Pt, Pt];
    const dst = t.dst.map(([x, y]) => [x * dstW, y * dstH]) as [Pt, Pt, Pt];
    const [a, b, c, d, e, f] = triangleAffine(src, dst);
    const g = growTriangle(dst, SEAM_PX);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(g[0][0], g[0][1]);
    ctx.lineTo(g[1][0], g[1][1]);
    ctx.lineTo(g[2][0], g[2][1]);
    ctx.closePath();
    ctx.clip();
    ctx.setTransform(a, d, b, e, c, f);
    ctx.drawImage(source, 0, 0);
    ctx.restore();
  }
}

/** Taille du canevas d'arrivée (pixels du plan d'origine fois `scale`) d'une carte avec maillage, ou null. */
export function warpedSize(map: string, scale = 1): Pt | null {
  const s = planSizeOf(map);
  return s ? [Math.round(s[0] * scale), Math.round(s[1] * scale)] : null;
}
