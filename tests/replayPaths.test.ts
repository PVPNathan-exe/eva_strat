import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frameAt, lifeAt, trailAt, CROSS_S, type ReplayLife } from '../src/lib/replayPaths.ts';
import type { LifePath, PathPoint } from '../src/lib/pathCut.ts';

const pt = (t: number, x: number, y = 0.5): PathPoint => ({ t, x, y });

test('trailAt : le trajet est coupé à l\'instant et le dernier point interpolé', () => {
  const seg = [pt(0, 0.1), pt(2, 0.3), pt(4, 0.5)];
  const { trail, head } = trailAt([seg], 3);
  assert.equal(trail.length, 1);
  assert.deepEqual(trail[0].map((p) => p.t), [0, 2, 3]);
  assert.ok(Math.abs((head as PathPoint).x - 0.4) < 1e-9);
});

test('trailAt : avant le premier point rien n\'est tracé, après le dernier tout l\'est', () => {
  const seg = [pt(1, 0.1), pt(2, 0.2)];
  assert.deepEqual(trailAt([seg], 0.5), { trail: [], head: null });
  const all = trailAt([seg], 10);
  assert.equal(all.trail[0].length, 2);
  assert.equal(all.head?.x, 0.2);
});

test('trailAt : entre deux morceaux (tyrolienne) le point reste à la sortie du premier, le second apparaît quand il commence', () => {
  const a = [pt(0, 0.1), pt(1, 0.2)];
  const b = [pt(3, 0.8), pt(4, 0.9)];
  const mid = trailAt([a, b], 2);
  assert.equal(mid.trail.length, 1);
  assert.equal(mid.head?.x, 0.2);
  const later = trailAt([a, b], 3.5);
  assert.equal(later.trail.length, 2);
  assert.ok(Math.abs((later.head as PathPoint).x - 0.85) < 1e-9);
});

test('trailAt : un morceau réduit à un seul point donne le point mais pas de trait', () => {
  const r = trailAt([[pt(0, 0.1), pt(5, 0.5)]], 0);
  assert.equal(r.trail.length, 0);
  assert.equal(r.head?.x, 0.1);
});

const lives: ReplayLife[] = [
  { slot: 1, idx: 0, t0: 0, t1: 10, ended: 'death', x1: 0.3, y1: 0.4 },
  { slot: 1, idx: 1, t0: 25, t1: 60, ended: 'end', x1: null, y1: null },
];
const paths: LifePath[] = [
  { game_id: 1, slot: 1, idx: 0, segments: [[pt(0, 0.1), pt(5, 0.2), pt(10, 0.3, 0.4)]] },
  { game_id: 1, slot: 1, idx: 1, segments: [[pt(25, 0.7), pt(30, 0.8)]] },
];

test('lifeAt : la vie en cours, rien entre la mort et la réapparition', () => {
  assert.equal(lifeAt(lives, 1, 5)?.idx, 0);
  assert.equal(lifeAt(lives, 1, 10)?.idx, 0);
  assert.equal(lifeAt(lives, 1, 15), null);
  assert.equal(lifeAt(lives, 1, 26)?.idx, 1);
  assert.equal(lifeAt(lives, 2, 5), null);
});

test('frameAt : vivant, le trajet de la vie en cours seulement', () => {
  const f = frameAt(paths, lives, 7);
  assert.equal(f.players.length, 1);
  assert.equal(f.players[0].idx, 0);
  assert.equal(f.crosses.length, 0);
  assert.equal(f.players[0].trail[0].at(-1)?.t, 7);
});

test('frameAt : à la mort le trajet disparaît et une croix apparaît à l\'endroit de la mort', () => {
  const f = frameAt(paths, lives, 10 + 1);
  assert.equal(f.players.length, 0);
  assert.equal(f.crosses.length, 1);
  assert.deepEqual([f.crosses[0].x, f.crosses[0].y], [0.3, 0.4]);
  assert.ok(f.crosses[0].age > 0 && f.crosses[0].age < 1);
});

test('frameAt : la croix s\'efface après CROSS_S, puis le nouveau trajet démarre à la réapparition, sans trace de l\'ancien', () => {
  assert.equal(frameAt(paths, lives, 10 + CROSS_S + 0.1).crosses.length, 0);
  assert.equal(frameAt(paths, lives, 15).players.length, 0);
  const respawn = frameAt(paths, lives, 27);
  assert.equal(respawn.players.length, 1);
  assert.equal(respawn.players[0].idx, 1);
  assert.ok(respawn.players[0].trail[0].every((p) => p.t >= 25)); // aucun point de la vie précédente
});

test('frameAt : une vie finie par la fin de la game n\'a pas de croix', () => {
  const f = frameAt(paths, lives, 61);
  assert.equal(f.players.length, 0);
  assert.equal(f.crosses.length, 0);
});
