// Routes /api/stats/* de l'onglet Stats. Squelette de la vague 0 : les agents y branchent leurs routes (lives, links, presence, owners, episodes, teams).

import type { ApiContext, ApiResult } from './api.ts';

/** Répond aux routes /api/stats/* ; null si la route n'en est pas une (handleApi continue alors). */
export function handleStats(ctx: ApiContext, method: string, pathname: string, query: URLSearchParams, body?: unknown): ApiResult | null {
  void [ctx, query, body]; // squelette : ces paramètres serviront dès que S1 branche les routes
  if (!pathname.startsWith('/api/stats/')) return null;
  return { status: 501, json: { error: `Route Stats pas encore disponible (${method} ${pathname})` } };
}
