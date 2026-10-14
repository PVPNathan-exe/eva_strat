import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advance, clampTime } from '../src/lib/gameClock.ts';
import { deathsOf, visibleDeaths } from '../src/lib/deathWindow.ts';
import type { KillLink, Life } from '../src/types/stats.ts';

test('clampTime : borné à la durée, 0 si la durée est inconnue', () => {
  assert.equal(clampTime(-3, 100), 0);
  assert.equal(clampTime(120, 100), 100);
  assert.equal(clampTime(5, 0), 0);
  assert.equal(clampTime(Number.NaN, 100), 0);
});

test('advance : le temps avance selon la vitesse et s\'arrête à la fin', () => {
  assert.deepEqual(advance(10, 100, 4, 300), { t: 10.4, ended: false });
  const end = advance(299.9, 100, 4, 300);
  assert.equal(end.t, 300);
  assert.equal(end.ended, true);
});

test('advance : un grand saut de temps (onglet caché) est plafonné à un quart de seconde réelle', () => {
  assert.equal(advance(0, 60000, 1, 300).t, 0.25);
  assert.equal(advance(5, -50, 1, 300).t, 5);
});

const life = (slot: number, idx: number, t0: number, t1: number, ended: 'death' | 'end' = 'death'): Life => ({
  game_id: 1,
  slot,
  idx,
  t0,
  t1,
  x0: 0.1,
  y0: 0.1,
  x1: ended === 'death' ? 0.5 : null,
  y1: ended === 'death' ? 0.5 : null,
  ended,
  killer_slot: null,
  weapon: null,
  kill_kind: null,
});

test('deathsOf : numérotées dans l\'ordre du temps, les vies sans mort sont ignorées', () => {
  const lives = [life(2, 0, 0, 40), life(1, 0, 0, 20), life(1, 1, 30, 90, 'end')];
  const d = deathsOf(lives, []);
  assert.deepEqual(d.map((x) => [x.life.slot, x.n]), [[1, 1], [2, 2]]);
});

test('deathsOf : trade et revenge retrouvés', () => {
  const links: KillLink[] = [{ game_id: 1, t: 20.3, victim_slot: 1, kind: 'trade', other_slot: 5, dt: 0.4, dist_m: 3 }];
  const d = deathsOf([life(1, 0, 0, 20)], links);
  assert.equal(d[0].links.trade?.other_slot, 5);
});

test('visibleDeaths : jusqu\'à l\'instant, ou dans la fenêtre', () => {
  const d = deathsOf([life(1, 0, 0, 20), life(2, 0, 0, 40), life(3, 0, 0, 90)], []);
  assert.deepEqual(visibleDeaths(d, 45, 0).map((x) => x.n), [1, 2]);
  assert.deepEqual(visibleDeaths(d, 45, 10).map((x) => x.n), [2]);
  assert.deepEqual(visibleDeaths(d, 10, 0), []);
  assert.deepEqual(visibleDeaths(d, 90, 60).map((x) => x.n), [2, 3]);
});
