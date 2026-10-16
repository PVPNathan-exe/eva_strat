// Appels HTTP des vues Joueurs et Équipes vers /api/stats/players-summary et /api/stats/teams-summary.
// Une route pas encore branchée répond 501 (ou 404 sur un serveur plus ancien) : StatsUnavailableError, affichée comme un message clair, comme statsRecapApi.

import { parse } from './analysisApi.ts';
import { StatsUnavailableError } from './statsApi.ts';
import type { PlayersSummary, TeamsSummary } from '../types/statsSummary.ts';

/** Construit la chaîne de requête sans les paramètres vides. */
export function queryString(params: Record<string, string | number[] | null | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '') continue;
    const text = Array.isArray(v) ? v.join(',') : v;
    if (text !== '') parts.push(`${k}=${encodeURIComponent(text)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

async function getJson<T>(url: string, route: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 501 || res.status === 404) throw new StatsUnavailableError(`La route ${route} n'est pas branchée sur ce serveur.`);
  return parse<T>(res);
}

export interface SummaryQuery {
  /** Carte (absente : toutes les cartes). */
  map?: string | null;
  /** Games retenues (absent : toutes). */
  games?: number[];
}

export const statsSummaryApi = {
  /** Statistiques globales de chaque joueur ; avec `player` (clé), le détail game par game de ce joueur en plus. */
  players: async (q: SummaryQuery & { team?: string | null; player?: string | null } = {}): Promise<PlayersSummary> => {
    const data = await getJson<PlayersSummary>(`/api/stats/players-summary${queryString({ map: q.map, team: q.team, player: q.player, games: q.games })}`, '/api/stats/players-summary');
    // Une réponse sans liste de joueurs vient d'un serveur qui ne connaît pas la route (page HTML, JSON vide)
    if (!Array.isArray(data.players)) throw new StatsUnavailableError("La route /api/stats/players-summary a répondu autre chose qu'une liste de joueurs.");
    return data;
  },
  /** Statistiques globales de chaque équipe ; avec `team` (clé), le détail game par game de cette équipe en plus. */
  teams: async (q: SummaryQuery & { team?: string | null } = {}): Promise<TeamsSummary> => {
    const data = await getJson<TeamsSummary>(`/api/stats/teams-summary${queryString({ map: q.map, team: q.team, games: q.games })}`, '/api/stats/teams-summary');
    if (!Array.isArray(data.teams)) throw new StatsUnavailableError("La route /api/stats/teams-summary a répondu autre chose qu'une liste d'équipes.");
    return data;
  },
};
