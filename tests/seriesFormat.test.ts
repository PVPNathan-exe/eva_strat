import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSeries, keyInstant, outcomeInfo, rateOf, timelineRows } from '../src/lib/episodeFormat.ts';
import { repositionSentence, seriesInfo, viewsSentence } from '../src/lib/seriesFormat.ts';
import type { Episode, PointOwner } from '../src/types/stats.ts';

// Forme réelle d'une série (game 32, Outlaw, point B, 384 s à 392,5 s), sans les photos d'équipe
const REAL_SERIES = {
  push_t: 384, series_t: [384, 392.5], window: [364, 402.5], from_team: 'B', to_team: 'A', killer_team: 'B', victim_team: 'A', holder_team: 'B', changed_hands: false, changed_to: null, changed_dt_s: null,
  view: 'victim', outcome_by_view: { victim: 'series_fail', killer: 'series_hold' }, team_by_view: { victim: 'A', killer: 'B' },
  kills: [
    { t: 392.5, killer: 8, victim: 3, weapon: null, kind: 'kill' },
    { t: 384, killer: 8, victim: 1, weapon: null, kind: 'kill' },
    { t: 387, killer: 7, victim: 2, weapon: 'B22', kind: 'kill' },
  ],
  adverse_team: 'B', reposition: { A: { shift_5_m: 8.9, shift_10_m: 13, near_point_end: 0 }, B: { shift_5_m: 7.7, shift_10_m: 12.4, near_point_end: 1 } },
};
const episode = (over: Partial<Episode>): Episode => ({ id: 1, game_id: 32, kind: 'retake', point: 'B', point_to: null, team: 'A', t0: 364, t1: 402.5, outcome: 'series_fail', data: REAL_SERIES, verdict: null, ...over });

test('isSeries et outcomeInfo : les cinq issues de série ont un libellé', () => {
  assert.equal(isSeries({ outcome: 'series_hold' }), true);
  assert.equal(isSeries({ outcome: 'success' }), false);
  assert.equal(isSeries({ outcome: null }), false);
  assert.equal(outcomeInfo('series_fail').label, 'Série de kills : échec de retake');
  assert.equal(outcomeInfo('series_collapse').tone, 'bad');
  assert.equal(outcomeInfo('series_hold').tone, 'good');
  assert.equal(outcomeInfo('series_changed').tone, 'doubt');
  assert.equal(outcomeInfo('series_neutral').label, 'Série de kills, point sans propriétaire');
});

test('seriesInfo : lit une série réelle, kills triés, repositionnement de l\'équipe adverse', () => {
  const s = seriesInfo(episode({}));
  assert.deepEqual(s.seriesT, [384, 392.5]);
  assert.equal(s.killerTeam, 'B');
  assert.equal(s.victimTeam, 'A');
  assert.equal(s.holderTeam, 'B');
  assert.equal(s.changedHands, false);
  assert.equal(s.view, 'victim');
  assert.deepEqual(s.outcomeByView, { victim: 'series_fail', killer: 'series_hold' });
  assert.equal(s.victims, 3);
  assert.deepEqual(s.kills.map((k) => k.t), [384, 387, 392.5]);
  assert.deepEqual(s.reposition, { shift5: 7.7, shift10: 12.4, near: 1 }); // équipe B, l'adversaire de l'équipe A de l'épisode
});

test('seriesInfo : data absent ou abîmé ne plante pas', () => {
  const empty = seriesInfo(episode({ data: null }));
  assert.equal(empty.seriesT, null);
  assert.equal(empty.victims, 0);
  assert.equal(empty.reposition, null);
  assert.deepEqual(empty.outcomeByView, { victim: null, killer: null });
  const broken = seriesInfo(episode({ data: { series_t: ['a', 2], kills: 'x', outcome_by_view: 3, reposition: { A: 1 }, adverse_team: 'A' } }));
  assert.equal(broken.seriesT, null);
  assert.deepEqual(broken.kills, []);
  assert.equal(broken.reposition, null);
});

test('viewsSentence : les deux lectures de l\'attribution, sans choisir', () => {
  assert.equal(viewsSentence(seriesInfo(episode({}))), 'lecture « victime » : Série de kills : échec de retake ; lecture « tueur » : Série de kills : la défense tient');
  assert.equal(viewsSentence(seriesInfo(episode({ data: null }))), null);
});

test('repositionSentence : décalage du centre à 5 s et 10 s', () => {
  assert.equal(repositionSentence(seriesInfo(episode({}))), 'centre déplacé de 7,7 m 5 s après, 12,4 m 10 s après, 1 joueur près du point à la fin');
  assert.equal(repositionSentence(seriesInfo(episode({ data: null }))), null);
});

test('keyInstant : le premier kill pour une série, repli sur le début de la fenêtre', () => {
  assert.equal(keyInstant(episode({})), 384);
  assert.equal(keyInstant(episode({ data: null })), 364);
});

test('rateOf : les séries de kills sont comptées à part, jamais dans le taux', () => {
  const eps = [
    episode({ id: 1, outcome: 'success', data: null }),
    episode({ id: 2, outcome: 'fail', data: null }),
    episode({ id: 3 }),
    episode({ id: 4, outcome: 'series_collapse' }),
    episode({ id: 5, outcome: 'series_changed', verdict: 'ko' }),
  ];
  const r = rateOf(eps);
  assert.equal(r.total, 2);
  assert.equal(r.series, 2); // la série jugée fausse n'est pas comptée
  assert.equal(r.decided, 2);
  assert.equal(r.good, 1);
});

test('timelineRows : teinte par équipe nommée (toneOf) ou, par défaut, A donne « a » et B donne « b »', () => {
  const owners: PointOwner[] = [
    { game_id: 32, point: 'B', t0: 364, t1: 380, owner: 'A', source: 'box' },
    { game_id: 32, point: 'B', t0: 380, t1: 402, owner: 'B', source: 'box' },
    { game_id: 32, point: 'B', t0: 390, t1: 395, owner: 'none', source: 'box' },
  ];
  const ep = episode({});
  assert.deepEqual(timelineRows(ep, owners)[0].bands.map((b) => b.tone), ['a', 'b', 'none']);
  // Équipe suivie côté B : ses bandes prennent la palette « a »
  const swapped = timelineRows(ep, owners, (o) => (o === 'B' ? 'a' : o === 'A' ? 'b' : 'none'));
  assert.deepEqual(swapped[0].bands.map((b) => b.tone), ['b', 'a', 'none']);
  assert.deepEqual(swapped[0].bands.map((b) => b.owner), ['A', 'B', 'none']); // le propriétaire brut reste disponible
});
