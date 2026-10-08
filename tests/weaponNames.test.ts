import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalName } from '../src/lib/weaponNames.ts';

const known = ['AK77', 'M12 TACTICAL', 'ERG-51', 'SPECTRE', 'STICKY', 'GRENADE'];

test('la saisie est ramenée à l’écriture de l’onglet Stratégie, sans tenir compte de la casse, des espaces ni des tirets', () => {
  assert.equal(canonicalName('spectre', known), 'SPECTRE');
  assert.equal(canonicalName('  Sticky ', known), 'STICKY');
  assert.equal(canonicalName('m12tactical', known), 'M12 TACTICAL');
  assert.equal(canonicalName('erg 51', known), 'ERG-51');
});

test('un nom inconnu est gardé tel quel (nettoyé), un nom vide reste vide', () => {
  assert.equal(canonicalName('  Wall ', known), 'Wall');
  assert.equal(canonicalName('   ', known), '');
});
