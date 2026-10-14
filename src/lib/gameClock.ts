// Horloge de rejeu d'une game (vues Parcours et Morts) : avancée du temps selon la vitesse et la durée. Fonctions pures, sans minuterie (le crochet useGameClock les appelle).

/** Vitesses de lecture proposées (multiples du temps réel). */
export const SPEEDS = [1, 2, 4, 8, 16];
export const DEFAULT_SPEED = 4;

/** Temps ramené dans 0..duration (0 si la durée est inconnue ou le temps n'est pas un nombre). */
export function clampTime(t: number, duration: number): number {
  if (!Number.isFinite(t) || duration <= 0) return 0;
  return Math.min(duration, Math.max(0, t));
}

/** Avance l'horloge de `dtMs` millisecondes réelles à la vitesse `speed`. `ended` : la fin de la game est atteinte (la lecture s'arrête). Un grand saut de temps (onglet caché) est plafonné. */
export function advance(t: number, dtMs: number, speed: number, duration: number): { t: number; ended: boolean } {
  const step = Math.min(Math.max(0, dtMs), 250) / 1000; // au plus un quart de seconde réelle par image
  const next = clampTime(t + step * speed, duration);
  return { t: next, ended: next >= duration };
}
