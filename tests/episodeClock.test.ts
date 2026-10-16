import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeBands,
  axisTicks,
  bandOf,
  buildLanes,
  episodeInScope,
  episodesAt,
  episodesByPalette,
  indexSamples,
  lastAtOrBefore,
  markKind,
  MIN_BAR_PCT,
  ownerBands,
  packRows,
  paletteOfSide,
  pointsOf,
  positionsAt,
  rectsFromBoxes,
  rectsFromPolygons,
  retakeMark,
  sideName,
  timeAtFraction,
  toneOfOwner,
} from '../src/lib/episodeClock.ts';
import { nameKey, NO_FOLLOW, type FollowGame, type FollowSpec } from '../src/lib/teamFollow.ts';
import type { Episode, PointActive, PointOwner } from '../src/types/stats.ts';
import { waveEpisode } from './waveFixtures.ts';

const GAME: FollowGame = { id: 32, teamA: 'SNV', teamB: 'NCT', players: [] };
const SWAPPED: FollowGame = { id: 33, teamA: 'NCT', teamB: 'SNV', players: [] };
/** Équipe suivie par son nom : NCT (côté B dans GAME, côté A dans SWAPPED). */
const FOLLOW_NCT: FollowSpec = { ...NO_FOLLOW, team: nameKey('nct') };
const episode = (over: Partial<Episode>): Episode => ({ id: 1, game_id: 32, kind: 'retake', point: 'B', point_to: null, team: 'A', t0: 364, t1: 402.5, outcome: 'series_fail', data: null, verdict: null, ...over });

test('paletteOfSide : l\'équipe suivie garde sa couleur par NOM quel que soit son côté', () => {
  assert.equal(paletteOfSide(GAME, FOLLOW_NCT, 'B'), 'a');
  assert.equal(paletteOfSide(GAME, FOLLOW_NCT, 'A'), 'b');
  assert.equal(paletteOfSide(SWAPPED, FOLLOW_NCT, 'A'), 'a');
  assert.equal(paletteOfSide(SWAPPED, FOLLOW_NCT, 'B'), 'b');
  // Sans équipe suivie : le côté décide (A orange = a, B bleue = b)
  assert.equal(paletteOfSide(GAME, NO_FOLLOW, 'A'), 'a');
  assert.equal(paletteOfSide(GAME, NO_FOLLOW, 'B'), 'b');
});

test('toneOfOwner et sideName : point neutre, nom de l\'équipe ou repli sur la couleur', () => {
  assert.equal(toneOfOwner(GAME, FOLLOW_NCT, 'none'), 'none');
  assert.equal(toneOfOwner(GAME, FOLLOW_NCT, 'B'), 'a');
  assert.equal(sideName(GAME, 'B'), 'NCT');
  assert.equal(sideName({ teamA: null, teamB: null }, 'B'), 'équipe bleue');
  assert.equal(sideName({ teamA: null, teamB: null }, null), 'équipe orange');
});

test('episodeInScope : côté montré et joueur choisi', () => {
  const ep = episode({ team: 'B', data: { attackers: [{ slot: 7, pos: [0.1, 0.1], dist_m: 1 }], defenders: [] } });
  assert.equal(episodeInScope(ep, GAME, NO_FOLLOW), true);
  assert.equal(episodeInScope(ep, GAME, { ...NO_FOLLOW, side: 'left' }), false); // seule l'équipe de gauche (A)
  assert.equal(episodeInScope(ep, GAME, { ...NO_FOLLOW, slot: 7 }), true);
  assert.equal(episodeInScope(ep, GAME, { ...NO_FOLLOW, slot: 2 }), false);
  // Équipe suivie NCT (B) : « adversaires seuls » écarte l'épisode de NCT
  assert.equal(episodeInScope(ep, GAME, { ...FOLLOW_NCT, show: 'opponents' }), false);
  assert.equal(episodeInScope(ep, GAME, { ...FOLLOW_NCT, show: 'followed' }), true);
});

test('episodesByPalette : une équipe nommée garde sa palette d\'une game à l\'autre', () => {
  const eps = [episode({ id: 1, game_id: 32, team: 'B' }), episode({ id: 2, game_id: 33, team: 'A' }), episode({ id: 3, game_id: 33, team: 'B' }), episode({ id: 4, game_id: 32, team: null })];
  const games = new Map([[32, GAME], [33, SWAPPED]]);
  const by = episodesByPalette(eps, (id) => games.get(id), FOLLOW_NCT);
  assert.deepEqual(by.a.map((e) => e.id), [1, 2]); // NCT : côté B dans la game 32, côté A dans la 33
  assert.deepEqual(by.b.map((e) => e.id), [3]);
});

test('bandOf : borné à la game, vide ignoré', () => {
  assert.deepEqual(bandOf(-10, 50, 200), { left: 0, width: 25, t0: 0, t1: 50 });
  assert.equal(bandOf(210, 250, 200), null);
  assert.equal(bandOf(50, 50, 200), null);
  assert.equal(bandOf(10, 20, 0), null);
});

// Propriétaires réels de l'Outlaw de la game 32 (extraits)
const OWNERS: PointOwner[] = [
  { game_id: 32, point: 'B', t0: 137, t1: 147, owner: 'A', source: 'box' },
  { game_id: 32, point: 'B', t0: 127, t1: 137, owner: 'none', source: 'box' },
  { game_id: 32, point: 'C', t0: 99, t1: 125, owner: 'B', source: 'box' },
  { game_id: 32, point: 'B', t0: 530, t1: 600, owner: 'B', source: 'box' },
];
const ACTIVE: PointActive[] = [
  { game_id: 32, point: 'C', t0: 37, t1: 127, source: 'hud' },
  { game_id: 32, point: 'B', t0: 127, t1: 217, source: 'hud' },
];

test('ownerBands : un point, dans l\'ordre du temps, teinte par équipe nommée', () => {
  const bands = ownerBands(OWNERS, 'B', 540, (o) => toneOfOwner(GAME, FOLLOW_NCT, o));
  assert.deepEqual(bands.map((b) => [b.owner, b.tone]), [['none', 'none'], ['A', 'b'], ['B', 'a']]);
  assert.equal(bands[2].t1, 540); // la bande est coupée à la fin de la game
  assert.ok(Math.abs(bands[0].left - (127 / 540) * 100) < 1e-9);
  assert.ok(Math.abs(bands[0].width - (10 / 540) * 100) < 1e-9);
});

test('activeBands, pointsOf et buildLanes : une ligne par point avec ses repères', () => {
  assert.deepEqual(activeBands(ACTIVE, 'B', 540).map((b) => [b.t0, b.t1]), [[127, 217]]);
  const eps = [episode({ id: 7, point: 'D' })];
  assert.deepEqual(pointsOf(OWNERS, ACTIVE, eps), ['B', 'C', 'D']);
  const marks = [retakeMark(eps[0], 540, 'b')];
  const lanes = buildLanes(['B', 'C', 'D'], OWNERS, ACTIVE, marks, 540, () => 'none');
  assert.deepEqual(lanes.map((l) => [l.point, l.owners.length, l.active.length, l.marks.length]), [['B', 3, 1, 0], ['C', 1, 1, 0], ['D', 0, 0, 1]]);
  assert.deepEqual(lanes.map((l) => l.rows), [1, 1, 1]);
});

test('buildLanes : deux vagues qui se chevauchent sur un point sont rangées sur deux rangées, la ligne grandit', () => {
  const base = waveEpisode().data as { wave: Record<string, unknown> };
  const a = retakeMark(waveEpisode({ id: 1, point: 'A' }), 540, 'a'); // 2,2 s à 21 s
  const b = retakeMark(waveEpisode({ id: 2, point: 'A', data: { ...base, wave: { ...base.wave, t_start: 5, t_end: 30, t_contact: 8 } } }), 540, 'b');
  const later = retakeMark(waveEpisode({ id: 3, point: 'A', data: { wave: { t_start: 100, t_end: 110, t_contact: 105, speed: 'progressif' } } }), 540, 'a');
  const other = retakeMark(waveEpisode({ id: 4, point: 'B' }), 540, 'a');
  const rotation = { key: 'r', point: 'A', kind: 'rotation' as const, tone: 'doubt' as const, t: 50, left: 9, spanLeft: 8, spanWidth: 2, palette: null, label: 'rotation' };
  const lanes = buildLanes(['A', 'B', 'C'], [], [], [a, b, later, other, rotation], 540, () => 'none');
  assert.deepEqual(lanes.map((l) => l.rows), [2, 1, 1]);
  const rowOf = (key: string) => lanes[0].marks.find((m) => m.key === key)?.bar?.row;
  assert.deepEqual([rowOf('1'), rowOf('2'), rowOf('3')], [0, 1, 0]); // la troisième vague reprend la première rangée
  assert.equal(lanes[0].marks.find((m) => m.key === 'r')?.bar, undefined); // un repère sans barre ne change pas
  assert.equal(lanes[1].marks[0].bar?.row, 0);
});

test('packRows : rangement glouton par début, écart minimal entre deux barres d' + "'" + 'une même rangée', () => {
  assert.deepEqual(packRows([]), []);
  assert.deepEqual(packRows([{ left: 0, width: 10 }, { left: 20, width: 10 }]), [0, 0]);
  assert.deepEqual(packRows([{ left: 0, width: 10 }, { left: 5, width: 10 }]), [0, 1]);
  // Écart de 1,5 : une barre qui commence 1 après la fin de la précédente passe à la rangée suivante, 1,5 après elle reste sur la même
  assert.deepEqual(packRows([{ left: 0, width: 10 }, { left: 11, width: 5 }]), [0, 1]);
  assert.deepEqual(packRows([{ left: 0, width: 10 }, { left: 11.5, width: 5 }]), [0, 0]);
  assert.deepEqual(packRows([{ left: 0, width: 10 }, { left: 10.2, width: 5 }], 0), [0, 0]);
  // Entrée désordonnée : une rangée par barre dans l'ordre d'entrée
  assert.deepEqual(packRows([{ left: 40, width: 5 }, { left: 0, width: 50 }, { left: 20, width: 5 }, { left: 60, width: 5 }]), [1, 0, 1, 0]);
});

test('markKind : une forme par issue, anciennes issues mappées', () => {
  const shape = (outcome: string) => markKind(waveEpisode({ outcome }));
  assert.deepEqual(
    ['success', 'fail', 'won_no_capture', 'initial', 'initial_lost', 'duel', 'indecis', 'no_contact'].map(shape),
    ['success', 'fail', 'won', 'initial', 'initial_lost', 'duel', 'indecis', 'no_contact'],
  );
  assert.equal(markKind({ outcome: 'no_push', data: null }), 'indecis');
  assert.equal(markKind({ outcome: 'series_fail', data: null }), 'fail');
  assert.equal(markKind({ outcome: 'series_collapse', data: null }), 'won');
  assert.equal(markKind({ outcome: null, data: null }), 'indecis');
});

test('retakeMark : barre du départ à la résolution, trait au premier kill, symbole à la fin', () => {
  const m = retakeMark(waveEpisode({ id: 9 }), 540, 'a');
  assert.equal(m.key, '9');
  assert.equal(m.kind, 'success');
  assert.equal(m.tone, 'good');
  assert.equal(m.palette, 'a');
  assert.equal(m.t, 21); // le symbole est posé sur la résolution
  assert.ok(Math.abs(m.left - (21 / 540) * 100) < 1e-9);
  assert.ok(m.bar);
  assert.ok(Math.abs(m.bar.left - (2.2 / 540) * 100) < 1e-9);
  assert.ok(Math.abs(m.bar.width - (18.8 / 540) * 100) < 1e-9);
  assert.ok(Math.abs((m.bar.contactLeft ?? 0) - (9.5 / 540) * 100) < 1e-9);
  assert.equal(m.bar.speed, 'rapide');
  assert.equal(m.bar.row, 0);
  assert.equal(m.spanLeft, m.bar.left);
  assert.equal(m.label, '0:02 : Retake réussi (rapide)');
});

test('retakeMark : vague sans contact, vague très courte, ancienne ligne', () => {
  const nc = retakeMark(waveEpisode({ outcome: 'no_contact', data: { wave: { t_start: 211.4, t_end: 221.1, t_contact: null, speed: null } } }), 540, 'b');
  assert.equal(nc.bar?.contactLeft, null);
  assert.equal(nc.bar?.speed, null);
  assert.equal(nc.label, '3:31 : Sans contact');
  const tiny = retakeMark(waveEpisode({ data: { wave: { t_start: 10, t_end: 10, t_contact: 10, speed: 'rapide' } } }), 540, 'a');
  assert.equal(tiny.bar?.width, MIN_BAR_PCT);
  // Ancienne ligne (sans data.wave) : barre de son début à sa fin, symbole de l'issue mappée
  const old = retakeMark(episode({ id: 5, outcome: 'series_fail', data: null }), 540, 'a');
  assert.equal(old.kind, 'fail');
  assert.equal(old.tone, 'bad');
  assert.ok(Math.abs((old.bar?.left ?? 0) - (364 / 540) * 100) < 1e-9);
  assert.ok(Math.abs((old.bar?.width ?? 0) - (38.5 / 540) * 100) < 1e-9);
  assert.equal(old.bar?.contactLeft, null);
  assert.match(old.label, /ancien calcul/);
});

test('episodesAt et timeAtFraction', () => {
  const eps = [episode({ id: 1, t0: 10, t1: 40 }), episode({ id: 2, t0: 50, t1: 80 })];
  assert.deepEqual(episodesAt(eps, 40).map((e) => e.id), [1]);
  assert.deepEqual(episodesAt(eps, 45), []);
  assert.equal(timeAtFraction(0.5, 540), 270);
  assert.equal(timeAtFraction(1.4, 540), 540);
  assert.equal(timeAtFraction(-1, 540), 0);
});

test('axisTicks : une graduation par minute, une toutes les deux minutes au-delà de 15 minutes', () => {
  const t = axisTicks(540);
  assert.equal(t.length, 10);
  assert.equal(t[1].label, '1:00');
  assert.equal(t[9].left, 100);
  assert.deepEqual(axisTicks(1000).map((k) => k.t).slice(0, 3), [0, 120, 240]);
});

test('indexSamples et positionsAt : vivants seulement, dernière position lue, disparaît après un trou', () => {
  const samples = [
    { t: 10.2, slot: 1, x: 0.2, y: 0.2, alive: 1 },
    { t: 10.0, slot: 1, x: 0.1, y: 0.1, alive: 1 }, // fourni dans le désordre
    { t: 10.4, slot: 1, x: 0.3, y: 0.3, alive: 0 }, // mort : ignoré
    { t: 10.0, slot: 6, x: 0.7, y: 0.7, alive: 1 },
    { t: 10.1, slot: 6, x: 0.8, y: 0.8, alive: 1 },
  ];
  const idx = indexSamples(samples);
  assert.deepEqual(idx.get(1)?.t, [10.0, 10.2]);
  assert.deepEqual(positionsAt(idx, 10.15).map((p) => [p.slot, p.x]), [[1, 0.1], [6, 0.8]]);
  assert.deepEqual(positionsAt(idx, 10.5).map((p) => p.slot), [1, 6]); // moins d'une seconde après la dernière ligne
  assert.deepEqual(positionsAt(idx, 12), []); // plus de ligne vivante depuis plus d'une seconde : le joueur n'est plus montré
  assert.deepEqual(positionsAt(idx, 9.9), []); // avant la première ligne
});

test('lastAtOrBefore : recherche dichotomique', () => {
  const ts = [1, 2, 4, 8];
  assert.equal(lastAtOrBefore(ts, 0), -1);
  assert.equal(lastAtOrBefore(ts, 1), 0);
  assert.equal(lastAtOrBefore(ts, 5), 2);
  assert.equal(lastAtOrBefore(ts, 99), 3);
  assert.equal(lastAtOrBefore([], 3), -1);
});

test('rectsFromPolygons et rectsFromBoxes : une lettre par polygone, centre et taille vers cadre', () => {
  const r = rectsFromPolygons([
    [[0.44, 0.04], [0.54, 0.04], [0.54, 0.12]],
    [[0.44, 0.43], [0.54, 0.6]],
  ]);
  assert.deepEqual(r.A, [0.44, 0.04, 0.54, 0.12]);
  assert.deepEqual(Object.keys(r), ['A', 'B']);
  const b = rectsFromBoxes({ C: { x: 0.5, y: 0.8, w: 0.1, h: 0.2 } });
  assert.ok(Math.abs(b.C[0] - 0.45) < 1e-9 && Math.abs(b.C[3] - 0.9) < 1e-9);
  assert.deepEqual(rectsFromPolygons([]), {});
});

test('pointsOf : les points connus de la carte sont listés même sans jamais être lus dans la game (Outlaw, point E)', () => {
  const owners = [{ game_id: 1, point: 'B', t0: 0, t1: 10, owner: 'A' as const, source: 'box' as const }];
  const active = [{ game_id: 1, point: 'C', t0: 0, t1: 90, source: 'hud' as const }];
  assert.deepEqual(pointsOf(owners, active, []), ['B', 'C']);
  assert.deepEqual(pointsOf(owners, active, [], ['A', 'B', 'C', 'D', 'E']), ['A', 'B', 'C', 'D', 'E']);
});
