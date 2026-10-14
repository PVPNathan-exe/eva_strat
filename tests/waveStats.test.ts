import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_WAVES, MIN_DECIDED, filterWaves, isFiltered, median, passesFilter, rateSentence, retakeRate, speedOf, teamOfWave, teamTable, type WaveFilter } from '../src/lib/waveStats.ts';
import type { Episode } from '../src/types/stats.ts';
import { REAL_NO_CONTACT, waveEpisode, waveOf } from './waveFixtures.ts';

const GAME = { teamA: 'SNV', teamB: 'NCT' };
const SWAPPED = { teamA: 'NCT', teamB: 'SNV' };
const UNNAMED = { teamA: null, teamB: null };

/** Lot de test : 4 retakes réussis, 2 ratés, 1 teamfight gagné sans capture, 1 prise initiale, 1 ouverture perdue, 2 duels, 1 indécis, 1 sans contact. */
const LOT: Episode[] = [
  ...[1, 2, 3, 4].map((id) => waveOf('success', id, { capturedT: 21 })),
  ...[5, 6].map((id) => waveOf('fail', id, { tfResult: 'lost', speed: 'progressif' })),
  waveOf('won_no_capture', 7),
  waveOf('initial', 8),
  waveOf('initial_lost', 13, { tfResult: 'lost' }),
  waveOf('duel', 9, { tfResult: 'duel' }),
  waveOf('duel', 10, { tfResult: 'duel' }),
  waveOf('indecis', 11, { tfResult: 'draw' }),
  waveOf('no_contact', 12, { speed: null, toContactS: null, tfResult: 'none' }),
];

test('retakeRate : réussis / (réussis + ratés + teamfights gagnés sans capture), le reste est exclu', () => {
  const r = retakeRate(LOT);
  assert.deepEqual([r.waves, r.success, r.fail, r.won, r.initial, r.openingLost, r.duel, r.other], [13, 4, 2, 1, 1, 1, 2, 2]);
  assert.equal(r.decided, 7);
  assert.equal(r.hidden, false);
  assert.ok(Math.abs((r.rate ?? 0) - 4 / 7) < 1e-9);
});

test('retakeRate : masqué sous 5 vagues décidées, minimum modifiable', () => {
  const four = LOT.filter((e) => e.id <= 4);
  const r = retakeRate(four);
  assert.equal(r.decided, 4);
  assert.equal(r.hidden, true);
  assert.equal(r.rate, null);
  assert.equal(retakeRate(LOT, {}, 8).hidden, true);
  assert.equal(MIN_DECIDED, 5);
  // les prises initiales, duels, indécis et sans contact n'ouvrent jamais le taux
  const noRetake = [waveOf('initial', 1), waveOf('duel', 2), waveOf('indecis', 3), waveOf('no_contact', 4), waveOf('initial_lost', 5), waveOf('initial', 6)];
  assert.equal(retakeRate(noRetake).decided, 0);
});

test('retakeRate : un verdict ko écarte la vague, un jugement de session l\'emporte sur la base, l\'ancien calcul n\'est pas compté', () => {
  const eps = [...LOT];
  eps[0] = { ...eps[0], verdict: 'ko' };
  assert.equal(retakeRate(eps).success, 3);
  assert.equal(retakeRate(eps).ko, 1);
  assert.equal(retakeRate(eps, { 1: 'ok' }).success, 4);
  assert.equal(retakeRate(eps, { 2: 'ko' }).success, 2);
  const withLegacy = [...LOT, waveEpisode({ id: 90, data: null }), waveEpisode({ id: 91, outcome: 'series_fail', data: null }), waveEpisode({ id: 92, outcome: 'no_push', data: null })];
  const r = retakeRate(withLegacy);
  assert.equal(r.legacy, 3);
  assert.equal(r.waves, 13);
  assert.equal(r.success, 4);
});

test('rateSentence : bilan en français, taux ou raison du masquage', () => {
  assert.equal(
    rateSentence(retakeRate(LOT)),
    '13 vagues (4 retakes réussis, 2 retakes ratés, 1 teamfight gagné sans capture, 2 duels, 1 prise initiale), retake réussi : 57 % (4 sur 7)',
  );
  assert.equal(rateSentence(retakeRate(LOT.slice(0, 2))), '2 vagues (2 retakes réussis, 0 retake raté, 0 teamfight gagné sans capture, 0 duel, 0 prise initiale), taux masqué (2 vagues décidées, minimum 5)');
});

test('passesFilter : groupe d\'issue et vitesse, une vague sans vitesse passe si les deux vitesses sont cochées', () => {
  const rapide = waveOf('success', 1);
  const prog = waveOf('fail', 2, { speed: 'progressif' });
  const none = waveOf('no_contact', 3, { speed: null });
  assert.equal(passesFilter(rapide, ALL_WAVES), true);
  const noSuccess: WaveFilter = { ...ALL_WAVES, groups: { ...ALL_WAVES.groups, success: false } };
  assert.deepEqual([rapide, prog].map((e) => passesFilter(e, noSuccess)), [false, true]);
  const onlyFast: WaveFilter = { ...ALL_WAVES, speeds: { rapide: true, progressif: false } };
  assert.deepEqual([rapide, prog, none].map((e) => passesFilter(e, onlyFast)), [true, false, false]);
  const onlyProg: WaveFilter = { ...ALL_WAVES, speeds: { rapide: false, progressif: true } };
  assert.deepEqual([rapide, prog, none].map((e) => passesFilter(e, onlyProg)), [false, true, false]);
  assert.deepEqual(filterWaves([rapide, prog, none], onlyFast).map((e) => e.id), [1]);
});

test('passesFilter : prises initiales (avec ouvertures perdues), autres, anciennes lignes mappées', () => {
  const only = (group: keyof WaveFilter['groups']): WaveFilter => ({ ...ALL_WAVES, groups: Object.fromEntries(Object.keys(ALL_WAVES.groups).map((g) => [g, g === group])) as WaveFilter['groups'] });
  const ids = (g: keyof WaveFilter['groups']) => filterWaves(LOT, only(g)).map((e) => e.id);
  assert.deepEqual(ids('success'), [1, 2, 3, 4]);
  assert.deepEqual(ids('fail'), [5, 6]);
  assert.deepEqual(ids('won_no_capture'), [7]);
  assert.deepEqual(ids('initial'), [8, 13]); // la prise initiale et l'ouverture perdue
  assert.deepEqual(ids('duel'), [9, 10]);
  assert.deepEqual(ids('other'), [11, 12]);
  // Une ancienne ligne series_fail est mappée sur « retakes ratés »
  assert.equal(passesFilter(waveEpisode({ outcome: 'series_fail', data: null }), only('fail')), true);
  assert.equal(isFiltered(ALL_WAVES), false);
  assert.equal(isFiltered(only('fail')), true);
  assert.equal(isFiltered({ ...ALL_WAVES, speeds: { rapide: false, progressif: true } }), true);
});

test('speedOf : vitesse lue dans la vague', () => {
  assert.equal(speedOf(waveEpisode()), 'rapide');
  assert.equal(speedOf(waveEpisode({ data: REAL_NO_CONTACT })), null);
  assert.equal(speedOf(waveEpisode({ data: null })), null);
});

test('median : valeur du milieu, moyenne des deux du milieu, null si vide', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([1, 2, 3, 10]), 2.5);
});

test('teamOfWave : par nom d\'équipe, sinon par côté', () => {
  assert.deepEqual(teamOfWave('B', GAME), { key: 'nct', label: 'NCT' });
  assert.deepEqual(teamOfWave('A', { teamA: ' Team  Éclair ', teamB: null }), { key: 'team eclair', label: 'Team  Éclair' });
  assert.deepEqual(teamOfWave('B', UNNAMED), { key: 'side:B', label: 'Équipe bleue (côté droit)' });
  assert.deepEqual(teamOfWave('A', undefined), { key: 'side:A', label: 'Équipe orange (côté gauche)' });
});

test('teamTable : une ligne par équipe nommée, vitesses et médiane du premier kill', () => {
  const eps = [
    waveOf('success', 1, { team: 'B', toContactS: 4 }),
    waveOf('success', 2, { team: 'B', toContactS: 8 }),
    waveOf('fail', 3, { team: 'B', speed: 'progressif', toContactS: 20 }),
    waveOf('fail', 4, { team: 'A', speed: 'progressif', toContactS: 6 }),
    waveOf('no_contact', 5, { team: 'A', speed: null, toContactS: null }),
  ];
  const rows = teamTable(eps, () => GAME);
  assert.deepEqual(rows.map((r) => r.label), ['NCT', 'SNV']);
  const nct = rows[0];
  assert.deepEqual([nct.waves, nct.success, nct.fail, nct.won, nct.fast, nct.progressive], [3, 2, 1, 0, 2, 1]);
  assert.equal(nct.medianToContactS, 8);
  assert.equal(nct.rate, null); // 3 vagues décidées : masqué
  const snv = rows[1];
  assert.deepEqual([snv.waves, snv.fail, snv.fast, snv.progressive], [2, 1, 0, 1]);
  assert.equal(snv.medianToContactS, 6); // la vague sans contact ne compte pas dans la médiane
});

test('teamTable : une équipe nommée garde sa ligne d\'une game à l\'autre même si elle change de côté', () => {
  const eps = [
    waveOf('success', 1, { team: 'B', gameId: 25 }), // NCT, côté B dans la game 25
    waveOf('success', 2, { team: 'A', gameId: 26 }), // NCT, côté A dans la game 26
    waveOf('fail', 3, { team: 'A', gameId: 25 }), // SNV
  ];
  const games: Record<number, typeof GAME> = { 25: GAME, 26: SWAPPED };
  const rows = teamTable(eps, (id) => games[id]);
  assert.deepEqual(rows.map((r) => [r.label, r.waves]), [['NCT', 2], ['SNV', 1]]);
});

test('teamTable : sans nom d\'équipe, un tableau par côté ; taux affiché à partir de 5 vagues décidées', () => {
  const eps = [1, 2, 3, 4].map((id) => waveOf('success', id, { team: 'A' })).concat([waveOf('fail', 5, { team: 'A' })]);
  const rows = teamTable(eps, () => UNNAMED);
  assert.deepEqual(rows.map((r) => r.label), ['Équipe orange (côté gauche)']);
  assert.equal(rows[0].decided, 5);
  assert.ok(Math.abs((rows[0].rate ?? 0) - 0.8) < 1e-9);
});

test('teamTable : verdict ko et ancien calcul écartés, jugement de session prioritaire', () => {
  const eps = [waveOf('success', 1, { verdict: 'ko' }), waveOf('success', 2), waveEpisode({ id: 3, data: null })];
  assert.equal(teamTable(eps, () => GAME)[0].waves, 1);
  assert.equal(teamTable(eps, () => GAME, { 1: 'ok' })[0].waves, 2);
  assert.deepEqual(teamTable([waveEpisode({ id: 3, data: null })], () => GAME), []);
});
