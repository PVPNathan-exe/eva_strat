import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRange } from '../../server/range.ts';

test('pas d’en-tête → null (réponse complète)', () => {
  assert.equal(parseRange(undefined, 1000), null);
});

test('plage fermée', () => {
  assert.deepEqual(parseRange('bytes=0-99', 1000), { start: 0, end: 99 });
});

test('plage ouverte jusqu’à la fin', () => {
  assert.deepEqual(parseRange('bytes=500-', 1000), { start: 500, end: 999 });
});

test('fin au-delà du fichier est ramenée à la taille', () => {
  assert.deepEqual(parseRange('bytes=900-5000', 1000), { start: 900, end: 999 });
});

test('plage de suffixe : les N derniers octets', () => {
  assert.deepEqual(parseRange('bytes=-100', 1000), { start: 900, end: 999 });
});

test('plages invalides', () => {
  assert.equal(parseRange('bytes=1000-', 1000), 'invalid');
  assert.equal(parseRange('bytes=50-10', 1000), 'invalid');
  assert.equal(parseRange('bytes=-', 1000), 'invalid');
  assert.equal(parseRange('bytes=-0', 1000), 'invalid');
  assert.equal(parseRange('octets=0-10', 1000), 'invalid');
});
