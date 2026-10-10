import assert from 'node:assert/strict';
import { test } from 'node:test';
import { teamTag } from '../src/lib/teams.ts';

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
