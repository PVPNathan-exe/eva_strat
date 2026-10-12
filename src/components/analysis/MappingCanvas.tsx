// Médiane de la minimap d'une carte, agrandie au pixel près, avec l'aperçu des classes de couleur et les éléments tracés (tyroliennes, portes, fenêtres, zones de capture et de départ, repères).
// Le clic est interprété par l'outil actif (voir MapMapping) : cette zone ne fait que dessiner et rendre la position du pointeur en pixel de la médiane et en fraction.

import { useEffect, useMemo, useRef, useState } from 'react';
import { CLASS_INFO, applyOverrides, classifyImage, type MapAnnotation, type Point } from '../../lib/mapAnnotation';
import { MappingShapes, type Draft } from './MappingShapes';

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
  conflicts: Uint8Array | null; // pixels ambigus à montrer (couleurs de deux classes qui se recouvrent), ou null
  draft: Draft; // tracé en cours
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

export function MappingCanvas({ url, annotation, zoom, preview, conflicts, draft, onImage, onHover, onDown, onMove, onUp }: Props) {
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
  const labels = useMemo(() => (image ? applyOverrides(classifyImage(image.data, annotation.colors), image.width, image.height, annotation.overrides) : null), [image, annotation.colors, annotation.overrides]);
  useEffect(() => {
    const cv = layer.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx || !image || !labels) return;
    cv.width = image.width;
    cv.height = image.height;
    const out = ctx.createImageData(image.width, image.height);
    for (let p = 0; p < labels.length; p++) {
      const info = labels[p] > 0 ? CLASS_INFO[labels[p] - 1] : null;
      if (conflicts && conflicts[p]) {
        out.data[p * 4] = 255; // pixel ambigu : magenta
        out.data[p * 4 + 1] = 0;
        out.data[p * 4 + 2] = 255;
        out.data[p * 4 + 3] = 255;
        continue;
      }
      if (!info || !preview) continue;
      out.data[p * 4] = info.preview[0];
      out.data[p * 4 + 1] = info.preview[1];
      out.data[p * 4 + 2] = info.preview[2];
      out.data[p * 4 + 3] = 170;
    }
    ctx.putImageData(out, 0, 0);
  }, [image, labels, preview, conflicts]);

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
        {image && <MappingShapes annotation={annotation} draft={draft} aspect={image.width / image.height} />}
      </div>
    </div>
  );
}
