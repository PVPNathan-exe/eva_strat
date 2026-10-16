import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  divergingPixels,
  duelShare,
  effectiveLayer,
  gate,
  heatNorm,
  isBlank,
  killsMinusDeaths,
  killsMinusDeathsTotal,
  LAYERS,
  outcomeRows,
  pairNorm,
  percentText,
  playerCells,
  playerDuels,
  playerGroups,
  shownRate,
  signedNorm,
  sumCells,
} from '../src/lib/teamView.ts';
import { globalUrl, teamSummaryUrl } from '../src/lib/statsTeamApi.ts';
import type { TeamCell, TeamPlayer } from '../src/types/statsTeam.ts';

const player = (key: string, side: 'left' | 'right', over: Partial<TeamPlayer> = {}): TeamPlayer => ({
  key,
  name: key.toUpperCase(),
  side,
  games: 1,
  seconds: 10,
  duels_won: 0,
  duels_lost: 0,
  duels_other: 0,
  cells: [],
  ...over,
});

test('gate : masqué sous le minimum, nombre de games manquantes', () => {
  assert.deepEqual(gate(3, 5), { ok: false, missing: 2 });
  assert.deepEqual(gate(5, 5), { ok: true, missing: 0 });
  assert.deepEqual(gate(0, 5), { ok: false, missing: 5 });
  assert.deepEqual(gate(7, 5), { ok: true, missing: 0 });
  assert.deepEqual(gate(NaN, 5), { ok: false, missing: 5 });
});

test('sumCells : cases additionnées, ordre ligne puis colonne, valeurs non finies ignorées', () => {
  const a: TeamCell[] = [[1, 0, 2], [0, 1, 1]];
  const b: TeamCell[] = [[1, 0, 3], [2, 0, NaN]];
  assert.deepEqual(sumCells([a, b]), [[1, 0, 5], [0, 1, 1]]);
  assert.deepEqual(sumCells([]), []);
});

test('heatNorm : proportionnel sous le 98e centile, grille vide reste vide', () => {
  // 50 cases de valeurs 1 à 50 : le 98e centile vaut 49, la case à 25 vaut 25/49, celles de 49 et 50 sont écrêtées à 1
  const cells: TeamCell[] = [];
  for (let i = 1; i <= 50; i++) cells.push([(i - 1) % 10, Math.floor((i - 1) / 10), i]);
  const norm = heatNorm(cells, 10, 0);
  assert.ok(Math.abs(norm[2 * 10 + 4] - 25 / 49) < 1e-6);
  assert.equal(norm[4 * 10 + 8], 1);
  assert.equal(norm[4 * 10 + 9], 1);
  assert.ok(isBlank(heatNorm([], 4, 1.5)));
});

test('heatNorm : une case isolée très chaude est écrêtée au 98e centile', () => {
  // 100 cases à 1 et une à 1000 : sur 101 cases occupées, le 98e centile vaut 1, donc la case chaude est écrêtée à 1
  const cells: TeamCell[] = [];
  for (let i = 0; i < 100; i++) cells.push([i % 10, Math.floor(i / 10), 1]);
  cells.push([5, 11, 1000]);
  const norm = heatNorm(cells, 12, 0);
  assert.equal(norm[11 * 12 + 5], 1);
  assert.equal(norm[0], 1);
});

test('pairNorm : même échelle pour les deux grilles', () => {
  const [a, b] = pairNorm([[0, 0, 10]], [[1, 1, 5]], 2, 0);
  assert.equal(a[0], 1);
  assert.equal(b[1 * 2 + 1], 0.5);
  const [za, zb] = pairNorm([], [], 2, 0);
  assert.ok(isBlank(za) && isBlank(zb));
});

test('signedNorm : signe conservé, écrêté à -1 et 1', () => {
  const norm = signedNorm(Float32Array.from([4, -2, 0, 1]), 1);
  assert.deepEqual(Array.from(norm), [1, -0.5, 0, 0.25]);
  assert.ok(isBlank(signedNorm(new Float32Array(4))));
});

test('killsMinusDeaths : positif où l\'on tue, négatif où l\'on meurt, masqué où il y a trop peu d\'événements', () => {
  const kills: TeamCell[] = [[0, 0, 10], [3, 3, 1]];
  const deaths: TeamCell[] = [[2, 0, 8], [3, 0, 1]];
  const diff = killsMinusDeaths(kills, deaths, 4, 0, 0.2);
  assert.ok(diff[0] > 0, 'case de kills');
  assert.ok(diff[0 * 4 + 2] < 0, 'case de morts');
  assert.equal(diff[3 * 4 + 3], 0, 'une seule case de kill, sous 20 % de l\'appui : masquée');
  assert.equal(diff[0 * 4 + 3], 0, 'une seule mort, masquée');
  assert.ok(Math.max(...diff) <= 1 && Math.min(...diff) >= -1);
});

test('killsMinusDeaths : sans événement, grille vide', () => {
  assert.ok(isBlank(killsMinusDeaths([], [], 4, 1.5)));
});

test('divergingPixels : vert au-dessus de zéro, rouge en dessous, transparent sur zéro', () => {
  const px = divergingPixels(Float32Array.from([1, -1, 0, 0]), 2, [255, 0, 0], [0, 255, 0]);
  assert.deepEqual(Array.from(px.slice(0, 3)), [0, 255, 0]);
  assert.deepEqual(Array.from(px.slice(4, 7)), [255, 0, 0]);
  assert.ok(px[3] > 0 && px[7] > 0);
  assert.equal(px[11], 0);
});

test('playerGroups : un groupe par pseudo, les deux côtés réunis', () => {
  const groups = playerGroups([player('zed', 'left', { games: 2, seconds: 30 }), player('abc', 'right'), player('zed', 'right', { games: 1, seconds: 15 })]);
  assert.deepEqual(groups.map((g) => g.key), ['abc', 'zed']);
  const zed = groups[1];
  assert.equal(zed.games, 3);
  assert.equal(zed.seconds, 45);
  assert.ok(zed.bySide.left && zed.bySide.right);
  assert.equal(groups[0].bySide.left, null);
});

test('playerCells et playerDuels : un côté ou les deux, pseudo inconnu vide', () => {
  const players = [
    player('zed', 'left', { cells: [[0, 0, 4]], duels_won: 2, duels_lost: 1, duels_other: 1 }),
    player('zed', 'right', { cells: [[0, 0, 1], [1, 0, 2]], duels_won: 1 }),
    player('abc', 'left', { cells: [[5, 5, 9]] }),
  ];
  assert.deepEqual(playerCells(players, 'zed', 'left'), [[0, 0, 4]]);
  assert.deepEqual(playerCells(players, 'zed', 'both'), [[0, 0, 5], [1, 0, 2]]);
  assert.deepEqual(playerCells(players, 'nul', 'both'), []);
  assert.deepEqual(playerDuels(players, 'zed'), { won: 3, lost: 1, other: 1 });
  assert.deepEqual(playerDuels(players, 'nul'), { won: 0, lost: 0, other: 0 });
});

test('duelShare, killsMinusDeathsTotal, shownRate : null reste null', () => {
  assert.equal(duelShare({ won: 3, lost: 1, other: 4 }), 0.75);
  assert.equal(duelShare({ won: 0, lost: 0, other: 2 }), null);
  assert.equal(killsMinusDeathsTotal(10, 7), 3);
  assert.equal(killsMinusDeathsTotal(null, 7), null);
  assert.equal(killsMinusDeathsTotal(10, null), null);
  assert.equal(shownRate({ decided: 4, rate: 0.5 }), null);
  assert.equal(shownRate({ decided: 5, rate: 0.4 }), 0.4);
  assert.equal(shownRate({ decided: 9, rate: null }), null);
});

test('outcomeRows : ordre des issues connues, inconnues ensuite, zéros omis', () => {
  const rows = outcomeRows({ waves: 10, counts: { fail: 4, success: 3, zzz: 1, unknown: 2, duel: 0 } });
  assert.deepEqual(rows.map((r) => r.key), ['success', 'fail', 'unknown', 'zzz']);
  assert.equal(rows[0].label, 'Retake réussi');
  assert.equal(rows[0].share, 0.3);
  assert.equal(rows[2].label, 'Issue non lue');
  assert.equal(outcomeRows({ waves: 0, counts: {} }).length, 0);
});

test('percentText : entier, tiret court si absent', () => {
  assert.equal(percentText(0.425), '43 %');
  assert.equal(percentText(null), '-');
  assert.equal(percentText(NaN), '-');
});

test('effectiveLayer : avec un joueur, les calques équipe seule retombent sur la présence', () => {
  assert.equal(effectiveLayer('kd', false), 'kd');
  assert.equal(effectiveLayer('kd', true), 'presence_left');
  assert.equal(effectiveLayer('presence_right', true), 'presence_right');
  assert.equal(LAYERS.filter((l) => !l.teamOnly).length, 2);
});

test('adresses des appels : paramètres encodés, valeurs par défaut omises', () => {
  assert.equal(teamSummaryUrl({ map: 'Reef Point', team: 'NCT', games: [3, 4], side: 'left', n: 64 }), '/api/stats/team-summary?map=Reef+Point&team=NCT&games=3%2C4&side=left&n=64');
  assert.equal(teamSummaryUrl({ map: 'Polaris', team: 'Équipe', side: 'both' }), '/api/stats/team-summary?map=Polaris&team=%C3%89quipe');
  assert.equal(globalUrl({ map: 'Polaris', games: [1], n: 32 }), '/api/stats/global?map=Polaris&games=1&n=32');
  assert.equal(globalUrl({ map: 'Polaris', games: [] }), '/api/stats/global?map=Polaris');
});
