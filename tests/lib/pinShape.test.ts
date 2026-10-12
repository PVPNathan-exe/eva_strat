import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pinOutline } from '../../src/lib/pinShape.ts';

test('sans angle, la pastille est un disque de rayon constant', () => {
  const pts = pinOutline(100, 50, 10, null);
  for (const [x, y] of pts) assert.ok(Math.abs(Math.hypot(x - 100, y - 50) - 10) < 1e-9);
});

test('la pointe vise dans le sens du regard et dépasse le disque', () => {
  for (const angle of [0, 90, 180, 270, 45]) {
    const pts = pinOutline(0, 0, 10, angle);
    const far = pts.reduce((best, p) => (Math.hypot(p[0], p[1]) > Math.hypot(best[0], best[1]) ? p : best));
    const dir = (Math.atan2(far[1], far[0]) * 180) / Math.PI;
    assert.ok(Math.abs((((dir - angle + 540) % 360) - 180)) < 1e-6, `angle ${angle}`);
    assert.ok(Math.hypot(far[0], far[1]) > 15);
  }
});
