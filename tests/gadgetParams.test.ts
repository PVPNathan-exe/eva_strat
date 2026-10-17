import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloneParams, displaySeconds, explosionLegend, formatMetres, gadgetKey, gadgetKind, knownRadii, shieldLengthM } from '../src/lib/gadgetParams.ts';

test('noms : CLONE et ECHO sont le même gadget, MED PACK et MEDPACK aussi', () => {
  assert.equal(gadgetKey('echo'), 'CLONE');
  assert.equal(gadgetKey(' Clone '), 'CLONE');
  assert.equal(gadgetKey('MED PACK'), 'MEDPACK');
  assert.equal(gadgetKind('shield'), 'shield');
  assert.equal(gadgetKind('CLONE'), 'clone');
  assert.equal(gadgetKind('DX3'), 'point');
  assert.equal(gadgetKind(null), 'point');
});

test('durée d affichage : SHIELD 10 s et CLONE 10 s (référence), rien pour un gadget posé en un point', () => {
  assert.equal(displaySeconds('SHIELD'), 10);
  assert.equal(displaySeconds('CLONE'), 10);
  assert.equal(displaySeconds('STICKY'), null);
  assert.equal(displaySeconds('SONAR'), null);
  assert.equal(displaySeconds(null), null);
});

test('clone : 5 km/h pendant 10 s, portée maximale d environ 13,9 m', () => {
  const p = cloneParams();
  assert.ok(p);
  assert.ok(Math.abs(p.speedMs - 5 / 3.6) < 1e-9);
  assert.equal(p.durationS, 10);
  assert.ok(Math.abs(p.maxRangeM - 13.8889) < 1e-3);
});

test('rayons : seul le STICKY est connu (3 m de mort sur le coup, 5 m de dégâts), les autres sont inconnus', () => {
  assert.deepEqual(knownRadii('STICKY'), [{ label: 'mort sur le coup', m: 3 }, { label: 'dégâts', m: 5 }]);
  assert.deepEqual(knownRadii('DX3'), []);
  assert.deepEqual(knownRadii('SONAR'), []);
  assert.deepEqual(knownRadii('SHIELD'), []);
  const legend = explosionLegend();
  assert.equal(legend.find((l) => l.name === 'STICKY')?.text, 'STICKY : 3 m (mort sur le coup), 5 m (dégâts)');
  assert.equal(legend.find((l) => l.name === 'DX3')?.text, 'DX3 : rayon non connu');
  assert.equal(legend.find((l) => l.name === 'SONAR')?.text, 'SONAR : rayon non connu');
});

test('longueur du trait du shield en mètres (arène de 31 m sur 16,5 m)', () => {
  assert.ok(Math.abs(shieldLengthM({ x: 0.2, y: 0.5 }, { x: 0.3, y: 0.5 }) - 3.1) < 1e-9);
  assert.ok(Math.abs(shieldLengthM({ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.2 }) - 1.65) < 1e-9);
  assert.ok(Math.abs(shieldLengthM({ x: 0, y: 0 }, { x: 1, y: 1 }) - Math.hypot(31, 16.5)) < 1e-9);
  assert.equal(shieldLengthM({ x: 0.4, y: 0.4 }, { x: 0.4, y: 0.4 }), 0);
});

test('mètres affichés : une décimale seulement quand il y en a une', () => {
  assert.equal(formatMetres(8.2), '8,2 m');
  assert.equal(formatMetres(3), '3 m');
});
