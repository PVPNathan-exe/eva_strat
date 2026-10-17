// Route /api/stats/scoreboard et lecture du tableau de fin de game (table scoreboard, analysis/scoreboard.py) : valeurs OFFICIELLES du jeu (kills, morts, assistances, score) par joueur.
// Une valeur null est « n/d » (lecture douteuse, jamais un chiffre deviné) ; une game sans tableau (vidéo coupée, pas encore lue) donne un tableau vide. Lecture seule.

import type { ApiContext, ApiResult } from './api.ts';
import { gameParam } from './statsOwners.ts';

/** Valeurs du tableau de fin de game pour un joueur (null : non lues). */
export interface ScoreboardValues {
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  score: number | null;
}

type Row = Record<string, unknown>;
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) ? v : null);

/** Tableau d'une game : { slot -> valeurs } ; vide si la game n'a pas de tableau lu. */
export function loadGameScoreboard(ctx: ApiContext, gameId: number): Map<number, ScoreboardValues> {
  const out = new Map<number, ScoreboardValues>();
  const rows = ctx.db.prepare('SELECT slot, kills, deaths, assists, score FROM scoreboard WHERE game_id = ?').all(gameId) as Row[];
  for (const r of rows) out.set(Number(r.slot), { kills: int(r.kills), deaths: int(r.deaths), assists: int(r.assists), score: int(r.score) });
  return out;
}

/** GET /api/stats/scoreboard?game= : [{ game_id, slot, kills, deaths, assists, score, name_read, t_video, source }] dans l'ordre des numéros de joueur ; [] sans tableau. */
export function listScoreboard(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = gameParam(query);
  if (typeof gameId === 'string') return { status: 400, json: { error: gameId } };
  const rows = ctx.db.prepare('SELECT game_id, slot, kills, deaths, assists, score, name_read, t_video, source FROM scoreboard WHERE game_id = ? ORDER BY slot').all(gameId);
  return { status: 200, json: rows };
}
