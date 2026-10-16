import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gazeFromEbp, isEbpExport, minimapFromPlan, parseEbp, pawnsAt, planDuration, slotOfEbp, stepStarts } from '../src/lib/ebpImport.ts';

// Cadre d'Atlantis de analysis/map_plan_insets.json, recopié ici (planInsets.ts charge un JSON que le lanceur de tests ne sait pas importer) ; `project` est sa formule
const inset = { l: 0.0078, t: 0.0158, r: -0.0074, b: 0.0042 };
const project = (i: typeof inset, x: number, y: number) => ({ x: (i.l + x * (1 - i.l - i.r)) * 100, y: (i.t + y * (1 - i.t - i.b)) * 100 });
const pawn = (number: number, left: number, top: number, angle = 0) => ({ number, left, top, angle, dead: false, floor: 0 });
// Deux étapes réduites d'un export EBP.GG de la carte Atlantis (valeurs de l'export de l'utilisateur) : le joueur 1 avance, les bleus restent au départ
const step = (p1: [number, number, number]) => ({
  yellowTeam: [pawn(1, ...p1), pawn(2, 20, 50), pawn(3, 20, 55), pawn(4, 20, 60)],
  blueTeam: [pawn(6, 93.02, 42.89), pawn(7, 91, 47), pawn(8, 91, 55), pawn(9, 93, 60)],
});
const EXPORT = { name: 'Atlantis', version: 5, steps: [step([61.389, 65.556, 65.514]), step([68.4, 76.5, 4])], stepsDetails: [{ time: 2000 }, { time: 2000 }] };

test('slotOfEbp : jaune 1 à 4, bleu 6 à 9 deviennent 1 à 8', () => {
  assert.deepEqual([1, 4].map((n) => slotOfEbp('A', n)), [1, 4]);
  assert.deepEqual([6, 9].map((n) => slotOfEbp('B', n)), [5, 8]);
});

test('gazeFromEbp : haut (0) devient nord (270), droite (90) devient est (0), toujours dans [0, 360)', () => {
  assert.equal(gazeFromEbp(0), 270);
  assert.equal(gazeFromEbp(90), 0);
  assert.equal(gazeFromEbp(180), 90);
  assert.equal(gazeFromEbp(-10), 260);
  assert.ok(gazeFromEbp(725) >= 0 && gazeFromEbp(725) < 360);
});

test('minimapFromPlan est l\'inverse exact de project (aller-retour pourcentage, minimap, pourcentage)', () => {
  for (const [l, t] of [[61.389, 65.556], [93.02, 42.89], [0, 0], [100, 100]]) {
    const m = minimapFromPlan(inset, l, t);
    const back = project(inset, m.x, m.y);
    assert.ok(Math.abs(back.x - l) < 1e-9 && Math.abs(back.y - t) < 1e-9);
  }
});

test('parseEbp : 2 étapes, 8 pions triés, joueurs bleus 5 à 8', () => {
  const plan = parseEbp(EXPORT, inset);
  assert.equal(plan.steps.length, 2);
  assert.deepEqual(plan.steps[0].pawns.map((p) => p.slot), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(plan.steps[0].pawns.map((p) => p.team), ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B']);
  assert.deepEqual(plan.transitions, [2]);
  assert.equal(planDuration(plan), 2);
  assert.deepEqual(stepStarts(plan), [0, 2]);
});

test('parseEbp : les joueurs bleus du plan tombent dans la zone de départ B d\'Atlantis (rectangle de map_spawns.json)', () => {
  const [x0, y0, x1, y1] = [0.8439135686485035, 0.39550659696290763, 0.9727553348543819, 0.6623724172267862];
  for (const p of parseEbp(EXPORT, inset).steps[0].pawns.filter((q) => q.team === 'B')) {
    assert.ok(p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1, `joueur ${p.slot} en ${p.x.toFixed(3)} ${p.y.toFixed(3)}`);
  }
});

test('parseEbp : refuse un fichier qui n\'est pas un export, un numéro hors équipe, une étape sans équipes', () => {
  assert.throws(() => parseEbp({ foo: 1 }, inset), /pas un export EBP/);
  assert.throws(() => parseEbp(null, inset), /pas un export EBP/);
  assert.throws(() => parseEbp({ steps: [{ yellowTeam: [pawn(7, 1, 1)], blueTeam: [] }] }, inset), /hors de l'équipe jaune/);
  assert.throws(() => parseEbp({ steps: [{ yellowTeam: [] }] }, inset), /équipes absentes/);
});

test('parseEbp : durée absente ou invalide = 2 s par défaut', () => {
  const plan = parseEbp({ ...EXPORT, stepsDetails: [] }, inset);
  assert.deepEqual(plan.transitions, [2]);
});

test('pawnsAt : début = étape 1, milieu = moyenne, fin et au-delà = étape 2', () => {
  const plan = parseEbp(EXPORT, inset);
  const p1 = (t: number) => pawnsAt(plan, t).find((p) => p.slot === 1)!;
  const a = plan.steps[0].pawns[0];
  const b = plan.steps[1].pawns[0];
  assert.equal(p1(0).x, a.x);
  assert.ok(Math.abs(p1(1).x - (a.x + b.x) / 2) < 1e-9);
  assert.equal(p1(2).x, b.x);
  assert.equal(p1(99).y, b.y);
});

test('pawnsAt : le regard tourne par le plus court chemin (350 degrés vers 10 passe par 0)', () => {
  const mk = (angle: number) => ({ yellowTeam: [pawn(1, 50, 50, angle)], blueTeam: [] });
  const plan = parseEbp({ steps: [mk(0), mk(20)], stepsDetails: [{ time: 1000 }] }, inset);
  // ebp 0 = 270, ebp 20 = 290 : milieu 280
  assert.ok(Math.abs(pawnsAt(plan, 0.5)[0].gaze - 280) < 1e-9);
  const wrap = parseEbp({ steps: [mk(90 + 350), mk(90 + 10)], stepsDetails: [{ time: 1000 }] }, inset);
  const mid = pawnsAt(wrap, 0.5)[0].gaze;
  assert.ok(mid < 1 || mid > 359, `milieu ${mid}`);
});

test('isEbpExport : reconnaît un export EBP.GG, pas une carte de l\'application ni autre chose', () => {
  assert.equal(isEbpExport(EXPORT), true);
  assert.equal(isEbpExport({ id: 'x', name: 'Atlantis', floors: [] }), false);
  assert.equal(isEbpExport({ steps: [] }), false);
  assert.equal(isEbpExport({ steps: [{ yellowTeam: [] }] }), false);
  assert.equal(isEbpExport(null), false);
  assert.equal(isEbpExport('texte'), false);
});
