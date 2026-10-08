// Logique REST de l'onglet Analyse (fonctions pures, testables sans serveur HTTP).

import type { DatabaseSync } from 'node:sqlite';

export const ZONE_NAMES = ['minimap', 'capture_points', 'team_a_bar', 'team_b_bar', 'timer'] as const;
export type ZoneName = (typeof ZONE_NAMES)[number];
export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Zones = Record<ZoneName, Zone>;

export interface ApiContext {
  db: DatabaseSync;
  defaultZones: Zones;
}

export interface ApiResult {
  status: number;
  json: unknown;
}

type Row = Record<string, unknown>;

const reply = (status: number, json: unknown): ApiResult => ({ status, json });
const fail = (error: string, status = 400): ApiResult => reply(status, { error });
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const STATUSES = ['detected', 'confirmed'];

function validateBounds(db: DatabaseSync, videoId: number, start: unknown, end: unknown, selfId?: number): string | null {
  const s = num(start);
  const e = num(end);
  if (s === null || e === null) return 'start_s et end_s doivent être des nombres';
  if (s < 0 || e <= s) return 'Bornes invalides : il faut 0 ≤ début < fin';
  const video = db.prepare('SELECT duration_s FROM videos WHERE id = ?').get(videoId) as Row | undefined;
  if (!video) return 'Vidéo inconnue';
  if (e > (video.duration_s as number) + 0.5) return 'La fin dépasse la durée de la vidéo';
  const clash = db
    .prepare('SELECT id FROM games WHERE video_id = ? AND id <> ? AND start_s < ? AND end_s > ?')
    .get(videoId, selfId ?? -1, e, s);
  if (clash) return 'Cette game chevauche une autre game';
  return null;
}

function listGames(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const videoId = Number(query.get('video'));
  if (!Number.isInteger(videoId)) return fail('Paramètre video manquant');
  const rows = ctx.db
    .prepare('SELECT id, video_id, start_s, end_s, map, status, winner, doubts, (SELECT COUNT(*) FROM samples s WHERE s.game_id = games.id) AS samples FROM games WHERE video_id = ? ORDER BY start_s')
    .all(videoId) as Row[];
  return reply(
    200,
    rows.map((r) => ({ ...r, doubts: typeof r.doubts === 'string' ? JSON.parse(r.doubts) : [] })),
  );
}

function createGame(ctx: ApiContext, body: Row): ApiResult {
  const videoId = num(body.video_id);
  if (videoId === null) return fail('video_id manquant');
  const error = validateBounds(ctx.db, videoId, body.start_s, body.end_s);
  if (error) return fail(error);
  const map = typeof body.map === 'string' && body.map ? body.map : null;
  const result = ctx.db
    .prepare("INSERT INTO games (video_id, start_s, end_s, map, status) VALUES (?, ?, ?, ?, 'confirmed')")
    .run(videoId, body.start_s as number, body.end_s as number, map);
  return reply(201, { id: Number(result.lastInsertRowid) });
}

function patchGame(ctx: ApiContext, id: number, body: Row): ApiResult {
  const current = ctx.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as Row | undefined;
  if (!current) return fail('Game introuvable', 404);
  const start = body.start_s ?? current.start_s;
  const end = body.end_s ?? current.end_s;
  // Bornes revalidées seulement si on les modifie (une game existante peut dépasser un peu la durée).
  if ('start_s' in body || 'end_s' in body) {
    const error = validateBounds(ctx.db, current.video_id as number, start, end, id);
    if (error) return fail(error);
  }
  const status = body.status ?? current.status;
  if (typeof status !== 'string' || !STATUSES.includes(status)) return fail('Statut inconnu');
  const map = 'map' in body ? (typeof body.map === 'string' && body.map ? body.map : null) : (current.map as string | null);
  const winner = 'winner' in body ? (typeof body.winner === 'string' && body.winner ? body.winner : null) : (current.winner as string | null);
  // Des bornes déplacées rendent les positions déjà lues caduques : elles seront relues à la prochaine analyse.
  if ('start_s' in body || 'end_s' in body) ctx.db.prepare('DELETE FROM samples WHERE game_id = ?').run(id);
  // Les zones à vérifier ne valent plus rien une fois la game confirmée ou ses bornes déplacées.
  const clearDoubts = status !== current.status || 'start_s' in body || 'end_s' in body;
  ctx.db
    .prepare('UPDATE games SET start_s = ?, end_s = ?, map = ?, status = ?, winner = ?, doubts = CASE WHEN ? THEN NULL ELSE doubts END, checked = CASE WHEN ? THEN 0 ELSE checked END WHERE id = ?')
    .run(start as number, end as number, map, status, winner, clearDoubts ? 1 : 0, 'start_s' in body || 'end_s' in body ? 1 : 0, id);
  return reply(200, { ok: true });
}

function deleteGame(ctx: ApiContext, id: number): ApiResult {
  const result = ctx.db.prepare('DELETE FROM games WHERE id = ?').run(id);
  return result.changes ? reply(200, { ok: true }) : fail('Game introuvable', 404);
}

function getCalibration(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const map = query.get('map');
  if (!map) return fail('Paramètre map manquant');
  const rows = ctx.db.prepare('SELECT zone, x, y, w, h FROM calibrations WHERE map = ?').all(map) as unknown as (Zone & { zone: ZoneName })[];
  const zones: Zones = { ...ctx.defaultZones };
  for (const r of rows) zones[r.zone] = { x: r.x, y: r.y, w: r.w, h: r.h };
  return reply(200, { map, zones, isDefault: rows.length === 0 });
}

function validZone(z: unknown): z is Zone {
  if (!z || typeof z !== 'object') return false;
  const { x, y, w, h } = z as Record<string, unknown>;
  if (![x, y, w, h].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  const [X, Y, W, H] = [x, y, w, h] as number[];
  return X >= 0 && Y >= 0 && W > 0 && H > 0 && X + W <= 1.0001 && Y + H <= 1.0001;
}

function putCalibration(ctx: ApiContext, body: Row): ApiResult {
  const map = typeof body.map === 'string' ? body.map.trim() : '';
  if (!map) return fail('Nom de carte manquant');
  const zones = body.zones as Record<string, unknown> | undefined;
  if (!zones) return fail('Zones manquantes');
  for (const name of ZONE_NAMES) {
    if (!validZone(zones[name])) return fail(`Zone invalide : ${name}`);
  }
  const upsert = ctx.db.prepare(
    `INSERT INTO calibrations (map, zone, x, y, w, h) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(map, zone) DO UPDATE SET x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h`,
  );
  ctx.db.exec('BEGIN');
  try {
    for (const name of ZONE_NAMES) {
      const z = zones[name] as Zone;
      upsert.run(map, name, z.x, z.y, z.w, z.h);
    }
    ctx.db.exec('COMMIT');
  } catch (err) {
    ctx.db.exec('ROLLBACK');
    throw err;
  }
  return reply(200, { ok: true });
}

export function handleApi(
  ctx: ApiContext,
  method: string,
  pathname: string,
  query: URLSearchParams,
  body: unknown,
): ApiResult {
  const payload = (body && typeof body === 'object' ? body : {}) as Row;

  if (method === 'GET' && pathname === '/api/videos') {
    return reply(200, ctx.db.prepare('SELECT id, path, source_url, duration_s, fps, width, height FROM videos ORDER BY id DESC').all());
  }
  if (pathname === '/api/games') {
    if (method === 'GET') return listGames(ctx, query);
    if (method === 'POST') return createGame(ctx, payload);
  }
  const gameMatch = /^\/api\/games\/(\d+)$/.exec(pathname);
  if (gameMatch) {
    const id = Number(gameMatch[1]);
    if (method === 'PATCH') return patchGame(ctx, id, payload);
    if (method === 'DELETE') return deleteGame(ctx, id);
  }
  if (pathname === '/api/calibrations') {
    if (method === 'GET') return getCalibration(ctx, query);
    if (method === 'PUT') return putCalibration(ctx, payload);
  }
  return fail('Route inconnue', 404);
}
