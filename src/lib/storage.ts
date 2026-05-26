// Export / import d'une configuration de carte sous forme de fichier JSON.
// La persistance auto (localStorage) est gérée par le store Zustand ; ces
// helpers servent à sauvegarder/partager une carte précise dans un fichier.

import type { MapConfig } from '../types/map';

/** Déclenche le téléchargement de la carte sous forme de fichier `.json`. */
export function exportMapToJSON(map: MapConfig): void {
  const data = JSON.stringify(map, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  const safeName = map.name.trim().replace(/[^a-z0-9-_]+/gi, '_') || 'map';
  a.download = `eva_strat_${safeName}.json`;
  a.click();

  URL.revokeObjectURL(url);
}

/** Lit un fichier `.json` et le parse en MapConfig (rejette si invalide). */
export function importMapFromJSON(file: File): Promise<MapConfig> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as MapConfig;
        if (!parsed.id || !Array.isArray(parsed.floors)) {
          throw new Error('Fichier de carte invalide.');
        }
        resolve(parsed);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('JSON illisible.'));
      }
    };
    reader.onerror = () => reject(new Error('Lecture du fichier impossible.'));
    reader.readAsText(file);
  });
}

/** Lit un fichier image et renvoie une data URL (pour servir de fond de carte). */
export function readImageAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Lecture de l’image impossible.'));
    reader.readAsDataURL(file);
  });
}
