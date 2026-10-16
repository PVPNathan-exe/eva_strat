import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameToVideoTime, hasNoPointChange, pointChangeLabel, pointChangeMarks, POINT_CHANGE_WINDOW_S } from '../src/lib/pointChangeMarks.ts';
import type { PointActive } from '../src/types/stats.ts';

const period = (point: string, t0: number, t1: number): PointActive => ({ game_id: 1, point, t0, t1, source: 'hud' });

// Outlaw : changements toutes les 90 s après le premier point (C), temps en secondes de game.
const outlaw = [period('C', 0, 35), period('B', 35, 125), period('A', 125, 215), period('B', 215, 300)];

test('engine et helios station : aucun changement de point, accents et casse ignorés', () => {
  assert.equal(hasNoPointChange('Engine'), true);
  assert.equal(hasNoPointChange('Helios Station'), true);
  assert.equal(hasNoPointChange('  helios   station '), true);
  assert.equal(hasNoPointChange('Outlaw'), false);
  assert.equal(hasNoPointChange(null), false);
});

test('temps de game vers temps de vidéo', () => {
  assert.equal(gameToVideoTime(35, 1000), 1035);
  assert.equal(gameToVideoTime(0, 1000), 1000);
});

test('la première période n est pas un changement, les suivantes le sont', () => {
  const marks = pointChangeMarks(outlaw, 1000, 1300);
  assert.deepEqual(marks.map((m) => m.point), ['B', 'A', 'B']);
  assert.deepEqual(marks.map((m) => m.from), ['C', 'B', 'A']);
  assert.deepEqual(marks.map((m) => m.gameT), [35, 125, 215]);
});

test('fenêtre de 10 s avant le changement, en temps de vidéo', () => {
  const [m] = pointChangeMarks(outlaw, 1000, 1300);
  assert.equal(POINT_CHANGE_WINDOW_S, 10);
  assert.equal(m.windowStartGameT, 25);
  assert.equal(m.videoT, 1035);
  assert.equal(m.windowStartVideoT, 1025);
});

test('fenêtre coupée au début de la game', () => {
  const [m] = pointChangeMarks([period('A', 0, 4), period('B', 4, 90)], 500, 800);
  assert.equal(m.windowStartGameT, 0);
  assert.equal(m.windowStartVideoT, 500);
  assert.equal(m.videoT, 504);
});

test('fenêtre personnalisée et périodes données dans le désordre', () => {
  const marks = pointChangeMarks([outlaw[2], outlaw[0], outlaw[1]], 0, 300, 20);
  assert.deepEqual(marks.map((m) => m.windowStartGameT), [15, 105]);
});

test('une période qui reprend le même point, ou qui commence après la fin de la game, n est pas un changement', () => {
  const marks = pointChangeMarks([period('C', 0, 30), period('C', 30, 60), period('B', 60, 150), period('A', 400, 500)], 0, 300);
  assert.deepEqual(marks.map((m) => m.point), ['B']);
});

test('aucune période, une seule période : aucun repère', () => {
  assert.deepEqual(pointChangeMarks([], 0, 300), []);
  assert.deepEqual(pointChangeMarks([period('A', 0, 300)], 0, 300), []);
});

test('l entrée n est pas modifiée', () => {
  const input = [outlaw[1], outlaw[0]];
  pointChangeMarks(input, 0, 300);
  assert.equal(input[0].point, 'B');
});

test('infobulle', () => {
  const [m] = pointChangeMarks(outlaw, 1000, 1300);
  assert.equal(pointChangeLabel(m, (s) => `${s}s`), 'Point B actif à 35s (C avant) : la lecture se place 10 s avant');
});
