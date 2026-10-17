// Couche en pixels d'une carte, exprimée sur la grille de la minimap : posée telle quelle (le navigateur l'étire sur le cadre affine) ou, pour une carte dont la minimap
// n'est pas homothétique au plan (`warp` = nom de la carte, voir lib/planWarp.ts), tracée déformée dans un canevas de la taille du plan (lib/warpDraw.ts).

import { useEffect, useRef } from 'react';
import { drawWarped, warpedSize } from '../lib/warpDraw';

interface Props {
  className?: string;
  /** Nom de la carte quand elle a un maillage : la couche est tracée déformée sur tout le plan. */
  warp?: string;
  /** Grille de pixels RGBA w x h (chaleur, zones sûres)... */
  pixels?: Uint8ClampedArray;
  w?: number;
  h?: number;
  /** ... ou un canevas déjà prêt (masque teinté). */
  canvas?: HTMLCanvasElement | null;
  /** Finesse du canevas déformé par rapport au plan d'origine (1 : un pixel du plan). */
  scale?: number;
  /** Interpolation douce (chaleur) ou pixels francs (masques). */
  smooth?: boolean;
}

export function PlanCanvas({ className, warp, pixels, w = 0, h = 0, canvas, scale = 1, smooth = true }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const target = ref.current;
    const ctx = target?.getContext('2d');
    if (!target || !ctx) return;
    let src: HTMLCanvasElement | null = canvas ?? null;
    const sw = canvas?.width ?? w;
    const sh = canvas?.height ?? h;
    if (!src && pixels && w > 0 && h > 0) {
      src = document.createElement('canvas');
      src.width = w;
      src.height = h;
      src.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(pixels), w, h), 0, 0);
    }
    const size = warp ? warpedSize(warp, scale) : null;
    if (size) {
      target.width = size[0];
      target.height = size[1];
      ctx.clearRect(0, 0, size[0], size[1]); // jamais de pixels de la carte précédente
      if (src && sw > 0 && sh > 0) drawWarped(ctx, warp!, src, sw, sh, size[0], size[1], smooth);
    } else {
      target.width = sw;
      target.height = sh;
      ctx.clearRect(0, 0, sw, sh);
      if (src) ctx.drawImage(src, 0, 0);
    }
  }, [warp, pixels, w, h, canvas, scale, smooth]);
  return <canvas ref={ref} className={className} />;
}
