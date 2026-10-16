// Routes /api/stats/* de l'onglet Stats : répartiteur (lives, links, presence, owners, episodes, teams, gadgets, duels, kill-scores, player-stats, game-summary, team-summary, global, players-summary, teams-summary en GET ; PUT du verdict d'un épisode, seule écriture).

import type { ApiContext, ApiResult } from './api.ts';
import { listEpisodes, putVerdict, teamAggregate } from './statsEpisodes.ts';
import { gameSummary, listDuels, listGadgets, listKillScores, listPlayerStats } from './statsGame.ts';
import { listLifeLoadouts, listLinks, listLives } from './statsLives.ts';
import { listActive, listLevels, listOwners } from './statsOwners.ts';
import { playersSummary, teamsSummary } from './statsPlayers.ts';
import { presence } from './statsPresence.ts';
import { globalSummary, teamSummary } from './statsTeam.ts';

/** Routes en lecture seule (GET). */
const GET_ROUTES: Record<string, (ctx: ApiContext, query: URLSearchParams) => ApiResult> = {
  '/api/stats/lives': listLives,
  '/api/stats/links': listLinks,
  '/api/stats/life-loadouts': listLifeLoadouts,
  '/api/stats/presence': presence,
  '/api/stats/owners': listOwners,
  '/api/stats/active': listActive,
  '/api/stats/levels': listLevels,
  '/api/stats/episodes': listEpisodes,
  '/api/stats/teams': teamAggregate,
  '/api/stats/gadgets': listGadgets,
  '/api/stats/duels': listDuels,
  '/api/stats/kill-scores': listKillScores,
  '/api/stats/player-stats': listPlayerStats,
  '/api/stats/game-summary': gameSummary,
  '/api/stats/team-summary': teamSummary,
  '/api/stats/global': globalSummary,
  '/api/stats/players-summary': playersSummary,
  '/api/stats/teams-summary': teamsSummary,
};

/** Répond aux routes /api/stats/* ; null si la route n'en est pas une (handleApi continue alors). */
export function handleStats(ctx: ApiContext, method: string, pathname: string, query: URLSearchParams, body?: unknown): ApiResult | null {
  if (!pathname.startsWith('/api/stats/')) return null;
  const episode = /^\/api\/stats\/episodes\/([^/]+)$/.exec(pathname); // seule écriture : le verdict de l'utilisateur
  if (episode) {
    if (method !== 'PUT') return { status: 405, json: { error: `Méthode ${method} non permise sur ${pathname} : PUT seulement` } };
    return putVerdict(ctx, episode[1], body);
  }
  const route = GET_ROUTES[pathname];
  if (route) {
    if (method !== 'GET') return { status: 405, json: { error: `Méthode ${method} non permise sur ${pathname} : GET seulement` } };
    return route(ctx, query);
  }
  return { status: 501, json: { error: `Route Stats pas encore disponible (${method} ${pathname})` } };
}
