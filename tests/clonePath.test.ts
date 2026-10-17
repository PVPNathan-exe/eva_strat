import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObstacleGrid, cloneAlong, clonePath, CLONE_CONTACT_M, isBlockedAt, stopText } from '../src/lib/clonePath.ts';
import { ARENA_M, metres } from '../src/lib/pathCut.ts';
import { formatMetres } from '../src/lib/gadgetParams.ts';

const N = 100;
/** Grille N x N libre, avec des colonnes (a inclus, b exclu, en cases) bloquées. */
function grid(columns: [number, number][] = []) {
  const blocked = new Uint8Array(N * N);
  for (const [a, b] of columns) for (let j = 0; j < N; j++) for (let i = a; i < b; i++) blocked[j * N + i] = 1;
  return { w: N, h: N, blocked };
}
const MAX = 13.9;
const near = (a: number, b: number, tol = 0.06) => Math.abs(a - b) <= tol;

test('trajet libre : jusqu au point visé, raison portée, rien de raccourci', () => {
  const from = { x: 0.1, y: 0.5 };
  const aim = { x: 0.1 + 6 / ARENA_M[0], y: 0.5 }; // 6 m vers la droite
  const r = clonePath({ from, aim, grid: grid(), players: [], maxRangeM: MAX });
  assert.equal(r.reason, 'portee');
  assert.equal(r.capped, false);
  assert.ok(near(r.distanceM, 6), `distance ${r.distanceM}`);
  assert.ok(near(metres(from, r.stop), 6));
  assert.equal(r.hitSlot, null);
});

test('portée maximale : une distance voulue plus longue est plafonnée', () => {
  const from = { x: 0.05, y: 0.5 };
  const aim = { x: 0.95, y: 0.5 }; // 27,9 m voulus
  const r = clonePath({ from, aim, grid: grid(), players: [], maxRangeM: MAX });
  assert.equal(r.reason, 'portee');
  assert.equal(r.capped, true);
  assert.ok(near(r.distanceM, MAX));
  assert.ok(near(r.wantedM, 0.9 * ARENA_M[0]));
});

test('mur : arrêt juste avant le premier mur, distance parcourue mesurée', () => {
  const from = { x: 0.1, y: 0.5 };
  const wallX = 0.4; // colonne de cases à partir de x = 0,40
  const g = grid([[40, 43]]);
  const r = clonePath({ from, aim: { x: 0.9, y: 0.5 }, grid: g, players: [], maxRangeM: MAX });
  const expected = (wallX - from.x) * ARENA_M[0]; // 9,3 m
  assert.equal(r.reason, 'mur');
  assert.ok(r.distanceM <= expected && expected - r.distanceM < 0.1, `distance ${r.distanceM} pour ${expected}`);
  assert.ok(r.stop.x < wallX);
  assert.equal(isBlockedAt(g, r.stop), false, 'le point d arrêt est libre');
});

test('mur : le premier obstacle gagne, un second mur derrière ne change rien', () => {
  const r = clonePath({ from: { x: 0.1, y: 0.5 }, aim: { x: 0.9, y: 0.5 }, grid: grid([[30, 31], [50, 52]]), players: [], maxRangeM: MAX });
  assert.equal(r.reason, 'mur');
  assert.ok(r.stop.x < 0.3);
});

test('joueur : arrêt au contact du premier joueur vivant, le lanceur est ignoré', () => {
  const from = { x: 0.1, y: 0.5 };
  const enemy = { slot: 6, x: 0.1 + 5 / ARENA_M[0], y: 0.5 }; // à 5 m
  const behind = { slot: 7, x: 0.1 + 8 / ARENA_M[0], y: 0.5 };
  const r = clonePath({ from, aim: { x: 0.9, y: 0.5 }, grid: grid(), players: [{ slot: 2, ...from }, enemy, behind], maxRangeM: MAX, ignoreSlot: 2 });
  assert.equal(r.reason, 'joueur');
  assert.equal(r.hitSlot, 6);
  assert.ok(near(r.distanceM, 5 - CLONE_CONTACT_M), `distance ${r.distanceM}`);
  assert.ok(metres(r.stop, enemy) <= CLONE_CONTACT_M + 1e-9);
});

test('joueur à côté du trajet (plus loin que le rayon de contact) : le clone passe', () => {
  const r = clonePath({ from: { x: 0.1, y: 0.5 }, aim: { x: 0.4, y: 0.5 }, grid: grid(), players: [{ slot: 6, x: 0.25, y: 0.5 + 1 / ARENA_M[1] }], maxRangeM: MAX });
  assert.equal(r.reason, 'portee');
});

test('un joueur déjà au contact au départ ne bloque pas tant qu on ne s en est pas éloigné', () => {
  const from = { x: 0.1, y: 0.5 };
  const mate = { slot: 3, x: 0.1 + 0.2 / ARENA_M[0], y: 0.5 };
  const r = clonePath({ from, aim: { x: 0.3, y: 0.5 }, grid: grid(), players: [mate], maxRangeM: MAX });
  assert.equal(r.reason, 'portee');
});

test('départ dans un mur (position imprécise) : tolérance courte, puis arrêt', () => {
  const r = clonePath({ from: { x: 0.1, y: 0.5 }, aim: { x: 0.9, y: 0.5 }, grid: grid([[10, 12]]), players: [], maxRangeM: MAX });
  assert.equal(r.reason, 'mur'); // la colonne fait 0,62 m : plus que la tolérance de 0,4 m
  assert.ok(r.distanceM <= 0.45, `distance ${r.distanceM}`);
});

test('bord de la minimap : un obstacle comme un autre', () => {
  const r = clonePath({ from: { x: 0.9, y: 0.5 }, aim: { x: 1.4, y: 0.5 }, grid: grid(), players: [], maxRangeM: MAX });
  assert.equal(r.reason, 'mur');
  assert.ok(r.stop.x < 1);
});

test('visée sur place : distance nulle, aucun déplacement', () => {
  const from = { x: 0.3, y: 0.3 };
  const r = clonePath({ from, aim: from, grid: grid(), players: [], maxRangeM: MAX });
  assert.equal(r.distanceM, 0);
  assert.deepEqual(r.stop, from);
});

test('le clone avance à sa vitesse puis reste à l arrêt', () => {
  const from = { x: 0.1, y: 0.5 };
  const r = clonePath({ from, aim: { x: 0.1 + 6 / ARENA_M[0], y: 0.5 }, grid: grid(), players: [], maxRangeM: MAX });
  const v = 5 / 3.6;
  const mid = cloneAlong(from, r, 2, v);
  assert.equal(mid.arrived, false);
  assert.ok(near(metres(from, mid.at), 2 * v, 1e-6));
  const end = cloneAlong(from, r, 10, v);
  assert.equal(end.arrived, true);
  assert.deepEqual(end.at, r.stop);
  assert.deepEqual(cloneAlong(from, r, -3, v).at, from, 'avant le lancement : au départ');
});

test('grille d obstacles : le tir par-dessus, les vitres et les portes arrêtent le clone (pas seulement le masque)', () => {
  const size = 8;
  const walk = { w: size, h: size, data: new Uint8Array(size * size).fill(255) }; // tout praticable
  const cls = { w: size, h: size, data: new Uint8Array(size * size).fill(1) };
  // colonne 2 : tir par-dessus (3), colonne 4 : vitre (4), colonne 6 : porte (5)
  for (let j = 0; j < size; j++) {
    cls.data[j * size + 2] = 3;
    cls.data[j * size + 4] = 4;
    cls.data[j * size + 6] = 5;
  }
  const g = buildObstacleGrid(walk, cls, size);
  for (let i = 0; i < size; i++) assert.equal(g.blocked[i], [2, 4, 6].includes(i) ? 1 : 0, `colonne ${i}`);
  const noClasses = buildObstacleGrid(walk, null, size);
  assert.ok(noClasses.blocked.every((b) => b === 0));
});

test('phrase d arrêt', () => {
  const base = { stop: { x: 0, y: 0 }, wantedM: 0, hitSlot: null };
  assert.equal(stopText({ ...base, reason: 'mur', distanceM: 8.2, capped: false }, formatMetres), 'arrêt sur un mur à 8,2 m');
  assert.equal(stopText({ ...base, reason: 'joueur', distanceM: 4, capped: false }, formatMetres), 'arrêt sur un joueur à 4 m');
  assert.match(stopText({ ...base, reason: 'portee', distanceM: 13.9, capped: true }, formatMetres), /portée maximale/);
  assert.match(stopText({ ...base, reason: 'portee', distanceM: 6, capped: false }, formatMetres), /distance voulue/);
});
