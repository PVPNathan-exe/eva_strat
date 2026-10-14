// Routes /api/stats/lives et /api/stats/links : vies et liens entre kills d'une game (tables lives et kill_links, remplies par analysis/stats_lives.py). Lecture seule.

import type { ApiContext, ApiResult } from './api.ts';

const reply = (status: number, json: unknown): ApiResult => ({ status, json });
const fail = (error: string, status = 400): ApiResult => reply(status, { error });

/** Lit le paramètre game : entier strictement positif, sinon un message d'erreur clair. */
function gameParam(query: URLSearchParams): number | string {
  const raw = query.get('game');
  if (raw === null || raw.trim() === '') return 'Paramètre game manquant';
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) return 'Paramètre game invalide : un identifiant de game (entier positif) est attendu';
  return id;
}

/** Les vies d'une game, dans l'ordre joueur puis apparition : [{ game_id, slot, idx, t0, t1, x0, y0, x1, y1, ended, killer_slot, weapon, kill_kind }]. */
export function listLives(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = gameParam(query);
  if (typeof gameId === 'string') return fail(gameId);
  const rows = ctx.db
    .prepare(
      'SELECT game_id, slot, idx, t0, t1, x0, y0, x1, y1, ended, killer_slot, weapon, kill_kind FROM lives WHERE game_id = ? ORDER BY slot, idx',
    )
    .all(gameId);
  return reply(200, rows);
}

/** L'équipement de chaque vie d'une game avec les bornes de la vie : [{ game_id, slot, life_idx, weapon1, weapon2, gadget, held, source, t0, t1 }] (identifiants d'icônes, temps en secondes depuis le début de la game). */
export function listLifeLoadouts(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = gameParam(query);
  if (typeof gameId === 'string') return fail(gameId);
  const rows = ctx.db
    .prepare(
      'SELECT l.game_id, l.slot, l.life_idx, l.weapon1, l.weapon2, l.gadget, l.held, l.source, v.t0, v.t1 FROM life_loadouts l JOIN lives v ON v.game_id = l.game_id AND v.slot = l.slot AND v.idx = l.life_idx WHERE l.game_id = ? ORDER BY l.slot, l.life_idx',
    )
    .all(gameId);
  return reply(200, rows);
}

/** Les trades et revenges d'une game, dans l'ordre du temps : [{ game_id, t, victim_slot, kind, other_slot, dt, dist_m }]. */
export function listLinks(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = gameParam(query);
  if (typeof gameId === 'string') return fail(gameId);
  const rows = ctx.db
    .prepare('SELECT game_id, t, victim_slot, kind, other_slot, dt, dist_m FROM kill_links WHERE game_id = ? ORDER BY t, victim_slot, kind')
    .all(gameId);
  return reply(200, rows);
}
