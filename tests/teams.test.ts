import assert from 'node:assert/strict';
import { test } from 'node:test';
import { teamRangesFromGames, teamTag } from '../src/lib/teams.ts';

test('le préfixe commun à au moins trois pseudos est proposé, sans le X de liaison', () => {
  assert.equal(teamTag(['NCTXVEX', 'NCTXMARM...', 'NCTXSPIRIT', 'NCTX7TAKAA']), 'NCT');
  assert.equal(teamTag(['SNVXPRIME...', 'SNVXLAIDEEN', 'SNVXGLEN5', 'SNVXALEXO...']), 'SNV');
  assert.equal(teamTag(['SNVXPRIME', 'SNVXLAIDEEN', 'SNVXGLEN5', 'Zorro']), 'SNV'); // trois sur quatre suffisent
});

test("aucun diminutif quand les pseudos n'ont pas de préfixe commun ou sont ceux par défaut", () => {
  assert.equal(teamTag(['Alpha', 'Bravo', 'Charlie', 'Delta']), null);
  assert.equal(teamTag(['PLAYER 1', 'PLAYER 2', 'PLAYER 3', 'PLAYER 4']), null);
  assert.equal(teamTag(['ABX1', 'ABX2', 'Zed', 'Kim']), null); // deux seulement
  assert.equal(teamTag([]), null);
});

test('les games qui se suivent avec les mêmes équipes font un seul morceau, une rotation en ouvre un autre', () => {
  const side = (names: string[], from: number) => names.map((name, i) => ({ slot: from + i, name }));
  const nct = side(['NCTXVEX', 'NCTXMARM', 'NCTXSPIRIT', 'NCTX7TAKAA'], 1);
  const snv = side(['SNVXPRIME', 'SNVXLAIDEEN', 'SNVXGLEN5', 'SNVXALEXO'], 5);
  const omg = side(['OMGXKAI', 'OMGXRED', 'OMGXZED', 'OMGXLUX'], 5);
  const games = [
    { start_s: 100, end_s: 400, players: [...nct, ...snv] },
    { start_s: 500, end_s: 800, players: [...nct, ...snv] },
    { start_s: 900, end_s: 1200, players: [...nct, ...omg] }, // la bleue change
    { start_s: 1300, end_s: 1500, players: [] }, // pseudos pas encore lus : ignorée
  ];
  const got = teamRangesFromGames(games, { SNV: 'Snovex' });
  assert.deepEqual(got, [
    { start_s: 100, end_s: 800, team_a: 'NCT', team_b: 'Snovex' }, // le nom complet retenu passe avant le diminutif
    { start_s: 900, end_s: 1200, team_a: 'NCT', team_b: 'OMG' },
  ]);
  assert.deepEqual(teamRangesFromGames([]), []);
});
