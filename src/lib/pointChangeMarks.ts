// Repères des changements de point de capture sur la frise zoomée d'une game (fonctions pures).
// Un changement = début d'une période de point actif après la première (/api/stats/active, temps en secondes depuis le début de la game).
// Chaque repère a un trait au changement et une fenêtre de WINDOW_S secondes avant (coupée au début de la game).

import type { PointActive } from '../types/stats.ts';

/** Fenêtre affichée avant un changement de point (secondes), demandée par l'utilisateur. */
export const POINT_CHANGE_WINDOW_S = 10;

/** Cartes sans aucun changement de point (un seul point ou points fixes) : pas de repères, un message dans l'aide. */
const MAPS_WITHOUT_CHANGE = ['engine', 'helios station'];

/** Nom de carte comparable : minuscules, sans accents, espaces simples. */
function normalizeMap(map: string): string {
  return map
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Vrai si la carte n'a aucun changement de point (Engine, Helios Station). Carte inconnue (null) : faux, on laisse les données parler. */
export function hasNoPointChange(map: string | null): boolean {
  return map !== null && MAPS_WITHOUT_CHANGE.includes(normalizeMap(map));
}

/** Un repère de changement de point, en temps de game et en temps de vidéo. */
export interface PointChangeMark {
  /** Point qui devient actif (lettre). */
  point: string;
  /** Point actif juste avant. */
  from: string;
  /** Instant du changement, secondes depuis le début de la game. */
  gameT: number;
  /** Début de la fenêtre avant le changement, secondes depuis le début de la game (jamais négatif). */
  windowStartGameT: number;
  /** Instant du changement dans la vidéo (start_s + gameT). */
  videoT: number;
  /** Début de la fenêtre dans la vidéo : c'est là qu'un clic place la lecture. */
  windowStartVideoT: number;
}

/** Temps de game vers temps de vidéo. */
export function gameToVideoTime(gameT: number, startS: number): number {
  return startS + gameT;
}

/**
 * Repères des changements de point d'une game.
 * Les périodes sont triées par début ; la première n'est pas un changement ; une période qui reprend le même point que la précédente
 * (coupure de lecture) n'en est pas un non plus ; un début hors de la game (après sa durée) est ignoré.
 */
export function pointChangeMarks(active: PointActive[], startS: number, endS: number, windowS = POINT_CHANGE_WINDOW_S): PointChangeMark[] {
  const duration = endS - startS;
  const periods = [...active].sort((a, b) => a.t0 - b.t0);
  const marks: PointChangeMark[] = [];
  for (let i = 1; i < periods.length; i++) {
    const { point, t0 } = periods[i];
    const from = periods[i - 1].point;
    if (point === from || t0 < 0 || t0 > duration) continue;
    const windowStartGameT = Math.max(0, t0 - windowS);
    marks.push({
      point,
      from,
      gameT: t0,
      windowStartGameT,
      videoT: gameToVideoTime(t0, startS),
      windowStartVideoT: gameToVideoTime(windowStartGameT, startS),
    });
  }
  return marks;
}

/** Texte d'infobulle d'un repère : « Point B actif à 2:30 (A avant) », temps dans la game. */
export function pointChangeLabel(mark: PointChangeMark, format: (s: number) => string): string {
  return `Point ${mark.point} actif à ${format(mark.gameT)} (${mark.from} avant) : la lecture se place ${Math.round(mark.gameT - mark.windowStartGameT)} s avant`;
}
