import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boxStyleOf, DRAG_MIN_PX, gazeAngle, isDrag, pixelDistance, planToMinimap, stageFraction } from '../src/components/analysis/review/notePlacement.ts';

const inset = { l: 0.02, t: 0.03, r: 0.01, b: 0.1 };
// Même formule que planInsets.project (non importé : ce fichier lit un JSON que node ne charge pas sans attribut)
const project = (i: typeof inset, x: number, y: number) => ({ x: (i.l + x * (1 - i.l - i.r)) * 100, y: (i.t + y * (1 - i.t - i.b)) * 100 });

test('du plan à la minimap : l inverse de project, bornée à 0 et 1', () => {
  for (const [x, y] of [[0, 0], [1, 1], [0.37, 0.81], [0.5, 0.5]]) {
    const p = project(inset, x, y);
    const back = planToMinimap(inset, p.x / 100, p.y / 100);
    assert.ok(Math.abs(back.x - x) < 1e-9 && Math.abs(back.y - y) < 1e-9, `aller-retour ${x},${y}`);
  }
  assert.deepEqual(planToMinimap(inset, 0, 0), { x: 0, y: 0 }, 'dans la marge du plan : borné');
  assert.deepEqual(planToMinimap(inset, 1, 1), { x: 1, y: 1 });
});

test('pointeur dans un rectangle : fractions bornées', () => {
  const rect = { left: 100, top: 50, width: 400, height: 200 };
  assert.deepEqual(stageFraction(rect, 300, 150), { x: 0.5, y: 0.5 });
  assert.deepEqual(stageFraction(rect, 0, 1000), { x: 0, y: 1 });
});

test('regard d un geste : 0 vers la droite, 90 vers le bas, 270 vers le haut ; geste trop court : aucun regard', () => {
  assert.equal(gazeAngle(30, 0), 0);
  assert.equal(gazeAngle(0, 30), 90);
  assert.equal(gazeAngle(0, -30), 270);
  assert.equal(Math.round(gazeAngle(-20, 0) ?? -1), 180);
  assert.equal(Math.round(gazeAngle(20, -20) ?? -1), 315);
  assert.equal(gazeAngle(3, 4), null, '5 pixels : un simple clic');
  assert.equal(gazeAngle(6, 8), 53.13010235415598, '10 pixels : assez');
});

test('cadre de la minimap dans le plan, en pourcentages', () => {
  const s = boxStyleOf(inset);
  assert.equal(s.left, '2%');
  assert.equal(s.top, '3%');
  assert.ok(Math.abs(parseFloat(String(s.width)) - 97) < 1e-9);
  assert.ok(Math.abs(parseFloat(String(s.height)) - 87) < 1e-9);
});

test('distance en pixels entre deux fractions du plan', () => {
  const rect = { width: 400, height: 200 };
  assert.equal(pixelDistance(rect, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }), 0);
  assert.equal(pixelDistance(rect, { x: 0, y: 0 }, { x: 0.03, y: 0.04 }), Math.hypot(12, 8));
});

test('glisser ou clic : un appui qui reste sous la distance minimale est un clic simple', () => {
  assert.equal(DRAG_MIN_PX, 6);
  assert.equal(isDrag(0, 0), false);
  assert.equal(isDrag(3, 4), false, '5 pixels : encore un clic');
  assert.equal(isDrag(6, 0), true, '6 pixels : un glisser');
  assert.equal(isDrag(-4, -5), true, 'distance diagonale');
  assert.equal(isDrag(10, 0, 12), false, 'seuil réglable (doigt)');
});
