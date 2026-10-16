// Chargement des images qui servent à construire la grille de visibilité d'une carte (masque des couloirs, classes, image « dessous »).
// Copie de ce que fait components/stats/StatsSafe.tsx (qui ne l'exporte pas et n'est pas modifié par l'écran de review).

import { readingOf } from '../../../lib/mapReading';
import type { GraySource } from '../../../lib/visibility';

const classUrls = import.meta.glob('../../../../analysis/map_masks/*_classes.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const classesUrlOf = (map: string) => Object.entries(classUrls).find(([path]) => path.endsWith(`/${map}_classes.png`))?.[1] ?? null;

/** Image décodée en niveaux de gris (le canal rouge) : les masques sont en gris. */
function loadGray(url: string): Promise<GraySource> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('Canevas indisponible'));
      ctx.drawImage(img, 0, 0);
      const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
      const data = new Uint8Array(img.width * img.height);
      for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
      resolve({ w: img.width, h: img.height, data });
    };
    img.onerror = () => reject(new Error(`Image illisible : ${url}`));
    img.src = url;
  });
}

export interface ZoneSources {
  walk: GraySource;
  classes: GraySource | null;
  /** Cartes à deux étages : sol réservé au niveau du dessous (image `_dessous.png`), ou null. */
  under: GraySource | null;
}

/** Masque des couloirs, image des classes (tir par-dessus, fenêtres, portes vitrées) et image « dessous » d'une carte. */
export async function loadZoneSources(map: string): Promise<ZoneSources> {
  const reading = readingOf(map);
  if (!reading.maskUrl) throw new Error(`Pas de masque des couloirs pour la carte ${map}`);
  const classesUrl = classesUrlOf(map);
  return {
    walk: await loadGray(reading.maskUrl),
    classes: classesUrl ? await loadGray(classesUrl).catch(() => null) : null,
    under: reading.underUrl ? await loadGray(reading.underUrl).catch(() => null) : null,
  };
}
