import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterByRoom } from '../src/lib/roomFilter.ts';

const games = [
  { id: 1, intersalle: false },
  { id: 2, intersalle: true },
  { id: 3, intersalle: true },
];

test('toutes les games sont gardées sans filtre', () => {
  assert.deepEqual(filterByRoom(games, 'all').map((g) => g.id), [1, 2, 3]);
});

test('intersalle ne garde que les vidéos taguées', () => {
  assert.deepEqual(filterByRoom(games, 'inter').map((g) => g.id), [2, 3]);
});

test('même salle garde les autres', () => {
  assert.deepEqual(filterByRoom(games, 'same').map((g) => g.id), [1]);
});
