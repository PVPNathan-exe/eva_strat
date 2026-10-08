import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../../server/api.ts';
import { insertVideo, testContext } from './helpers.ts';

const q = (s = '') => new URLSearchParams(s);

test('GET /api/videos liste les vidéos', () => {
  const ctx = testContext();
  insertVideo(ctx);
  const res = handleApi(ctx, 'GET', '/api/videos', q(), undefined);
  assert.equal(res.status, 200);
  assert.equal((res.json as unknown[]).length, 1);
});

test('POST /api/games crée une game confirmée manuellement', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  const res = handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  assert.equal(res.status, 201);
  const list = handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined);
  const games = list.json as { start_s: number; status: string }[];
  assert.equal(games.length, 1);
  assert.equal(games[0].start_s, 100);
  assert.equal(games[0].status, 'confirmed');
});

test('POST /api/games refuse des bornes invalides', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx, 600);
  assert.equal(handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 50, end_s: 50 }).status, 400);
  assert.equal(handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: -5, end_s: 50 }).status, 400);
  assert.equal(handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 0, end_s: 9999 }).status, 400);
  assert.equal(handleApi(ctx, 'POST', '/api/games', q(), { video_id: 999, start_s: 0, end_s: 10 }).status, 400);
});

test('POST /api/games refuse un chevauchement', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const res = handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 600, end_s: 900 });
  assert.equal(res.status, 400);
  assert.match((res.json as { error: string }).error, /chevauche/i);
});

test('PATCH /api/games/:id modifie bornes, carte et statut', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  const res = handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { start_s: 120, end_s: 710, map: 'Silva', status: 'confirmed' });
  assert.equal(res.status, 200);
  const game = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as Record<string, unknown>[])[0];
  assert.equal(game.start_s, 120);
  assert.equal(game.end_s, 710);
  assert.equal(game.map, 'Silva');
});

test('PATCH autorise de rester sur ses propres bornes (pas de faux chevauchement)', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  assert.equal(handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { end_s: 710 }).status, 200);
});

test('PATCH refuse un statut inconnu et une game absente', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  assert.equal(handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { status: 'bidon' }).status, 400);
  assert.equal(handleApi(ctx, 'PATCH', '/api/games/9999', q(), { map: 'Silva' }).status, 404);
});

test('DELETE /api/games/:id supprime la game', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  assert.equal(handleApi(ctx, 'DELETE', `/api/games/${id}`, q(), undefined).status, 200);
  assert.equal((handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as unknown[]).length, 0);
  assert.equal(handleApi(ctx, 'DELETE', `/api/games/${id}`, q(), undefined).status, 404);
});

test('GET /api/calibrations renvoie les zones par défaut quand rien n’est enregistré', () => {
  const ctx = testContext();
  const res = handleApi(ctx, 'GET', '/api/calibrations', q('map=Silva'), undefined);
  assert.equal(res.status, 200);
  const body = res.json as { isDefault: boolean; zones: Record<string, unknown> };
  assert.equal(body.isDefault, true);
  assert.deepEqual(Object.keys(body.zones).sort(), ['capture_pct_a', 'capture_pct_b', 'capture_points', 'minimap', 'team_a_bar', 'team_b_bar', 'timer']);
});

test('PUT /api/calibrations enregistre puis relit les zones', () => {
  const ctx = testContext();
  const zones = { ...ctx.defaultZones, minimap: { x: 0.01, y: 0.7, w: 0.2, h: 0.28 } };
  assert.equal(handleApi(ctx, 'PUT', '/api/calibrations', q(), { map: 'Silva', zones }).status, 200);
  const body = handleApi(ctx, 'GET', '/api/calibrations', q('map=Silva'), undefined).json as {
    isDefault: boolean;
    zones: Record<string, { x: number }>;
  };
  assert.equal(body.isDefault, false);
  assert.equal(body.zones.minimap.x, 0.01);
  const other = handleApi(ctx, 'GET', '/api/calibrations', q('map=Atlantis'), undefined).json as { isDefault: boolean };
  assert.equal(other.isDefault, true);
});

test('PUT /api/calibrations refuse une zone hors de l’image', () => {
  const ctx = testContext();
  const zones = { ...ctx.defaultZones, minimap: { x: 0.9, y: 0.7, w: 0.3, h: 0.28 } };
  assert.equal(handleApi(ctx, 'PUT', '/api/calibrations', q(), { map: 'Silva', zones }).status, 400);
  assert.equal(handleApi(ctx, 'PUT', '/api/calibrations', q(), { map: '', zones: ctx.defaultZones }).status, 400);
});

test('route inconnue → 404', () => {
  const ctx = testContext();
  assert.equal(handleApi(ctx, 'GET', '/api/nimporte', q(), undefined).status, 404);
});

test('PATCH sans toucher aux bornes accepte une fin qui dépasse un peu la durée', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx, 1000);
  const id = Number(
    ctx.db.prepare("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 100, 1000.4, 'detected')").run(videoId).lastInsertRowid,
  );
  assert.equal(handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { map: 'Silva' }).status, 200);
  assert.equal(handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { end_s: 99999 }).status, 400);
});

test('PATCH efface les zones à vérifier à la confirmation, pas pour un simple changement de carte', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  const id = Number(
    ctx.db
      .prepare("INSERT INTO games (video_id, start_s, end_s, status, doubts) VALUES (?, 100, 700, 'detected', ?)")
      .run(videoId, JSON.stringify([{ start_s: 690, end_s: 700, label: 'x' }])).lastInsertRowid,
  );
  const doubts = () => (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { doubts: unknown[] }[])[0].doubts;
  handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { map: 'Silva' });
  assert.equal(doubts().length, 1);
  handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { status: 'confirmed' });
  assert.equal(doubts().length, 0);
});

test('les positions sont comptées par game et effacées quand on déplace une borne', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  const id = Number(ctx.db.prepare("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 100, 700, 'confirmed')").run(videoId).lastInsertRowid);
  ctx.db.prepare("INSERT INTO samples (game_id, frame, t, slot, team, x, y) VALUES (?, 0, 100, 1, 'A', 0.1, 0.2)").run(id);
  const samples = () => (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { samples: number }[])[0].samples;
  assert.equal(samples(), 1);
  handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { map: 'Silva' });
  assert.equal(samples(), 1);
  handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { end_s: 710 });
  assert.equal(samples(), 0);
});
