import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiContext } from '../../server/api.ts';
import { handleStats } from '../../server/statsApi.ts';
import { gameSummary } from '../../server/statsGame.ts';
import { listScoreboard, loadGameScoreboard } from '../../server/statsScoreboard.ts';
import { insertVideo, testContext } from './helpers.ts';

const q = (s = '') => new URLSearchParams(s);

function insertGame(ctx: ApiContext): number {
  const videoId = insertVideo(ctx);
  const r = ctx.db.prepare('INSERT INTO games (video_id, start_s, end_s, map, team_a, team_b) VALUES (?, 100, 700, ?, ?, ?)').run(videoId, 'Polaris', 'Alpha', 'Bravo');
  return Number(r.lastInsertRowid);
}

const insertRow = (ctx: ApiContext, g: number, slot: number, k: number | null, d: number | null, a: number | null, score: number | null) =>
  ctx.db.prepare('INSERT INTO scoreboard (game_id, slot, kills, deaths, assists, score, name_read, t_video, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(g, slot, k, d, a, score, 'NOM', 710.5, 'ecran_de_fin');

test('scoreboard : lignes de la game seulement, dans l ordre des joueurs, n/d gardé à null', () => {
  const ctx = testContext();
  const g = insertGame(ctx);
  const other = insertGame(ctx);
  insertRow(ctx, g, 5, 11, 8, 3, 775);
  insertRow(ctx, g, 1, 10, 5, null, 700);
  insertRow(ctx, other, 1, 1, 1, 1, 25);
  const res = listScoreboard(ctx, q(`game=${g}`));
  assert.equal(res.status, 200);
  const rows = res.json as { slot: number; kills: number; assists: number | null; score: number; name_read: string }[];
  assert.deepEqual(rows.map((r) => r.slot), [1, 5]);
  assert.equal(rows[0].assists, null);
  assert.equal(rows[1].score, 775);
  assert.equal(rows[1].name_read, 'NOM');
});

test('scoreboard : game sans tableau donne un tableau vide, paramètre manquant 400, route reconnue par le répartiteur', () => {
  const ctx = testContext();
  const g = insertGame(ctx);
  assert.deepEqual(listScoreboard(ctx, q(`game=${g}`)).json, []);
  assert.equal(listScoreboard(ctx, q()).status, 400);
  const res = handleStats(ctx, 'GET', '/api/stats/scoreboard', q(`game=${g}`));
  assert.equal(res?.status, 200);
  assert.equal(handleStats(ctx, 'POST', '/api/stats/scoreboard', q(`game=${g}`))?.status, 405);
});

test('game-summary : scoreboard par joueur (valeurs officielles, null sans tableau)', () => {
  const ctx = testContext();
  const g = insertGame(ctx);
  ctx.db.prepare('INSERT INTO player_game_stats (game_id, slot, kills, deaths) VALUES (?, 1, 9, 5)').run(g);
  ctx.db.prepare('INSERT INTO player_game_stats (game_id, slot, kills, deaths) VALUES (?, 5, 3, 8)').run(g);
  insertRow(ctx, g, 1, 10, 5, 1, 700);
  const j = gameSummary(ctx, q(`game=${g}`)).json as { players: { slot: number; scoreboard: { kills: number; assists: number } | null }[] };
  const by = new Map(j.players.map((p) => [p.slot, p.scoreboard]));
  assert.deepEqual(by.get(1), { kills: 10, deaths: 5, assists: 1, score: 700 });
  assert.equal(by.get(5), null);
  assert.equal(loadGameScoreboard(ctx, g).size, 1);
});
