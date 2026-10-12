import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSpawn, alignmentError, classifyImage, rectFrom, sanitize, solveAlignment, upsertColor, type PickedColor } from '../../src/lib/mapAnnotation.ts';

const px = (...rgbs: number[][]) => Uint8ClampedArray.from(rgbs.flatMap((c) => [...c, 255]));

test('un pixel prend la classe de la couleur la plus proche, à moins de sa tolérance', () => {
  const colors: PickedColor[] = [
    { rgb: [100, 100, 100], tol: 10, cls: 'sol' },
    { rgb: [110, 100, 100], tol: 10, cls: 'mur' },
  ];
  const labels = classifyImage(px([100, 100, 100], [109, 100, 100], [160, 100, 100]), colors);
  assert.deepEqual([...labels], [1, 2, 0]);
});

test('la porte vitrée a un code distinct de la porte', () => {
  const colors: PickedColor[] = [
    { rgb: [10, 10, 10], tol: 0, cls: 'porte' },
    { rgb: [20, 20, 20], tol: 0, cls: 'porte_vitre' },
  ];
  assert.deepEqual([...classifyImage(px([10, 10, 10], [20, 20, 20]), colors)], [6, 7]);
});

test('ajouter deux fois la même couleur change sa classe sans la dupliquer', () => {
  const once = upsertColor([], [1, 2, 3], 'sol');
  const twice = upsertColor(once, [1, 2, 3], 'mur');
  assert.equal(twice.length, 1);
  assert.equal(twice[0].cls, 'mur');
});

test('une équipe a au plus 2 zones de départ', () => {
  let spawns = { A: [], B: [] } as ReturnType<typeof sanitize>['spawns'];
  spawns = addSpawn(spawns, 'A', [0.1, 0.1, 0.2, 0.2])!;
  spawns = addSpawn(spawns, 'A', [0.5, 0.5, 0.6, 0.6])!;
  assert.equal(addSpawn(spawns, 'A', [0.7, 0.7, 0.8, 0.8]), null);
  assert.ok(addSpawn(spawns, 'B', [0.7, 0.7, 0.8, 0.8]));
});

test('un rectangle trop petit est refusé et les coins sont remis dans l\'ordre', () => {
  assert.equal(rectFrom([0.5, 0.5], [0.505, 0.9]), null);
  assert.deepEqual(rectFrom([0.6, 0.7], [0.2, 0.3]), [0.2, 0.3, 0.6, 0.7]);
});

test('l\'alignement retrouve le cadre qui a servi à fabriquer les repères', () => {
  const inset = { l: 0.1, t: 0.05, r: 0.2, b: 0.15 };
  const at = (u: number, v: number) => [inset.l + u * (1 - inset.l - inset.r), inset.t + v * (1 - inset.t - inset.b)] as [number, number];
  const pairs = [[0.1, 0.1], [0.9, 0.2], [0.5, 0.9]].map(([u, v]) => ({ minimap: [u, v] as [number, number], plan: at(u, v) }));
  const solved = solveAlignment(pairs)!;
  for (const k of ['l', 't', 'r', 'b'] as const) assert.ok(Math.abs(solved[k] - inset[k]) < 1e-9, k);
  assert.ok(alignmentError(pairs, solved) < 1e-9);
});

test('l\'alignement est refusé avec un seul repère ou des repères alignés sur un axe', () => {
  assert.equal(solveAlignment([{ minimap: [0.2, 0.2], plan: [0.3, 0.3] }]), null);
  const sameColumn = [{ minimap: [0.5, 0.1] as [number, number], plan: [0.5, 0.1] as [number, number] }, { minimap: [0.5, 0.9] as [number, number], plan: [0.5, 0.9] as [number, number] }];
  assert.equal(solveAlignment(sameColumn), null);
});

test('sanitize écarte les valeurs invalides et borne les zones de départ', () => {
  const a = sanitize({
    colors: [{ rgb: [1, 2, 3], tol: 500, cls: 'sol' }, { rgb: [1, 2], cls: 'sol' }, { rgb: [1, 2, 3], cls: 'lave' }],
    tps: [{ from: [0.1, 0.1], to: [2, 0.2] }, { from: [0.1, 0.1], to: [0.2, 0.2] }],
    doors: [{ from: [0.1, 0.1], to: [0.2, 0.2], glass: 1 }],
    spawns: { A: [[0.1, 0.1, 0.2, 0.2], [0.3, 0.3, 0.4, 0.4], [0.5, 0.5, 0.6, 0.6], [0.9, 0.9, 0.2, 0.2]] },
  });
  assert.equal(a.colors.length, 1);
  assert.equal(a.colors[0].tol, 120);
  assert.equal(a.tps.length, 1);
  assert.equal(a.doors[0].glass, true);
  assert.equal(a.spawns.A.length, 2);
  assert.deepEqual(a.spawns.B, []);
});
