import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axisSentence, doubtfulCapture, holderLabel, retreatSentence, speedSentence, tfResultLabel, waveInfo, waveSummary } from '../src/lib/waveInfo.ts';
import { REAL_DUEL, REAL_NO_CONTACT, waveEpisode } from './waveFixtures.ts';

test('waveInfo : lit une vague réelle (retake réussi, game 26)', () => {
  const w = waveInfo(waveEpisode());
  assert.ok(w);
  assert.equal(w.team, 'B');
  assert.equal(w.size, 4);
  assert.equal(w.speed, 'rapide');
  assert.equal(w.tStart, 2.2);
  assert.equal(w.tContact, 9.5);
  assert.equal(w.tEnd, 21);
  assert.equal(w.toContactS, 7.3);
  assert.equal(w.durationS, 18.8);
  assert.equal(w.point, 'A');
  assert.deepEqual([w.holderBefore, w.holderAfter, w.captureFrom, w.capturedT], ['A', 'B', 'A', 21]);
  assert.equal(w.axisFrac, 0.57);
  assert.equal(w.kind, 'teamfight');
  assert.deepEqual(w.fight?.losses, { A: 4, B: 2 });
  assert.equal(w.fight?.winner, 'B');
  assert.equal(w.fight?.nKills, 6);
  assert.equal(w.survivorsRetreated, 0);
});

test('waveInfo : duel progressif et vague sans contact', () => {
  const d = waveInfo(waveEpisode({ outcome: 'duel', data: REAL_DUEL }));
  assert.equal(d?.speed, 'progressif');
  assert.equal(d?.kind, 'duel');
  assert.equal(d?.holderBefore, null);
  assert.equal(d?.nStops, 1);
  assert.equal(d?.stopS, 5);
  const n = waveInfo(waveEpisode({ outcome: 'no_contact', data: REAL_NO_CONTACT }));
  assert.equal(n?.tContact, null);
  assert.equal(n?.toContactS, null);
  assert.equal(n?.speed, null);
  assert.equal(n?.fight, null);
  assert.equal(n?.axisFrac, null);
  assert.equal(n?.survivorsRetreated, 1);
});

test('waveInfo : ancienne ligne ou champ abîmé ne plante pas', () => {
  assert.equal(waveInfo(waveEpisode({ data: null })), null);
  assert.equal(waveInfo(waveEpisode({ data: { push_t: 3, change_t: 5 } })), null);
  const broken = waveInfo(waveEpisode({ t0: 4, t1: 30, data: { wave: { t_start: 'a', t_end: null, speed: 'zzz', fight: { losses: { A: 1 } }, size: Infinity, kind: 3 } } }));
  assert.equal(broken?.tStart, 4); // repli sur les bornes de l'épisode
  assert.equal(broken?.tEnd, 30);
  assert.equal(broken?.speed, null);
  assert.equal(broken?.size, null);
  assert.equal(broken?.kind, null);
  assert.equal(broken?.fight?.losses, null);
});

test('tfResultLabel : résultat du teamfight pour l\'équipe de la vague', () => {
  assert.equal(tfResultLabel('won'), 'teamfight gagné');
  assert.equal(tfResultLabel('lost'), 'teamfight perdu');
  assert.equal(tfResultLabel('draw'), 'teamfight à égalité');
  assert.equal(tfResultLabel('duel'), 'duel (ni gagné ni perdu)');
  assert.equal(tfResultLabel('none'), 'aucun kill');
});

test('axisSentence : pourcentage du trajet entre les spawns', () => {
  assert.equal(axisSentence(0.57, true), "57 % du trajet entre le spawn de la vague (0 %) et celui de l'adversaire (100 %)");
  assert.equal(axisSentence(0.08, true).startsWith('8 %'), true);
  assert.equal(axisSentence(null, true), 'non mesurée (départs neutres, ou combat hors du trajet)');
  assert.equal(axisSentence(null, false), 'aucun combat');
});

test('retreatSentence, speedSentence, holderLabel', () => {
  assert.equal(retreatSentence(2, 3), '2 sur 3 survivants repliés à plus de 7 m du point');
  assert.equal(retreatSentence(1, 1), '1 sur 1 survivant replié à plus de 7 m du point');
  assert.equal(retreatSentence(0, 0), 'aucun survivant 3 s après le teamfight');
  assert.equal(retreatSentence(null, 2), 'inconnu');
  const duel = waveInfo(waveEpisode({ data: REAL_DUEL }));
  assert.equal(speedSentence(duel!), "progressive (1 arrêt, 5,0 s à l'arrêt avant le premier kill)");
  assert.equal(speedSentence(waveInfo(waveEpisode())!), 'rapide (aucun arrêt avant le premier kill)');
  assert.equal(speedSentence(waveInfo(waveEpisode({ data: REAL_NO_CONTACT }))!), 'non mesurée (aucun contact)');
  const name = (s: 'A' | 'B') => (s === 'A' ? 'SNV' : 'NCT');
  assert.equal(holderLabel('B', name), 'NCT');
  assert.equal(holderLabel(null, name), 'personne (neutre)');
});

test('doubtfulCapture : prise malgré un teamfight non gagné', () => {
  assert.equal(doubtfulCapture({ capturedT: 21, tfResult: 'won' }), false);
  assert.equal(doubtfulCapture({ capturedT: 21, tfResult: 'lost' }), true);
  assert.equal(doubtfulCapture({ capturedT: 21, tfResult: 'draw' }), true);
  assert.equal(doubtfulCapture({ capturedT: null, tfResult: 'lost' }), false);
});

test('waveSummary : taille, premier kill, teamfight ou duel', () => {
  assert.equal(waveSummary(waveInfo(waveEpisode())!), '4 joueurs, premier kill après 7,3 s, teamfight de 6 kills');
  assert.equal(waveSummary(waveInfo(waveEpisode({ data: REAL_DUEL }))!), '4 joueurs, premier kill après 10,1 s, duel');
  assert.equal(waveSummary(waveInfo(waveEpisode({ data: REAL_NO_CONTACT }))!), '2 joueurs, aucun kill');
});
