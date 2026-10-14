import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrivalGap,
  causeLabel,
  causeSummary,
  deathSentence,
  episodeMarks,
  fateLabel,
  filterEpisodes,
  flowSignature,
  formatSeconds,
  groupByPoint,
  involvesSlot,
  isSeries,
  keyInstant,
  offsetLabel,
  outcomeInfo,
  pctInWindow,
  rateOf,
  retakeInfo,
  rotationFlow,
  rotationInfo,
  timelineDeaths,
  timelineRows,
  videoSeek,
  windowOf,
} from '../src/lib/episodeFormat.ts';
import type { Episode, PointOwner } from '../src/types/stats.ts';
import { REAL_NO_CONTACT, waveEpisode } from './waveFixtures.ts';

/** Épisode de test : seuls les champs utiles changent. */
const episode = (over: Partial<Episode>): Episode => ({ id: 1, game_id: 1, kind: 'retake', point: 'A', point_to: null, team: 'B', t0: 67, t1: 97, outcome: 'success', data: null, verdict: null, ...over });

// Forme réelle d'un retake réussi (game 16 de la base calculée) : 2 attaquants, 1 défenseur mort après
const REAL_RETAKE = {
  change_t: 87.0,
  push_t: 84.5,
  window: [67.0, 97.0],
  from_team: 'A',
  to_team: 'B',
  attackers: [{ slot: 7, pos: [0.4555, 0.5639], dist_m: 0.0 }, { slot: 8, pos: [0.6358, 0.3484], dist_m: 3.9 }],
  defenders: [{ slot: 3, pos: [0.369, 0.5913], dist_m: 2.4, fate: 'mort_apres', death_t: 93.6 }],
  first_death: { slot: 3, t: 93.6, dt_push: 9.1, killer: 8, weapon: null, killer_dist_m: 0.6, defenders_near: 3, cause: 'tue_sur_le_point', pos: [0.338, 0.6174], team: 'A' },
  deaths: [{ slot: 3, t: 93.6, dt_push: 9.1, killer: 8, weapon: null, killer_dist_m: 0.6, defenders_near: 3, cause: 'tue_sur_le_point', pos: [0.338, 0.6174], team: 'A' }],
  stagger_s: 10.0,
  defenders_left: 0,
};

test('outcomeInfo : libellés et tons des retakes (vocabulaire des vagues), des rotations et des anciennes issues', () => {
  assert.deepEqual(outcomeInfo('success'), { label: 'Retake réussi (teamfight gagné et point capturé)', tone: 'good' });
  assert.deepEqual(outcomeInfo('fail'), { label: 'Retake raté (teamfight perdu)', tone: 'bad' });
  assert.equal(outcomeInfo('won_no_capture').label, 'Teamfight gagné sans capture du point');
  assert.equal(outcomeInfo('initial').tone, 'neutral');
  assert.equal(outcomeInfo('duel').tone, 'neutral');
  assert.equal(outcomeInfo('indecis').tone, 'doubt');
  assert.equal(outcomeInfo('no_push').tone, 'doubt');
  assert.equal(outcomeInfo('series_fail').tone, 'bad');
  assert.deepEqual(outcomeInfo('arrived'), { label: 'Arrivés à deux ou plus', tone: 'good' });
  assert.equal(outcomeInfo('not_arrived').tone, 'bad');
  assert.equal(outcomeInfo('zzz').tone, 'doubt');
  assert.equal(outcomeInfo(null).label, 'Inconnu');
});

test('windowOf : data.window si elle est écrite, sinon les bornes de l\'épisode', () => {
  assert.deepEqual(windowOf(waveEpisode()), { t0: 0, t1: 26 });
  assert.deepEqual(windowOf(episode({ t0: 5, t1: 9, data: null })), { t0: 5, t1: 9 });
  assert.deepEqual(windowOf(episode({ t0: 5, t1: 9, data: { window: [9, 5] } })), { t0: 5, t1: 9 }); // fenêtre à l'envers : ignorée
  assert.deepEqual(windowOf(episode({ t0: 5, t1: 9, data: { window: ['a', 12] } })), { t0: 5, t1: 9 });
});

test('episodeMarks : départ, premier kill et prise du point d\'une vague, dans l\'ordre du temps', () => {
  assert.deepEqual(episodeMarks(waveEpisode()), [{ t: 2.2, label: 'Départ' }, { t: 9.5, label: 'Premier kill' }, { t: 21, label: 'Prise du point' }]);
  assert.deepEqual(episodeMarks(waveEpisode({ data: REAL_NO_CONTACT })), [{ t: 211.4, label: 'Départ' }]); // ni contact ni prise
  assert.deepEqual(episodeMarks(episode({ data: { push_t: 84.5, change_t: 87 } })), [{ t: 84.5, label: 'Départ' }, { t: 87, label: 'Prise du point' }]); // ancienne ligne
});

test('causeSummary : causes des morts, la plus fréquente d\'abord', () => {
  assert.equal(causeSummary([{ cause: 'tue_a_distance' }, { cause: 'tue_sur_le_point' }, { cause: 'tue_a_distance' }]), 'tué à distance : 2 ; tué sur le point : 1');
  assert.equal(causeSummary([]), '');
});

test('isSeries et keyInstant : une ancienne série garde son premier kill comme instant clé', () => {
  assert.equal(isSeries({ outcome: 'series_hold' }), true);
  assert.equal(isSeries({ outcome: 'success' }), false);
  assert.equal(isSeries({ outcome: null }), false);
  assert.equal(keyInstant(episode({ t0: 364, outcome: 'series_fail', data: { series_t: [384, 392.5] } })), 384);
  assert.equal(keyInstant(episode({ t0: 364, outcome: 'series_fail', data: null })), 364);
  assert.equal(keyInstant(waveEpisode()), 2.2); // vague : le départ du spawn
});

test('rateOf (rotations) : les anciennes séries de kills sont comptées à part, jamais dans le taux', () => {
  const eps = [
    episode({ id: 1, outcome: 'success', data: null }),
    episode({ id: 2, outcome: 'fail', data: null }),
    episode({ id: 3, outcome: 'series_fail' }),
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
    { game_id: 1, point: 'A', t0: 67, t1: 80, owner: 'A', source: 'box' },
    { game_id: 1, point: 'A', t0: 80, t1: 95, owner: 'B', source: 'box' },
    { game_id: 1, point: 'A', t0: 90, t1: 95, owner: 'none', source: 'box' },
  ];
  const ep = episode({});
  assert.deepEqual(timelineRows(ep, owners)[0].bands.map((b) => b.tone), ['a', 'b', 'none']);
  const swapped = timelineRows(ep, owners, (o) => (o === 'B' ? 'a' : o === 'A' ? 'b' : 'none')); // équipe suivie côté B : ses bandes prennent la palette « a »
  assert.deepEqual(swapped[0].bands.map((b) => b.tone), ['b', 'a', 'none']);
  assert.deepEqual(swapped[0].bands.map((b) => b.owner), ['A', 'B', 'none']); // le propriétaire brut reste disponible
});

test('formatSeconds : virgule décimale et minutes', () => {
  assert.equal(formatSeconds(6.5), '6,5 s');
  assert.equal(formatSeconds(0), '0,0 s');
  assert.equal(formatSeconds(65), '1 min 05 s');
  assert.equal(formatSeconds(125.4), '2 min 05 s');
});

test('retakeInfo : lit un champ data réel', () => {
  const r = retakeInfo(episode({ data: REAL_RETAKE }));
  assert.equal(r.pushT, 84.5);
  assert.equal(r.changeT, 87);
  assert.equal(r.attackers.length, 2);
  assert.deepEqual(r.attackers[1].pos, [0.6358, 0.3484]);
  assert.equal(r.defenders[0].fate, 'mort_apres');
  assert.equal(r.firstDeath?.slot, 3);
  assert.equal(r.firstDeath?.team, 'A');
  assert.equal(r.staggerS, 10);
  assert.deepEqual(r.survivors, []);
});

test('retakeInfo : data absent ou abîmé ne plante pas', () => {
  const empty = retakeInfo(episode({ data: null }));
  assert.equal(empty.pushT, null);
  assert.deepEqual(empty.attackers, []);
  assert.equal(empty.firstDeath, null);
  const broken = retakeInfo(episode({ data: { attackers: 'oups', deaths: [{ slot: 'x' }, null, 3], push_t: 'a' } }));
  assert.deepEqual(broken.attackers, []);
  assert.deepEqual(broken.deaths, []);
  assert.equal(broken.pushT, null);
});

test('rateOf : taux masqué sous 5 épisodes décidés, à vérifier non comptés', () => {
  const eps = [episode({ id: 1 }), episode({ id: 2 }), episode({ id: 3, outcome: 'fail' }), episode({ id: 4, outcome: 'no_push' }), episode({ id: 5 })];
  const r = rateOf(eps);
  assert.equal(r.decided, 4);
  assert.equal(r.doubt, 1);
  assert.equal(r.hidden, true);
  assert.equal(r.rate, null);
  const six = [...eps, episode({ id: 6 }), episode({ id: 7, outcome: 'fail' })];
  const r6 = rateOf(six);
  assert.equal(r6.hidden, false);
  assert.equal(r6.decided, 6);
  assert.equal(r6.good, 4);
  assert.ok(Math.abs((r6.rate ?? 0) - 4 / 6) < 1e-9);
});

test('rateOf : un verdict ko écarte l\'épisode, un jugement de session l\'emporte sur la base', () => {
  const eps = Array.from({ length: 6 }, (_, i) => episode({ id: i + 1 }));
  eps[0].verdict = 'ko';
  assert.equal(rateOf(eps).total, 5);
  assert.equal(rateOf(eps, { 1: 'ok' }).total, 6); // jugé bon pendant la session
  assert.equal(rateOf(eps, { 2: 'ko' }).total, 4);
  assert.equal(rateOf(eps, {}, 10).hidden, true); // minimum modifiable
});

test('groupByPoint : un groupe par point, alphabétique, ordre conservé', () => {
  const g = groupByPoint([episode({ id: 1, point: 'B' }), episode({ id: 2, point: 'A' }), episode({ id: 3, point: 'B' }), episode({ id: 4, point: null })]);
  assert.deepEqual(g.map((x) => x.point), ['?', 'A', 'B']);
  assert.deepEqual(g[2].episodes.map((e) => e.id), [1, 3]);
  assert.equal(g[1].label, 'Point A');
  assert.equal(g[0].label, 'Point inconnu');
});

test('filterEpisodes et involvesSlot : games, équipe et joueur', () => {
  const eps = [episode({ id: 1, game_id: 2, t0: 50, data: REAL_RETAKE }), episode({ id: 2, game_id: 1, team: 'A', data: REAL_RETAKE }), episode({ id: 3, game_id: 9 })];
  assert.deepEqual(filterEpisodes(eps, [1, 2], 'all', 0).map((e) => e.id), [2, 1]); // game 9 écartée, tri par game
  assert.deepEqual(filterEpisodes(eps, [1, 2], 'B', 0).map((e) => e.id), [1]);
  assert.deepEqual(filterEpisodes(eps, [1, 2], 'all', 7).map((e) => e.id), [2, 1]); // le 7 attaque
  assert.deepEqual(filterEpisodes(eps, [1, 2], 'all', 5), []);
  assert.equal(involvesSlot(eps[0], 3), true); // défenseur
});

// Rotations d'une équipe sur Outlaw : C vers B (arrivées à 6,5 s et 9,0 s), puis B vers D (départ 2 s avant la nouvelle boîte)
const rotation = (id: number, over: Partial<Episode>, data: Record<string, unknown>): Episode => episode({ id, kind: 'rotation', team: 'A', t0: 0, t1: 40, outcome: 'arrived', data, ...over });
const FIRST = rotation(1, { point: 'C', point_to: 'B' }, {
  switch_t: 126, old_owner: 'B', new_owner_after: 'A', distance_points_m: 10.6, start_players: [],
  arrivals: [{ slot: 4, t: 135.0, travel_s: 9.0 }, { slot: 2, t: 132.5, travel_s: 6.5 }], second_arrival_s: 9.0, deaths_en_route: [],
});
const SECOND = rotation(2, { point: 'B', point_to: 'D', t0: 206 }, {
  switch_t: 216, start_players: [{ slot: 2, leave_t: 214.0, leave_offset_s: -2.0 }, { slot: 4, leave_t: 215.0, leave_offset_s: -1.0 }],
  arrivals: [{ slot: 2, t: 224.5, travel_s: 8.5 }], second_arrival_s: null, deaths_en_route: [{ slot: 4, t: 227.3, killer: 3 }],
});

test('rotationInfo : arrivées triées, mort en route à l\'équipe de la rotation', () => {
  const r = rotationInfo(FIRST);
  assert.deepEqual(r.arrivals.map((a) => a.slot), [2, 4]);
  assert.equal(arrivalGap(r), 2.5);
  assert.equal(r.distanceM, 10.6);
  const s = rotationInfo(SECOND);
  assert.equal(s.deaths[0].team, 'A');
  assert.equal(s.deaths[0].killer, 3);
  assert.equal(arrivalGap(s), null);
  assert.equal(keyInstant(FIRST), 126);
});

test('rotationFlow : flèches, effectifs et séjour estimé', () => {
  const f = rotationFlow([SECOND, FIRST]);
  assert.deepEqual(f.arrows.map((a) => [a.from, a.to, a.count]), [['B', 'D', 1], ['C', 'B', 1]]);
  assert.equal(f.arrows.find((a) => a.to === 'B')?.meanTravelS, 9);
  assert.equal(f.arrows.find((a) => a.to === 'D')?.meanTravelS, null);
  // Séjour sur B : arrivée à 126 + 9 = 135, départ lu à 216 - 1 (élément du milieu de -2 et -1) = 215
  const b = f.nodes.find((n) => n.point === 'B');
  assert.equal(b?.visits, 1);
  assert.equal(b?.seconds, 80);
  assert.equal(f.measured, true);
  assert.equal(flowSignature(FIRST), 'C>B');
});

test('rotationFlow : sans séjour mesurable, measured faux ; rotations d\'une autre game ou équipe non enchaînées', () => {
  const other = rotation(3, { point: 'B', point_to: 'D', game_id: 7, t0: 206 }, { switch_t: 216, arrivals: [{ slot: 2, t: 224.5, travel_s: 8.5 }], start_players: [] });
  const f = rotationFlow([FIRST, other]);
  assert.equal(f.measured, false);
  assert.equal(rotationFlow([]).nodes.length, 0);
});

test('videoSeek : 5 s avant l\'instant, jamais avant le début de la game', () => {
  assert.equal(videoSeek(1000, 87), 1082);
  assert.equal(videoSeek(1000, 3), 1000);
});

test('pctInWindow, timelineRows et timelineDeaths', () => {
  const ep = episode({ id: 9, t0: 67, t1: 97, data: REAL_RETAKE });
  assert.equal(pctInWindow(ep, 82), 50);
  assert.equal(pctInWindow(ep, 0), 0);
  assert.equal(pctInWindow(ep, 500), 100);
  const owners: PointOwner[] = [
    { game_id: 1, point: 'A', t0: 15, t1: 87, owner: 'A', source: 'box' },
    { game_id: 1, point: 'A', t0: 87, t1: 123, owner: 'B', source: 'box' },
    { game_id: 1, point: 'B', t0: 0, t1: 200, owner: 'none', source: 'box' },
    { game_id: 2, point: 'A', t0: 0, t1: 200, owner: 'B', source: 'box' },
  ];
  const rows = timelineRows(ep, owners);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].bands.map((b) => b.owner), ['A', 'B']);
  assert.equal(rows[0].bands[0].left, 0);
  assert.ok(Math.abs(rows[0].bands[0].width - (20 / 30) * 100) < 1e-9);
  assert.equal(rows[0].bands[1].left + rows[0].bands[1].width, 100);
  const deaths = timelineDeaths(ep);
  assert.deepEqual(deaths.map((d) => [d.n, d.slot]), [[1, 3]]);
  assert.equal(timelineRows(rotation(5, { point: 'C', point_to: 'B' }, {}), owners).length, 2);
});

test('deathSentence : numéro de jeu, pseudo et cause', () => {
  const d = retakeInfo(episode({ data: REAL_RETAKE })).deaths[0];
  const s = deathSentence(d, (slot) => (slot === 8 ? 'Zed' : undefined));
  assert.equal(s, 'n° 3 : tué par n° 9 (Zed), tueur à 0,6 m du point (tué sur le point)');
});

test('fateLabel, causeLabel et offsetLabel : libellés français', () => {
  assert.equal(fateLabel('recule'), 'reculé');
  assert.equal(fateLabel('mort'), 'mort dans le teamfight');
  assert.equal(fateLabel(null), 'sort inconnu');
  assert.equal(fateLabel('autre_chose'), 'autre_chose');
  assert.equal(causeLabel('en_route'), 'tué en route');
  assert.equal(causeLabel('sans_tueur'), 'tueur non lu');
  assert.equal(offsetLabel(-2), '2,0 s avant');
  assert.equal(offsetLabel(3.5), '3,5 s après');
});
