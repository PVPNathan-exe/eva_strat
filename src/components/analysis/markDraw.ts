// Dessin des corrections posées à la main sur la minimap agrandie (onglet Lecture) : contour magenta, avec le regard s'il a été donné.

import { MARKER_RADIUS, pinOutline } from '../../lib/pinShape';
import type { UserMark } from '../../types/analysis';

export const MARK_COLOR = '#ff4df0';
export const MARK_SHOWN_S = 0.5; // une correction se voit à ce temps près de son instant

export interface Drag {
  slot: number;
  x0: number; // départ du geste (fraction de la minimap) : la position
  y0: number;
  x1: number; // pointeur actuel : sa direction depuis le départ donne le regard
  y1: number;
}

/** Regard (degrés, 0 = droite, 90 = bas) d'un geste dans un canevas de largeur et hauteur en pixels ; null si le geste est trop court pour viser une direction. */
export function dragAngle(d: Drag, width: number, height: number, minPixels = 10): number | null {
  const dx = (d.x1 - d.x0) * width;
  const dy = (d.y1 - d.y0) * height;
  return Math.hypot(dx, dy) < minPixels ? null : (Math.atan2(dy, dx) * 180) / Math.PI + (dy < 0 ? 360 : 0);
}

const numberOf = (slot: number) => (slot <= 4 ? slot : slot + 1);

function outline(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, angle: number | null, dashed: boolean) {
  ctx.beginPath();
  pinOutline(cx, cy, radius, angle).forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = MARK_COLOR;
  ctx.setLineDash(dashed ? [4, 3] : []);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawMarks(ctx: CanvasRenderingContext2D, marks: UserMark[], time: number, width: number, height: number, drag: Drag | null) {
  const radius = MARKER_RADIUS * width;
  ctx.font = '700 15px system-ui, sans-serif';
  ctx.fillStyle = MARK_COLOR;
  for (const m of marks) {
    if (Math.abs(m.t - time) > MARK_SHOWN_S) continue;
    outline(ctx, m.x * width, m.y * height, radius, m.angle, false);
    ctx.fillText(`${numberOf(m.slot)} main`, m.x * width + radius + 3, m.y * height + radius + 12);
  }
  if (drag) outline(ctx, drag.x0 * width, drag.y0 * height, radius, dragAngle(drag, width, height), true);
}
