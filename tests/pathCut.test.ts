import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutPath, decimate, isJump, isRide, metres, pathsOfLives, toGameTime, DEFAULT_CUT, type PathPoint, type StationPair } from '../src/lib/pathCut.ts';

// Paire de tyroliennes de Polaris (map_teleports.json) : entrée en bas, sortie en haut.
const PAIRS: StationPair[] = [[[0.6056, 0.6934], [0.6034, 0.0556]]];
const pt = (t: number, x: number, y: number): PathPoint => ({ t, x, y });

test('metres : la minimap fait 31 m sur 16,5 m', () => {
  assert.ok(Math.abs(metres({ x: 0, y: 0 }, { x: 1, y: 0 }) - 31) < 1e-9);
  assert.ok(Math.abs(metres({ x: 0, y: 0 }, { x: 0, y: 1 }) - 16.5) < 1e-9);
});

test('isRide : de l\'entrée à la sortie, dans les deux sens, pas ailleurs', () => {
  assert.equal(isRide(pt(0, 0.6, 0.69), pt(0.1, 0.6034, 0.06), PAIRS, 0.05), true);
  assert.equal(isRide(pt(0, 0.6034, 0.06), pt(0.1, 0.6056, 0.69), PAIRS, 0.05), true);
  assert.equal(isRide(pt(0, 0.6, 0.69), pt(0.1, 0.3, 0.3), PAIRS, 0.05), false);
  assert.equal(isRide(pt(0, 0.6, 0.69), pt(0.1, 0.61, 0.7), PAIRS, 0.05), false);
});

test('isRide : une paire aux extrémités presque confondues (Reef Point) est ignorée', () => {
  const reef: StationPair[] = [[[0.1288, 0.3905], [0.1288, 0.3925]]];
  assert.equal(isRide(pt(0, 0.1288, 0.3905), pt(0.1, 0.1288, 0.3925), reef, 0.05), false);
});

test('isJump : 14 m/s plus la marge, au-delà c\'est un saut', () => {
  const a = pt(0, 0.1, 0.5);
  assert.equal(isJump(a, pt(0.5, 0.2, 0.5), DEFAULT_CUT), false); // 3,1 m en 0,5 s
  assert.equal(isJump(a, pt(0.1, 0.6, 0.5), DEFAULT_CUT), true); // 15,5 m en 0,1 s
});

test('cutPath : une marche continue reste d\'un seul morceau', () => {
  const walk = [0, 1, 2, 3, 4].map((i) => pt(i * 0.2, 0.3 + i * 0.01, 0.5));
  const out = cutPath(walk, PAIRS, { minStep: 0 });
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 5);
});

test('cutPath : coupée à la tyrolienne, deux morceaux', () => {
  const pts = [pt(0, 0.6, 0.62), pt(0.2, 0.6056, 0.69), pt(0.4, 0.6034, 0.0556), pt(0.6, 0.6, 0.12)];
  const out = cutPath(pts, PAIRS, { minStep: 0 });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].map((p) => p.t), [0, 0.2]);
  assert.deepEqual(out[1].map((p) => p.t), [0.4, 0.6]);
});

test('cutPath : coupée à un trou de lecture et à un saut hors des stations', () => {
  const gap = [pt(0, 0.3, 0.5), pt(0.2, 0.31, 0.5), pt(3, 0.32, 0.5), pt(3.2, 0.33, 0.5)];
  assert.equal(cutPath(gap, PAIRS, { minStep: 0 }).length, 2);
  const jump = [pt(0, 0.1, 0.5), pt(0.1, 0.11, 0.5), pt(0.2, 0.9, 0.5), pt(0.3, 0.91, 0.5)];
  assert.equal(cutPath(jump, [], { minStep: 0 }).length, 2);
});

test('cutPath : les morceaux d\'un seul point disparaissent, liste vide acceptée', () => {
  assert.deepEqual(cutPath([], PAIRS), []);
  assert.deepEqual(cutPath([pt(0, 0.3, 0.3)], PAIRS), []);
  const lonely = [pt(0, 0.3, 0.5), pt(0.1, 0.31, 0.5), pt(5, 0.7, 0.5)];
  const out = cutPath(lonely, [], { minStep: 0 });
  assert.equal(out.length, 1);
  assert.equal(out[0].length, 2);
});

test('decimate : garde le premier et le dernier, retire les points trop proches', () => {
  const pts = [0, 1, 2, 3, 4, 5].map((i) => pt(i, 0.3 + i * 0.001, 0.5));
  const out = decimate(pts, 0.004);
  assert.equal(out[0], pts[0]);
  assert.equal(out[out.length - 1], pts[5]);
  assert.ok(out.length < pts.length);
  assert.equal(decimate(pts, 0).length, 6);
});

test('pathsOfLives : un trajet par vie, seulement les lignes vivantes du joueur', () => {
  const samples = [];
  for (let i = 0; i <= 20; i++) samples.push({ t: i * 0.5, slot: 3, x: 0.3 + i * 0.005, y: 0.5, alive: 1 });
  for (let i = 0; i <= 20; i++) samples.push({ t: i * 0.5, slot: 4, x: 0.8, y: 0.2, alive: 1 });
  samples.push({ t: 4.5, slot: 3, x: 0.99, y: 0.99, alive: 0 }); // ligne morte : ignorée
  const lives = [
    { game_id: 7, slot: 3, idx: 0, t0: 0, t1: 4 },
    { game_id: 7, slot: 3, idx: 1, t0: 6, t1: 10 },
  ];
  const out = pathsOfLives(samples, lives, [], { minStep: 0 });
  assert.equal(out.length, 2);
  assert.equal(out[0].game_id, 7);
  assert.equal(out[0].segments.length, 1);
  assert.equal(out[0].segments[0].length, 9); // t = 0 à 4 par 0,5
  assert.ok(out[0].segments[0].every((p) => p.x < 0.6));
  assert.equal(out[1].segments[0][0].t, 6);
});

test('pathsOfLives : une vie sans ligne donne zéro morceau', () => {
  const out = pathsOfLives([], [{ slot: 1, idx: 0, t0: 0, t1: 5 }], []);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].segments, []);
  assert.equal(out[0].game_id, null);
});

test('toGameTime : sans la conversion, des temps de vidéo ne tombent dans aucune vie (temps de game)', () => {
  const startS = 827.6; // /api/samples donne le temps de la vidéo, les vies sont en secondes depuis le début de la game
  const video = [];
  for (let i = 0; i <= 20; i++) video.push({ t: startS + i * 0.5, slot: 3, x: 0.3 + i * 0.005, y: 0.5, alive: 1 });
  const lives = [{ game_id: 16, slot: 3, idx: 0, t0: 0.1, t1: 9.9 }];
  assert.equal(pathsOfLives(video, lives, [], { minStep: 0 })[0].segments.length, 0);
  const out = pathsOfLives(toGameTime(video, startS), lives, [], { minStep: 0 });
  assert.equal(out[0].segments.length, 1);
  assert.equal(out[0].segments[0].length, 19);
  assert.ok(Math.abs(out[0].segments[0][0].t - 0.5) < 1e-9);
  assert.equal(video[0].t, startS); // l'entrée n'est pas modifiée
});
