// Routes /api/stats/* de l'onglet Stats. Squelette de la vague 0 : les agents y branchent leurs routes (lives, links, presence, owners, episodes, teams).

import type { ApiContext, ApiResult } from './api.ts';

/** Répond aux routes /api/stats/* ; null si la route n'en est pas une (handleApi continue alors). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- squelette : les paramètres serviront dès que S1 branche les routes
export function handleStats(ctx: ApiContext, method: string, pathname: string, query: URLSearchParams, body?: unknown): ApiResult | null {
  if (!pathname.startsWith('/api/stats/')) return null;
  return { status: 501, json: { error: 'Route Stats pas encore disponible' } };
}
