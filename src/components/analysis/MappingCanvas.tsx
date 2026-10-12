// Médiane de la minimap d'une carte, agrandie au pixel près, avec l'aperçu des classes de couleur et les éléments tracés (tyroliennes, portes, zones de départ, repères).
// Le clic est interprété par l'outil actif (voir MapMapping) : cette zone ne fait que dessiner et rendre la position du pointeur en pixel de la médiane et en fraction.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CLASS_INFO, classifyImage, type MapAnnotation, type Point, type Rect } from '../../lib/mapAnnotation';

export interface Pixel {
  x: number; // pixel de la médiane
  y: number;
  frac: Point; // même position en fraction de l'image
}

interface Props {
  url: string;
  annotation: MapAnnotation;
  zoom: number; // 0 : ajusté à la largeur disponible
  preview: boolean; // coloriser les pixels classés
  pendingPoint: Point | null; // premier clic d'un tracé en cours
  dragRect: Rect | null; // rectangle en cours de tracé
  onImage: (image: ImageData) => void;
  onHover: (pixel: Pixel | null) => void;
  onDown: (pixel: Pixel) => void;
  onMove: (pixel: Pixel) => void;
  onUp: (pixel: Pixel) => void;
}

/** Image de la médiane lue une fois dans un canevas hors écran. */
function useImageData(url: string): ImageData | null {
  const [data, setData] = useState<ImageData | null>(null);
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = img.width;
      cv.height = img.height;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      if (!ctx || cancelled) return;
      ctx.drawImage(img, 0, 0);
      setData(ctx.getImageData(0, 0, img.width, img.height));
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return data;
}

const pct = (v: number) => v * 100;

export function MappingCanvas({ url, annotation, zoom, preview, pendingPoint, dragRect, onImage, onHover, onDown, onMove, onUp }: Props) {
  const image = useImageData(url);
  const base = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!image) return;
    onImage(image);
    const ctx = base.current?.getContext('2d');
    if (base.current && ctx) {
      base.current.width = image.width;
      base.current.height = image.height;
      ctx.putImageData(image, 0, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  // Aperçu des classes : une couleur par classe, semi-transparente, au pixel près.
  const labels = useMemo(() => (image ? classifyImage(image.data, annotation.colors) : null), [image, annotation.colors]);
  useEffect(() => {
    const cv = layer.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx || !image || !labels) return;
    cv.width = image.width;
    cv.height = image.height;
    const out = ctx.createImageData(image.width, image.height);
    for (let p = 0; p < labels.length; p++) {
      const info = labels[p] > 0 ? CLASS_INFO[labels[p] - 1] : null;
      if (!info || !preview) continue;
      out.data[p * 4] = info.preview[0];
      out.data[p * 4 + 1] = info.preview[1];
      out.data[p * 4 + 2] = info.preview[2];
      out.data[p * 4 + 3] = 170;
    }
    ctx.putImageData(out, 0, 0);
  }, [image, labels, preview]);

  const pixelOf = (e: React.PointerEvent<HTMLDivElement>): Pixel | null => {
    if (!image) return null;
    const r = e.currentTarget.getBoundingClientRect();
    const fx = Math.min(0.999999, Math.max(0, (e.clientX - r.left) / r.width));
    const fy = Math.min(0.999999, Math.max(0, (e.clientY - r.top) / r.height));
    return { x: Math.floor(fx * image.width), y: Math.floor(fy * image.height), frac: [fx, fy] };
  };

  const handle = (fn: (p: Pixel) => void) => (e: React.PointerEvent<HTMLDivElement>) => {
    const p = pixelOf(e);
    if (p) fn(p);
  };

  const width = zoom === 0 ? '100%' : image ? image.width * zoom : undefined;
  return (
    <div className="mapping__scroll">
      <div
        className="mapping__stage"
        style={{ width, aspectRatio: image ? `${image.width} / ${image.height}` : undefined }}
        onPointerDown={handle((p) => onDown(p))}
        onPointerMove={handle((p) => {
          onHover(p);
          onMove(p);
        })}
        onPointerUp={handle((p) => onUp(p))}
        onPointerLeave={() => onHover(null)}
      >
        <canvas ref={base} className="mapping__canvas" />
        <canvas ref={layer} className="mapping__canvas mapping__canvas--layer" />
        <svg className="mapping__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          <defs>
            <marker id="mapping-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="mapping__arrowhead" />
            </marker>
          </defs>
          {annotation.tps.map((t, i) => (
            <line key={`tp${i}`} x1={pct(t.from[0])} y1={pct(t.from[1])} x2={pct(t.to[0])} y2={pct(t.to[1])} className="mapping__tp" markerEnd="url(#mapping-arrow)" vectorEffect="non-scaling-stroke" />
          ))}
          {annotation.doors.map((d, i) => (
            <line key={`door${i}`} x1={pct(d.from[0])} y1={pct(d.from[1])} x2={pct(d.to[0])} y2={pct(d.to[1])} className={d.glass ? 'mapping__door mapping__door--glass' : 'mapping__door'} vectorEffect="non-scaling-stroke" />
          ))}
          {(['A', 'B'] as const).flatMap((team) =>
            annotation.spawns[team].map((r, i) => (
              <rect key={`${team}${i}`} x={pct(r[0])} y={pct(r[1])} width={pct(r[2] - r[0])} height={pct(r[3] - r[1])} className={`mapping__spawn mapping__spawn--${team}`} vectorEffect="non-scaling-stroke" />
            )),
          )}
          {dragRect && <rect x={pct(dragRect[0])} y={pct(dragRect[1])} width={pct(dragRect[2] - dragRect[0])} height={pct(dragRect[3] - dragRect[1])} className="mapping__spawn mapping__spawn--drag" vectorEffect="non-scaling-stroke" />}
          {annotation.pairs.map((p, i) => (
            <g key={`pair${i}`}>
              <line x1={pct(p.minimap[0]) - 1} y1={pct(p.minimap[1])} x2={pct(p.minimap[0]) + 1} y2={pct(p.minimap[1])} className="mapping__landmark" vectorEffect="non-scaling-stroke" />
              <line x1={pct(p.minimap[0])} y1={pct(p.minimap[1]) - 1} x2={pct(p.minimap[0])} y2={pct(p.minimap[1]) + 1} className="mapping__landmark" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {pendingPoint && <circle cx={pct(pendingPoint[0])} cy={pct(pendingPoint[1])} r={0.9} className="mapping__pending" vectorEffect="non-scaling-stroke" />}
        </svg>
      </div>
    </div>
  );
}
