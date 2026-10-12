import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSpawn, alignmentError, closesPolygon, sideOf, stationAngle, visionArrow, stationRadius, classifyImage, rectFrom, sanitize, solveAlignment, upsertColor, type PickedColor } from '../../src/lib/mapAnnotation.ts';

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
  assert.deepEqual([...classifyImage(px([10, 10, 10], [20, 20, 20]), colors)], [5, 6]);
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
    tps: [{ from: [0.1, 0.1], to: [2, 0.2] }, { from: [0.1, 0.1], to: [0.2, 0.2] }, { a: { x: 0.1, y: 0.1, r: 0.03, angle: -90 }, b: { x: 0.5, y: 0.5, r: 0.03 } }, { a: { x: 0.1, y: 0.1, r: 0.9 }, b: { x: 0.5, y: 0.5, r: 0.03 } }],
    doors: [{ from: [0.1, 0.1], to: [0.2, 0.2], glass: 1 }, { from: [0.3, 0.3], to: [0.4, 0.3], kind: 'fenetre', glass: true, side: -1 }, { from: [0.3, 0.3], to: [0.4, 0.3], side: 7 }, { from: [0.1, 0.1], to: [0.2, 0.1], kind: 'mur', glass: true, side: 1 }, { from: [0.5, 0.5], to: [0.6, 0.5], glass: true, side: 1 }, { from: [0.5, 0.5], to: [0.6, 0.5], glass: false, side: 1 }],
    spawns: { A: [[0.1, 0.1, 0.2, 0.2], [0.3, 0.3, 0.4, 0.4], [0.5, 0.5, 0.6, 0.6], [0.9, 0.9, 0.2, 0.2]] },
    capture: [[0.4, 0.4, 0.5, 0.5], [0.9, 0.9, 0.2, 0.2], [2, 0, 3, 1], [[0.1, 0.1], [0.2, 0.1], [0.2, 0.3]], [[0.1, 0.1], [0.2, 0.1]]],
  });
  assert.equal(a.colors.length, 1);
  assert.equal(a.colors[0].tol, 120);
  assert.equal(a.tps.length, 2); // une ancienne flèche et une paire valides ; flèche hors image et rayon trop grand refusés
  assert.equal(a.tps[1].a.angle, 270);
  assert.equal(a.tps[1].b.angle, null);
  assert.equal(a.doors[0].glass, true);
  assert.equal(a.doors[0].kind, 'porte');
  assert.deepEqual([a.doors[1].kind, a.doors[1].glass, a.doors[1].side], ['fenetre', false, -1]); // une fenêtre n'est pas une porte vitrée
  assert.equal(a.doors[2].side, 0);
  assert.deepEqual([a.doors[4].side, a.doors[5].side], [1, 0]); // sens unique : porte vitrée oui, porte sans vitre non
  assert.deepEqual([a.doors[3].kind, a.doors[3].glass, a.doors[3].side], ['mur', false, 0]); // un mur n'a ni vitre ni sens
  assert.equal(a.spawns.A.length, 2);
  // l'ancien rectangle devient ses 4 coins ; une forme libre de 3 points est gardée ; 2 points ou un rectangle à l'envers sont refusés
  assert.deepEqual(a.capture, [[[0.4, 0.4], [0.5, 0.4], [0.5, 0.5], [0.4, 0.5]], [[0.1, 0.1], [0.2, 0.1], [0.2, 0.3]]]);
  assert.deepEqual(a.spawns.B, []);
});

test('le rayon d\'une station tient compte de la forme de l\'image et ne dépasse pas la limite', () => {
  // image deux fois plus large que haute : 0,1 en hauteur vaut 0,05 en largeur
  assert.ok(Math.abs(stationRadius([0.5, 0.5], [0.5, 0.6], 2) - 0.05) < 1e-9);
  assert.ok(Math.abs(stationRadius([0.5, 0.5], [0.53, 0.5], 2) - 0.03) < 1e-9);
  assert.equal(stationRadius([0.5, 0.5], [0.5, 0.5], 2), 0.02);
  assert.equal(stationRadius([0.1, 0.1], [0.9, 0.1], 2), 0.2);
});

test('la direction d\'une station est celle du centre vers le clic, ou null dans le cercle', () => {
  assert.equal(stationAngle([0.5, 0.5], [0.9, 0.5], 0.03, 2), 0);
  assert.equal(stationAngle([0.5, 0.5], [0.5, 0.9], 0.03, 2), 90);
  assert.equal(stationAngle([0.5, 0.5], [0.1, 0.5], 0.03, 2), 180);
  assert.equal(stationAngle([0.5, 0.5], [0.5, 0.1], 0.03, 2), 270);
  assert.equal(stationAngle([0.5, 0.5], [0.51, 0.5], 0.03, 2), null);
  // image deux fois plus large que haute : +0,2 en largeur et +0,4 en hauteur font la même distance réelle, donc 45 degrés
  assert.ok(Math.abs((stationAngle([0.5, 0.5], [0.7, 0.9], 0.03, 2) ?? 0) - 45) < 1e-9);
});

test('le côté d\'un trait de fenêtre dépend du côté cliqué et de la forme de l\'image', () => {
  assert.equal(sideOf([0.2, 0.5], [0.8, 0.5], [0.5, 0.9], 2), 1); // trait vers la droite, clic en dessous
  assert.equal(sideOf([0.2, 0.5], [0.8, 0.5], [0.5, 0.1], 2), -1);
  assert.equal(sideOf([0.8, 0.5], [0.2, 0.5], [0.5, 0.9], 2), -1); // le même trait tracé à l'envers inverse le signe
  assert.equal(sideOf([0.2, 0.5], [0.8, 0.5], [0.5, 0.5], 2), 0);
});

test('la flèche de vision part du côté qui voit et traverse le trait', () => {
  // trait horizontal vers la droite : le côté 1 est en dessous (y plus grand), la flèche monte
  const arrow = visionArrow([0.2, 0.5], [0.8, 0.5], 1, 2)!;
  assert.ok(arrow[0][1] > 0.5 && arrow[1][1] < 0.5);
  assert.ok(Math.abs(arrow[0][0] - 0.5) < 1e-9);
  const other = visionArrow([0.2, 0.5], [0.8, 0.5], -1, 2)!;
  assert.ok(other[0][1] < 0.5 && other[1][1] > 0.5);
  assert.equal(visionArrow([0.2, 0.5], [0.8, 0.5], 0, 2), null);
  // le côté désigné par sideOf est bien celui d'où part la flèche
  const click: [number, number] = [0.5, 0.9];
  assert.equal(sideOf([0.2, 0.5], [0.8, 0.5], click, 2), 1);
});

test('un clic sur le premier point ferme la forme libre, seulement avec 3 points au moins', () => {
  const two: [number, number][] = [[0.2, 0.2], [0.5, 0.2]];
  assert.equal(closesPolygon(two, [0.2, 0.2], 2), false);
  const three: [number, number][] = [...two, [0.5, 0.5]];
  assert.equal(closesPolygon(three, [0.205, 0.21], 2), true);
  assert.equal(closesPolygon(three, [0.4, 0.4], 2), false);
});
