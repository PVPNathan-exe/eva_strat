import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { COVER_A, COVER_B, computeInstant, computeZones, createCache, indexSamples, outlinesOf, positionsAt, shootersAt, zoneCounts, zonePixels, type Instant, type PositionSample, type Shooter } from '../src/lib/safeZones.ts';
import { buildGrid, cellMetres, CLASS_CODES, layerGrid, type BlockGrid, type GraySource, type Segment } from '../src/lib/visibility.ts';
import type { RotorModel } from '../src/lib/rotors.ts';

const gridOf = (n: number, wall: (x: number, y: number) => boolean): BlockGrid => {
  const blocked = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) blocked[y * n + x] = wall(x, y) ? 1 : 0;
  return { w: n, h: n, blocked };
};
const shooter = (slot: number, x: number, y: number, rangeM = 60): Shooter => ({ slot, team: slot <= 4 ? 'A' : 'B', x, y, rangeM, estimated: false });
const at = (r: { w: number; state: Uint8Array }, cx: number, cy: number) => r.state[cy * r.w + cx];

// Budget visé : 50 ms par image. Les tests tournent en parallèle sur la machine : la limite vérifiée est 4 fois plus large pour ne pas échouer sous charge (mesures réelles : 4 à 15 ms).
const FRAME_LIMIT_MS = 200;

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
    assert.ok(times[3] < FRAME_LIMIT_MS, `plus de ${FRAME_LIMIT_MS} ms : ${times[3]}`);
    assert.ok(counts.open > 5000);
  }
});

/** Source en niveaux de gris de n par n, remplie de `fill`, modifiée par `paint(x, y)` si elle renvoie une valeur. */
const image = (n: number, fill: number, paint: (x: number, y: number) => number | undefined = () => undefined): GraySource => {
  const data = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) data[y * n + x] = paint(x, y) ?? fill;
  return { w: n, h: n, data };
};
/** Carte à la main : sol partout, un mur vertical (x 240 à 279 sur 400) percé d'une fenêtre à mi-hauteur (y 160 à 239). */
const windowMap = () =>
  buildGrid(
    image(400, 255, (x) => (x >= 240 && x < 280 ? 0 : undefined)),
    image(400, CLASS_CODES.sol, (x, y) => (x >= 240 && x < 280 ? (y >= 160 && y < 240 ? CLASS_CODES.vue : CLASS_CODES.mur) : undefined)),
    'balles',
    100,
  );
const inst = (base: BlockGrid, shooters: Shooter[], extra: Partial<Parameters<typeof computeInstant>[0]> = {}) => computeInstant({ base, doors: null, rotors: null, t: 0, shooters, ...extra });

test('vitre : l ennemi qui voit à travers repère la case, même hors de portée de tir ; en mode balles elle reste sûre', () => {
  const base = windowMap();
  // A à gauche de la fenêtre, B à droite, loin du mur : B est vu par A à travers la vitre, mais aucune balle ne passe
  const a = shooter(1, 0.3, 0.5, 60);
  const b = shooter(5, 0.9, 0.5, 60);
  const tous = inst(base, [a, b]);
  const cell = (cx: number, cy: number) => tous.result.state[cy * 100 + cx];
  assert.equal(cell(80, 50), COVER_A | COVER_B, 'derrière la vitre, sur la ligne de A : vue par A (repérée) et couverte par B');
  assert.equal(tous.result.shot[50 * 100 + 80] & COVER_A, 0, 'A ne peut pas tirer à travers la vitre');
  assert.equal(tous.result.seen[50 * 100 + 80] & COVER_A, COVER_A, 'mais il la voit');
  assert.ok(tous.counts.sightOnlyA > 0 && tous.counts.sightOnlyB > 0);
  const balles = inst(base, [a, b], { mode: 'balles' });
  assert.equal(balles.result.state[50 * 100 + 80], COVER_B, 'tir seul : la case est sûre pour B');
  const vue = inst(base, [a, b], { mode: 'vue' });
  assert.equal(vue.result.state[50 * 100 + 80], COVER_A | COVER_B);
  assert.equal(balles.counts.sightOnlyA, 0, 'mode balles : aucune zone de vision calculée');
  assert.ok(tous.counts.safeB < balles.counts.safeB, 'la vitre retire des cases sûres à B');
  // les contours : la vue de A traverse la vitre, son tir non
  const lens = (kind: 'vue' | 'tir') => outlinesOf(tous.result, kind)[0].points.length;
  assert.ok(lens('vue') > 0 && lens('tir') > 0);
  assert.ok(tous.result.views[0].dist.some((d, i) => d > tous.result.shotViews[0].dist[i] + 1), 'au moins un rayon de vision va plus loin que le rayon de tir');
});

test('couche de pixels : zone de tir seule, zone de vision seule, zones sûres', () => {
  const base = windowMap();
  const r = inst(base, [shooter(1, 0.3, 0.5), shooter(5, 0.9, 0.5)]).result;
  const colors = { a: [255, 0, 0] as [number, number, number], b: [0, 0, 255] as [number, number, number], contested: [9, 9, 9] as [number, number, number], alpha: 100 };
  const idx = (50 * 100 + 80) * 4;
  assert.deepEqual([...zonePixels(r, colors, 'all', 'seen').slice(idx, idx + 3)], [9, 9, 9], 'vision : vue par les deux');
  assert.deepEqual([...zonePixels(r, colors, 'all', 'shot').slice(idx, idx + 4)], [0, 0, 255, 100], 'tir : B seul');
  assert.deepEqual([...zonePixels(r, colors).slice(idx, idx + 3)], [9, 9, 9], 'sûre : contestée');
});

test('portes : fermées par défaut, ouvertes quand un joueur de n importe quelle équipe est à portée', () => {
  const base: BlockGrid = { w: 100, h: 100, blocked: new Uint8Array(10000) };
  const door: Segment = [[0.5, 0.4], [0.5, 0.6]];
  const a = shooter(1, 0.3, 0.5);
  const b = shooter(5, 0.7, 0.5);
  const closed = inst(base, [a, b], { doors: [door] });
  assert.equal(closed.doors.length, 1);
  assert.equal(closed.doors[0].open, false);
  assert.equal(closed.result.state[50 * 100 + 70], COVER_B, 'porte fermée : A ne voit pas derrière');
  assert.equal(closed.result.state[50 * 100 + 30], COVER_A);
  assert.equal(inst(base, [a, b], { doors: null }).result.state[50 * 100 + 70], COVER_A | COVER_B, 'doors null : ouverte en permanence');
  // un coéquipier de A près de la porte l ouvre (0,5 m au dessus du bout, x = 0,5)
  const mate = shooter(2, 0.5, 0.4 - 0.5 / 16.5);
  const opened = inst(base, [a, b, mate], { doors: [door] });
  assert.equal(opened.doors[0].open, true);
  assert.equal(opened.result.state[50 * 100 + 70] & COVER_A, COVER_A, 'porte ouverte par le joueur proche : A voit derrière');
  // un ennemi près de la porte l ouvre aussi
  const foe = shooter(6, 0.5, 0.6 + 1.5 / 16.5);
  assert.equal(inst(base, [a, b, foe], { doors: [door] }).doors[0].open, true);
  // trop loin (2,5 m) : fermée ; rayon réglable
  const faraway = shooter(3, 0.5, 0.6 + 2.5 / 16.5);
  assert.equal(inst(base, [a, b, faraway], { doors: [door] }).doors[0].open, false);
  assert.equal(inst(base, [a, b, faraway], { doors: [door], doorOpenM: 3 }).doors[0].open, true);
});

test('porte vitrée : fermée, l ennemi la voit mais ne tire pas ; ouverte par un joueur proche, il tire aussi', () => {
  const base = buildGrid(
    image(400, 255),
    image(400, CLASS_CODES.sol, (x) => (x >= 240 && x < 244 ? CLASS_CODES.porte_vitre : undefined)),
    'balles',
    100,
  );
  const door: Segment = [[0.605, 0.3], [0.605, 0.7]];
  const a = shooter(1, 0.3, 0.5);
  const b = shooter(5, 0.9, 0.5);
  const closed = inst(base, [a, b], { glassDoors: [door] });
  assert.equal(closed.result.shot[50 * 100 + 75] & COVER_A, 0, 'fermée : pas de tir à travers');
  assert.equal(closed.result.seen[50 * 100 + 75] & COVER_A, COVER_A, 'fermée : A voit derrière');
  const mate = shooter(2, 0.605, 0.3 - 1 / 16.5);
  const opened = inst(base, [a, b, mate], { glassDoors: [door] });
  assert.equal(opened.doors[0].open && opened.doors[0].glass, true);
  assert.equal(opened.result.shot[50 * 100 + 75] & COVER_A, COVER_A, 'ouverte : A tire derrière');
});

test('deux étages : le niveau connu change la grille du joueur, un niveau inconnu est compté', () => {
  const walk = image(400, 255);
  const classes = image(400, CLASS_CODES.sol, (x) => (x >= 240 && x < 260 ? CLASS_CODES.mur : undefined));
  const under = image(400, 0, (x) => (x >= 240 && x < 260 ? 255 : undefined));
  const base = buildGrid(walk, classes, 'balles', 100, under);
  const up = (level: 'etage' | 'dessous' | null): Shooter => ({ ...shooter(1, 0.3, 0.5), level });
  const at = (level: 'etage' | 'dessous' | null) => inst(base, [up(level)]);
  assert.equal(at('etage').result.state[50 * 100 + 70], 0, 'étage : le bloc réservé au dessous est un mur');
  assert.equal(at('dessous').result.state[50 * 100 + 70], COVER_A, 'dessous : on voit derrière');
  assert.equal(at(null).result.state[50 * 100 + 70], COVER_A, 'niveau inconnu : grille commune, étages mélangés');
  assert.equal(at(null).unknownLevel, 1);
  assert.equal(at('etage').unknownLevel, 0);
  assert.equal(inst(windowMap(), [up(null)]).unknownLevel, 0, 'carte à un seul étage : jamais de niveau inconnu');
  assert.ok(layerGrid(base, 'balles', 'etage').blocked !== layerGrid(base, 'balles').blocked);
});

test('vision plus longue que le tir (visionM d un joueur) : cases repérées mais non tirables', () => {
  const g: BlockGrid = { w: 100, h: 100, blocked: new Uint8Array(10000) };
  const [cw] = cellMetres(g);
  const near = { ...shooter(1, 0.2, 0.5, 5), visionM: 20 };
  const r = computeZones(g, [near]);
  const far = Math.round(10 / cw);
  assert.equal(r.shot[50 * 100 + 20 + far], 0, 'à 10 m : hors portée de tir');
  assert.equal(r.seen[50 * 100 + 20 + far], COVER_A, 'mais vue');
  assert.equal(r.state[50 * 100 + 20 + far], COVER_A);
  assert.ok(zoneCounts(r, g).sightOnlyA > 0);
});

/** Masque, classes, image « dessous », portes et anneaux réels d'une carte, ou null si le masque manque. */
function realMap(name: string) {
  const dir = 'analysis/map_masks';
  if (!existsSync(`${dir}/${name}.png`)) return null;
  const maybe = (suffix: string) => (existsSync(`${dir}/${name}${suffix}.png`) ? readGrayPng(`${dir}/${name}${suffix}.png`) : null);
  const all = JSON.parse(readFileSync('analysis/map_doors.json', 'utf8')) as Record<string, { from: [number, number]; to: [number, number]; kind: string; glass: boolean }[]>;
  const segs = (glass: boolean): Segment[] => (all[name] ?? []).filter((o) => o.kind === 'porte' && o.glass === glass).map((o) => [o.from, o.to] as Segment);
  const rotors = (JSON.parse(readFileSync('analysis/map_rotors.json', 'utf8')) as Record<string, RotorModel>)[name] ?? null;
  return { walk: readGrayPng(`${dir}/${name}.png`), classes: maybe('_classes'), under: maybe('_dessous'), doors: segs(false), glassDoors: segs(true), rotors };
}

/** Huit joueurs sur des cases libres tirées au hasard (graine fixe), quatre par équipe. */
function randomShooters(grid: BlockGrid, seed0: number, range: number, level?: (i: number) => 'etage' | 'dessous' | null): Shooter[] {
  let seed = seed0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out: Shooter[] = [];
  while (out.length < 8) {
    const x = Math.floor(rnd() * grid.w);
    const y = Math.floor(rnd() * grid.h);
    if (!grid.blocked[y * grid.w + x]) out.push({ ...shooter(out.length + 1, (x + 0.5) / grid.w, (y + 0.5) / grid.h, range), level: level ? level(out.length) : null });
  }
  return out;
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];

test('vraies cartes avec portes, vitres, anneaux et étages : temps d une image sous 50 ms, portes fermées par défaut', () => {
  for (const name of ['Reef Point', 'Engine', 'Atlantis', 'The Cliff', 'Outlaw']) {
    const m = realMap(name);
    if (!m) continue;
    const base = buildGrid(m.walk, m.classes, 'balles', 200, m.under);
    const hasLayers = Boolean(base.layers?.etage);
    for (const range of [60, 15]) {
      const shooters = randomShooters(layerGrid(base, 'vue'), 321, range);
      const run = (): Instant => computeInstant({ base, doors: m.doors, glassDoors: m.glassDoors, rotors: m.rotors, t: 30, shooters });
      const first = run();
      const times: number[] = [];
      for (let k = 0; k < 7; k++) times.push(run().ms);
      const med = median(times);
      const c = first.counts;
      const openDoors = first.doors.filter((d) => d.open).length;
      console.log(
        `   ${name}, 8 joueurs, portée ${range} m : médiane ${med.toFixed(1)} ms (max ${Math.max(...times).toFixed(1)}) ; portes ${first.doors.length} dont ${openDoors} ouvertes ; vitrées ${m.glassDoors.length} ; étage ${hasLayers ? 'oui' : 'non'} ; sûres A ${c.safeA}, B ${c.safeB}, contestées ${c.contested}, repérées sans tir A ${c.sightOnlyA}, B ${c.sightOnlyB}, cases libres ${c.open}`,
      );
      assert.ok(med < FRAME_LIMIT_MS, `${name} : plus de ${FRAME_LIMIT_MS} ms (${med})`);
      assert.equal(first.unknownLevel, hasLayers ? 8 : 0);
    }
  }
});

test('vraies cartes : effet des portes fermées par défaut et des étages sur les zones', () => {
  const reef = realMap('Reef Point');
  if (reef) {
    const base = buildGrid(reef.walk, reef.classes, 'balles', 200);
    let fewer = 0;
    let violations = 0;
    let runs = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const shooters = randomShooters(layerGrid(base, 'vue'), seed * 7919, 60);
      const closed = computeInstant({ base, doors: reef.doors, rotors: null, t: 0, shooters });
      const open = computeInstant({ base, doors: null, rotors: null, t: 0, shooters });
      runs++;
      if (closed.counts.contested < open.counts.contested) fewer++;
      if (closed.counts.contested > open.counts.contested) violations++; // fermer une porte ne peut que retirer de la couverture
    }
    console.log(`   Reef Point : portes fermées sauf joueur proche, ${fewer} tirages sur ${runs} avec moins de cases contestées que portes ouvertes`);
    assert.equal(violations, 0);
  }
  for (const name of ['Atlantis', 'The Cliff']) {
    const m = realMap(name);
    if (!m || !m.under) continue;
    const base = buildGrid(m.walk, m.classes, 'balles', 200, m.under);
    const etage = base.layers?.etage;
    assert.ok(etage, `${name} : couche d étage construite`);
    if (!etage || !base.layers) continue;
    let diffBalles = 0;
    let freeBalles = 0;
    for (let i = 0; i < etage.balles.length; i++) {
      if (!base.layers.balles[i]) freeBalles++;
      if (etage.balles[i] !== base.layers.balles[i]) diffBalles++;
    }
    console.log(`   ${name} : ${diffBalles} cases de la grille 200 sur 200 sont des murs pour un joueur à l étage et du sol pour les autres (${((100 * diffBalles) / freeBalles).toFixed(1)} % des cases libres)`);
    assert.ok(diffBalles > 0 && diffBalles < freeBalles);
  }
});

test('niveau : la ligne de suivi le porte jusqu au joueur qui couvre', () => {
  const index = indexSamples([{ t: 10, slot: 1, team: 'A', x: 0.3, y: 0.5, alive: 1, level: 'etage' }, { t: 10, slot: 5, team: 'B', x: 0.7, y: 0.5, alive: 1 }]);
  const shooters = shootersAt(positionsAt(index, 10), [{ slot: 1, weapon1: null, weapon2: null }, { slot: 5, weapon1: null, weapon2: null }]);
  assert.deepEqual(shooters.map((p) => p.level), ['etage', null]);
});
