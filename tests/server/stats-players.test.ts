import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiContext } from '../../server/api.ts';
import { playersSummary, teamsSummary } from '../../server/statsPlayers.ts';
import { insertVideo, testContext } from './helpers.ts';

const q = (s = '') => new URLSearchParams(s);
const errorOf = (res: { json: unknown }) => (res.json as { error: string }).error;

function insertGame(ctx: ApiContext, map: string, teamA: string | null, teamB: string | null): number {
  const videoId = insertVideo(ctx);
  const r = ctx.db.prepare('INSERT INTO games (video_id, start_s, end_s, map, team_a, team_b) VALUES (?, 100, 700, ?, ?, ?)').run(videoId, map, teamA, teamB);
  return Number(r.lastInsertRowid);
}

/**
 * Trois games : g1 Polaris Alpha (A) contre Bravo (B), g2 Atlantis Bravo (A) contre Alpha (B), g3 Polaris Alpha contre Bravo sans aucun bilan.
 * Ana joue pour Alpha (pseudo écrit Ana, ANA, ana), Bob pour Bravo.
 */
function fixture() {
  const ctx = testContext();
  const g1 = insertGame(ctx, 'Polaris', 'Alpha', 'Bravo');
  const g2 = insertGame(ctx, 'Atlantis', 'Bravo', 'Alpha');
  const g3 = insertGame(ctx, 'Polaris', 'alpha ', 'BRAVO');
  const pl = ctx.db.prepare('INSERT INTO players (game_id, slot, name) VALUES (?, ?, ?)');
  pl.run(g1, 1, 'Ana');
  pl.run(g1, 5, 'Bob');
  pl.run(g1, 6, '  '); // pseudo vide : ignoré
  pl.run(g2, 5, 'ANA ');
  pl.run(g2, 1, 'Bob');
  pl.run(g3, 1, 'ana');
  const st = ctx.db.prepare(
    `INSERT INTO player_game_stats (game_id, slot, kills, deaths, alive_s, v_mean, v_p98, gadget_uses, gadget_unused_at_death, gadget_possible, duels_won, duels_lost, duels_other)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  st.run(g1, 1, 3, 1, 100, 2, 4, 2, 0, 4, 2, 0, 1); // Ana
  st.run(g1, 2, 1, 2, 80, 1, 3, null, null, null, 0, 1, 0); // coéquipier sans pseudo ni gadget lu
  st.run(g1, 5, 1, 3, 50, 4, 5, 1, 1, 2, 0, 2, 0); // Bob
  st.run(g2, 5, 2, 2, 300, 3, 6, null, null, null, 1, 1, 0); // Ana, gadget_possible inconnu
  st.run(g2, 1, 5, 0, 100, 5, 7, 3, 0, 3, 3, 0, 0); // Bob
  const sc = ctx.db.prepare('INSERT INTO kill_scores (game_id, t, killer_slot, victim_slot, impact, reasons) VALUES (?, ?, ?, ?, ?, ?)');
  sc.run(g1, 30, 1, 5, 2, null);
  sc.run(g1, 90, 5, 1, -2, null);
  const cap = ctx.db.prepare('INSERT INTO capture_state (game_id, t, point, pct, team) VALUES (?, ?, ?, ?, ?)');
  cap.run(g1, 100, 'score_A', 10, 'A');
  cap.run(g1, 200, 'score_A', 55, 'A');
  cap.run(g1, 100, 'score_B', 30, 'B');
  cap.run(g1, 200, 'score_B', 40, 'B');
  const pa = ctx.db.prepare('INSERT INTO point_active (game_id, point, t0, t1, source) VALUES (?, ?, ?, ?, ?)');
  pa.run(g1, 'C', 0, 85, 'schedule');
  pa.run(g1, 'B', 85, 175, 'schedule');
  for (const [p, a, b] of [['A', 0, 90], ['B', 90, 180], ['A', 180, 240]] as const) pa.run(g2, p, a, b, 'schedule');
  return { ctx, g1, g2, g3 };
}

type PlayersBody = {
  scope: { map: string | null; team: string | null };
  games: number;
  min: number;
  players: Record<string, unknown>[];
  per_game?: Record<string, unknown>[];
};

test('players-summary : toutes cartes, pseudo normalisé, sommes, moyenne pondérée, médiane, pas de somme partielle, tri par kills', () => {
  const { ctx } = fixture();
  const res = playersSummary(ctx, q());
  assert.equal(res.status, 200);
  const j = res.json as PlayersBody;
  assert.equal(j.games, 3);
  assert.equal(j.min, 5);
  assert.deepEqual(j.scope, { map: null, team: null });
  assert.deepEqual(j.players.map((p) => p.key), ['bob', 'ana']); // Bob 6 kills, Ana 5
  const ana = j.players[1];
  assert.equal(ana.name, 'Ana'); // la première écriture à égalité
  assert.equal(ana.team, 'Alpha');
  assert.equal(ana.games, 3);
  assert.equal(ana.games_with_stats, 2); // g3 sans bilan
  assert.deepEqual(ana.maps, ['Atlantis', 'Polaris']);
  assert.equal(ana.kills, 5);
  assert.equal(ana.deaths, 3);
  assert.equal(ana.kd, 1.667);
  assert.equal(ana.alive_s, 400);
  assert.equal(ana.v_mean, 2.75); // (2 * 100 + 3 * 300) / 400
  assert.equal(ana.v_p98_median, 5);
  assert.equal(ana.gadget_uses, 2); // le null de g2 n'est pas un zéro
  assert.equal(ana.gadget_possible, null); // une game avec stats sans valeur : pas de total partiel
  assert.equal(ana.duels_won, 3);
  assert.equal(ana.kill_score_sum, 2); // seule g1 a des notes
  assert.equal(ana.death_score_sum, 2); // sa mort à 90 s : -(-2)
  assert.equal(ana.score_sum, 4);
  const bob = j.players[0];
  assert.equal(bob.gadget_possible, 5);
  assert.equal(bob.kd, 2);
  assert.equal(bob.kill_score_sum, -2);
  assert.equal(j.per_game, undefined);
});

test('players-summary : filtres carte (sans casse), games et équipe', () => {
  const { ctx, g1, g2 } = fixture();
  const polaris = playersSummary(ctx, q('map=polaris')).json as PlayersBody;
  assert.equal(polaris.games, 2); // g1 et g3
  assert.deepEqual(polaris.scope, { map: 'polaris', team: null });
  const ana = polaris.players.find((p) => p.key === 'ana');
  assert.equal(ana?.games, 2);
  assert.equal(ana?.games_with_stats, 1);
  assert.deepEqual(ana?.maps, ['Polaris']);
  assert.equal(ana?.kills, 3);
  assert.equal(ana?.gadget_possible, 4); // seule g1 a des stats : total complet

  const only = playersSummary(ctx, q(`games=${g2}`)).json as PlayersBody;
  assert.equal(only.games, 1);
  assert.equal(only.players.length, 2);
  assert.equal(((playersSummary(ctx, q(`games=${g1},${g2}`)).json) as PlayersBody).games, 2);

  const bravo = playersSummary(ctx, q('team=bravo')).json as PlayersBody;
  assert.equal(bravo.games, 3);
  assert.deepEqual(bravo.players.map((p) => p.key), ['bob']); // Ana joue pour Alpha
  assert.equal(bravo.players[0].team, 'Bravo');

  const none = playersSummary(ctx, q('team=Inconnue'));
  assert.equal(none.status, 200);
  assert.deepEqual((none.json as PlayersBody).players, []);
  assert.equal((none.json as PlayersBody).games, 0);
});

test('players-summary : détail game par game d\'un joueur, game sans bilan en null', () => {
  const { ctx, g1, g2, g3 } = fixture();
  const j = playersSummary(ctx, q('player=ANA%20')).json as PlayersBody;
  assert.equal(j.players.length, 1);
  assert.equal(j.players[0].key, 'ana');
  const per = j.per_game ?? [];
  assert.deepEqual(per.map((p) => p.game_id), [g1, g2, g3]);
  assert.deepEqual(per.map((p) => p.side), ['A', 'B', 'A']);
  assert.deepEqual(per.map((p) => p.slot), [1, 5, 1]);
  assert.equal(per[0].opponent, 'Bravo');
  assert.equal(per[1].opponent, 'Bravo');
  assert.equal(per[0].team, 'Alpha');
  assert.equal(per[0].kd, 3);
  assert.equal(per[0].score_sum, 4);
  assert.equal(per[1].gadget_possible, null);
  assert.equal(per[1].score_sum, null); // g2 n'a aucune note
  assert.equal(per[2].has_stats, false);
  assert.equal(per[2].kills, null);
  assert.equal(per[2].kd, null);
  assert.equal(per[2].duels_won, null);
  // Joueur inconnu : liste vide et détail vide
  const ghost = playersSummary(ctx, q('player=fantome')).json as PlayersBody;
  assert.deepEqual(ghost.players, []);
  assert.deepEqual(ghost.per_game, []);
});

type TeamsBody = {
  scope: { map: string | null };
  games: number;
  min: number;
  teams: Record<string, unknown>[];
  per_game?: Record<string, unknown>[];
};

test('teams-summary : équipes par nom normalisé, kills et morts des joueurs du côté, gadgets sans somme partielle, changements de point, capture finale', () => {
  const { ctx } = fixture();
  const res = teamsSummary(ctx, q());
  assert.equal(res.status, 200);
  const j = res.json as TeamsBody;
  assert.equal(j.games, 3);
  assert.equal(j.min, 5);
  assert.equal(j.teams.length, 2); // « alpha  » et « BRAVO » rejoignent Alpha et Bravo
  const alpha = j.teams.find((t) => t.key === 'alpha');
  const bravo = j.teams.find((t) => t.key === 'bravo');
  assert.equal(alpha?.name, 'Alpha');
  assert.equal(alpha?.games, 3);
  assert.equal(alpha?.games_with_stats, 2);
  assert.deepEqual(alpha?.maps, ['Atlantis', 'Polaris']);
  assert.equal(alpha?.kills, 6); // g1 : 3 + 1 (le coéquipier sans pseudo compte) ; g2 : 2
  assert.equal(alpha?.deaths, 5);
  assert.equal(alpha?.gadget_possible, null); // le coéquipier de g1 n'a pas de valeur
  assert.equal(alpha?.gadget_uses, 2);
  assert.equal(alpha?.point_changes, 3); // g1 : 1, g2 : 2
  assert.deepEqual(alpha?.final_capture_avg, { own: 55, opponent: 40 }); // seule g1 a une lecture
  assert.equal(bravo?.kills, 6);
  assert.equal(bravo?.gadget_possible, 5);
  assert.equal(bravo?.duels_won, 3);
  assert.deepEqual(bravo?.final_capture_avg, { own: 40, opponent: 55 });
  assert.equal(j.per_game, undefined);
});

test('teams-summary : détail game par game, winner repris tel quel, filtres carte et games, équipe inconnue', () => {
  const { ctx, g1, g2, g3 } = fixture();
  const j = teamsSummary(ctx, q('team=Bravo')).json as TeamsBody;
  assert.equal(j.games, 3);
  assert.deepEqual(j.teams.map((t) => t.key), ['bravo']);
  const per = j.per_game ?? [];
  assert.deepEqual(per.map((p) => p.game_id), [g1, g2, g3]);
  assert.deepEqual(per.map((p) => p.side), ['B', 'A', 'B']);
  assert.equal(per[0].opponent, 'Alpha');
  assert.equal(per[0].winner, null);
  assert.deepEqual(per[0].final_capture, { own: 40, opponent: 55 });
  assert.equal(per[1].final_capture, null);
  assert.equal(per[0].kills, 1);
  assert.equal(per[0].kd, 0.333);
  assert.equal(per[0].point_changes, 1);
  assert.equal(per[1].gadget_possible, 3);
  assert.equal(per[2].has_stats, false);
  assert.equal(per[2].kills, null);

  const polaris = teamsSummary(ctx, q('map=Polaris&team=alpha')).json as TeamsBody;
  assert.equal(polaris.games, 2);
  assert.equal(polaris.teams[0].kills, 4);
  assert.equal(polaris.teams[0].gadget_possible, null);
  assert.equal(polaris.per_game?.length, 2);
  assert.equal(((teamsSummary(ctx, q(`games=${g2}`)).json) as TeamsBody).games, 1);

  const none = teamsSummary(ctx, q('team=Inconnue'));
  assert.equal(none.status, 200);
  assert.deepEqual((none.json as TeamsBody).teams, []);
  assert.deepEqual((none.json as TeamsBody).per_game, []);
  assert.equal((none.json as TeamsBody).games, 0);
});

test('équipes NULL ignorées, base vide : 200 et listes vides', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris', null, 'Bravo');
  ctx.db.prepare('INSERT INTO player_game_stats (game_id, slot, kills, deaths) VALUES (?, 1, 2, 1)').run(g);
  const j = teamsSummary(ctx, q()).json as TeamsBody;
  assert.deepEqual(j.teams.map((t) => t.key), ['bravo']);
  assert.equal(j.teams[0].kills, null); // le seul bilan est du côté sans nom
  assert.equal(j.teams[0].games_with_stats, 0);
  assert.equal(j.teams[0].kd, null);
  const empty = testContext();
  assert.deepEqual((playersSummary(empty, q()).json as PlayersBody).players, []);
  assert.deepEqual((teamsSummary(empty, q()).json as TeamsBody).teams, []);
});

test('paramètres invalides : 400', () => {
  const ctx = testContext();
  for (const route of [playersSummary, teamsSummary]) {
    assert.equal(route(ctx, q('games=abc')).status, 400);
    assert.match(errorOf(route(ctx, q('games=0'))), /games/);
    assert.equal(route(ctx, q('games=1,,2')).status, 400);
    assert.equal(route(ctx, q(`map=${'x'.repeat(200)}`)).status, 400);
    assert.equal(route(ctx, q(`team=${'x'.repeat(200)}`)).status, 400);
  }
  assert.equal(playersSummary(ctx, q(`player=${'x'.repeat(200)}`)).status, 400);
});
