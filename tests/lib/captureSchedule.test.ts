import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureCalendarOf, seenAt } from '../../src/lib/captureSchedule.ts';
import type { CaptureBox } from '../../src/types/analysis.ts';

const box = (t0: number, point: string): CaptureBox => ({ t0, t1: t0 + 80, x: 0.5, y: 0.5, w: 0.1, h: 0.1, point });

test('un changement du calendrier retrouve le point vu à quelques secondes près, le plus proche gagne', () => {
  const boxes = [box(35, 'C'), box(125, 'B'), box(131, 'A')];
  assert.equal(seenAt(boxes, 35)?.point, 'C');
  assert.equal(seenAt(boxes, 127)?.point, 'B');
  assert.equal(seenAt(boxes, 130)?.point, 'A');
  assert.equal(seenAt(boxes, 215), undefined); // rien vu à cet instant
});

test('seule Outlaw a un calendrier de points, avec le point C au premier changement', () => {
  assert.equal(captureCalendarOf('Polaris'), null);
  const outlaw = captureCalendarOf('Outlaw');
  assert.ok(outlaw);
  assert.equal(outlaw.durationS, 720);
  assert.equal(outlaw.schedule[0].restant, '11:25');
  assert.equal(outlaw.schedule[0].t, 35);
  assert.equal(outlaw.schedule.length, 8);
});
