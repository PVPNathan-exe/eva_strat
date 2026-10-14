// Routes /api/stats/* de l'onglet Stats : répartiteur. S1 branche lives, links et presence ; les autres (owners, episodes, teams) restent à brancher par leurs agents.

import type { ApiContext, ApiResult } from './api.ts';
import { listLinks, listLives } from './statsLives.ts';
import { presence } from './statsPresence.ts';

/** Routes en lecture seule (GET) déjà branchées. */
const GET_ROUTES: Record<string, (ctx: ApiContext, query: URLSearchParams) => ApiResult> = {
  '/api/stats/lives': listLives,
  '/api/stats/links': listLinks,
  '/api/stats/presence': presence,
};

/** Répond aux routes /api/stats/* ; null si la route n'en est pas une (handleApi continue alors). */
export function handleStats(ctx: ApiContext, method: string, pathname: string, query: URLSearchParams, body?: unknown): ApiResult | null {
  void body; // aucune route d'écriture branchée pour l'instant (PUT /api/stats/episodes/:id viendra avec S2)
  if (!pathname.startsWith('/api/stats/')) return null;
  const route = GET_ROUTES[pathname];
  if (route) {
    if (method !== 'GET') return { status: 405, json: { error: `Méthode ${method} non permise sur ${pathname} : GET seulement` } };
    return route(ctx, query);
  }
  return { status: 501, json: { error: `Route Stats pas encore disponible (${method} ${pathname})` } };
}
