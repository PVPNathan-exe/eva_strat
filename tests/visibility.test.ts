import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, castView, CLASS_CODES, cellMetres, DOOR_OPEN_M, distanceToSegmentM, doorsOpenedBy, layerGrid, rayCount, viewPolygon, withClosedDoors, withOpenedGlass, withRotors, type BlockGrid, type GraySource } from '../src/lib/visibility.ts';

/** Source en niveaux de gris de n par n, remplie de `fill`, modifiée par `paint(x, y)` si elle renvoie une valeur. */
const image = (n: number, fill: number, paint: (x: number, y: number) => number | undefined = () => undefined): GraySource => {
  const data = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) data[y * n + x] = paint(x, y) ?? fill;
  return { w: n, h: n, data };
};

/** Grille à la main : tout est libre, `wall(x, y)` dit les cases qui bloquent. */
const gridOf = (n: number, wall: (x: number, y: number) => boolean): BlockGrid => {
  const blocked = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) blocked[y * n + x] = wall(x, y) ? 1 : 0;
  return { w: n, h: n, blocked };
};

const seen = (grid: BlockGrid, x: number, y: number, range: number) => {
  const mark = new Uint8Array(grid.w * grid.h);
  castView(grid, x, y, range, mark);
  return (cx: number, cy: number) => mark[cy * grid.w + cx] === 1;
};

test('salle vide : tout ce qui est dans la portée est vu, rien au delà', () => {
  const g = gridOf(100, () => false);
  const [cw] = cellMetres(g);
  const see = seen(g, 0.5, 0.5, 5);
  assert.ok(see(50, 50));
  assert.ok(see(50 + Math.round(4 / cw), 50), 'à 4 m sur la même ligne');
  assert.ok(!see(50 + Math.round(6 / cw), 50), 'à 6 m : hors portée');
  assert.ok(!see(2, 2), 'coin lointain');
});

test('mur plein : la case derrière le mur n est pas vue, celles du même côté et au dessus le sont', () => {
  const g = gridOf(100, (x, y) => x === 60 && y >= 30 && y <= 70);
  const see = seen(g, 0.4, 0.5, 40);
  assert.ok(see(55, 50));
  assert.ok(!see(60, 50), 'le mur lui même n est jamais marqué');
  assert.ok(!see(70, 50), 'derrière le mur');
  assert.ok(!see(70, 55), 'derrière le mur, un peu de côté');
  assert.ok(see(70, 10), 'au dessus du mur, ligne de vue libre');
});

test('tir par dessus : une fine ligne de tir dans un bloc de mur laisse passer la vue et les balles', () => {
  // Masque 400 : sol partout sauf un bloc de mur (x 240 à 279) ; classes : la ligne y = 200 est « tir par dessus »
  const walk = image(400, 255, (x) => (x >= 240 && x < 280 ? 0 : undefined));
  const classes = image(400, CLASS_CODES.sol, (x, y) => (x >= 240 && x < 280 ? (y === 200 ? CLASS_CODES.tir : CLASS_CODES.mur) : undefined));
  for (const mode of ['balles', 'vue'] as const) {
    const g = buildGrid(walk, classes, mode, 100);
    const see = seen(g, 0.3, 0.5, 40);
    assert.ok(see(70, 50), `${mode} : de l autre côté du bloc, sur la ligne de tir`);
    assert.ok(!see(70, 40), `${mode} : derrière le bloc, hors de la ligne de tir`);
  }
  const sans = buildGrid(walk, null, 'vue', 100);
  assert.ok(!seen(sans, 0.3, 0.5, 40)(70, 50), 'sans classes : le bloc est un mur');
});

test('fenêtre : on voit à travers, les balles ne passent pas', () => {
  const walk = image(400, 255, (x) => (x >= 240 && x < 280 ? 0 : undefined));
  const classes = image(400, CLASS_CODES.sol, (x, y) => (x >= 240 && x < 280 ? (y >= 160 && y < 240 ? CLASS_CODES.vue : CLASS_CODES.mur) : undefined));
  assert.ok(seen(buildGrid(walk, classes, 'vue', 100), 0.3, 0.5, 40)(70, 50), 'vue : traverse la fenêtre');
  assert.ok(!seen(buildGrid(walk, classes, 'balles', 100), 0.3, 0.5, 40)(70, 50), 'balles : la fenêtre bloque');
});

test('porte vitrée sur du sol : bloque les balles, laisse voir', () => {
  const walk = image(400, 255);
  const classes = image(400, CLASS_CODES.sol, (x) => (x >= 240 && x < 244 ? CLASS_CODES.porte_vitre : undefined));
  assert.ok(seen(buildGrid(walk, classes, 'vue', 100), 0.3, 0.5, 40)(70, 50));
  assert.ok(!seen(buildGrid(walk, classes, 'balles', 100), 0.3, 0.5, 40)(70, 50));
});

test('porte fermée : un segment de porte ajouté bloque, rien ne change sans', () => {
  const open = gridOf(100, () => false);
  const closed = withClosedDoors(open, [[[0.6, 0.2], [0.6, 0.8]]]);
  assert.ok(seen(open, 0.3, 0.5, 40)(70, 50));
  assert.ok(!seen(closed, 0.3, 0.5, 40)(70, 50));
  assert.ok(seen(closed, 0.3, 0.5, 40)(70, 4), 'au dessus de la porte');
  assert.equal(open.blocked.reduce((a, b) => a + b, 0), 0, 'la grille d origine n est pas modifiée');
});

test('un trait de mur de 1 pixel sur un masque de 400 garde sa case dans une grille de 200', () => {
  const walk = image(400, 255, (x) => (x === 301 ? 0 : undefined));
  const g = buildGrid(walk, null, 'balles', 200);
  assert.equal(g.blocked[100 * 200 + 150], 1);
  assert.ok(!seen(g, 0.3, 0.5, 40)(170, 100));
});

test('point de départ dans un mur : ramené à la case libre voisine ; enfermé : vue vide', () => {
  const g = gridOf(100, (x, y) => Math.abs(x - 50) <= 1 && Math.abs(y - 50) <= 1);
  const mark = new Uint8Array(100 * 100);
  const v = castView(g, 0.505, 0.505, 5, mark);
  assert.ok(v.dist.length > 0);
  assert.ok(Math.hypot(v.x - 0.505, v.y - 0.505) < 0.04);
  const closed = gridOf(100, (x, y) => Math.abs(x - 50) <= 12 && Math.abs(y - 50) <= 12);
  assert.equal(castView(closed, 0.5, 0.5, 5).dist.length, 0);
});

test('polygone : cercle de la portée dans une salle vide, plus court derrière un mur proche', () => {
  const g = gridOf(100, () => false);
  const n = rayCount(g, 4);
  const v = castView(g, 0.5, 0.5, 4);
  assert.equal(v.dist.length, n);
  assert.ok(v.dist.every((d) => d === 4));
  const poly = viewPolygon(v, 90);
  assert.ok(poly.length <= 90 && poly.length >= 45, `sommets : ${poly.length}`);
  const wall = gridOf(100, (x) => x === 53);
  const near = castView(wall, 0.5, 0.5, 4);
  assert.ok(near.dist[0] < 1.2, 'rayon vers la droite arrêté par le mur');
  assert.equal(near.dist[Math.floor(near.dist.length / 2)], 4, 'rayon vers la gauche libre');
});

test('rotors : un arc plein bloque, une ouverture laisse passer, une fenêtre laisse voir sans laisser les balles', () => {
  // Anneau à t_ref = 0, centre au milieu, ouverture de 350 à 10 degrés (la droite) et fenêtre de 170 à 190 degrés (la gauche)
  const model = { aspect: 1, centre: [0.5, 0.5] as [number, number], t_ref: 0, anneaux: [{ nom: 'a', r_min: 0.2, r_max: 0.24, trou_min: 0.18, trou_max: 0.26, omega: 0, ouvertures: [[350, 370]] as [number, number][], fenetres: [[180, 10]] as [number, number][] }] };
  const base = gridOf(200, () => true); // le masque est un trou partout (tout bloque) : seule la bande de l anneau est refaite
  const vue = withRotors(base, model, 0, 'vue');
  const balles = withRotors(base, model, 0, 'balles');
  const at = (g: BlockGrid, angle: number, r: number) => g.blocked[Math.floor((0.5 + r * Math.sin((angle * Math.PI) / 180)) * 200) * 200 + Math.floor((0.5 + r * Math.cos((angle * Math.PI) / 180)) * 200)];
  assert.equal(at(vue, 0, 0.22), 0, 'ouverture');
  assert.equal(at(vue, 90, 0.22), 1, 'arc plein');
  assert.equal(at(vue, 180, 0.22), 0, 'fenêtre en mode vue');
  assert.equal(at(balles, 180, 0.22), 1, 'fenêtre en mode balles');
  assert.equal(at(vue, 90, 0.19), 0, 'bande du trou hors de l arc plein : sol');
  const turned = withRotors(base, { ...model, anneaux: [{ ...model.anneaux[0], omega: 90 }] }, 1, 'vue');
  assert.equal(at(turned, 90, 0.22), 0, 'après 1 s à 90 degrés par seconde, l ouverture est passée en bas');
  assert.equal(at(turned, 0, 0.22), 1);
});

test('précision : écart avec une ligne de vue exacte sur une grille de 200 avec des murs au hasard', () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const g = gridOf(200, () => rnd() < 0.12);
  // Des blocs plutôt que du bruit : on épaissit chaque mur en carré de 3 cases
  const thick = gridOf(200, (x, y) => [0, 1, 2].some((dx) => [0, 1, 2].some((dy) => g.blocked[Math.max(0, y - dy) * 200 + Math.max(0, x - dx)] === 1 && rnd() < 0.2)));
  const ox = 100;
  const oy = 100;
  thick.blocked[oy * 200 + ox] = 0;
  const [cw, ch] = cellMetres(thick);
  const range = 15;
  const mark = new Uint8Array(200 * 200);
  castView(thick, (ox + 0.5) / 200, (oy + 0.5) / 200, range, mark);
  let both = 0;
  let wrong = 0;
  for (let y = 0; y < 200; y++)
    for (let x = 0; x < 200; x++) {
      if (thick.blocked[y * 200 + x]) continue;
      if (Math.hypot((x - ox) * cw, (y - oy) * ch) > range - 0.2) continue;
      // Référence : on échantillonne le segment tous les quart de case
      const len = Math.max(Math.abs(x - ox), Math.abs(y - oy)) * 4 || 1;
      let clear = true;
      for (let k = 1; k < len && clear; k++) {
        const cx = Math.floor(ox + 0.5 + ((x - ox) * k) / len);
        const cy = Math.floor(oy + 0.5 + ((y - oy) * k) / len);
        if (thick.blocked[cy * 200 + cx]) clear = false;
      }
      both++;
      if (clear !== (mark[y * 200 + x] === 1)) wrong++;
    }
  console.log(`   précision du lancer de rayons : ${wrong} cases en désaccord sur ${both} (${((100 * wrong) / both).toFixed(2)} %)`);
  assert.ok(wrong / both < 0.03, `trop d écart : ${wrong} sur ${both}`);
});

test('temps de calcul : une vue de 8 joueurs sur une grille de 200 sur 200', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  // Carte réaliste : des couloirs (murs en blocs de 6 à 14 cases) sur 18 % de la grille
  const blocked = new Uint8Array(200 * 200);
  for (let b = 0; b < 140; b++) {
    const bx = Math.floor(rnd() * 190);
    const by = Math.floor(rnd() * 190);
    const bw = 4 + Math.floor(rnd() * 12);
    const bh = 4 + Math.floor(rnd() * 12);
    for (let y = by; y < Math.min(200, by + bh); y++) for (let x = bx; x < Math.min(200, bx + bw); x++) blocked[y * 200 + x] = 1;
  }
  const g: BlockGrid = { w: 200, h: 200, blocked };
  const points: [number, number][] = [];
  while (points.length < 8) {
    const x = Math.floor(rnd() * 200);
    const y = Math.floor(rnd() * 200);
    if (!blocked[y * 200 + x]) points.push([(x + 0.5) / 200, (y + 0.5) / 200]);
  }
  for (const [label, range] of [['portée 60 m (sans limite)', 60], ['portée 15 m', 15]] as const) {
    const times: number[] = [];
    for (let run = 0; run < 7; run++) {
      const mark = new Uint8Array(200 * 200);
      const t0 = performance.now();
      for (const [x, y] of points) castView(g, x, y, range, mark);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    console.log(`   8 joueurs, ${label} : médiane ${times[3].toFixed(1)} ms (min ${times[0].toFixed(1)}, max ${times[6].toFixed(1)})`);
  }
  assert.ok(true);
});

test('couches : une fenêtre sépare balles et vue, sans vitre les deux couches sont le même tableau', () => {
  const walk = image(400, 255, (x) => (x >= 240 && x < 280 ? 0 : undefined));
  const classes = image(400, CLASS_CODES.sol, (x, y) => (x >= 240 && x < 280 ? (y >= 160 && y < 240 ? CLASS_CODES.vue : CLASS_CODES.mur) : undefined));
  const g = buildGrid(walk, classes, 'balles', 100);
  assert.ok(g.layers);
  assert.notEqual(g.layers.balles, g.layers.vue);
  assert.equal(g.blocked, g.layers.balles, 'blocked suit le mode demandé');
  assert.equal(buildGrid(walk, classes, 'vue', 100).blocked[50 * 100 + 65], 0, 'la fenêtre laisse voir');
  assert.equal(g.layers.balles[50 * 100 + 65], 1, 'et bloque les balles');
  const plain = buildGrid(walk, null, 'balles', 100);
  assert.equal(plain.layers?.balles, plain.layers?.vue);
  const view = layerGrid(g, 'vue');
  assert.equal(view.blocked, g.layers.vue);
  assert.equal(layerGrid({ w: 3, h: 3, blocked: new Uint8Array(9) }, 'vue').blocked.length, 9, 'grille faite à la main : une seule couche');
});

test('distance à un segment et ouverture des portes : à DOOR_OPEN_M ou moins, de n importe quel joueur', () => {
  const door: [[number, number], [number, number]] = [[0.5, 0.4], [0.5, 0.6]]; // 3,3 m de haut, à 15,5 m du bord gauche
  assert.ok(Math.abs(distanceToSegmentM(0.5, 0.5, door)) < 1e-9, 'sur la porte');
  assert.ok(Math.abs(distanceToSegmentM(0.5 + 1 / 31, 0.5, door) - 1) < 1e-9, 'à 1 m de côté');
  assert.ok(Math.abs(distanceToSegmentM(0.5, 0.6 + 2 / 16.5, door) - 2) < 1e-9, 'à 2 m du bout');
  assert.equal(DOOR_OPEN_M, 2);
  const near = { x: 0.5 + 1.9 / 31, y: 0.5 };
  const far = { x: 0.5 + 2.1 / 31, y: 0.5 };
  assert.deepEqual(doorsOpenedBy([door], [far]), [false]);
  assert.deepEqual(doorsOpenedBy([door], [far, near]), [true]);
  assert.deepEqual(doorsOpenedBy([door], [far], 3), [true], 'rayon réglable');
  assert.deepEqual(doorsOpenedBy([door], []), [false], 'personne : fermée');
});

test('porte vitrée : fermée elle laisse voir et bloque les balles, ouverte elle laisse tout passer', () => {
  const walk = image(400, 255);
  const classes = image(400, CLASS_CODES.sol, (x) => (x >= 240 && x < 244 ? CLASS_CODES.porte_vitre : undefined));
  const base = buildGrid(walk, classes, 'balles', 100);
  const shot = layerGrid(base, 'balles');
  const sight = layerGrid(base, 'vue');
  const door: [[number, number], [number, number]] = [[0.605, 0.3], [0.605, 0.7]];
  assert.ok(!seen(shot, 0.3, 0.5, 40)(70, 50), 'balles : fermée');
  assert.ok(seen(sight, 0.3, 0.5, 40)(70, 50), 'vue : fermée, on voit');
  const opened = withOpenedGlass(shot, sight, [door]);
  assert.ok(seen(opened, 0.3, 0.5, 40)(70, 50), 'balles : ouverte');
  assert.equal(withOpenedGlass(shot, sight, []), shot, 'aucune porte ouverte : rien ne change');
  assert.ok(!seen(shot, 0.3, 0.5, 40)(70, 50), 'la grille d origine n est pas modifiée');
});

test('deux étages : le sol réservé au dessous est libre pour tous, mais bloque le joueur de l étage', () => {
  // Masque 400 : sol partout, un bloc « dessous » de 20 pixels (x 240 à 259) que le masque garde praticable ; classe mur dans ce bloc.
  const walk = image(400, 255);
  const classes = image(400, CLASS_CODES.sol, (x) => (x >= 240 && x < 260 ? CLASS_CODES.mur : undefined));
  const under = image(200, 0, (x) => (x >= 120 && x < 130 ? 255 : undefined)); // image 200 sur 200 : autre taille que le masque
  const g = buildGrid(walk, classes, 'balles', 100, under);
  assert.ok(g.layers?.etage, 'couche de l étage présente');
  assert.ok(seen(layerGrid(g, 'balles'), 0.3, 0.5, 40)(70, 50), 'niveau inconnu ou dessous : le bloc est praticable, on traverse');
  assert.ok(!seen(layerGrid(g, 'balles', 'etage'), 0.3, 0.5, 40)(70, 50), 'étage : le bloc est un mur (sa classe mur)');
  assert.equal(buildGrid(walk, classes, 'balles', 100, image(200, 0)).layers?.etage, undefined, 'image dessous vide : pas de couche d étage');
});

test('castView peut marquer deux tableaux d un seul jeu de rayons', () => {
  const g = gridOf(100, (x) => x === 60);
  const a = new Uint8Array(100 * 100);
  const b = new Uint8Array(100 * 100);
  castView(g, 0.3, 0.5, 20, a, b);
  assert.deepEqual(a, b);
  assert.ok(a[50 * 100 + 40] === 1 && a.some((v) => v === 1));
});
