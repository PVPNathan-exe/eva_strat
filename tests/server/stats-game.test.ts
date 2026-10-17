import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiContext } from '../../server/api.ts';
import { gameSummary, listDuels, listGadgets, listKillScores, listPlayerStats } from '../../server/statsGame.ts';
import { insertVideo, testContext } from './helpers.ts';

const q = (s = '') => new URLSearchParams(s);
const errorOf = (res: { json: unknown }) => (res.json as { error: string }).error;

function insertGame(ctx: ApiContext, map: string, startS = 100): number {
  const videoId = insertVideo(ctx);
  const r = ctx.db
    .prepare('INSERT INTO games (video_id, start_s, end_s, map, team_a, team_b) VALUES (?, ?, ?, ?, ?, ?)')
    .run(videoId, startS, startS + 600, map, 'Alpha', 'Bravo');
  return Number(r.lastInsertRowid);
}

test("gadgets, duels, kill-scores, player-stats : lignes d'une game seulement, ordre et décodage", () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  const other = insertGame(ctx, 'Polaris');

  const gad = ctx.db.prepare('INSERT INTO gadget_state (game_id, slot, t0, t1, gadget, state) VALUES (?, ?, ?, ?, ?, ?)');
  gad.run(g, 2, 30, 50, 'DX3', 'used');
  gad.run(g, 1, 40, 60, 'DX3', 'ready');
  gad.run(g, 2, 0, 30, 'DX3', 'ready');
  gad.run(other, 1, 0, 10, 'DX3', 'ready');
  const gadgets = listGadgets(ctx, q(`game=${g}`)).json as { slot: number; t0: number; state: string }[];
  assert.deepEqual(gadgets.map((r) => [r.slot, r.t0, r.state]), [[1, 40, 'ready'], [2, 0, 'ready'], [2, 30, 'used']]);

  const duel = ctx.db.prepare('INSERT INTO duels (game_id, t0, t1, slot_a, slot_b, winner_slot, outcome, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  duel.run(g, 50, 55, 1, 5, 1, 'kill', '{"hp":{"1":40,"5":0}}');
  duel.run(g, 10, 14, 2, 6, null, 'indecis', null);
  duel.run(g, 80, 84, 3, 7, 7, 'kill', 'pas du json');
  duel.run(other, 1, 2, 1, 5, 1, 'kill', null);
  const duels = listDuels(ctx, q(`game=${g}`)).json as { t0: number; data: unknown }[];
  assert.deepEqual(duels.map((d) => d.t0), [10, 50, 80]);
  assert.equal(duels[0].data, null);
  assert.deepEqual(duels[1].data, { hp: { '1': 40, '5': 0 } });
  assert.equal(duels[2].data, null);

  const sc = ctx.db.prepare('INSERT INTO kill_scores (game_id, t, killer_slot, victim_slot, impact, reasons) VALUES (?, ?, ?, ?, ?, ?)');
  sc.run(g, 60, 1, 5, 2, '["premier kill","gagne le teamfight"]');
  sc.run(g, 20, null, 6, -1, null);
  sc.run(other, 5, 1, 5, 1, '[]');
  const scores = listKillScores(ctx, q(`game=${g}`)).json as { t: number; reasons: string[] | null }[];
  assert.deepEqual(scores.map((s) => s.t), [20, 60]);
  assert.equal(scores[0].reasons, null);
  assert.deepEqual(scores[1].reasons, ['premier kill', 'gagne le teamfight']);

  const st = ctx.db.prepare('INSERT INTO player_game_stats (game_id, slot, kills, deaths, v_p98) VALUES (?, ?, ?, ?, ?)');
  st.run(g, 5, 1, 2, 3.1);
  st.run(g, 1, 4, 0, 2.5);
  const stats = listPlayerStats(ctx, q(`game=${g}`)).json as { slot: number; kills: number; gadget_uses: number | null; duels_won: number }[];
  assert.deepEqual(stats.map((s) => s.slot), [1, 5]);
  assert.equal(stats[0].kills, 4);
  assert.equal(stats[0].gadget_uses, null);
  assert.equal(stats[0].duels_won, 0);
});

test('les routes de game : game absente ou invalide = 400, game inconnue = liste vide', () => {
  const ctx = testContext();
  for (const route of [listGadgets, listDuels, listKillScores, listPlayerStats, gameSummary]) {
    assert.equal(route(ctx, q()).status, 400);
    assert.match(errorOf(route(ctx, q('game=abc'))), /game/);
    assert.equal(route(ctx, q('game=0')).status, 400);
    assert.equal(route(ctx, q('game=1.5')).status, 400);
  }
  for (const route of [listGadgets, listDuels, listKillScores, listPlayerStats]) {
    const res = route(ctx, q('game=999'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, []);
  }
});

test('game-summary : bilan par joueur, notes vues des deux équipes, totaux par équipe, nombre de games et seuil', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  const pl = ctx.db.prepare('INSERT INTO players (game_id, slot, name) VALUES (?, ?, ?)');
  pl.run(g, 1, 'Ana');
  pl.run(g, 5, 'Bob');
  const st = ctx.db.prepare(
    'INSERT INTO player_game_stats (game_id, slot, kills, deaths, gadget_uses, gadget_unused_at_death, gadget_possible, duels_won, duels_lost, duels_other) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  st.run(g, 1, 3, 1, 2, 0, 4, 2, 0, 1);
  st.run(g, 2, 1, 2, null, null, null, 0, 1, 0);
  st.run(g, 5, 1, 3, 1, 1, 2.5, 0, 2, 0);
  const sc = ctx.db.prepare('INSERT INTO kill_scores (game_id, t, killer_slot, victim_slot, impact, reasons) VALUES (?, ?, ?, ?, ?, ?)');
  sc.run(g, 30, 1, 5, 2, '["premier de la vague"]');
  sc.run(g, 70, 1, 6, 1, null);
  sc.run(g, 90, 5, 1, -2, '["perd le teamfight"]');
  const pa = ctx.db.prepare('INSERT INTO point_active (game_id, point, t0, t1, source) VALUES (?, ?, ?, ?, ?)');
  pa.run(g, 'C', 0, 85, 'schedule');
  pa.run(g, 'B', 85, 175, 'schedule');
  pa.run(g, 'A', 175, 235, 'schedule');

  const res = gameSummary(ctx, q(`game=${g}`));
  assert.equal(res.status, 200);
  const j = res.json as {
    map: string;
    point_changes: number;
    games: number;
    min: number;
    game: { duration_s: number; team_a: string };
    players: {
      slot: number;
      team: string;
      name: string | null;
      has_stats: boolean;
      kill_score_sum: number;
      death_score_sum: number;
      score_sum: number;
      kill_notes: { t: number; other_slot: number; impact: number; reasons: string[] | null }[];
      death_notes: { t: number; other_slot: number | null; impact: number }[];
    }[];
    teams: Record<'A' | 'B', Record<string, number | null>>;
  };
  assert.equal(j.map, 'Polaris');
  assert.equal(j.point_changes, 2);
  assert.equal(j.games, 1);
  assert.equal(j.min, 5);
  assert.equal(j.game.duration_s, 600);
  assert.equal(j.game.team_a, 'Alpha');
  assert.deepEqual(j.players.map((p) => p.slot), [1, 2, 5, 6]);
  const ana = j.players[0];
  assert.equal(ana.name, 'Ana');
  assert.equal(ana.team, 'A');
  assert.equal(ana.kill_score_sum, 3);
  assert.deepEqual(ana.kill_notes.map((n) => [n.t, n.other_slot, n.impact]), [[30, 5, 2], [70, 6, 1]]);
  assert.deepEqual(ana.kill_notes[0].reasons, ['premier de la vague']);
  // La mort vue du côté du mort : impact opposé à celui du tueur (la table est du point de vue de l'équipe du tueur).
  assert.deepEqual(ana.death_notes.map((n) => [n.t, n.other_slot, n.impact]), [[90, 5, 2]]);
  assert.equal(ana.score_sum, 5);
  const bob = j.players[2];
  assert.equal(bob.kill_score_sum, -2);
  assert.equal(bob.death_score_sum, -2); // morts de Bob : kills 30 (impact 2, vu de Bob -2)
  assert.equal(j.players[1].has_stats, true);
  assert.equal(j.players[3].has_stats, false); // joueur 6 : mort notée, aucune ligne de bilan
  assert.equal(j.teams.A.kills, 4);
  assert.equal(j.teams.A.gadget_uses, 2); // une seule valeur lue : le null est ignoré, pas compté comme zéro
  assert.equal(j.teams.A.gadget_possible, null); // un joueur de l'équipe sans valeur : pas de total partiel
  assert.equal(j.teams.A.duels_won, 2);
  assert.equal(j.teams.B.deaths, 3);
  assert.equal(j.teams.A.kill_score_sum, 3);
});

test('game-summary : Engine et Helios Station sans changement de point, game vide, game inconnue 404', () => {
  const ctx = testContext();
  const engine = insertGame(ctx, 'Engine');
  const helios = insertGame(ctx, 'Helios  Station');
  const pa = ctx.db.prepare('INSERT INTO point_active (game_id, point, t0, t1, source) VALUES (?, ?, ?, ?, ?)');
  for (const id of [engine, helios]) {
    pa.run(id, 'A', 0, 100, 'hud');
    pa.run(id, 'B', 100, 200, 'hud');
  }
  assert.equal((gameSummary(ctx, q(`game=${engine}`)).json as { point_changes: number }).point_changes, 0);
  assert.equal((gameSummary(ctx, q(`game=${helios}`)).json as { point_changes: number }).point_changes, 0);

  const empty = insertGame(ctx, 'Atlantis');
  const e = gameSummary(ctx, q(`game=${empty}`));
  assert.equal(e.status, 200);
  assert.equal((e.json as { point_changes: number }).point_changes, 0);
  assert.deepEqual((e.json as { players: unknown[] }).players, []);

  const missing = gameSummary(ctx, q('game=999'));
  assert.equal(missing.status, 404);
  assert.match(errorOf(missing), /introuvable/);
});

test('game-summary : un point resté allumé sur le HUD ne compte pas comme un changement (Outlaw, game 32 : C, B, A, B, D, B, B donne 5)', () => {
  const ctx = testContext();
  const id = insertGame(ctx, 'Outlaw');
  const pa = ctx.db.prepare('INSERT INTO point_active (game_id, point, t0, t1, source) VALUES (?, ?, ?, ?, ?)');
  [['C', 37, 127], ['B', 127, 217], ['A', 217, 307], ['B', 308, 397], ['D', 397, 539], ['B', 489, 511], ['B', 525, 539]].forEach(([p, a, b]) => pa.run(id, p, a, b, 'hud'));
  assert.equal((gameSummary(ctx, q(`game=${id}`)).json as { point_changes: number }).point_changes, 5);
});

test('game-summary : la note de la mort vient de death_impact quand elle existe (bouclier humain), sinon l ancienne règle (opposé du kill)', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  const pl = ctx.db.prepare('INSERT INTO players (game_id, slot, name) VALUES (?, ?, ?)');
  pl.run(g, 1, 'Ana');
  pl.run(g, 5, 'Bob');
  const sc = ctx.db.prepare('INSERT INTO kill_scores (game_id, t, killer_slot, victim_slot, impact, reasons, death_impact) VALUES (?, ?, ?, ?, ?, ?, ?)');
  sc.run(g, 30, 5, 1, 2, '["bouclier humain"]', 1); // Ana meurt en bouclier humain : sa mort vaut +1, pas -2
  sc.run(g, 60, 1, 5, 1, '[]', null); // ancien calcul : la mort de Bob vaut -1
  const j = gameSummary(ctx, q(`game=${g}`)).json as { players: { slot: number; kill_score_sum: number; death_score_sum: number; death_notes: { impact: number }[] }[] };
  const ana = j.players.find((p) => p.slot === 1)!;
  const bob = j.players.find((p) => p.slot === 5)!;
  assert.deepEqual(ana.death_notes.map((n) => n.impact), [1]);
  assert.equal(ana.death_score_sum, 1);
  assert.deepEqual(bob.death_notes.map((n) => n.impact), [-1]);
  assert.equal(bob.kill_score_sum, 2);
});
