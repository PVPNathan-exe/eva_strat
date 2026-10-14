// Morts d'une game pour la vue Morts : numérotées dans l'ordre du temps, avec leurs liens (trade, revenge), et morts visibles à un instant (depuis le début ou dans une fenêtre).
// Fonctions pures : temps en secondes depuis le début de la game.

import { linksOfDeath, type DeathLinks } from './statsApi.ts';
import type { KillLink, Life } from '../types/stats.ts';

export interface Death {
  key: string;
  life: Life;
  /** Numéro d'ordre de la mort dans sa game (1 pour la première). */
  n: number;
  links: DeathLinks;
}

export const deathKey = (l: Pick<Life, 'game_id' | 'slot' | 'idx'>): string => `${l.game_id}:${l.slot}:${l.idx}`;

/** Fenêtres proposées (secondes avant l'instant) ; 0 : depuis le début de la game. */
export const WINDOWS_S = [0, 10, 20, 30, 60];

/** Morts de toutes les vies (position de mort connue), numérotées par game dans l'ordre du temps, avec leurs liens. */
export function deathsOf(lives: Life[], links: KillLink[]): Death[] {
  const out: Death[] = [];
  const byGame = new Map<number, Life[]>();
  for (const l of lives) if (l.ended === 'death' && l.x1 !== null && l.y1 !== null) byGame.set(l.game_id, [...(byGame.get(l.game_id) ?? []), l]);
  for (const list of byGame.values()) {
    list.sort((a, b) => a.t1 - b.t1);
    list.forEach((life, i) => out.push({ key: deathKey(life), life, n: i + 1, links: linksOfDeath(life, links) }));
  }
  return out;
}

/** Morts déjà survenues à l'instant t : toutes depuis le début (windowS <= 0), ou seulement celles des `windowS` dernières secondes. */
export function visibleDeaths(deaths: Death[], t: number, windowS: number): Death[] {
  return deaths.filter((d) => d.life.t1 <= t && (windowS <= 0 || d.life.t1 >= t - windowS));
}
