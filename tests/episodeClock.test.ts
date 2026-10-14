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
  ownerBands,
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
});

test('markKind et retakeMark : forme selon le résultat, position et fenêtre', () => {
  assert.equal(markKind({ outcome: 'success' }), 'success');
  assert.equal(markKind({ outcome: 'fail' }), 'fail');
  assert.equal(markKind({ outcome: 'no_push' }), 'nopush');
  assert.equal(markKind({ outcome: 'series_collapse' }), 'series');
  assert.equal(markKind({ outcome: null }), 'nopush');
  const m = retakeMark(episode({ id: 9, outcome: 'series_fail', data: { series_t: [384, 392.5] } }), 540, 'a');
  assert.equal(m.key, '9');
  assert.equal(m.kind, 'series');
  assert.equal(m.tone, 'bad');
  assert.equal(m.t, 384); // instant clé d'une série : le premier kill
  assert.ok(Math.abs(m.left - (384 / 540) * 100) < 1e-9);
  assert.ok(Math.abs(m.spanLeft - (364 / 540) * 100) < 1e-9);
  assert.ok(Math.abs(m.spanWidth - (38.5 / 540) * 100) < 1e-9);
  assert.equal(m.palette, 'a');
  const r = retakeMark(episode({ outcome: 'success', data: { push_t: 84.5, change_t: 87 } }), 540, null);
  assert.equal(r.t, 84.5);
  assert.equal(r.tone, 'good');
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
