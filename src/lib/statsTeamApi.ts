// Appels HTTP de la vue Équipe (et de la vue Global) : /api/stats/team-summary et /api/stats/global. Types dans types/statsTeam.ts.
// Une route pas encore branchée côté serveur répond 501 : StatsUnavailableError, comme les autres routes Stats.

import { parse } from './analysisApi.ts';
import { StatsUnavailableError } from './statsApi.ts';
import type { GlobalSummary, TeamSummary } from '../types/statsTeam.ts';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 501) throw new StatsUnavailableError();
  return parse<T>(res);
}

export interface TeamSummaryQuery {
  map: string;
  /** Nom de l'équipe suivie (le serveur compare sans casse ni accents). */
  team: string;
  /** Games demandées (absent : toutes les games de la carte). */
  games?: number[];
  side?: 'both' | 'left' | 'right';
  /** Côté de la grille (32 par défaut côté serveur). */
  n?: number;
}

export interface GlobalQuery {
  map: string;
  games?: number[];
  n?: number;
}

/** Adresse de team-summary (fonction pure, testée). */
export function teamSummaryUrl(q: TeamSummaryQuery): string {
  const params = new URLSearchParams({ map: q.map, team: q.team });
  if (q.games && q.games.length) params.set('games', q.games.join(','));
  if (q.side && q.side !== 'both') params.set('side', q.side);
  if (q.n) params.set('n', String(q.n));
  return `/api/stats/team-summary?${params}`;
}

/** Adresse de global (fonction pure, testée). */
export function globalUrl(q: GlobalQuery): string {
  const params = new URLSearchParams({ map: q.map });
  if (q.games && q.games.length) params.set('games', q.games.join(','));
  if (q.n) params.set('n', String(q.n));
  return `/api/stats/global?${params}`;
}

export const statsTeamApi = {
  teamSummary: (q: TeamSummaryQuery) => getJson<TeamSummary>(teamSummaryUrl(q)),
  global: (q: GlobalQuery) => getJson<GlobalSummary>(globalUrl(q)),
};
