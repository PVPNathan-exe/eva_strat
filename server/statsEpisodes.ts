// Routes /api/stats/episodes (liste et verdict) et /api/stats/teams : retakes et rotations détectés (table episodes, remplie par analysis/stats_episodes.py).
// Le PUT du verdict est la seule écriture de tout /api/stats : l'utilisateur dit si la détection d'un épisode est juste (ok), fausse (ko) ou pas encore regardée (null).

import type { ApiContext, ApiResult } from './api.ts';
import { gameParam } from './statsOwners.ts';

const reply = (status: number, json: unknown): ApiResult => ({ status, json });
const fail = (error: string, status = 400): ApiResult => reply(status, { error });

const KINDS = ['retake', 'rotation'];
const MAP_MAX = 64;
/** Nombre de games en dessous duquel l'interface masque les résultats d'une équipe (plan Stats, section 6). */
export const TEAM_MIN_GAMES = 5;

type Row = Record<string, unknown>;

/** Décode la colonne data (JSON) ; null si elle est vide, illisible ou n'est pas un objet. */
function decodeData(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Une ligne de la table episodes avec data décodé, conforme au type Episode de src/types/stats.ts. */
function toEpisode(row: Row): Row {
  return { ...row, data: decodeData(row.data) };
}

const COLUMNS = 'e.id, e.game_id, e.kind, e.point, e.point_to, e.team, e.t0, e.t1, e.outcome, e.data, e.verdict';

/**
 * Les épisodes d'une game (?game=) ou de toutes les games d'une carte (?map=&kind=), dans l'ordre game puis temps.
 * Filtres : kind (retake ou rotation, obligatoire avec map), team (A ou B). game et map ne se combinent pas.
 */
export function listEpisodes(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const hasGame = query.get('game') !== null;
  const map = (query.get('map') ?? '').trim();
  if (hasGame && query.get('map') !== null) return fail('Paramètres game et map incompatibles : en choisir un seul');
  if (!hasGame && query.get('map') === null) return fail('Paramètre game ou map manquant');

  const kind = query.get('kind');
  if (kind !== null && !KINDS.includes(kind)) return fail('Paramètre kind invalide : retake ou rotation attendu');
  const team = query.get('team');
  if (team !== null && team !== 'A' && team !== 'B') return fail('Paramètre team invalide : A ou B attendu');

  const where: string[] = [];
  const args: (string | number)[] = [];
  let from = 'episodes e';
  if (hasGame) {
    const gameId = gameParam(query);
    if (typeof gameId === 'string') return fail(gameId);
    where.push('e.game_id = ?');
    args.push(gameId);
  } else {
    if (map === '') return fail('Paramètre map manquant');
    if (map.length > MAP_MAX) return fail('Paramètre map invalide : nom de carte trop long');
    if (kind === null) return fail('Paramètre kind manquant : retake ou rotation attendu avec map');
    from = 'episodes e JOIN games g ON g.id = e.game_id';
    where.push('g.map = ?');
    args.push(map);
  }
  if (kind !== null) {
    where.push('e.kind = ?');
    args.push(kind);
  }
  if (team !== null) {
    where.push('e.team = ?');
    args.push(team);
  }
  const rows = ctx.db
    .prepare(`SELECT ${COLUMNS} FROM ${from} WHERE ${where.join(' AND ')} ORDER BY e.game_id, e.t0, e.id`)
    .all(...args) as Row[];
  return reply(200, rows.map(toEpisode));
}

/** PUT /api/stats/episodes/:id avec { verdict: 'ok' | 'ko' | null } : enregistre le jugement de l'utilisateur et renvoie l'épisode à jour. */
export function putVerdict(ctx: ApiContext, idText: string, body: unknown): ApiResult {
  if (!/^[1-9]\d{0,14}$/.test(idText)) return fail("Identifiant d'épisode invalide : un entier positif est attendu");
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Corps invalide : un objet { verdict } est attendu');
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'verdict') return fail('Corps invalide : seul le champ verdict est permis');
  const verdict = (body as { verdict: unknown }).verdict;
  if (verdict !== 'ok' && verdict !== 'ko' && verdict !== null) return fail("Champ verdict invalide : 'ok', 'ko' ou null attendu");

  const id = Number(idText);
  const found = ctx.db.prepare('UPDATE episodes SET verdict = ? WHERE id = ?').run(verdict, id);
  if (Number(found.changes) === 0) return fail(`Épisode ${id} introuvable`, 404);
  const row = ctx.db.prepare(`SELECT ${COLUMNS} FROM episodes e WHERE e.id = ?`).get(id) as Row;
  return reply(200, toEpisode(row));
}

/**
 * GET /api/stats/teams?map=&team= : réponse minimale (vague 4 pour le reste) = nombre de games de l'équipe sur la carte et seuil d'affichage.
 * L'équipe est identifiée par son nom saisi (games.team_a ou team_b), la signature d'équipe n'est pas encore définie.
 */
export function teamAggregate(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const map = (query.get('map') ?? '').trim();
  if (map === '') return fail('Paramètre map manquant');
  if (map.length > MAP_MAX) return fail('Paramètre map invalide : nom de carte trop long');
  const team = (query.get('team') ?? '').trim();
  if (team === '') return fail("Paramètre team manquant : le nom de l'équipe est attendu");
  if (team.length > 60) return fail("Paramètre team invalide : nom d'équipe trop long");
  const count = ctx.db
    .prepare('SELECT COUNT(*) AS n FROM games WHERE map = ? AND (team_a = ? OR team_b = ?)')
    .get(map, team, team) as { n: number };
  return reply(200, { team, map, games: Number(count.n), min: TEAM_MIN_GAMES });
}
