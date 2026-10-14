import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISSUE_GROUPS, LEGACY_OUTCOMES, SHAPE_LABELS, WAVE_ISSUES, hasWave, issueLabel, shapesOf, speedLabel, waveIssueInfo } from '../src/lib/waveOutcome.ts';
import { waveEpisode } from './waveFixtures.ts';

test('chaque issue du calcul actuel a un libellé français, un ton, une forme et un groupe', () => {
  assert.deepEqual(Object.keys(WAVE_ISSUES).sort(), ['duel', 'fail', 'indecis', 'initial', 'initial_lost', 'no_contact', 'success', 'won_no_capture']);
  const shapes = Object.values(WAVE_ISSUES).map((d) => d.shape);
  assert.equal(new Set(shapes).size, shapes.length); // une forme par issue
  for (const [key, d] of Object.entries(WAVE_ISSUES)) {
    assert.ok(d.label.length > 0 && d.short.length > 0, key);
    assert.ok(ISSUE_GROUPS.some((g) => g.id === d.group), key);
  }
  assert.equal(WAVE_ISSUES.success.label, 'Retake réussi (teamfight gagné et point capturé)');
  assert.equal(WAVE_ISSUES.fail.short, 'Retake raté');
  assert.equal(WAVE_ISSUES.initial.short, 'Prise initiale');
});

test('waveIssueInfo : une vague du calcul actuel, rôle dans le taux', () => {
  const ok = waveIssueInfo(waveEpisode());
  assert.equal(ok.legacy, false);
  assert.equal(ok.shape, 'success');
  assert.equal(ok.tone, 'good');
  assert.equal(ok.role, 'success');
  const roles = (o: string) => waveIssueInfo(waveEpisode({ outcome: o })).role;
  assert.equal(roles('fail'), 'fail');
  assert.equal(roles('won_no_capture'), 'won');
  // Hors taux : prise initiale, ouverture perdue, duel, indécis, sans contact
  for (const o of ['initial', 'initial_lost', 'duel', 'indecis', 'no_contact']) assert.equal(roles(o), null, o);
  assert.equal(waveIssueInfo(waveEpisode({ outcome: 'initial' })).tone, 'neutral');
  assert.equal(waveIssueInfo(waveEpisode({ outcome: 'initial_lost' })).tone, 'bad');
});

test('waveIssueInfo : anciennes issues mappées d\'après la table de retakes.py, jamais comptées', () => {
  const old = (outcome: string, data: Record<string, unknown> | null = null) => waveIssueInfo({ outcome, data });
  // success et fail sans détail de vague : ancien calcul, mais le symbole reste celui de l'issue actuelle
  assert.deepEqual([old('success').legacy, old('success').shape, old('success').group], [true, 'success', 'success']);
  assert.deepEqual([old('fail').legacy, old('fail').shape], [true, 'fail']);
  assert.match(old('success').label, /\(ancien calcul\)$/);
  // series_fail -> fail ; series_changed -> success
  assert.equal(old('series_fail').shape, 'fail');
  assert.equal(old('series_changed').shape, 'success');
  // series_collapse -> success si le point change de main, sinon teamfight gagné sans capture
  assert.equal(old('series_collapse', { changed_hands: true }).shape, 'success');
  assert.equal(old('series_collapse', { changed_hands: false }).shape, 'won');
  assert.equal(old('series_collapse', null).group, 'won_no_capture');
  // series_hold -> défense (non écrite), series_neutral -> prise initiale, no_push -> prise hors vague
  assert.equal(old('series_hold').group, 'other');
  assert.equal(old('series_neutral').group, 'initial');
  assert.equal(old('no_push').group, 'other');
  for (const o of LEGACY_OUTCOMES) {
    const i = old(o);
    assert.equal(i.legacy, true, o);
    assert.equal(i.role, null, o); // jamais dans le taux
    assert.match(i.label, /ancien calcul|Teamfight|Retake/, o);
  }
});

test('waveIssueInfo : issue inconnue ou absente, à vérifier et hors taux', () => {
  const unknown = waveIssueInfo(waveEpisode({ outcome: 'zzz' }));
  assert.deepEqual([unknown.label, unknown.tone, unknown.role, unknown.legacy], ['zzz', 'doubt', null, false]);
  const none = waveIssueInfo({ outcome: null, data: null });
  assert.deepEqual([none.label, none.legacy, none.key], ['Inconnu', true, null]);
});

test('hasWave : seule la révision 3 porte data.wave', () => {
  assert.equal(hasWave(waveEpisode()), true);
  assert.equal(hasWave({ data: null }), false);
  assert.equal(hasWave({ data: { wave: 'x' } }), false);
  assert.equal(hasWave({ data: { push_t: 3, change_t: 9 } }), false);
});

test('issueLabel : libellé d\'une issue seule', () => {
  assert.deepEqual(issueLabel('success'), { label: WAVE_ISSUES.success.label, tone: 'good' });
  assert.equal(issueLabel('no_push')?.tone, 'doubt');
  assert.equal(issueLabel('zzz'), null);
  assert.equal(issueLabel(null), null);
});

test('shapesOf : formes présentes, dans l\'ordre de la légende, avec leur libellé', () => {
  const eps = [waveEpisode({ outcome: 'no_contact' }), waveEpisode({ id: 2, outcome: 'fail' }), waveEpisode({ id: 3, outcome: 'success' }), waveEpisode({ id: 4, outcome: 'fail' }), { outcome: 'series_hold', data: null }];
  assert.deepEqual(shapesOf(eps), ['success', 'fail', 'indecis', 'no_contact']);
  assert.equal(SHAPE_LABELS.won, 'Teamfight gagné, sans capture');
  assert.equal(SHAPE_LABELS.duel, 'Duel');
});

test('speedLabel : rapide, progressif ou non mesurée', () => {
  assert.equal(speedLabel('rapide'), 'Rapide');
  assert.equal(speedLabel('progressif'), 'Progressif');
  assert.equal(speedLabel(null), 'Non mesurée (aucun contact)');
});
