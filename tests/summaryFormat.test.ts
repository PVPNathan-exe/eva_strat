import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureAverage,
  captureCell,
  duelShare,
  duelShareCell,
  emptyStatsNotice,
  gamesCell,
  kdSort,
  mapsCell,
  median,
  nextSort,
  palOfTeam,
  partialStatsNotice,
  sortRows,
  sumStrict,
  totalPlayerGames,
  totalTeamGames,
  weightedMean,
} from '../src/lib/summaryFormat.ts';
import { playerGameColumns, playerSummaryColumns } from '../src/components/stats/global-stats/playerColumns.ts';
import { sortByColumn } from '../src/components/stats/global-stats/columns.ts';
import type { PlayerGameRow, PlayerSummaryRow, TeamGameRow } from '../src/types/statsSummary.ts';

const pg = (over: Partial<PlayerGameRow> = {}): PlayerGameRow => ({
  game_id: 1, map: 'Polaris', start_s: 10, team: 'NCT', opponent: 'SNV', side: 'A', slot: 1, kills: 5, deaths: 2, kd: 2.5, alive_s: 100, v_mean: 2, v_p98: 4,
  gadget_uses: 3, gadget_unused_at_death: 1, gadget_possible: 4, duels_won: 3, duels_lost: 1, duels_other: 0, score_sum: 2, rating: { individual: 12, teamplay: 14, overall: 13, assists: 2, assist_source: 'repli' }, has_stats: true, ...over,
});

const tg = (over: Partial<TeamGameRow> = {}): TeamGameRow => ({
  game_id: 1, map: 'Polaris', start_s: 10, side: 'A', opponent: 'SNV', winner: null, final_capture: { own: 99, opponent: 27 }, kills: 10, deaths: 8, kd: 1.25,
  duels_won: 4, duels_lost: 2, duels_other: 1, gadget_uses: 6, gadget_possible: 8, point_changes: 4, rating: { individual: 10, teamplay: 12, overall: 11 }, has_stats: true, ...over,
});

test('sortRows : valeurs absentes toujours en bas, égalités dans l\'ordre d\'origine', () => {
  const rows = [{ n: 'a', v: 3 }, { n: 'b', v: null }, { n: 'c', v: 7 }, { n: 'd', v: 3 }];
  assert.deepEqual(sortRows(rows, (r) => r.v, 'desc').map((r) => r.n), ['c', 'a', 'd', 'b']);
  assert.deepEqual(sortRows(rows, (r) => r.v, 'asc').map((r) => r.n), ['a', 'd', 'c', 'b']);
  assert.equal(rows[0].n, 'a'); // la liste d'origine n'est pas modifiée
});

test('sortRows : textes selon l\'alphabet français, nombres dans les noms', () => {
  const rows = ['Zed', 'élan', 'Alexo', 'p10', 'p9'];
  assert.deepEqual(sortRows(rows, (r) => r, 'asc'), ['Alexo', 'élan', 'p9', 'p10', 'Zed']);
});

test('nextSort : nombre décroissant d\'abord, texte croissant, second clic inverse', () => {
  assert.deepEqual(nextSort({ col: 'kills', dir: 'desc' }, 'deaths', true), { col: 'deaths', dir: 'desc' });
  assert.deepEqual(nextSort({ col: 'kills', dir: 'desc' }, 'name', false), { col: 'name', dir: 'asc' });
  assert.deepEqual(nextSort({ col: 'kills', dir: 'desc' }, 'kills', true), { col: 'kills', dir: 'asc' });
  assert.deepEqual(nextSort({ col: 'kills', dir: 'asc' }, 'kills', true), { col: 'kills', dir: 'desc' });
});

test('gamesCell : le nombre de games derrière les chiffres, « sur » quand certaines n\'ont pas de bilan', () => {
  assert.equal(gamesCell(10, 10).text, '10');
  assert.equal(gamesCell(8, 10).text, '8 sur 10');
  assert.equal(mapsCell([]).text, 'n/d');
  assert.equal(mapsCell(['Polaris', 'Atlantis']).text, 'Polaris, Atlantis');
  assert.equal(mapsCell(['A', 'B', 'C']).text, '3 cartes');
  assert.equal(mapsCell(['A', 'B', 'C']).title, 'A, B, C');
});

test('duelShare : gagnés sur décidés, null sans duel décidé ni chiffre', () => {
  assert.equal(duelShare(3, 1), 0.75);
  assert.equal(duelShare(0, 0), null);
  assert.equal(duelShare(null, 2), null);
  assert.equal(duelShare(0, 4), 0);
});

test('duelShareCell : n/d sans duel, masquée sous le minimum de games, sinon pourcentage', () => {
  assert.equal(duelShareCell(0, 0, 9, 5).text, 'n/d');
  assert.equal(duelShareCell(3, 1, 4, 5).text, 'sous 5 games');
  assert.equal(duelShareCell(3, 1, 5, 5).text, '75 %');
  assert.equal(duelShareCell(1, 2, 1, 0).text, '33 %'); // une game de détail : pas de minimum
});

test('kdSort : sans mort passe devant, absent sans chiffre', () => {
  assert.equal(kdSort(6, 3), 2);
  assert.ok((kdSort(1, 0) as number) > (kdSort(30, 1) as number));
  assert.equal(kdSort(null, 3), null);
});

test('sumStrict : jamais de somme partielle', () => {
  assert.equal(sumStrict([1, 2, 3]), 6);
  assert.equal(sumStrict([1, null, 3]), null);
  assert.equal(sumStrict([]), null);
  assert.equal(sumStrict([0, 0]), 0);
});

test('weightedMean et median', () => {
  assert.equal(weightedMean([2, 4], [100, 300]), 3.5);
  assert.equal(weightedMean([2, null], [100, 300]), 2); // paire incomplète ignorée
  assert.equal(weightedMean([null], [10]), null);
  assert.equal(median([4, 1, null, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([null]), null);
});

test('totalPlayerGames : somme des games avec bilan, « possible » non établi dès qu\'une game ne l\'établit pas', () => {
  const rows = [pg(), pg({ game_id: 2, kills: 1, deaths: 4, alive_s: 300, v_mean: 4, v_p98: 6 }), pg({ game_id: 3, has_stats: false, kills: null, deaths: null })];
  const t = totalPlayerGames(rows);
  assert.equal(t.kills, 6);
  assert.equal(t.deaths, 6);
  assert.equal(t.alive_s, 400);
  assert.equal(t.v_mean, 3.5); // pondérée par le temps vivant
  assert.equal(t.v_p98, 5); // médiane des games
  assert.equal(t.gadget_possible, 8);
  assert.equal(t.has_stats, true);
  const partial = totalPlayerGames([pg(), pg({ game_id: 2, gadget_possible: null })]);
  assert.equal(partial.gadget_possible, null);
  assert.equal(partial.gadget_uses, 6); // les utilisés restent comptés
  assert.equal(totalPlayerGames([pg({ has_stats: false })]).has_stats, false);
});

test('totalTeamGames et captureAverage : moyenne sur les games où la capture est lue', () => {
  const rows = [tg(), tg({ game_id: 2, final_capture: { own: 51, opponent: 99 } }), tg({ game_id: 3, final_capture: null })];
  const t = totalTeamGames(rows);
  assert.equal(t.kills, 30);
  assert.equal(t.point_changes, 12);
  assert.deepEqual(t.final_capture, { own: 75, opponent: 63 });
  assert.equal(captureAverage([tg({ final_capture: null })]), null);
  assert.equal(t.winner, null);
});

test('captureCell : jamais une victoire, n/d quand non lue', () => {
  assert.equal(captureCell({ own: 99.4, opponent: 26.6 }).text, '99 % contre 27 %');
  assert.equal(captureCell(null).text, 'n/d');
  assert.match(captureCell({ own: 50, opponent: 40 }).title ?? '', /pas un résultat de match/);
});

test('palOfTeam : suivie en a, autres en b, rien sans équipe suivie', () => {
  assert.equal(palOfTeam('Team Éclair', 'team eclair'), 'a');
  assert.equal(palOfTeam('SNV', 'team eclair'), 'b');
  assert.equal(palOfTeam('SNV', null), null);
  assert.equal(palOfTeam(null, 'team eclair'), null);
});

test('messages : base sans statistiques et games sans bilan', () => {
  assert.match(emptyStatsNotice([], 'joueur', null) ?? '', /npm run stats -- --all/);
  assert.match(emptyStatsNotice([{ games_with_stats: 0 }], 'équipe', 'Polaris') ?? '', /Polaris/);
  assert.equal(emptyStatsNotice([{ games_with_stats: 0 }, { games_with_stats: 2 }], 'joueur', null), null);
  assert.equal(partialStatsNotice([{ has_stats: true }]), null);
  assert.match(partialStatsNotice([{ has_stats: true }, { has_stats: false }]) ?? '', /1 game sans bilan/);
});

test('colonnes joueurs : non établi pour un secondaire sans délai, n/d sans bilan, tri par kills', () => {
  const sumRow = (over: Partial<PlayerSummaryRow>): PlayerSummaryRow => ({
    key: 'a', name: 'Alexo', team: 'NCT', games: 3, games_with_stats: 3, maps: ['Polaris'], kills: 10, deaths: 5, kd: 2, alive_s: 600, v_mean: 2.1, v_p98_median: 4.5,
    gadget_uses: 2, gadget_unused_at_death: null, gadget_possible: null, duels_won: 4, duels_lost: 4, duels_other: 1, kill_score_sum: 3, death_score_sum: -1, score_sum: 2,
    rating: { individual: 11, teamplay: 12, overall: 11.5, games_rated: 3, individual_games: 3, teamplay_games: 3 }, ...over,
  });
  const cols = playerSummaryColumns(5);
  const cell = (id: string, row: PlayerSummaryRow) => cols.find((c) => c.id === id)!.cell(row);
  const row = sumRow({});
  assert.equal(cell('gadget', row).text, 'non établi');
  assert.equal(cell('unused', row).text, 'non établi');
  assert.equal(cell('duel_share', row).text, 'sous 5 games');
  assert.equal(cell('score', row).text, '+2');
  assert.equal(cell('games', row).text, '3');
  const none = sumRow({ key: 'b', name: 'Bob', games_with_stats: 0, kills: null, deaths: null, score_sum: null });
  assert.equal(cell('kills', none).text, 'n/d');
  assert.equal(cell('gadget', none).text, 'n/d');
  const sorted = sortByColumn([none, row, sumRow({ key: 'c', name: 'Cid', kills: 12 })], cols, { col: 'kills', dir: 'desc' });
  assert.deepEqual(sorted.map((r) => r.key), ['c', 'a', 'b']);
  assert.equal(playerGameColumns().find((c) => c.id === 'side')!.cell(pg({ side: 'B', slot: 6 })).text, 'droite, n° 7');
});
