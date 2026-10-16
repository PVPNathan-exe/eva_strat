import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTrails, formatFine, frameIndexAt, groupFrames, lerpAngle, numberOfSlot, shownAt } from '../src/components/analysis/review/replayFrames.ts';
import type { Sample } from '../src/types/analysis.ts';

const s = (frame: number, t: number, slot: number, x: number, y: number, extra: Partial<Sample> = {}): Sample => ({
  frame, t, slot, team: slot <= 4 ? 'A' : 'B', x, y, angle: 0, alive: 1, confidence: 1, ...extra,
});
const place = (x: number, y: number) => ({ x: Math.round(x * 100), y: Math.round(y * 100) });

test('numéro affiché : le créneau 5 à 8 s affiche 6 à 9', () => {
  assert.deepEqual([1, 4, 5, 8].map(numberOfSlot), [1, 4, 6, 9]);
});

test('images regroupées par instant, triées ; recherche de l image courante', () => {
  const frames = groupFrames([s(2, 20, 1, 0.2, 0.2), s(1, 10, 1, 0.1, 0.1), s(1, 10, 5, 0.9, 0.9)]);
  assert.deepEqual(frames.map((f) => f.t), [10, 20]);
  assert.equal(frames[0].bySlot.size, 2);
  assert.equal(frameIndexAt(frames, 5), 0, 'avant tout : la première');
  assert.equal(frameIndexAt(frames, 10), 0);
  assert.equal(frameIndexAt(frames, 19.9), 0);
  assert.equal(frameIndexAt(frames, 20), 1);
  assert.equal(frameIndexAt(frames, 99), 1);
});

test('instant interpolé entre deux images ; pas de trait à travers une mort, un trou ou une réapparition', () => {
  const frames = groupFrames([
    s(1, 10, 1, 0.1, 0.1, { angle: 350 }), s(2, 11, 1, 0.2, 0.1, { angle: 10 }),
    s(1, 10, 2, 0.1, 0.5), s(2, 11, 2, 0.1, 0.5, { alive: 0 }),
    s(1, 10, 3, 0.1, 0.9), s(2, 11, 3, 0.9, 0.9),
  ]);
  const at = new Map(shownAt(frames, 10.5).map((p) => [p.slot, p]));
  assert.ok(Math.abs(at.get(1)!.x - 0.15) < 1e-9);
  assert.ok(Math.abs(at.get(1)!.angle! - 0) < 1e-9 || Math.abs(at.get(1)!.angle! - 360) < 1e-9, '350 vers 10 par le plus court chemin : 0');
  assert.equal(at.get(2)!.x, 0.1);
  assert.equal(at.get(2)!.alive, true, 'vivant à l image courante, mort à la suivante : pas d interpolation');
  assert.equal(at.get(3)!.x, 0.1, 'saut de 0,8 : réapparition, pas d interpolation');
  assert.deepEqual(shownAt([], 10), []);
});

test('angle intermédiaire par le plus court chemin', () => {
  assert.equal(lerpAngle(350, 10, 0.5), 0);
  assert.equal(lerpAngle(10, 350, 0.5), 0);
  assert.equal(lerpAngle(0, 90, 0.5), 45);
});

test('traînées : coupées à une mort et à un trou, jamais pour un joueur masqué', () => {
  const frames = groupFrames([
    s(1, 10, 1, 0.1, 0.1), s(2, 11, 1, 0.12, 0.1), s(3, 12, 1, 0.14, 0.1), s(4, 13, 1, 0.16, 0.1, { alive: 0 }), s(5, 14, 1, 0.18, 0.1),
    s(1, 10, 5, 0.5, 0.5), s(2, 11, 5, 0.52, 0.5),
  ]);
  const trails = computeTrails(frames, 14, new Set(), place);
  const p1 = trails.filter((t) => t.key.startsWith('1-'));
  assert.equal(p1.length, 1, 'la mort coupe : un seul morceau de plus d un point');
  assert.equal(p1[0].points, '10,10 12,10 14,10');
  assert.equal(p1[0].team, 'A');
  assert.equal(trails.filter((t) => t.key.startsWith('5-')).length, 1);
  assert.deepEqual(computeTrails(frames, 14, new Set([1, 5]), place), []);
  assert.deepEqual(computeTrails([], 14, new Set(), place), []);
});

test('instant avec le dixième de seconde', () => {
  assert.equal(formatFine(72.34), '1:12.3');
  assert.equal(formatFine(-3), '0:00.0');
});

test('la traînée finit exactement sur la position affichée du point (interpolée entre deux images), à chaque instant', () => {
  const frames = groupFrames([s(1, 10, 1, 0.1, 0.1), s(2, 11, 1, 0.3, 0.1), s(3, 12, 1, 0.5, 0.1)]);
  for (const t of [10.4, 11, 11.25, 11.9]) {
    const pawn = shownAt(frames, t).find((p) => p.slot === 1)!;
    const trail = computeTrails(frames, t, new Set(), place).find((tr) => tr.key.startsWith('1-'));
    assert.ok(trail, `traînée à ${t}`);
    const last = trail.points.split(' ').pop()!;
    assert.equal(last, `${place(pawn.x, pawn.y).x},${place(pawn.x, pawn.y).y}`, `bout de la traînée à ${t} s`);
  }
});

test('la traînée ne rejoint pas le point du joueur mort', () => {
  const frames = groupFrames([s(1, 10, 1, 0.1, 0.1), s(2, 11, 1, 0.3, 0.1, { alive: 0 })]);
  const trail = computeTrails(frames, 10.5, new Set(), place).find((tr) => tr.key.startsWith('1-'));
  assert.equal(trail, undefined, 'un seul point vivant : pas de trait');
});
