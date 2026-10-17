import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiContext } from '../../server/api.ts';
import { gameSummary } from '../../server/statsGame.ts';
import { playersSummary, teamsSummary } from '../../server/statsPlayers.ts';
import { meanRating, teamRatingOfGame } from '../../server/statsRatings.ts';
import { insertVideo, testContext } from './helpers.ts';

const q = (s = '') => new URLSearchParams(s);

function insertGame(ctx: ApiContext, map: string, teamA: string, teamB: string): number {
  const videoId = insertVideo(ctx);
  const r = ctx.db.prepare('INSERT INTO games (video_id, start_s, end_s, map, team_a, team_b) VALUES (?, 100, 700, ?, ?, ?)').run(videoId, map, teamA, teamB);
  return Number(r.lastInsertRowid);
}

/**
 * g1 : Alpha (A, joueurs 1 à 4) contre Bravo (B). Ana (joueur 1) a les trois notes, les trois autres de Alpha aussi, Bob (5) n'a pas de note globale (teamplay absente).
 * g2 : Alpha est à droite (B), Ana joue le slot 5 : individuelle 8, teamplay 12, globale 10. g3 : Ana sans aucune note (game non calculée).
 */
function fixture() {
  const ctx = testContext();
  const g1 = insertGame(ctx, 'Polaris', 'Alpha', 'Bravo');
  const g2 = insertGame(ctx, 'Polaris', 'Bravo', 'Alpha');
  const g3 = insertGame(ctx, 'Polaris', 'Alpha', 'Bravo');
  const pl = ctx.db.prepare('INSERT INTO players (game_id, slot, name) VALUES (?, ?, ?)');
  pl.run(g1, 1, 'Ana');
  pl.run(g1, 5, 'Bob');
  pl.run(g2, 5, 'ANA ');
  pl.run(g3, 1, 'ana');
  const rt = ctx.db.prepare('INSERT INTO player_ratings (game_id, slot, individual, teamplay, overall, assists, assist_source, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const detail = JSON.stringify({ assist_source: 'repli', teamplay: { note: 14, components: { share_kills: { label: 'Part des kills', raw: 0.4, note: 14, weight: 2 } } } });
  rt.run(g1, 1, 12, 14, 13, 3, 'repli', detail);
  for (const slot of [2, 3, 4]) rt.run(g1, slot, 10, 10, 10, 1, 'repli', null);
  rt.run(g1, 5, 9, null, null, null, 'repli', '{"overall_reason":"une sous-note manque"}');
  rt.run(g2, 5, 8, 12, 10, 2, 'tableau', null);
  return { ctx, g1, g2, g3 };
}

test('meanRating : une moyenne par note sur les games où elle existe, avec le nombre de games, null sans aucune note', () => {
  const m = meanRating([{ individual: 12, teamplay: 14, overall: 13 }, { individual: 8, teamplay: null, overall: null }, null]);
  assert.deepEqual(m, { individual: 10, teamplay: 14, overall: 13, games_rated: 1, individual_games: 2, teamplay_games: 1 });
  assert.deepEqual(meanRating([]), { individual: null, teamplay: null, overall: null, games_rated: 0, individual_games: 0, teamplay_games: 0 });
});

test("teamRatingOfGame : moyenne de l'équipe seulement si tous les joueurs ont la note", () => {
  const full = { individual: 10, teamplay: 12, overall: 11 };
  assert.deepEqual(teamRatingOfGame([full, full, full, full]), full);
  assert.deepEqual(teamRatingOfGame([full, full, full, null]), { individual: null, teamplay: null, overall: null });
  assert.deepEqual(teamRatingOfGame([full, full, full, { individual: 10, teamplay: null, overall: null }]), { individual: 10, teamplay: null, overall: null });
  assert.deepEqual(teamRatingOfGame([]), { individual: null, teamplay: null, overall: null });
});

test('game-summary : la note de chaque joueur (trois notes, assistances, source, détail), null sans note, note moyenne des équipes seulement si complète', () => {
  const { ctx, g1, g3 } = fixture();
  const j = gameSummary(ctx, q(`game=${g1}`)).json as { players: { slot: number; rating: Record<string, unknown> | null }[]; teams: Record<string, { rating: Record<string, number | null> }> };
  const ana = j.players.find((p) => p.slot === 1);
  assert.ok(ana?.rating);
  assert.equal(ana.rating.individual, 12);
  assert.equal(ana.rating.teamplay, 14);
  assert.equal(ana.rating.overall, 13);
  assert.equal(ana.rating.assists, 3);
  assert.equal(ana.rating.assist_source, 'repli');
  const comps = (ana.rating.detail as { teamplay: { components: Record<string, { weight: number }> } }).teamplay.components;
  assert.equal(comps.share_kills.weight, 2);
  const bob = j.players.find((p) => p.slot === 5);
  assert.equal(bob?.rating?.individual, 9);
  assert.equal(bob?.rating?.teamplay, null); // jamais 0
  assert.equal(bob?.rating?.overall, null);
  assert.deepEqual(j.teams.A.rating, { individual: 10.5, teamplay: 11, overall: 10.75 });
  assert.deepEqual(j.teams.B.rating, { individual: null, teamplay: null, overall: null }); // les joueurs 6 à 8 n'ont pas de ligne
  const empty = gameSummary(ctx, q(`game=${g3}`)).json as { players: { rating: unknown }[] };
  assert.ok(empty.players.every((p) => p.rating === null));
});

test('players-summary : note moyenne de chaque joueur sur ses games notées, nombre de games notées, pseudo écrit autrement regroupé, détail par game', () => {
  const { ctx } = fixture();
  const j = playersSummary(ctx, q()).json as { players: { key: string; rating: Record<string, number | null> }[]; per_game?: unknown[] };
  const ana = j.players.find((p) => p.key === 'ana');
  assert.ok(ana);
  // g1 (12, 14, 13), g2 (8, 12, 10), g3 sans note : moyennes sur 2 games notées
  assert.deepEqual(ana.rating, { individual: 10, teamplay: 13, overall: 11.5, games_rated: 2, individual_games: 2, teamplay_games: 2 });
  const bob = j.players.find((p) => p.key === 'bob');
  assert.deepEqual(bob?.rating, { individual: 9, teamplay: null, overall: null, games_rated: 0, individual_games: 1, teamplay_games: 0 });
  const one = playersSummary(ctx, q('player=ana')).json as { per_game: { game_id: number; rating: Record<string, unknown> | null }[] };
  assert.deepEqual(one.per_game.map((r) => r.rating?.overall ?? null), [13, 10, null]);
  assert.equal(one.per_game[1].rating?.assist_source, 'tableau');
});

test('teams-summary : note de l\'équipe = moyenne de ses quatre joueurs, game par game, seulement si les quatre sont notés', () => {
  const { ctx } = fixture();
  const j = teamsSummary(ctx, q('team=alpha')).json as { teams: { key: string; rating: Record<string, number | null> }[]; per_game: { game_id: number; rating: Record<string, number | null> }[] };
  // g1 : Alpha = joueurs 1 à 4 (12, 10, 10, 10 : individuelle 10,5, teamplay 11, globale 10,75) ; g2 : Alpha = joueurs 5 à 8, un seul noté : pas de note d'équipe
  assert.deepEqual(j.per_game[0].rating, { individual: 10.5, teamplay: 11, overall: 10.75 });
  assert.deepEqual(j.per_game[1].rating, { individual: null, teamplay: null, overall: null });
  assert.deepEqual(j.teams[0].rating, { individual: 10.5, teamplay: 11, overall: 10.75, games_rated: 1, individual_games: 1, teamplay_games: 1 });
});
