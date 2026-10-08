import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampBounds, formatTime, parseTime, pctToTime, timeToPct } from '../src/lib/timeline.ts';

test('formatTime', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(65.9), '1:05');
  assert.equal(formatTime(3725), '1:02:05');
  assert.equal(formatTime(-3), '0:00');
});

test('timeToPct et pctToTime sont réciproques', () => {
  assert.equal(timeToPct(150, 600), 25);
  assert.equal(pctToTime(25, 600), 150);
  assert.equal(timeToPct(10, 0), 0);
  assert.equal(timeToPct(900, 600), 100);
});

test('clampBounds garde 0 ≤ début < fin ≤ durée', () => {
  assert.deepEqual(clampBounds(-5, 100, 600), { start: 0, end: 100 });
  assert.deepEqual(clampBounds(100, 9999, 600), { start: 100, end: 600 });
  assert.deepEqual(clampBounds(300, 300, 600), { start: 300, end: 301 });
  assert.deepEqual(clampBounds(599.9, 599.9, 600), { start: 599, end: 600 });
});

test('parseTime lit m:ss, h:mm:ss et les secondes', () => {
  assert.equal(parseTime('1:23'), 83);
  assert.equal(parseTime('1:02:03'), 3723);
  assert.equal(parseTime('83'), 83);
  assert.equal(parseTime(' 83,5 '), 83.5);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime('1:2:3:4'), null);
  assert.equal(parseTime(''), null);
});
