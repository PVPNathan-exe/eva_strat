import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medianRange, OPEN_RANGE_M, rangeOfPlayer, rangeOfWeapon, resolveName, usefulRange } from '../src/lib/weaponRange.ts';

test('bandes à 100, 70, 40 : la portée s arrête à la fin de la dernière bande à 50 % ou plus du maximum', () => {
  const r = usefulRange([
    { fromM: 0, toM: 10, pct: 100 },
    { fromM: 10, toM: 20, pct: 70 },
    { fromM: 20, toM: null, pct: 40 },
  ]);
  assert.deepEqual(r, { rangeM: 20, open: false });
});

test('dernière bande sans fin au dessus du seuil : portée sans limite', () => {
  const r = usefulRange([
    { fromM: 0, toM: 25, pct: 100 },
    { fromM: 25, toM: null, pct: 75 },
  ]);
  assert.deepEqual(r, { rangeM: OPEN_RANGE_M, open: true });
});

test('le seuil est relatif au maximum de l arme, et une bande exactement à 50 % compte', () => {
  // Maximum 100 % à la deuxième bande (WESTFIRE) : la première bande à 70 % reste au dessus du seuil
  assert.equal(usefulRange([{ fromM: 0, toM: 5, pct: 70 }, { fromM: 5, toM: 25, pct: 100 }, { fromM: 25, toM: null, pct: 20 }]).rangeM, 25);
  assert.equal(usefulRange([{ fromM: 0, toM: 3.5, pct: 100 }, { fromM: 3.5, toM: 6, pct: 50 }, { fromM: 6, toM: 10, pct: 40 }]).rangeM, 6);
  // Fraction personnalisée
  assert.equal(usefulRange([{ fromM: 0, toM: 3.5, pct: 100 }, { fromM: 3.5, toM: 6, pct: 50 }, { fromM: 6, toM: 10, pct: 40 }], 0.4).rangeM, 10);
});

test('une bande trop faible ferme la portée même si une bande plus loin remonte', () => {
  assert.equal(usefulRange([{ fromM: 0, toM: 4, pct: 100 }, { fromM: 4, toM: 8, pct: 30 }, { fromM: 8, toM: null, pct: 90 }]).rangeM, 4);
});

test('armes du catalogue : valeurs lues dans stuffs.ts', () => {
  assert.deepEqual(rangeOfWeapon('AK77'), { rangeM: OPEN_RANGE_M, open: true, weapon: 'AK77' });
  assert.equal(rangeOfWeapon('mp-52')?.rangeM, 15, 'casse et tiret ignorés : 55 % jusqu à 15 m, 45 % au delà');
  assert.equal(rangeOfWeapon('SPECTRE')?.rangeM, 20);
  assert.equal(rangeOfWeapon('T1 GAUSS')?.rangeM, 6);
  assert.equal(rangeOfWeapon('STRIKER')?.rangeM, 10);
  assert.equal(rangeOfWeapon('Ça n existe pas'), null);
  assert.equal(rangeOfWeapon(null), null);
});

test('joueur : la plus longue de ses deux armes ; sans arme connue, la médiane marquée estimée', () => {
  const median = { rangeM: 15, open: false };
  const p = rangeOfPlayer('SPECTRE', 'MP-52', median);
  assert.deepEqual(p, { rangeM: 20, open: false, weapon: 'SPECTRE', estimated: false });
  assert.equal(rangeOfPlayer('STRIKER', 'DX3', median).weapon, 'STRIKER', 'un gadget n est pas une arme');
  assert.deepEqual(rangeOfPlayer(null, null, median), { rangeM: 15, open: false, weapon: null, estimated: true });
  assert.equal(rangeOfPlayer('?', '?', median).estimated, true);
});

test('médiane des armes lues', () => {
  assert.equal(medianRange(['SPECTRE', 'MP-52', 'STRIKER']).rangeM, 15);
  assert.equal(medianRange(['SPECTRE', 'MP-52']).rangeM, 17.5);
  assert.equal(medianRange(['AK77', 'ATLAS', 'SPECTRE']).open, true);
  // Aucune arme lue : médiane du catalogue entier (bornée par OPEN_RANGE_M)
  const all = medianRange([null, undefined]);
  assert.ok(all.rangeM > 0 && all.rangeM <= OPEN_RANGE_M);
});

test('identifiants d icônes : identifiant vers nom vers portée ; identifiant sans nom ou gadget : estimé', () => {
  const names = { B2: 'SPECTRE', B5: 'STRIKER', G9: 'DX3', B30: '' };
  assert.equal(resolveName('B2', names), 'SPECTRE');
  assert.equal(resolveName('B99', names), null, 'identifiant inconnu');
  assert.equal(resolveName('B30', names), null, 'identifiant sans nom');
  assert.equal(resolveName('AK77', names), 'AK77', 'déjà un nom');
  assert.equal(rangeOfWeapon('B2', names)?.rangeM, 20);
  assert.equal(rangeOfWeapon('G9', names), null, 'un gadget n a pas de portée d arme');
  const median = { rangeM: 15, open: false };
  assert.deepEqual(rangeOfPlayer('B5', 'G9', median, names), { rangeM: 10, open: false, weapon: 'STRIKER', estimated: false });
  assert.equal(rangeOfPlayer('B99', 'G9', median, names).estimated, true);
  assert.equal(medianRange(['B2', 'B5', 'B99'], names).rangeM, 15);
});
