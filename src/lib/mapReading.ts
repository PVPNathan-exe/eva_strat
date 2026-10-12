// Ce que le programme sait d'une carte : couloirs (masque), traits de murs, stations de tyrolienne, zones de départ.
// Les images viennent de analysis/map_masks (construites par map_mask.py), les stations et zones de départ des JSON de analysis/.

import teleports from '../../analysis/map_teleports.json';
import spawns from '../../analysis/map_spawns.json';

const masks = import.meta.glob('../../analysis/map_masks/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

const find = (name: string) => Object.entries(masks).find(([path]) => path.endsWith(`/${name}`))?.[1] ?? null;

export interface MapReading {
  maskUrl: string | null; // couloirs : pixels blancs = praticable
  linesUrl: string | null; // traits de murs
  medianUrl: string | null; // médiane de la minimap du jeu (fond des cartes dont le plan n'est pas aligné)
  stations: [number, number][][]; // paires [entrée, sortie] en fraction de la minimap
  spawns: { team: 'A' | 'B'; rect: [number, number, number, number] }[]; // x0, y0, x1, y1 (une équipe peut avoir plusieurs zones)
}

export function readingOf(map: string): MapReading {
  const tp = (teleports as Record<string, unknown>)[map];
  const sp = (spawns as Record<string, unknown>)[map] as Record<string, number[] | number[][]> | undefined;
  return {
    maskUrl: find(`${map}.png`),
    linesUrl: find(`${map}_lignes.png`),
    medianUrl: find(`${map}_mediane.png`),
    stations: Array.isArray(tp) ? (tp as [number, number][][]) : [],
    spawns: sp
      ? (['A', 'B'] as const).flatMap((t) => {
          const v = sp[t];
          if (!v) return [];
          const rects = (typeof v[0] === 'number' ? [v] : v) as number[][];
          return rects.map((rect) => ({ team: t, rect: rect as [number, number, number, number] }));
        })
      : [],
  };
}

/** Cartes pour lesquelles le programme a un masque de couloirs. */
export const mapsWithReading = (): string[] =>
  Object.keys(masks)
    .map((p) => p.split('/').pop() ?? '')
    .filter((f) => f.endsWith('.png') && !f.includes('_'))
    .map((f) => f.replace('.png', ''));

export type Rgb = [number, number, number];

/** Image en niveaux de gris chargée comme une couche colorée (canevas hors écran) : les pixels blancs prennent la couleur et l'opacité alpha (0 à 255), le reste est transparent. */
export function loadTinted(url: string, color: Rgb, alpha: number): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canevas indisponible'));
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, img.width, img.height);
      for (let i = 0; i < data.data.length; i += 4) {
        const on = data.data[i] > 127;
        data.data[i] = color[0];
        data.data[i + 1] = color[1];
        data.data[i + 2] = color[2];
        data.data[i + 3] = on ? alpha : 0;
      }
      ctx.putImageData(data, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error(`Image illisible : ${url}`));
    img.src = url;
  });
}
