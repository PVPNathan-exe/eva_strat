import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSpawn, alignmentError, applyOverrides, findConflicts, pointInPolygon, separateTolerances, balancePair, completePair, closesPolygon, sideOf, stationAngle, visionArrow, stationRadius, classifyImage, rectFrom, sanitize, solveAlignment, upsertColor, type PickedColor } from '../../src/lib/mapAnnotation.ts';

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
  let spawns = { A: [], B: [], any: [] } as ReturnType<typeof sanitize>['spawns'];
  spawns = addSpawn(spawns, 'A', [0.1, 0.1, 0.2, 0.2])!;
  spawns = addSpawn(spawns, 'A', [0.5, 0.5, 0.6, 0.6])!;
  assert.equal(addSpawn(spawns, 'A', [0.7, 0.7, 0.8, 0.8]), null);
  assert.ok(addSpawn(spawns, 'B', [0.7, 0.7, 0.8, 0.8]));
  for (let i = 0; i < 4; i++) spawns = addSpawn(spawns, 'any', [0.1 * i, 0.1, 0.1 * i + 0.05, 0.2])!; // zones neutres (Outlaw) : 4 au plus
  assert.equal(addSpawn(spawns, 'any', [0.9, 0.9, 0.95, 0.95]), null);
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
  assert.equal(a.tps[1].b.angle, 90); // la seconde station prend l'opposée de la première (règle des 180 degrés)
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

test('les deux stations d\'une tyrolienne ont des directions opposées (180 degrés)', () => {
  const a = { x: 0.1, y: 0.1, r: 0.02, angle: 90 };
  const b = { x: 0.9, y: 0.9, r: 0.02, angle: null };
  assert.equal(completePair(a, b).b.angle, 270); // la seconde se déduit de la première
  assert.equal(completePair({ ...a, angle: 300 }, b).b.angle, 120); // on repasse par 0 et 360
  assert.equal(completePair({ ...a, angle: null }, { ...b, angle: 45 }).a.angle, 225); // première sans direction : elle se déduit de la seconde
  const both = completePair({ ...a, angle: 10 }, { ...b, angle: 100 }); // deux directions à la création : la première l'emporte
  assert.equal(both.b.angle, 190);
  const read = balancePair({ a: { ...a, angle: 320 }, b: { ...b, angle: 153 } }); // paire relue : l'écart de 13 degrés est réparti
  assert.ok(Math.abs((read.a.angle ?? 0) - 326.5) < 1e-9 && Math.abs((read.b.angle ?? 0) - 146.5) < 1e-9);
  const none = completePair(a && { ...a, angle: null }, b);
  assert.deepEqual([none.a.angle, none.b.angle], [null, null]);
});

test('une zone de remplacement change la classe des seuls pixels voulus, dans la zone', () => {
  // image 10 x 10 : colonne de gauche (x < 5) en classe 3 (tir), droite en classe 3 aussi, la ligne 0 en classe 2 (mur)
  const labels = new Uint8Array(100).fill(3);
  for (let x = 0; x < 10; x++) labels[x] = 2;
  const zone: [number, number][] = [[0, 0], [0.5, 0], [0.5, 1], [0, 1]]; // moitié gauche
  applyOverrides(labels, 10, 10, [{ polygon: zone, from: 'tir', to: 'vue', under: false }]);
  assert.equal(labels[5 * 10 + 2], 4); // tir dans la zone devient vue seulement (code 4)
  assert.equal(labels[5 * 10 + 7], 3); // hors de la zone : inchangé
  assert.equal(labels[2], 2); // un mur dans la zone n'est pas un tir : inchangé
  applyOverrides(labels, 10, 10, [{ polygon: zone, from: 'any', to: 'sol', under: false }]);
  assert.equal(labels[2], 1); // « toutes les classes » : le mur aussi
  assert.equal(labels[5 * 10 + 7], 3);
});

test('pointInPolygon gère une forme concave', () => {
  const l: [number, number][] = [[0.2, 0.2], [0.5, 0.2], [0.5, 0.5], [0.8, 0.5], [0.8, 0.8], [0.2, 0.8]];
  assert.equal(pointInPolygon([0.3, 0.3], l), true);
  assert.equal(pointInPolygon([0.7, 0.7], l), true);
  assert.equal(pointInPolygon([0.7, 0.3], l), false); // le creux du L
});

test('les couleurs de classes différentes qui se recouvrent sont détectées et leurs tolérances séparées', () => {
  const colors: PickedColor[] = [
    { rgb: [100, 100, 100], tol: 10, cls: 'tir' },
    { rgb: [107, 100, 100], tol: 10, cls: 'mur' }, // à 7 de la première
    { rgb: [200, 200, 200], tol: 10, cls: 'sol' },
    { rgb: [100, 100, 104], tol: 10, cls: 'tir' }, // même classe que la première : pas un conflit
  ];
  const rgba = Uint8ClampedArray.from([103, 100, 100, 255, 100, 100, 100, 255, 200, 200, 200, 255]);
  const { mask, pairs } = findConflicts(rgba, colors);
  assert.deepEqual([...mask], [1, 1, 0]); // les deux premiers pixels sont à la fois tir et mur
  assert.deepEqual(pairs.map((p) => [p.i, p.j]), [[0, 1], [1, 3]]);
  const tight = separateTolerances(colors);
  assert.equal(tight[0].tol, 3); // moitié de 7 (arrondie vers le bas)
  assert.equal(tight[2].tol, 10); // couleur isolée : inchangée
  assert.equal(findConflicts(rgba, tight).pairs.length, 0);
});

test('le recoupement avec le plan stratégique est une option choisie carte par carte (désactivée par défaut)', () => {
  assert.equal(sanitize({}).usePlan, false);
  assert.equal(sanitize({ usePlan: true }).usePlan, true);
  assert.equal(sanitize({ usePlan: 'oui' }).usePlan, false);
});

test('un trait ou une zone « passage possible en dessous » est lu tel quel, sauf pour une porte', () => {
  const a = sanitize({
    doors: [
      { from: [0.1, 0.1], to: [0.2, 0.1], kind: 'tir', under: true },
      { from: [0.1, 0.2], to: [0.2, 0.2], kind: 'tir' },
      { from: [0.1, 0.3], to: [0.2, 0.3], kind: 'porte', under: true },
    ],
    overrides: [{ polygon: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.3]], from: 'any', to: 'tir', under: true }, { polygon: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.3]], from: 'any', to: 'tir' }],
  });
  assert.deepEqual(a.doors.map((d) => d.under), [true, false, false]);
  assert.deepEqual(a.overrides.map((o) => o.under), [true, false]);
});

test('« hors map » se pose par zone, jamais par couleur de pixel', () => {
  const a = sanitize({ colors: [{ rgb: [1, 2, 3], tol: 10, cls: 'hors' }, { rgb: [4, 5, 6], tol: 10, cls: 'sol' }], overrides: [{ polygon: [[0, 0], [1, 0], [1, 1]], from: 'any', to: 'hors' }] });
  assert.equal(a.colors.length, 1); // la couleur « hors » est écartée
  assert.equal(a.overrides[0].to, 'hors'); // la zone « hors » est gardée
  const labels = new Uint8Array(100).fill(1);
  applyOverrides(labels, 10, 10, a.overrides);
  assert.equal(labels[2 * 10 + 8], 7); // un pixel dans le triangle (haut droit) devient hors map, code 7
  assert.equal(labels[8 * 10 + 1], 1); // un pixel hors du triangle reste du sol
});
