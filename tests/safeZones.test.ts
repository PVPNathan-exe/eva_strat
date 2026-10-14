import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { COVER_A, COVER_B, computeZones, createCache, indexSamples, outlinesOf, positionsAt, zoneCounts, zonePixels, type PositionSample, type Shooter } from '../src/lib/safeZones.ts';
import { buildGrid, cellMetres, type BlockGrid, type GraySource } from '../src/lib/visibility.ts';

const gridOf = (n: number, wall: (x: number, y: number) => boolean): BlockGrid => {
  const blocked = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) blocked[y * n + x] = wall(x, y) ? 1 : 0;
  return { w: n, h: n, blocked };
};
const shooter = (slot: number, x: number, y: number, rangeM = 60): Shooter => ({ slot, team: slot <= 4 ? 'A' : 'B', x, y, rangeM, estimated: false });
const at = (r: { w: number; state: Uint8Array }, cx: number, cy: number) => r.state[cy * r.w + cx];

test('un mur entre deux équipes : chacune couvre son côté, personne ne couvre l autre', () => {
  const g = gridOf(100, (x) => x === 50);
  const r = computeZones(g, [shooter(1, 0.2, 0.5), shooter(5, 0.8, 0.5)]);
  assert.equal(at(r, 30, 50), COVER_A);
  assert.equal(at(r, 70, 50), COVER_B);
  const c = zoneCounts(r, g);
  assert.ok(c.contested === 0 && c.safeA > 0 && c.safeB > 0);
  assert.equal(c.safeA + c.safeB + c.contested + c.uncovered, c.open);
});

test('sans mur : tout est couvert par les deux, rien n est sûr', () => {
  const g = gridOf(100, () => false);
  const r = computeZones(g, [shooter(1, 0.2, 0.5), shooter(5, 0.8, 0.5)]);
  const c = zoneCounts(r, g);
  assert.equal(c.safeA + c.safeB, 0);
  assert.ok(c.contested > 0.9 * c.open);
});

test('la portée limite la couverture : une zone hors de portée de l ennemi devient sûre', () => {
  const g = gridOf(100, () => false);
  const [cw] = cellMetres(g);
  const r = computeZones(g, [shooter(1, 0.2, 0.5, 60), shooter(5, 0.8, 0.5, 5)]);
  assert.equal(at(r, 78, 50), COVER_A | COVER_B, 'tout près de l ennemi : les deux couvrent');
  assert.equal(at(r, 80 - Math.round(6 / cw), 50) & COVER_B, 0, 'à plus de 5 m de l ennemi : il ne couvre pas');
  assert.equal(at(r, 40, 50), COVER_A, 'zone sûre pour A');
});

test('joueurs d une même équipe : l union de leurs vues', () => {
  const g = gridOf(100, (x, y) => x === 50 && y > 10 && y < 90);
  const r = computeZones(g, [shooter(1, 0.3, 0.5), shooter(2, 0.7, 0.5)]);
  assert.equal(at(r, 70, 50), COVER_A, 'le 2 couvre son côté du mur');
  assert.equal(r.views.length, 2);
  assert.equal(outlinesOf(r).length, 2);
  assert.equal(outlinesOf(r)[1].slot, 2);
});

test('pixels de la couche : couleur par état, murs et zones non couvertes transparents', () => {
  const g = gridOf(20, (x) => x === 10);
  const r = computeZones(g, [shooter(1, 0.2, 0.5), shooter(5, 0.8, 0.5)]);
  const colors = { a: [255, 0, 0] as [number, number, number], b: [0, 0, 255] as [number, number, number], contested: [9, 9, 9] as [number, number, number], alpha: 100 };
  const px = zonePixels(r, colors);
  assert.deepEqual([...px.slice((10 * 20 + 3) * 4, (10 * 20 + 3) * 4 + 4)], [255, 0, 0, 100]);
  assert.deepEqual([...px.slice((10 * 20 + 15) * 4, (10 * 20 + 15) * 4 + 4)], [0, 0, 255, 100]);
  assert.equal(px[(10 * 20 + 10) * 4 + 3], 0, 'le mur n est pas couvert');
  assert.equal(zonePixels(r, colors, 'A')[(10 * 20 + 15) * 4 + 3], 0, 'équipe A seule : la zone sûre de B disparaît');
});

test('positions à un instant : la ligne la plus proche, vivante, à 1,5 s près', () => {
  const s = (t: number, slot: number, alive = 1): PositionSample => ({ t, slot, team: slot <= 4 ? 'A' : 'B', x: t / 100, y: 0.5, alive });
  const index = indexSamples([s(10, 1), s(11, 1), s(12, 1), s(10, 5), s(11, 5, 0), s(30, 6)]);
  assert.deepEqual(positionsAt(index, 11.2).map((p) => p.slot), [1], 'le 5 est mort à cet instant, le 6 est trop loin');
  assert.equal(positionsAt(index, 11.2)[0].t, 11);
  assert.deepEqual(positionsAt(index, 10.1).map((p) => p.slot), [1, 5]);
  assert.deepEqual(positionsAt(index, 100), []);
  assert.equal(positionsAt(index, 5).length, 0, 'avant la première ligne : plus de 1,5 s');
});

test('cache par instant : le plus ancien sort en premier, une lecture rafraîchit', () => {
  const c = createCache<number>(2);
  c.set('a', 1);
  c.set('b', 2);
  assert.equal(c.get('a'), 1);
  c.set('c', 3);
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  assert.equal(c.size, 2);
});

/** Décodage minimal d un PNG en niveaux de gris 8 bits non entrelacé (pour le test sur un vrai masque). */
function readGrayPng(path: string): GraySource {
  const buf = readFileSync(path);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  assert.equal(buf[24], 8);
  assert.equal(buf[25], 0, 'niveaux de gris');
  const parts: Buffer[] = [];
  for (let p = 8; p < buf.length; ) {
    const len = buf.readUInt32BE(p);
    if (buf.toString('latin1', p + 4, p + 8) === 'IDAT') parts.push(buf.subarray(p + 8, p + 8 + len));
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (w + 1)];
    for (let x = 0; x < w; x++) {
      const v = raw[y * (w + 1) + 1 + x];
      const a = x > 0 ? out[y * w + x - 1] : 0;
      const b = y > 0 ? out[(y - 1) * w + x] : 0;
      const c = x > 0 && y > 0 ? out[(y - 1) * w + x - 1] : 0;
      const pa = Math.abs(b - c);
      const pb = Math.abs(a - c);
      const pc = Math.abs(a + b - 2 * c);
      out[y * w + x] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
    }
  }
  return { w, h, data: out };
}

test('vrai masque (Polaris, 8 joueurs, classes réelles) : temps de calcul d une image et part des zones', () => {
  const dir = 'analysis/map_masks';
  if (!existsSync(`${dir}/Polaris.png`)) return;
  const walk = readGrayPng(`${dir}/Polaris.png`);
  const classes = existsSync(`${dir}/Polaris_classes.png`) ? readGrayPng(`${dir}/Polaris_classes.png`) : null;
  let t0 = performance.now();
  const grid = buildGrid(walk, classes, 'balles', 200);
  console.log(`   construction de la grille 200 sur 200 depuis le masque : ${(performance.now() - t0).toFixed(1)} ms`);
  // Huit positions sur des cases libres tirées au hasard (graine fixe), quatre par équipe
  let seed = 99;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const free: [number, number][] = [];
  while (free.length < 8) {
    const x = Math.floor(rnd() * 200);
    const y = Math.floor(rnd() * 200);
    if (!grid.blocked[y * 200 + x]) free.push([(x + 0.5) / 200, (y + 0.5) / 200]);
  }
  for (const range of [60, 15]) {
    const shooters = free.map(([x, y], i) => shooter(i + 1, x, y, range));
    const times: number[] = [];
    let counts = zoneCounts(computeZones(grid, shooters), grid);
    for (let k = 0; k < 7; k++) {
      t0 = performance.now();
      const r = computeZones(grid, shooters);
      times.push(performance.now() - t0);
      counts = zoneCounts(r, grid);
    }
    times.sort((a, b) => a - b);
    console.log(
      `   Polaris, 8 joueurs, portée ${range} m : médiane ${times[3].toFixed(1)} ms (max ${times[6].toFixed(1)}) ; cases libres ${counts.open} sur ${200 * 200}, sûres A ${counts.safeA}, sûres B ${counts.safeB}, contestées ${counts.contested}`,
    );
    assert.ok(times[3] < 50, `plus de 50 ms : ${times[3]}`);
    assert.ok(counts.open > 5000);
  }
});
