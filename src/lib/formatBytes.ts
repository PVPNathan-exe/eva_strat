// Taille de fichier lisible en français (espace avant l'unité, virgule décimale), unités décimales comme l'Explorateur de Windows.

const UNITS = ['o', 'Ko', 'Mo', 'Go', 'To'];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const text = unit === 0 || value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace('.', ',');
  return `${text} ${UNITS[unit]}`;
}
