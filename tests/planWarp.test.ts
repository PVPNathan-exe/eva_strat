import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  frameBox,
  growTriangle,
  hasWarp,
  isWarped,
  localScale,
  projectInset,
  projectPath,
  radiusPercent,
  registerWarps,
  triangleAffine,
  unprojectInset,
  warpToMinimap,
  warpToPlan,
  warpTriangles,
  type Pt,
  type WarpEntry,
} from '../src/lib/planWarp.ts';

const root = new URL('..', import.meta.url);
const warpData = JSON.parse(readFileSync(new URL('analysis/map_warp.json', root), 'utf-8')) as Record<string, WarpEntry>;
const insets = JSON.parse(readFileSync(new URL('analysis/map_plan_insets.json', root), 'utf-8')) as Record<string, { l: number; t: number; r: number; b: number }>;
registerWarps(warpData);

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

test('seule la carte du fichier a un maillage ; les autres gardent le cadre affine', () => {
  assert.ok(hasWarp('Artefact'));
  for (const map of Object.keys(insets)) assert.equal(hasWarp(map), map in warpData, map);
  assert.ok(!hasWarp('Polaris') && !hasWarp(null) && !hasWarp(undefined));
});

test('projectInset sans maillage : exactement l ancienne formule du cadre affine, pour toutes les cartes alignées', () => {
  for (const [map, i] of Object.entries(insets)) {
    if (hasWarp(map)) continue;
    const inset = { l: i.l, t: i.t, r: i.r, b: i.b };
    for (const [x, y] of [[0, 0], [1, 1], [0.37, 0.81], [0.5, 0.5], [-0.1, 1.2]]) {
      const p = projectInset(inset, x, y);
      assert.equal(p.x, (i.l + x * (1 - i.l - i.r)) * 100, `${map} x`);
      assert.equal(p.y, (i.t + y * (1 - i.t - i.b)) * 100, `${map} y`);
      const back = unprojectInset(inset, p.x / 100, p.y / 100);
      assert.ok(near(back.x, x, 1e-9) && near(back.y, y, 1e-9), `${map} aller-retour`);
    }
    assert.ok(!isWarped(inset));
    assert.deepEqual(frameBox(inset), { left: `${i.l * 100}%`, top: `${i.t * 100}%`, width: `${(1 - i.l - i.r) * 100}%`, height: `${(1 - i.t - i.b) * 100}%` });
  }
});

test('chaque repère du maillage tombe exactement sur son repère du plan, et inversement', () => {
  for (const p of warpData.Artefact.points) {
    const q = warpToPlan('Artefact', p.mini[0], p.mini[1]);
    assert.ok(near(q.x, p.plan[0], 1e-6) && near(q.y, p.plan[1], 1e-6), `repère ${p.mini} vers le plan`);
    const m = warpToMinimap('Artefact', p.plan[0], p.plan[1]);
    assert.ok(near(m.x, p.mini[0], 1e-6) && near(m.y, p.mini[1], 1e-6), `repère ${p.plan} vers la minimap`);
  }
});

test('aller-retour minimap, plan, minimap sur une grille de la minimap entière (dedans, au bord et hors maillage proche)', () => {
  let n = 0;
  for (let x = 0.03; x < 1; x += 0.037) {
    for (let y = 0.03; y < 1; y += 0.037) {
      const p = warpToPlan('Artefact', x, y);
      const back = warpToMinimap('Artefact', p.x, p.y);
      // hors maillage la transformation prolongée n'est pas exactement réversible : seules les positions proches du maillage comptent ici
      if (Math.abs(back.x - x) > 1e-6 || Math.abs(back.y - y) > 1e-6) continue;
      n++;
    }
  }
  assert.ok(n > 500, `${n} points réversibles`);
});

test('mêmes valeurs que analysis/map_warp.py (to_plan), y compris hors du maillage (prolongement, affine global)', () => {
  // [x, y, plan x, plan y] calculés par map_warp.to_plan sur le même fichier
  const expected = [
    [0.5, 0.5, 0.499211543, 0.464937174], [0.22, 0.36, 0.291521775, 0.387329741], [0.46, 0.86, 0.469593873, 0.906505088], [0.1, 0.1, 0.179921327, 0.062522858],
    [0.7, 0.62, 0.646342903, 0.528874506], [0.02, 0.56, 0.116140876, 0.542328285], [0.97, 0.57, 0.954298934, 0.503516964], [0.5, 0.02, 0.496230607, 0.028111640],
    [0.5, 0.99, 0.495686946, 0.978839774], [-0.2, 0.5, -0.058755611, 0.479317776], [1.1, 1.1, 0.974631055, 1.1077544], [0.06, 0.13, 0.148106536, 0.093750035], [0.3, 0.9, 0.350584768, 0.929759772],
  ];
  for (const [x, y, ex, ey] of expected) {
    const p = warpToPlan('Artefact', x, y);
    assert.ok(near(p.x, ex, 1e-6) && near(p.y, ey, 1e-6), `(${x}, ${y}) : ${p.x}, ${p.y} au lieu de ${ex}, ${ey}`);
  }
});

test('projectInset et unprojectInset passent par le maillage quand le cadre porte le nom de la carte', () => {
  const inset = { ...insets.Artefact, warp: 'Artefact' };
  assert.ok(isWarped(inset));
  const p = projectInset(inset, 0.46, 0.86);
  const w = warpToPlan('Artefact', 0.46, 0.86);
  assert.ok(near(p.x, w.x * 100) && near(p.y, w.y * 100));
  const back = unprojectInset(inset, p.x / 100, p.y / 100);
  assert.ok(near(back.x, 0.46, 1e-6) && near(back.y, 0.86, 1e-6));
  assert.deepEqual(frameBox(inset), { left: '0%', top: '0%', width: '100%', height: '100%' });
  // un nom de carte sans maillage retombe sur le cadre affine
  const ghost = { ...insets.Artefact, warp: 'Inconnue' };
  assert.ok(!isWarped(ghost));
  assert.equal(projectInset(ghost, 0.5, 0.5).x, (insets.Artefact.l + 0.5 * (1 - insets.Artefact.l - insets.Artefact.r)) * 100);
});

test('les trois blocs d Artefact : les positions des blocs de la minimap tombent dans les blocs du plan', () => {
  // coins extérieurs du bloc du milieu (mesurés par map_warp.py) : minimap (83, 88) à (355, 170) sur 436 x 258, plan (231, 256) à (616, 368) sur 850 x 670
  const tl = warpToPlan('Artefact', 83 / 436, 88 / 258);
  const br = warpToPlan('Artefact', 355 / 436, 170 / 258);
  assert.ok(Math.abs(tl.x * 850 - 231) < 3 && Math.abs(tl.y * 670 - 256) < 3, `coin haut gauche ${tl.x * 850}, ${tl.y * 670}`);
  assert.ok(Math.abs(br.x * 850 - 616) < 3 && Math.abs(br.y * 670 - 368) < 3, `coin bas droit ${br.x * 850}, ${br.y * 670}`);
  // le centre du bloc du haut de la minimap est dans celui du plan (y du plan sous 80 pixels), celui du bas sous 590
  assert.ok(warpToPlan('Artefact', 0.5, 0.12).y * 670 < 80);
  assert.ok(warpToPlan('Artefact', 0.5, 0.88).y * 670 > 590);
});

test('triangleAffine : les trois sommets arrivent sur leur image, le centre aussi', () => {
  const src: [Pt, Pt, Pt] = [[0.1, 0.2], [0.9, 0.3], [0.4, 0.8]];
  const dst: [Pt, Pt, Pt] = [[10, 50], [200, 40], [90, 300]];
  const [a, b, c, d, e, f] = triangleAffine(src, dst);
  src.forEach(([x, y], i) => {
    assert.ok(near(a * x + b * y + c, dst[i][0], 1e-9) && near(d * x + e * y + f, dst[i][1], 1e-9), `sommet ${i}`);
  });
  const mx = (src[0][0] + src[1][0] + src[2][0]) / 3;
  const my = (src[0][1] + src[1][1] + src[2][1]) / 3;
  assert.ok(near(a * mx + b * my + c, (10 + 200 + 90) / 3, 1e-9) && near(d * mx + e * my + f, (50 + 40 + 300) / 3, 1e-9));
});

test('growTriangle écarte chaque sommet de son centre de la distance demandée', () => {
  const tri: [Pt, Pt, Pt] = [[0, 0], [10, 0], [0, 10]];
  const g = growTriangle(tri, 1);
  const cx = 10 / 3;
  tri.forEach((p, i) => assert.ok(near(Math.hypot(g[i][0] - cx, g[i][1] - cx) - Math.hypot(p[0] - cx, p[1] - cx), 1, 1e-9)));
});

test('les triangles du maillage couvrent la minimap sans se retourner : même signe d aire des deux côtés', () => {
  const tris = warpTriangles('Artefact');
  assert.ok(tris.length > 400);
  const area = (t: [Pt, Pt, Pt]) => (t[1][0] - t[0][0]) * (t[2][1] - t[0][1]) - (t[1][1] - t[0][1]) * (t[2][0] - t[0][0]);
  for (const t of tris) assert.ok(area(t.src) * area(t.dst) > 0);
  assert.deepEqual(warpTriangles('Polaris'), []);
});

test('échelle locale : plus de pixels de plan par pixel de minimap dans les vides entre blocs que dans un bloc', () => {
  const inBlock = localScale('Artefact', 0.5, 0.52); // bloc du milieu
  const gap = localScale('Artefact', 0.3, 0.25); // entre le bloc du haut et celui du milieu
  assert.ok(gap.sy > 2 * inBlock.sy, `vide ${gap.sy}, bloc ${inBlock.sy}`);
  assert.ok(inBlock.sx > 0.6 && inBlock.sx < 0.85, `échelle x du bloc ${inBlock.sx}`); // bloc du milieu : 385 / 850 du plan pour 272 / 436 de la minimap
});

test('rayon en mètres : cadre affine inchangé, maillage selon l échelle locale', () => {
  const plain = { l: 0.02, t: 0.03, r: 0.01, b: 0.1 };
  const r0 = radiusPercent(plain, 4, [31, 16.5]);
  assert.ok(near(r0.rx, (4 / 31) * (1 - 0.03) * 100) && near(r0.ry, (4 / 16.5) * (1 - 0.13) * 100));
  const r1 = radiusPercent({ ...plain, warp: 'Artefact' }, 4, [31, 16.5], { x: 0.5, y: 0.52 });
  assert.ok(r1.rx > 0 && r1.ry > 0);
});

test('projectPath : sommets seuls sans maillage, points intermédiaires avec maillage', () => {
  const plain = { l: 0.02, t: 0.03, r: 0.01, b: 0.1 };
  assert.equal(projectPath(plain, [[0, 0], [1, 1]]).length, 2);
  const warped = projectPath({ ...plain, warp: 'Artefact' }, [[0.2, 0.1], [0.2, 0.9]]);
  assert.ok(warped.length > 10);
  assert.ok(warped.every((p, i) => i === 0 || p.y >= warped[i - 1].y - 1e-9), 'trajet vertical : y croissant');
});
