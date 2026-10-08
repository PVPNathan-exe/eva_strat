// Logique REST de l'onglet Analyse (fonctions pures, testables sans serveur HTTP).

import type { DatabaseSync } from 'node:sqlite';
import { resolveStuff } from './weapons.ts';

export const ZONE_NAMES = ['minimap', 'capture_points', 'capture_pct_a', 'capture_pct_b', 'team_a_bar', 'team_b_bar', 'timer'] as const;
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
  /** Noms donnés aux icônes d'armes (names.json) ; absent dans les tests qui n'en ont pas besoin. */
  weaponNames?: () => Record<string, string>;
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
  type KillOut = { t: number; killer: number | null; victim: number; weapon: string | null; weaponName: string | null; stuff: string | null; headshot: boolean; kind: string | null };
  const kills = new Map<number, KillOut[]>();
  const names = ctx.weaponNames?.() ?? {};
  for (const k of ctx.db
    .prepare('SELECT game_id, t, killer_slot, victim_slot, weapon, headshot, kind FROM kills WHERE game_id IN (SELECT id FROM games WHERE video_id = ?) ORDER BY t')
    .all(videoId) as { game_id: number; t: number; killer_slot: number | null; victim_slot: number; weapon: string | null; headshot: number; kind: string | null }[]) {
    kills.set(k.game_id, [...(kills.get(k.game_id) ?? []), { t: k.t, killer: k.killer_slot, victim: k.victim_slot, weapon: k.weapon, weaponName: null, stuff: null, headshot: !!k.headshot, kind: k.kind }]);
  }
  type PlayerRow = { game_id: number; slot: number; name: string; weapon1: string | null; weapon2: string | null; gadget: string | null };
  const players = new Map<number, Omit<PlayerRow, 'game_id'>[]>();
  for (const p of ctx.db
    .prepare(
      `SELECT p.game_id, p.slot, p.name, l.weapon1, l.weapon2, l.gadget FROM players p
       LEFT JOIN loadouts l ON l.game_id = p.game_id AND l.slot = p.slot
       WHERE p.game_id IN (SELECT id FROM games WHERE video_id = ?) ORDER BY p.slot`,
    )
    .all(videoId) as PlayerRow[]) {
    players.set(p.game_id, [...(players.get(p.game_id) ?? []), { slot: p.slot, name: p.name, weapon1: p.weapon1, weapon2: p.weapon2, gadget: p.gadget }]);
  }
  return reply(
    200,
    rows.map((r) => {
      const gamePlayers = players.get(r.id as number) ?? [];
      return {
        ...r,
        doubts: typeof r.doubts === 'string' ? JSON.parse(r.doubts) : [],
        players: gamePlayers,
        kills: (kills.get(r.id as number) ?? []).map((k) => {
          const weaponName = k.weapon ? (names[k.weapon] ?? null) : null;
          const gadget = gamePlayers.find((p) => p.slot === k.killer)?.gadget;
          return { ...k, weaponName, stuff: resolveStuff(weaponName, gadget ? (names[gadget] ?? null) : null) };
        }),
      };
    }),
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
  if ('start_s' in body || 'end_s' in body) {
    ctx.db.prepare('DELETE FROM samples WHERE game_id = ?').run(id);
    ctx.db.prepare('DELETE FROM kills WHERE game_id = ?').run(id);
    ctx.db.prepare('DELETE FROM kills_meta WHERE game_id = ?').run(id);
    ctx.db.prepare("DELETE FROM capture_state WHERE game_id = ? AND point IN ('score_A', 'score_B')").run(id);
  }
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

function listSamples(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = Number(query.get('game'));
  if (query.get('game') === null || !Number.isInteger(gameId)) return fail('Paramètre game manquant');
  const rows = ctx.db
    .prepare('SELECT frame, t, slot, team, x, y, angle, alive, confidence FROM samples WHERE game_id = ? ORDER BY frame, slot')
    .all(gameId);
  return reply(200, rows);
}

function getCapture(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = Number(query.get('game'));
  if (query.get('game') === null || !Number.isInteger(gameId)) return fail('Paramètre game manquant');
  const rows = ctx.db
    .prepare("SELECT t, pct, team FROM capture_state WHERE game_id = ? AND point IN ('score_A', 'score_B') ORDER BY t")
    .all(gameId) as { t: number; pct: number; team: 'A' | 'B' }[];
  const out: Record<'A' | 'B', { t: number; v: number }[]> = { A: [], B: [] };
  for (const r of rows) out[r.team].push({ t: r.t, v: r.pct });
  return reply(200, out);
}

const teamOf = (slot: number) => (slot <= 4 ? 'A' : 'B');
const validSlot = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 8;

/** Échange deux joueurs entre t0 et t1 dans les positions enregistrées (même logique que db.swap_slots côté Python). */
export function swapSlots(db: DatabaseSync, gameId: number, a: number, b: number, t0: number, t1: number): void {
  const rows = db
    .prepare('SELECT * FROM samples WHERE game_id = ? AND slot IN (?, ?) AND t BETWEEN ? AND ?')
    .all(gameId, a, b, t0, t1) as Record<string, number | null>[];
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM samples WHERE game_id = ? AND slot IN (?, ?) AND t BETWEEN ? AND ?').run(gameId, a, b, t0, t1);
    const insert = db.prepare(
      'INSERT OR REPLACE INTO samples (game_id, frame, t, slot, team, x, y, angle, alive, hp, weapon, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const r of rows) {
      insert.run(gameId, r.frame, r.t, r.slot === a ? b : a, r.team as never, r.x, r.y, r.angle, r.alive, r.hp, r.weapon as never, r.confidence);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function listCorrections(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = Number(query.get('game'));
  if (query.get('game') === null || !Number.isInteger(gameId)) return fail('Paramètre game manquant');
  return reply(200, ctx.db.prepare('SELECT id, t0, t1, slot_a, slot_b FROM corrections WHERE game_id = ? ORDER BY id').all(gameId));
}

function createCorrection(ctx: ApiContext, body: Row): ApiResult {
  const { game_id, t0, t1, slot_a, slot_b } = body;
  if (!validSlot(slot_a) || !validSlot(slot_b) || slot_a === slot_b) return fail('Deux joueurs différents sont nécessaires');
  if (teamOf(slot_a) !== teamOf(slot_b)) return fail('On ne peut échanger que deux joueurs de la même équipe');
  const gid = num(game_id);
  const a = num(t0);
  const b = num(t1);
  if (gid === null || a === null || b === null || b <= a) return fail('Période invalide');
  if (!ctx.db.prepare('SELECT 1 FROM games WHERE id = ?').get(gid)) return fail('Game introuvable', 404);
  swapSlots(ctx.db, gid, slot_a, slot_b, a, b);
  const result = ctx.db.prepare('INSERT INTO corrections (game_id, t0, t1, slot_a, slot_b) VALUES (?, ?, ?, ?, ?)').run(gid, a, b, slot_a, slot_b);
  return reply(201, { id: Number(result.lastInsertRowid) });
}

function deleteCorrection(ctx: ApiContext, id: number): ApiResult {
  const c = ctx.db.prepare('SELECT game_id, t0, t1, slot_a, slot_b FROM corrections WHERE id = ?').get(id) as Record<string, number> | undefined;
  if (!c) return fail('Correction introuvable', 404);
  swapSlots(ctx.db, c.game_id, c.slot_a, c.slot_b, c.t0, c.t1); // un échange refait annule le précédent
  ctx.db.prepare('DELETE FROM corrections WHERE id = ?').run(id);
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
  if (method === 'GET' && pathname === '/api/samples') return listSamples(ctx, query);
  if (method === 'GET' && pathname === '/api/capture') return getCapture(ctx, query);
  if (pathname === '/api/corrections') {
    if (method === 'GET') return listCorrections(ctx, query);
    if (method === 'POST') return createCorrection(ctx, payload);
  }
  const correctionMatch = /^\/api\/corrections\/(\d+)$/.exec(pathname);
  if (correctionMatch && method === 'DELETE') return deleteCorrection(ctx, Number(correctionMatch[1]));
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
