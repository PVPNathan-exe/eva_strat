import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiContext } from '../../server/api.ts';
import { globalSummary, teamSummary } from '../../server/statsTeam.ts';
import { insertVideo, testContext } from './helpers.ts';

const q = (s = '') => new URLSearchParams(s);
const errorOf = (res: { json: unknown }) => (res.json as { error: string }).error;

type Cells = [number, number, number][];
const cell = (cells: Cells, col: number, row: number): number => cells.find((c) => c[0] === col && c[1] === row)?.[2] ?? 0;

function insertGame(ctx: ApiContext, map: string, startS: number, teamA: string | null, teamB: string | null): number {
  const videoId = insertVideo(ctx);
  const r = ctx.db.prepare('INSERT INTO games (video_id, start_s, end_s, map, team_a, team_b) VALUES (?, ?, ?, ?, ?, ?)').run(videoId, startS, startS + 600, map, teamA, teamB);
  return Number(r.lastInsertRowid);
}

/** Position vivante d'un joueur à un instant de VIDÉO. */
function sample(ctx: ApiContext, game: number, frame: number, t: number, slot: number, x: number, y: number): void {
  ctx.db
    .prepare('INSERT INTO samples (game_id, frame, t, slot, team, x, y, angle, alive) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)')
    .run(game, frame, t, slot, slot <= 4 ? 'A' : 'B', x, y);
}

function death(ctx: ApiContext, game: number, slot: number, idx: number, x: number, y: number, killer: number | null): void {
  ctx.db
    .prepare("INSERT INTO lives (game_id, slot, idx, t0, t1, x0, y0, x1, y1, ended, killer_slot) VALUES (?, ?, ?, 0, 50, 0.5, 0.5, ?, ?, 'death', ?)")
    .run(game, slot, idx, x, y, killer);
}

function episode(ctx: ApiContext, game: number, team: 'A' | 'B', outcome: string, data: string | null, verdict: string | null = null): void {
  ctx.db
    .prepare("INSERT INTO episodes (game_id, kind, point, team, t0, t1, outcome, data, verdict) VALUES (?, 'retake', 'A', ?, 10, 40, ?, ?, ?)")
    .run(game, team, outcome, data, verdict);
}

/**
 * Monde de test sur Polaris. g1 (début vidéo 100 s) : « Équipe Éclair » à gauche contre Rivals. g2 (début 200 s) : Rivals à gauche contre « equipe  eclair » à droite.
 * g4 : Autre contre Rivals (sans données). g3 : Éclair sur Atlantis (autre carte).
 */
function world() {
  const ctx = testContext();
  const g1 = insertGame(ctx, 'Polaris', 100, 'Équipe Éclair', 'Rivals');
  const g2 = insertGame(ctx, 'Polaris', 200, 'Rivals', 'equipe  eclair ');
  const g3 = insertGame(ctx, 'Atlantis', 0, 'Équipe Éclair', 'Rivals');
  const g4 = insertGame(ctx, 'Polaris', 0, 'Autre', 'Rivals');

  const pl = ctx.db.prepare('INSERT INTO players (game_id, slot, name) VALUES (?, ?, ?)');
  pl.run(g1, 1, 'Ana');
  pl.run(g1, 5, 'Zed');
  pl.run(g2, 5, 'ANA');
  pl.run(g2, 1, 'Zed');
  pl.run(g2, 6, 'Yan');

  // g1 : le 1 reste en (0.1, 0.1) trois images (0,5 s chacune) puis passe en (0.3, 0.3) à 11 s de game ; le 5 reste en (0.9, 0.9)
  [100, 100.5, 101].forEach((t, i) => sample(ctx, g1, i, t, 1, 0.1, 0.1));
  sample(ctx, g1, 3, 111, 1, 0.3, 0.3);
  [100, 100.5, 101].forEach((t, i) => sample(ctx, g1, i, t, 5, 0.9, 0.9));
  // g2 : Éclair est à droite, le 5 en (0.55, 0.55)
  [200, 200.5, 201].forEach((t, i) => sample(ctx, g2, i, t, 5, 0.55, 0.55));
  sample(ctx, g2, 3, 221, 5, 0.55, 0.55);

  death(ctx, g1, 1, 0, 0.15, 0.15, 5);
  death(ctx, g1, 6, 0, 0.8, 0.8, 2);
  death(ctx, g2, 5, 0, 0.55, 0.55, 1);

  const duel = ctx.db.prepare('INSERT INTO duels (game_id, t0, t1, slot_a, slot_b, winner_slot) VALUES (?, ?, ?, ?, ?, ?)');
  duel.run(g1, 10, 12, 1, 5, 5); // Éclair (gauche) perd, au lieu du 1 à 11 s
  duel.run(g2, 20, 22, 5, 1, 5); // Éclair (droite) gagne, au lieu du 5 à 21 s
  duel.run(g2, 30, 32, 6, 2, null); // sans vainqueur, côté Éclair le 6

  const st = ctx.db.prepare(
    'INSERT INTO player_game_stats (game_id, slot, kills, deaths, gadget_uses, gadget_unused_at_death, gadget_possible) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  st.run(g1, 1, 2, 1, 1, 0, 2);
  st.run(g1, 2, 1, 0, null, null, null);
  st.run(g1, 5, 9, 9, 7, 7, 7); // Rivals : ne compte pas pour Éclair
  st.run(g2, 5, 1, 1, 2, 1, 3);

  const wave = (speed: string | null, size: number) => JSON.stringify({ wave: { speed, size } });
  episode(ctx, g1, 'A', 'success', wave('rapide', 3));
  episode(ctx, g1, 'A', 'fail', wave('progressif', 3));
  episode(ctx, g1, 'A', 'success', wave('rapide', 3), 'ko'); // jugée fausse : jamais comptée
  episode(ctx, g1, 'A', 'success', null); // ancien calcul, sans data.wave : jamais comptée
  episode(ctx, g2, 'B', 'success', wave('rapide', 2));
  episode(ctx, g2, 'A', 'success', wave('rapide', 4)); // Rivals
  return { ctx, g1, g2, g3, g4 };
}

test('team-summary : équipe reconnue par son nom (casse, accents, espaces), carte et côtés', () => {
  const { ctx, g1, g2 } = world();
  const res = teamSummary(ctx, q('map=Polaris&team=EQUIPE ECLAIR&n=10'));
  assert.equal(res.status, 200);
  const j = res.json as Record<string, unknown> & { games: number; game_ids: number[]; min: number; n: number; team: string; side: string };
  assert.equal(j.games, 2);
  assert.deepEqual(j.game_ids, [g1, g2]);
  assert.equal(j.min, 5);
  assert.equal(j.n, 10);
  assert.equal(j.team, 'Équipe Éclair');
  assert.equal(j.side, 'both');

  const left = teamSummary(ctx, q('map=Polaris&team=Équipe Éclair&side=left'));
  assert.deepEqual((left.json as { game_ids: number[] }).game_ids, [g1]);
  const right = teamSummary(ctx, q('map=Polaris&team=Équipe Éclair&side=right'));
  assert.deepEqual((right.json as { game_ids: number[] }).game_ids, [g2]);
  const some = teamSummary(ctx, q(`map=Polaris&team=Équipe Éclair&games=${g2},999`));
  assert.deepEqual((some.json as { game_ids: number[] }).game_ids, [g2]);

  const none = teamSummary(ctx, q('map=Polaris&team=Inconnus'));
  assert.equal(none.status, 200);
  const nj = none.json as { games: number; min: number; death_grid: unknown[]; players: unknown[]; stats: { kills: number | null } };
  assert.equal(nj.games, 0);
  assert.equal(nj.min, 5);
  assert.deepEqual(nj.death_grid, []);
  assert.deepEqual(nj.players, []);
  assert.equal(nj.stats.kills, null);
});

test('team-summary : sommes de player_game_stats, grilles de morts et de kills, duels et leurs lieux', () => {
  const { ctx } = world();
  const j = teamSummary(ctx, q('map=Polaris&team=Équipe Éclair&n=10')).json as {
    stats: Record<string, number | null>;
    duels: { won: number; lost: number; other: number };
    death_grid: Cells;
    kill_grid: Cells;
    duel_won_grid: Cells;
    duel_lost_grid: Cells;
  };
  assert.equal(j.stats.games_with_stats, 2);
  assert.equal(j.stats.kills, 4); // 2 + 1 (g1, Éclair) + 1 (g2)
  assert.equal(j.stats.deaths, 2);
  assert.equal(j.stats.gadget_uses, 3);
  assert.equal(j.stats.gadget_unused_at_death, 1);
  assert.equal(j.stats.gadget_possible, 5);
  assert.deepEqual(j.duels, { won: 1, lost: 1, other: 1 });
  // Morts d'Éclair : le 1 de g1 en case (1, 1), le 5 de g2 en case (5, 5)
  assert.equal(cell(j.death_grid, 1, 1), 1);
  assert.equal(cell(j.death_grid, 5, 5), 1);
  assert.equal(j.death_grid.length, 2);
  // Kills d'Éclair : le 6 de Rivals tué par le 2 en (8, 8) ; le 5 d'Éclair (g2) tué par le 1 de Rivals ne compte pas ici
  assert.equal(cell(j.kill_grid, 8, 8), 1);
  assert.equal(j.kill_grid.length, 1);
  // Duel perdu au lieu du 1 à 11 s de game (temps de VIDÉO 111 = début 100 + 11), duel gagné au lieu du 5 à 21 s de game (vidéo 221)
  assert.deepEqual(j.duel_lost_grid, [[3, 3, 1]]);
  assert.deepEqual(j.duel_won_grid, [[5, 5, 1]]);
});

test('team-summary : présence par côté et par pseudo, temps = lignes vivantes x pas réel', () => {
  const { ctx } = world();
  const j = teamSummary(ctx, q('map=Polaris&team=Équipe Éclair&n=10')).json as {
    presence: { left: Cells; right: Cells };
    players: { key: string; name: string; side: string; games: number; seconds: number; duels_won: number; duels_lost: number; duels_other: number; cells: Cells }[];
  };
  // g1, côté gauche : le 1 trois images en (1, 1) et une en (3, 3), pas de 0,5 s
  assert.equal(cell(j.presence.left, 1, 1), 1.5);
  assert.equal(cell(j.presence.left, 3, 3), 0.5);
  assert.equal(cell(j.presence.left, 9, 9), 0); // le 5 de Rivals n'est pas à Éclair
  // g2, côté droit
  assert.equal(cell(j.presence.right, 5, 5), 2);
  const rows = j.players.map((p) => [p.key, p.side, p.name, p.games, p.seconds]);
  assert.deepEqual(rows, [
    ['ana', 'left', 'Ana', 1, 2],
    ['ana', 'right', 'ANA', 1, 2],
    ['yan', 'right', 'Yan', 1, 0], // duels seulement : aucune présence lue
  ]);
  const left = j.players.find((p) => p.side === 'left');
  assert.deepEqual([left?.duels_won, left?.duels_lost, left?.duels_other], [0, 1, 0]);
  const right = j.players.find((p) => p.key === 'ana' && p.side === 'right');
  assert.deepEqual([right?.duels_won, right?.duels_lost, right?.duels_other], [1, 0, 0]);
});

test('team-summary : vagues comptées sans l\'ancien calcul ni les vagues jugées fausses, par vitesse et par taille', () => {
  const { ctx } = world();
  const o = (teamSummary(ctx, q('map=Polaris&team=Équipe Éclair')).json as { outcomes: Record<string, unknown> }).outcomes as {
    waves: number;
    decided: number;
    rate: number | null;
    counts: Record<string, number>;
    by_speed: Record<string, { waves: number; rate: number | null }>;
    by_size: Record<string, { waves: number }>;
  };
  assert.equal(o.waves, 3);
  assert.deepEqual(o.counts, { success: 2, fail: 1 });
  assert.equal(o.decided, 3);
  assert.equal(o.rate, 0.667);
  assert.equal(o.by_speed.rapide.waves, 2);
  assert.equal(o.by_speed.rapide.rate, 1);
  assert.equal(o.by_speed.progressif.rate, 0);
  assert.equal(o.by_size['3'].waves, 2);
  assert.equal(o.by_size['2'].waves, 1);
});

test('team-summary : paramètres invalides = 400 avec un message clair', () => {
  const { ctx } = world();
  assert.match(errorOf(teamSummary(ctx, q('team=A'))), /map/);
  assert.match(errorOf(teamSummary(ctx, q('map=Polaris'))), /team/);
  assert.match(errorOf(teamSummary(ctx, q(`map=Polaris&team=${'x'.repeat(61)}`))), /trop long/);
  assert.match(errorOf(teamSummary(ctx, q(`map=${'x'.repeat(65)}&team=A`))), /trop long/);
  assert.match(errorOf(teamSummary(ctx, q('map=Polaris&team=A&side=up'))), /side/);
  assert.match(errorOf(teamSummary(ctx, q('map=Polaris&team=A&n=1'))), /n invalide/);
  assert.match(errorOf(teamSummary(ctx, q('map=Polaris&team=A&n=abc'))), /n invalide/);
  assert.match(errorOf(teamSummary(ctx, q('map=Polaris&team=A&games=1,x'))), /games invalide/);
});

test('global : les deux côtés de toutes les games de la carte, vagues de toutes les équipes', () => {
  const { ctx, g1, g2, g4 } = world();
  const res = globalSummary(ctx, q('map=Polaris&n=10'));
  assert.equal(res.status, 200);
  const j = res.json as {
    games: number;
    game_ids: number[];
    min: number;
    left: { death_grid: Cells; kill_grid: Cells; presence: Cells; duel_won_grid: Cells; duel_lost_grid: Cells; duels: { won: number; lost: number; other: number } };
    right: { death_grid: Cells; kill_grid: Cells; presence: Cells; duels: { won: number; lost: number; other: number } };
    outcomes: { waves: number; decided: number; rate: number; counts: Record<string, number> };
  };
  assert.equal(j.games, 3);
  assert.deepEqual(j.game_ids, [g1, g2, g4]);
  assert.equal(j.min, 5);
  // Gauche : le 1 de g1 mort en (1, 1) ; droite : le 6 de g1 en (8, 8) et le 5 de g2 en (5, 5)
  assert.deepEqual(j.left.death_grid, [[1, 1, 1]]);
  assert.equal(j.right.death_grid.length, 2);
  // Kills de la gauche : le 2 tue le 6 en (8, 8), le 1 tue le 5 en (5, 5)
  assert.equal(cell(j.left.kill_grid, 8, 8), 1);
  assert.equal(cell(j.left.kill_grid, 5, 5), 1);
  assert.equal(cell(j.left.presence, 1, 1), 1.5);
  assert.equal(cell(j.right.presence, 9, 9), 1.5);
  assert.deepEqual(j.left.duels, { won: 0, lost: 2, other: 1 }); // le 1 perd en g1 et en g2, le 2 de g2 est sans vainqueur
  assert.deepEqual(j.right.duels, { won: 2, lost: 0, other: 1 });
  assert.equal(j.outcomes.waves, 4);
  assert.deepEqual(j.outcomes.counts, { success: 3, fail: 1 });
  assert.equal(j.outcomes.rate, 0.75);
  assert.match(errorOf(globalSummary(ctx, q())), /map/);
  assert.match(errorOf(globalSummary(ctx, q('map=Polaris&n=999'))), /n invalide/);
  const empty = globalSummary(ctx, q('map=Atlantis&games=999'));
  assert.equal((empty.json as { games: number }).games, 0);
});
