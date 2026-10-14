// Route /api/stats/owners : propriétaire de chaque point de capture au cours d'une game (table point_owner, remplie par analysis/stats_owners.py). Lecture seule.

import type { ApiContext, ApiResult } from './api.ts';

const reply = (status: number, json: unknown): ApiResult => ({ status, json });
const fail = (error: string, status = 400): ApiResult => reply(status, { error });

/** Lit le paramètre game : entier strictement positif, sinon un message d'erreur clair (partagé avec statsEpisodes). */
export function gameParam(query: URLSearchParams): number | string {
  const raw = query.get('game');
  if (raw === null || raw.trim() === '') return 'Paramètre game manquant';
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) return 'Paramètre game invalide : un identifiant de game (entier positif) est attendu';
  return id;
}

/** Les périodes de propriété d'une game, dans l'ordre point puis temps : [{ game_id, point, t0, t1, owner, source }] (temps en secondes depuis le début de la game). */
export function listOwners(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = gameParam(query);
  if (typeof gameId === 'string') return fail(gameId);
  const rows = ctx.db
    .prepare('SELECT game_id, point, t0, t1, owner, source FROM point_owner WHERE game_id = ? ORDER BY point, t0')
    .all(gameId);
  return reply(200, rows);
}

/** Les périodes où chaque point est ACTIF (clignote sous le chrono, ou dont la boîte est dessinée) : [{ game_id, point, t0, t1, source }], dans l'ordre temps puis point (temps en secondes depuis le début de la game). */
export function listActive(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = gameParam(query);
  if (typeof gameId === 'string') return fail(gameId);
  const rows = ctx.db.prepare('SELECT game_id, point, t0, t1, source FROM point_active WHERE game_id = ? ORDER BY t0, point').all(gameId);
  return reply(200, rows);
}
