import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approachSentence,
  arrivalSentence,
  concentrateSentence,
  flowOfTeam,
  leaveSentence,
  parseFlow,
  resultOf,
  rotationEvents,
  rotationMark,
  rotationSeek,
  rotationSpan,
  signedSeconds,
  windowMarks,
  windowPct,
  winnerSentence,
} from '../src/lib/rotationWindow.ts';
import type { Episode } from '../src/types/stats.ts';

// Forme réelle (game 32, Outlaw, changement du point B vers le point A à 217 s) : les épisodes des deux équipes portent le même changement
const FLOW_A = {
  team: 'A', was_on_old: true, stays_on_old: false, leave_old_offset_s: -2.5, alive_at_leave: 4, leave_phase: 'au_changement', concentrate_new_offset_s: 3, already_on_new: false,
  first_arrival_s: 0, second_arrival_s: 3, shift_m: { '10': 5.4, '20': 4.8 }, toward_new_m: { '10': 2.8, '20': 2.8 }, owns_old_at_change: false, owns_new_before: false, deaths: [], kills: 4,
};
const FLOW_B = {
  team: 'B', was_on_old: false, stays_on_old: false, leave_old_offset_s: null, alive_at_leave: null, leave_phase: 'jamais', concentrate_new_offset_s: null, already_on_new: false,
  first_arrival_s: 7.5, second_arrival_s: null, shift_m: { '10': 2.1, '20': 6.6 }, toward_new_m: { '10': -0.8, '20': 5.2 }, owns_old_at_change: false, owns_new_before: false,
  deaths: [{ slot: 8, t: 208, killer: 3 }, { slot: 6, t: 227.3, killer: 3 }], kills: 0,
};
const RESULT = { owner_t10: 'A', owner_t20: 'A', owner_first: 'A', first_team: 'A', winner: 'A', team_won: 'A', value: 'won' };
const rotation = (id: number, team: 'A' | 'B', data: Record<string, unknown>, over: Partial<Episode> = {}): Episode => ({
  id, game_id: 32, kind: 'rotation', point: 'B', point_to: 'A', team, t0: 197, t1: 247, outcome: 'arrived', data: { switch_t: 217, source: 'hud', result: RESULT, ...data }, verdict: null, ...over,
});
const EP_A = rotation(181, 'A', { flow: FLOW_A, opponent: FLOW_B });
const EP_B = rotation(182, 'B', { flow: FLOW_B, opponent: FLOW_A }, { outcome: 'partial' });

test('rotationEvents : les deux équipes d\'un même changement sont regroupées, dans l\'ordre du temps', () => {
  const later = rotation(190, 'A', {}, { point: 'A', point_to: 'B', data: { switch_t: 308 } });
  const ev = rotationEvents([later, EP_B, EP_A]);
  assert.equal(ev.length, 2);
  assert.equal(ev[0].switchT, 217);
  assert.deepEqual(ev[0].episodes.map((e) => e.id), [182, 181]);
  assert.equal(ev[0].point, 'B');
  assert.equal(ev[0].pointTo, 'A');
  assert.equal(ev[1].switchT, 308);
  // Les épisodes de retake ou sans point d'arrivée sont ignorés
  assert.equal(rotationEvents([rotation(1, 'A', {}, { kind: 'retake' }), rotation(2, 'A', {}, { point_to: null })]).length, 0);
});

test('rotationSeek et rotationSpan : 20 s avant, 20 s après, sans reculer avant la game', () => {
  assert.equal(rotationSeek({ switchT: 217 }), 197);
  assert.equal(rotationSeek({ switchT: 12 }), 0);
  assert.deepEqual(rotationSpan({ switchT: 217 }), { from: 197, to: 237 });
});

test('rotationMark : repère au nouveau point, fenêtre de 40 s', () => {
  const [ev] = rotationEvents([EP_A, EP_B]);
  const m = rotationMark(ev, 540);
  assert.equal(m.kind, 'rotation');
  assert.equal(m.point, 'A');
  assert.equal(m.key, ev.key);
  assert.ok(Math.abs(m.left - (217 / 540) * 100) < 1e-9);
  assert.ok(Math.abs(m.spanWidth - (40 / 540) * 100) < 1e-9);
});

test('parseFlow : lit un flow réel, déduit le décalage des morts quand il manque', () => {
  const b = parseFlow(FLOW_B, 217);
  assert.equal(b?.team, 'B');
  assert.equal(b?.leavePhase, 'jamais');
  assert.equal(b?.leaveOffset, null);
  assert.equal(b?.firstArrival, 7.5);
  assert.deepEqual(b?.toward, { s10: -0.8, s20: 5.2 });
  assert.equal(b?.deaths[0].offset, -9);
  assert.ok(Math.abs((b?.deaths[1].offset ?? 0) - 10.3) < 1e-9);
  assert.equal(parseFlow(undefined, 0), null);
  assert.equal(parseFlow('oups', 0), null);
  const broken = parseFlow({ team: 'Z', leave_phase: 'peut-être', deaths: [{ slot: 'x' }, null, 4], toward_new_m: 3 }, 0);
  assert.equal(broken?.team, null);
  assert.equal(broken?.leavePhase, null);
  assert.deepEqual(broken?.deaths, []);
  assert.deepEqual(broken?.toward, { s10: null, s20: null });
});

test('flowOfTeam : propre flow, sinon l\'adversaire de l\'épisode de l\'autre équipe', () => {
  const [both] = rotationEvents([EP_A, EP_B]);
  assert.equal(flowOfTeam(both, 'A')?.leaveOffset, -2.5);
  assert.equal(flowOfTeam(both, 'B')?.firstArrival, 7.5);
  // Seul l'épisode de A existe : le comportement de B vient de data.opponent
  const [onlyA] = rotationEvents([EP_A]);
  assert.equal(flowOfTeam(onlyA, 'B')?.team, 'B');
  assert.equal(flowOfTeam(onlyA, 'B')?.leavePhase, 'jamais');
  // Anciens calculs sans flow : null
  const [old] = rotationEvents([rotation(5, 'A', {})]);
  assert.equal(flowOfTeam(old, 'A'), null);
  assert.equal(flowOfTeam(old, 'B'), null);
});

test('resultOf et winnerSentence', () => {
  const [ev] = rotationEvents([EP_A]);
  const r = resultOf(ev);
  assert.equal(r?.winner, 'A');
  assert.equal(r?.ownerT20, 'A');
  const name = (s: 'A' | 'B') => (s === 'A' ? 'SNV' : 'NCT');
  assert.equal(winnerSentence(r, name), 'Gagnée par SNV (propriétaire du nouveau point : SNV à +10 s, SNV à +20 s).');
  assert.equal(winnerSentence(null, name), 'Gagnant non lu (le nouveau point reste sans propriétaire).');
  assert.equal(winnerSentence({ winner: null, firstTeam: null, ownerFirst: null, ownerT10: null, ownerT20: null }, name).startsWith('Gagnant non lu'), true);
  assert.equal(resultOf(rotationEvents([rotation(5, 'A', { result: 'x' })])[0]), null);
});

test('windowMarks et windowPct : repères triés, axe de -20 s à +20 s', () => {
  const a = parseFlow(FLOW_A, 217);
  assert.ok(a);
  const marks = windowMarks(a);
  assert.deepEqual(marks.map((m) => [m.kind, m.offset]), [['leave', -2.5], ['first', 0], ['concentrate', 3], ['second', 3]]);
  assert.equal(windowPct(-20), 0);
  assert.equal(windowPct(0), 50);
  assert.equal(windowPct(20), 100);
  assert.equal(windowPct(30), 100); // au-delà de la fenêtre : borné
  const b = parseFlow(FLOW_B, 217);
  assert.ok(b);
  assert.deepEqual(windowMarks(b).map((m) => m.kind), ['death', 'first', 'death']);
});

test('signedSeconds et phrases : négatif = l\'équipe anticipe', () => {
  assert.equal(signedSeconds(-1.5), '-1,5 s');
  assert.equal(signedSeconds(3), '+3,0 s');
  const a = parseFlow(FLOW_A, 217);
  const b = parseFlow(FLOW_B, 217);
  assert.ok(a && b);
  assert.equal(leaveSentence(a), 'Part au moment du changement : -2,5 s par rapport au changement, 4 vivants.');
  assert.equal(leaveSentence({ ...a, leavePhase: 'avant', leaveOffset: -9 }).startsWith('Anticipe : -9,0 s'), true);
  assert.equal(leaveSentence({ ...a, leavePhase: 'apres', leaveOffset: 6 }).startsWith('Part en retard : +6,0 s'), true);
  assert.equal(leaveSentence({ ...a, leavePhase: 'reste' }).startsWith('Reste sur l\'ancien point'), true);
  assert.equal(leaveSentence(b).startsWith('N\'était pas sur l\'ancien point'), true);
  assert.equal(concentrateSentence(a), 'Se concentre sur le nouveau point +3,0 s.');
  assert.equal(concentrateSentence({ ...a, concentrateOffset: -5.5 }), 'Se concentre sur le nouveau point -5,5 s (avant le changement).');
  assert.equal(concentrateSentence({ ...a, alreadyOnNew: true }), 'Déjà sur le nouveau point au début de la fenêtre.');
  assert.equal(concentrateSentence(b), 'Ne se concentre pas sur le nouveau point dans la fenêtre.');
  assert.equal(arrivalSentence(a), 'Première arrivée +0,0 s, deuxième +3,0 s.');
  assert.equal(arrivalSentence(b), 'Un seul arrivé (+7,5 s).');
  assert.equal(arrivalSentence({ ...b, firstArrival: null }), 'Personne n\'arrive au nouveau point.');
  assert.equal(approachSentence(b), 'Le centre de l\'équipe s\'éloigne de 0,8 m à +10 s, se rapproche de 5,2 m à +20 s.');
  assert.equal(approachSentence({ ...b, toward: { s10: null, s20: null } }), null);
});
