import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureSegments, hasCapture } from '../src/lib/captureTimeline.ts';

/** Série d'une équipe : une lecture par seconde à partir de t0, valeurs données. */
const series = (t0: number, values: number[]) => values.map((v, i) => ({ t: t0 + i, v }));
const teams = (segs: { t0: number; t1: number; team: string | null }[]) => segs.map((s) => [s.t0, s.t1, s.team]);

test('sans lecture de capture : aucune découpe (la barre verte reste)', () => {
  assert.deepEqual(captureSegments(null, 100, 200), []);
  assert.deepEqual(captureSegments({ A: [], B: [] }, 100, 200), []);
  assert.equal(hasCapture({ A: [], B: [] }), false);
  assert.equal(hasCapture({ A: [{ t: 1, v: 0 }], B: [] }), true);
});

test("neutre avant la première hausse, puis l'équipe dont le score monte", () => {
  const segs = captureSegments({ A: series(100, [0, 0, 1, 2, 3]), B: series(100, [0, 0, 0, 0, 0]) }, 100, 104);
  assert.deepEqual(teams(segs), [
    [100, 101, null],
    [101, 104, 'A'],
  ]);
});

test('quand rien ne monte, la couleur précédente est gardée', () => {
  const segs = captureSegments({ A: series(0, [0, 1, 2, 2, 2, 2]), B: series(0, [0, 0, 0, 0, 0, 0]) }, 0, 5);
  assert.deepEqual(teams(segs), [[0, 5, 'A']]);
});

test("changement d'équipe : orange puis bleue", () => {
  const segs = captureSegments({ A: series(0, [0, 1, 2, 3, 3, 3, 3, 3]), B: series(0, [0, 0, 0, 0, 1, 2, 3, 4]) }, 0, 7);
  assert.deepEqual(teams(segs), [
    [0, 3, 'A'],
    [3, 7, 'B'],
  ]);
});

test('les deux montent : la plus forte hausse gagne, égalité : couleur précédente', () => {
  const segs = captureSegments({ A: series(0, [0, 1, 3, 4]), B: series(0, [0, 0, 1, 5]) }, 0, 3);
  assert.deepEqual(teams(segs), [
    [0, 2, 'A'],
    [2, 3, 'B'],
  ]);
  const tie = captureSegments({ A: series(0, [0, 1, 2]), B: series(0, [0, 0, 1]) }, 0, 2);
  assert.deepEqual(teams(tie), [[0, 2, 'A']]);
});

test('une baisse (lecture fausse) ne compte pas comme une hausse', () => {
  const segs = captureSegments({ A: series(0, [5, 6, 7, 7, 7]), B: series(0, [10, 9, 10, 10, 10]) }, 0, 4);
  assert.deepEqual(teams(segs), [[0, 4, 'A']]);
});

test('plus de CAPTURE_GAP_S sans lecture : morceau neutre, puis la couleur reprend', () => {
  const A = [...series(0, [0, 1, 2]), ...series(20, [8, 9, 10])];
  const segs = captureSegments({ A, B: [] }, 0, 22);
  assert.deepEqual(teams(segs), [
    [0, 2, 'A'],
    [2, 20, null],
    [20, 22, 'A'],
  ]);
});

test('une hausse mesurée après une lecture trop ancienne ne date pas la capture', () => {
  // Orange n'est plus lue pendant 30 s alors que bleue capture : sa remontée à la reprise ne colore pas la seconde de reprise.
  const A = [{ t: 0, v: 0 }, { t: 1, v: 1 }, { t: 31, v: 20 }, { t: 32, v: 20 }];
  const B = [{ t: 0, v: 0 }, { t: 1, v: 0 }, ...series(2, Array.from({ length: 29 }, (_, i) => i + 1)), { t: 31, v: 29 }, { t: 32, v: 29 }];
  const segs = captureSegments({ A, B }, 0, 32, { smoothS: 0 });
  assert.deepEqual(teams(segs), [
    [0, 1, 'A'],
    [1, 32, 'B'],
  ]);
});

test('lissage : un morceau de moins de CAPTURE_SMOOTH_S entouré de la même équipe est absorbé', () => {
  // Bleue capture, une lecture orange fausse de +1 à 4 s, puis bleue reprend.
  const A = series(0, [0, 0, 0, 0, 1, 1, 1, 1, 1]);
  const B = series(0, [0, 1, 2, 3, 3, 4, 5, 6, 7]);
  assert.deepEqual(teams(captureSegments({ A, B }, 0, 8)), [
    [0, 8, 'B'],
  ]);
  assert.deepEqual(teams(captureSegments({ A, B }, 0, 8, { smoothS: 0 })), [
    [0, 3, 'B'],
    [3, 4, 'A'],
    [4, 8, 'B'],
  ]);
});

test('CAPTURE_IDLE_S activé : neutre après ce délai sans hausse', () => {
  const A = series(0, [0, 1, 2, 2, 2, 2, 2, 2, 2]);
  const segs = captureSegments({ A, B: [] }, 0, 8, { idleS: 3, smoothS: 0 });
  assert.deepEqual(teams(segs), [
    [0, 5, 'A'],
    [5, 8, null],
  ]);
});

test('les lectures hors de la game sont ignorées et la découpe couvre toute la game', () => {
  const segs = captureSegments({ A: series(95, [0, 0, 0, 0, 0, 0, 1, 2, 3]), B: [] }, 100, 110);
  assert.equal(segs[0].t0, 100);
  assert.equal(segs[segs.length - 1].t1, 110);
  assert.deepEqual(teams(segs), [
    [100, 103, 'A'],
    [103, 110, null], // plus de 5 s sans lecture avant la fin
  ]);
});
