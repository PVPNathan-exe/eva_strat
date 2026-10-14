import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blur, gridFromCells, heatColor, heatPixels, mergeGrids, normalize, parseHex, percentile, totalSeconds } from '../src/lib/heatGrid.ts';
import { linksOfDeath } from '../src/lib/statsApi.ts';
import type { KillLink, Life } from '../src/types/stats.ts';

test('gridFromCells : placement ligne par ligne, doublons additionnés, cases hors grille ignorées', () => {
  const g = gridFromCells(4, [[1, 2, 3], [1, 2, 1.5], [0, 0, 2], [4, 0, 9], [-1, 1, 9], [2, 4, 9], [1.5, 1, 9], [3, 3, NaN]]);
  assert.equal(g.length, 16);
  assert.equal(g[2 * 4 + 1], 4.5);
  assert.equal(g[0], 2);
  assert.equal(totalSeconds(g), 6.5);
});

test('gridFromCells : grille vide', () => {
  assert.equal(gridFromCells(0, []).length, 0);
  assert.equal(totalSeconds(gridFromCells(8, [])), 0);
});

test('blur : sigma 0 rend la grille telle quelle, sinon elle s\'étale et reste symétrique', () => {
  const g = gridFromCells(9, [[4, 4, 10]]);
  assert.equal(blur(g, 9, 0), g);
  const b = blur(g, 9, 1);
  assert.ok(b[4 * 9 + 4] < 10 && b[4 * 9 + 4] > 0);
  assert.ok(b[4 * 9 + 5] > 0);
  assert.ok(Math.abs(b[4 * 9 + 3] - b[4 * 9 + 5]) < 1e-6);
  assert.ok(Math.abs(b[3 * 9 + 4] - b[5 * 9 + 4]) < 1e-6);
  assert.ok(Math.abs(totalSeconds(b) - 10) < 0.5); // somme à peu près conservée (centre de la grille)
});

test('blur : une grille uniforme reste uniforme, bords compris', () => {
  const g = new Float32Array(25).fill(2);
  for (const v of blur(g, 5, 1.5)) assert.ok(Math.abs(v - 2) < 1e-5);
});

test('percentile et normalize : écrêtage au percentile des cases occupées', () => {
  const g = Float32Array.from([0, 0, 1, 2, 3, 4, 100]);
  assert.equal(percentile(g, 1), 100);
  assert.equal(percentile(g, 0), 1);
  assert.equal(percentile(new Float32Array(4), 0.9), 0);
  const n = normalize(g, 0.5);
  assert.equal(n[0], 0);
  assert.equal(n[6], 1); // écrêté
  assert.ok(n.every((v) => v >= 0 && v <= 1));
  assert.deepEqual(Array.from(normalize(new Float32Array(3))), [0, 0, 0]);
});

test('parseHex : trois et six chiffres, refus du reste', () => {
  assert.deepEqual(parseHex('#ff9f1c'), [255, 159, 28]);
  assert.deepEqual(parseHex(' #FFF '), [255, 255, 255]);
  assert.equal(parseHex('rgb(1,2,3)'), null);
  assert.equal(parseHex('var(--c-x)'), null);
  assert.equal(parseHex(''), null);
});

test('heatColor : valeur 0 transparente et couleur basse, valeur 1 couleur haute et opacité maximale', () => {
  const low: [number, number, number] = [0, 0, 0];
  const high: [number, number, number] = [200, 100, 50];
  assert.deepEqual(heatColor(0, low, high, 0.8), [0, 0, 0, 0]);
  assert.deepEqual(heatColor(1, low, high, 0.8), [200, 100, 50, 204]);
  assert.deepEqual(heatColor(5, low, high, 0.8), heatColor(1, low, high, 0.8)); // écrêté
  assert.deepEqual(heatColor(-1, low, high, 0.8), heatColor(0, low, high, 0.8));
});

test('heatPixels : 4 octets par case', () => {
  const px = heatPixels(Float32Array.from([0, 1, 0.5, 0]), 2, [0, 0, 0], [255, 255, 255]);
  assert.equal(px.length, 16);
  assert.equal(px[3], 0);
  assert.equal(px[7], 217);
});

// Liens d'une mort (statsApi.linksOfDeath)
const life = (over: Partial<Life> = {}): Life => ({ game_id: 1, slot: 2, idx: 0, t0: 0, t1: 50, x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5, ended: 'death', killer_slot: 6, weapon: 'AR', kill_kind: 'kill', ...over });
const link = (over: Partial<KillLink>): KillLink => ({ game_id: 1, t: 50, victim_slot: 2, kind: 'trade', other_slot: 6, dt: 0.4, dist_m: 3, ...over });

test('linksOfDeath : trade de cette mort, vengeance par un coéquipier, mort d\'un tueur vengeur', () => {
  const links = [
    link({ kind: 'trade', victim_slot: 2, t: 50.2 }),
    link({ kind: 'revenge', victim_slot: 6, other_slot: 2, t: 53 }), // le 6 (tueur du 2) est tué par un coéquipier : le 2 est vengé
    link({ kind: 'revenge', victim_slot: 2, other_slot: 4, t: 50.1 }), // le 2, qui venait de tuer le 4, est tué par un coéquipier du 4 : cette mort est une revenge
    link({ kind: 'trade', victim_slot: 2, t: 120 }), // une autre mort du 2
    link({ game_id: 2, kind: 'trade', victim_slot: 2, t: 50 }), // une autre game
  ];
  const r = linksOfDeath(life(), links);
  assert.equal(r.trade?.t, 50.2);
  assert.equal(r.avengedBy?.t, 53);
  assert.equal(r.revengeKill?.other_slot, 4);
});

test('linksOfDeath : aucune liaison, vie finie par la fin de game', () => {
  const r = linksOfDeath(life(), []);
  assert.deepEqual(r, { trade: null, avengedBy: null, revengeKill: null });
  assert.deepEqual(linksOfDeath(life({ ended: 'end' }), [link({ t: 50 })]), { trade: null, avengedBy: null, revengeKill: null });
});

test('mergeGrids : additionne les cases de plusieurs grilles de même côté et le nombre de games', () => {
  const m = mergeGrids([
    { n: 4, games: 1, cells: [[0, 0, 2], [1, 2, 3]] },
    { n: 4, games: 2, cells: [[1, 2, 1.5], [3, 3, 1]] },
  ]);
  assert.equal(m.n, 4);
  assert.equal(m.games, 3);
  assert.deepEqual(m.cells, [[0, 0, 2], [1, 2, 4.5], [3, 3, 1]]);
});

test('mergeGrids : une grille d\'un autre côté est ignorée, aucune grille donne une grille vide', () => {
  const m = mergeGrids([{ n: 4, games: 1, cells: [[0, 0, 1]] }, { n: 8, games: 1, cells: [[5, 5, 9]] }]);
  assert.deepEqual(m.cells, [[0, 0, 1]]);
  assert.deepEqual(mergeGrids([]), { n: 64, games: 0, cells: [] });
});
