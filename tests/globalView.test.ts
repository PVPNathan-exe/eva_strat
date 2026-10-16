import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bestStrategy,
  globalLayerDef,
  globalLayers,
  GLOBAL_LAYERS,
  layerCells,
  rawLayer,
  sideTotals,
  sidesOf,
  sizeRows,
  speedRows,
  strategyAnswer,
  type StrategyRow,
} from '../src/lib/globalView.ts';
import { percentText } from '../src/lib/teamView.ts';
import type { GlobalSide, GlobalSummary, TeamCell, TeamWaveTally } from '../src/types/statsTeam.ts';

const side = (over: Partial<GlobalSide> = {}): GlobalSide => ({
  stats: { games_with_stats: 1, kills: 10, deaths: 7, gadget_uses: null, gadget_unused_at_death: null, gadget_possible: null },
  duels: { won: 3, lost: 1, other: 2 },
  death_grid: [],
  kill_grid: [],
  presence: [],
  duel_won_grid: [],
  duel_lost_grid: [],
  ...over,
});

const tally = (waves: number, decided: number, success: number): TeamWaveTally => ({
  waves,
  decided,
  counts: { success },
  rate: decided > 0 ? success / decided : null,
});

const summary = (left: GlobalSide, right: GlobalSide, n = 8): GlobalSummary => ({
  map: 'Polaris',
  n,
  games: 6,
  game_ids: [1, 2, 3, 4, 5, 6],
  min: 5,
  left,
  right,
  outcomes: { ...tally(0, 0, 0), by_speed: {}, by_size: {} },
});

test('sidesOf : un côté ou les deux', () => {
  assert.deepEqual(sidesOf('both'), ['left', 'right']);
  assert.deepEqual(sidesOf('right'), ['right']);
});

test('globalLayerDef : calque connu, repli sur le premier', () => {
  assert.equal(globalLayerDef('duels').label, 'Duels gagnés moins perdus');
  assert.equal(globalLayerDef('inconnu' as never).id, GLOBAL_LAYERS[0].id);
});

test('layerCells : plus et minus selon le calque', () => {
  const s = side({ kill_grid: [[1, 1, 2]], death_grid: [[2, 2, 3]], presence: [[0, 0, 9]], duel_won_grid: [[3, 3, 1]], duel_lost_grid: [[4, 4, 1]] });
  assert.deepEqual(layerCells(s, 'strong'), { plus: s.kill_grid, minus: s.death_grid });
  assert.deepEqual(layerCells(s, 'presence'), { plus: s.presence, minus: null });
  assert.deepEqual(layerCells(s, 'deaths'), { plus: s.death_grid, minus: null });
  assert.deepEqual(layerCells(s, 'duels'), { plus: s.duel_won_grid, minus: s.duel_lost_grid });
});

test('rawLayer : seule la part positive de la différence, cases peu fréquentées masquées', () => {
  const n = 6;
  // case (1,1) : 10 kills contre 2 morts (fort) ; case (3,3) : 2 kills contre 10 morts (faible) ; case (5,5) : 1 kill, 0 mort (appui trop faible devant 12)
  const kills: TeamCell[] = [[1, 1, 10], [3, 3, 2], [5, 5, 1]];
  const deaths: TeamCell[] = [[1, 1, 2], [3, 3, 10]];
  const raw = rawLayer(kills, deaths, n, 0, 0.2);
  assert.equal(raw[1 * n + 1], 8);
  assert.equal(raw[3 * n + 3], 0, 'la case faible n\'est pas dessinée');
  assert.equal(raw[5 * n + 5], 0, 'appui sous le plancher : masquée');
  assert.ok(raw.every((v) => v >= 0));
});

test('rawLayer : sans minus, chaleur simple', () => {
  const raw = rawLayer([[2, 1, 5]], null, 4, 0);
  assert.equal(raw[1 * 4 + 2], 5);
  assert.equal(raw[0], 0);
});

test('globalLayers : même échelle pour les deux côtés, côté vide marqué vide', () => {
  const n = 4;
  // présence : gauche 10 s dans une case, droite 5 s dans une case : même échelle, la droite vaut la moitié
  const data = summary(side({ presence: [[0, 0, 10]] }), side({ presence: [[1, 1, 5]] }), n);
  const [l, r] = globalLayers(data, 'presence', 'both', 0);
  assert.equal(l.side, 'left');
  assert.equal(r.side, 'right');
  assert.equal(l.norm[0], 1);
  assert.equal(r.norm[1 * n + 1], 0.5);
  assert.equal(l.blank, false);

  const only = globalLayers(data, 'presence', 'right', 0);
  assert.equal(only.length, 1);
  assert.equal(only[0].norm[1 * n + 1], 1, 'seul : à sa propre échelle');

  const empty = globalLayers(summary(side(), side(), n), 'deaths', 'both', 0);
  assert.ok(empty.every((x) => x.blank));
});

test('globalLayers : positions fortes, un côté sans case forte reste vide', () => {
  const n = 6;
  const left = side({ kill_grid: [[2, 2, 10]], death_grid: [[2, 2, 1]] });
  const right = side({ kill_grid: [[4, 4, 1]], death_grid: [[4, 4, 9]] });
  const [l, r] = globalLayers(summary(left, right, n), 'strong', 'both', 0);
  assert.equal(l.blank, false);
  assert.equal(r.blank, true);
});

test('sideTotals : null reste null, parts de duels', () => {
  const t = sideTotals(side());
  assert.equal(t.diff, 3);
  assert.equal(t.duelShare, 0.75);
  const none = sideTotals(side({ stats: { games_with_stats: 0, kills: null, deaths: null, gadget_uses: null, gadget_unused_at_death: null, gadget_possible: null }, duels: { won: 0, lost: 0, other: 1 } }));
  assert.equal(none.kills, null);
  assert.equal(none.diff, null);
  assert.equal(none.duelShare, null);
});

test('speedRows : rapide puis progressif puis autres, taux masqué sous 5 décidées, groupes vides omis', () => {
  const rows = speedRows({ none: tally(2, 0, 0), progressif: tally(12, 8, 4), rapide: tally(20, 4, 3), vide: tally(0, 0, 0) });
  assert.deepEqual(rows.map((r) => r.key), ['rapide', 'progressif', 'none']);
  assert.equal(rows[0].rate, null, '4 décidées : masqué');
  assert.equal(rows[1].rate, 0.5);
  assert.equal(rows[1].success, 4);
  assert.match(rows[2].label, /non mesurée/);
});

test('sizeRows : tailles croissantes (ordre numérique), taille non lue en dernier', () => {
  const rows = sizeRows({ unknown: tally(1, 0, 0), '10': tally(5, 5, 1), '2': tally(6, 6, 3), '4': tally(7, 6, 2) });
  assert.deepEqual(rows.map((r) => r.key), ['2', '4', '10', 'unknown']);
  assert.equal(rows[0].label, '2 joueurs');
  assert.equal(rows[3].label, 'Taille non lue');
});

test('bestStrategy : meilleur taux affiché, égalité listée, moins de 2 comparables : null', () => {
  const row = (key: string, rate: number | null): StrategyRow => ({ key, label: key, waves: 10, decided: 10, success: 5, rate });
  assert.equal(bestStrategy([row('a', 0.5)]), null);
  assert.equal(bestStrategy([row('a', 0.5), row('b', null)]), null);
  const b = bestStrategy([row('a', 0.4), row('b', 0.6), row('c', 0.6), row('d', null)]);
  assert.deepEqual(b?.best.map((r) => r.key), ['b', 'c']);
  assert.equal(b?.comparable, 3);
});

test('strategyAnswer : conclut seulement quand on peut comparer', () => {
  const row = (key: string, rate: number | null): StrategyRow => ({ key, label: `Groupe ${key}`, waves: 10, decided: 10, success: 5, rate });
  assert.match(strategyAnswer('Par vitesse', [row('a', null), row('b', 0.4)], percentText), /pas assez de vagues décidées/);
  const text = strategyAnswer('Par vitesse', [row('a', 0.3), row('b', 0.6)], percentText);
  assert.match(text, /60 %/);
  assert.match(text, /Groupe b/);
  assert.doesNotMatch(text, /égalité/);
});
