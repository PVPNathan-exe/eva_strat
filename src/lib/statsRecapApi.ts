// Appels HTTP de la vue Récap vers les routes de Stats 2 (server/statsGame.ts). Une route pas encore branchée répond 501 : StatsUnavailableError, comme statsApi.ts.

import { parse } from './analysisApi.ts';
import { StatsUnavailableError } from './statsApi.ts';
import type { GameSummary } from '../types/statsRecap.ts';

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 501) throw new StatsUnavailableError();
  return parse<T>(res);
}

export const statsRecapApi = {
  /** Récap d'une game : bilan par joueur, notes des kills et des morts, changements de point. */
  gameSummary: (gameId: number) => getJson<GameSummary>(`/api/stats/game-summary?game=${gameId}`),
};
