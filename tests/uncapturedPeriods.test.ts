import { test } from 'node:test';
import assert from 'node:assert/strict';
import { showsUncaptured, uncapturedPeriods } from '../src/lib/uncapturedPeriods.ts';
import type { PointOwner } from '../src/types/stats.ts';

const row = (point: string, t0: number, t1: number, owner: PointOwner['owner']): PointOwner => ({ game_id: 1, point, t0, t1, owner, source: 'box' });

test('seul Outlaw montre les moments sans propriétaire', () => {
  assert.equal(showsUncaptured('Outlaw'), true);
  assert.equal(showsUncaptured(' outlaw '), true);
  assert.equal(showsUncaptured('Atlantis'), false);
  assert.equal(showsUncaptured(null), false);
});

test('garde les périodes sans propriétaire, triées, sans les prises', () => {
  const out = uncapturedPeriods([row('C', 58, 99, 'none'), row('C', 41, 58, 'A'), row('C', 38, 41, 'none')], 540);
  assert.deepEqual(out, [{ point: 'C', t0: 38, t1: 41 }, { point: 'C', t0: 58, t1: 99 }]);
});

test('recolle deux périodes qui se suivent sur le même point, pas sur deux points', () => {
  const out = uncapturedPeriods([row('B', 10, 20, 'none'), row('B', 20.5, 30, 'none'), row('A', 30, 40, 'none')], 100);
  assert.deepEqual(out, [{ point: 'B', t0: 10, t1: 30 }, { point: 'A', t0: 30, t1: 40 }]);
});

test('ignore les trous de moins d une seconde et coupe à la durée de la game', () => {
  const out = uncapturedPeriods([row('B', 5, 5.5, 'none'), row('B', 90, 120, 'none')], 100);
  assert.deepEqual(out, [{ point: 'B', t0: 90, t1: 100 }]);
});
