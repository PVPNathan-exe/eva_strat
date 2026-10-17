import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assistSourceText, componentValueText, coverageText, fmtRating, groupCoverage, groupLines, meanRatingCell, ratingCell } from '../src/lib/ratingFormat.ts';
import { meanRatings, totalPlayerGames, totalTeamGames } from '../src/lib/summaryFormat.ts';
import { playerGameColumns, playerSummaryColumns } from '../src/components/stats/global-stats/playerColumns.ts';
import { teamGameColumns, teamSummaryColumns } from '../src/components/stats/global-stats/teamColumns.ts';
import type { RatingDetail, RatingGroupDetail } from '../src/types/stats.ts';
import type { PlayerGameRow, PlayerSummaryRow, TeamGameRow, TeamSummaryRow } from '../src/types/statsSummary.ts';

const group: RatingGroupDetail = {
  note: 11.5,
  reason: null,
  components: {
    share_kills: { label: "Part des kills de l'équipe", weight: 2, down: false, raw: 0.4, note: 14 },
    share_deaths: { label: "Part des morts de l'équipe", weight: 2, down: true, raw: 0.25, note: 10 },
    gadget: { label: 'Secondaires utilisés sur possibles', weight: 1, down: false, raw: null, note: null, reason: 'secondaire non établi (délai ou lecture manquants)' },
  },
};

test("fmtRating : une décimale, virgule française, « n/d » quand la note n'est pas établie (jamais 0)", () => {
  assert.equal(fmtRating(12), '12,0');
  assert.equal(fmtRating(9.04), '9,0');
  assert.equal(fmtRating(0), '0,0'); // une vraie note de 0 s'écrit 0,0
  assert.equal(fmtRating(null), 'n/d');
  assert.equal(fmtRating(undefined), 'n/d');
});

test("ratingCell : texte, raison de l'absence en infobulle", () => {
  assert.equal(ratingCell(13.26).text, '13,3');
  assert.match(ratingCell(13.26).title ?? '', /sur 20/);
  const none = ratingCell(null, 'composantes disponibles : 30 % du poids (minimum 50 %)');
  assert.equal(none.text, 'n/d');
  assert.match(none.title ?? '', /30 %/);
});

test("componentValueText : l'unité de chaque composante", () => {
  assert.equal(componentValueText('kills_per_min', 1.4222), '1,42 par min');
  assert.equal(componentValueText('share_kills', 0.2667), '27 %');
  assert.equal(componentValueText('aggro', 3.6), '3,6 s par min');
  assert.equal(componentValueText('cohesion', 4.45), '4,5 m');
  assert.equal(componentValueText('space', 0.4), "0,4 de l'axe");
  assert.equal(componentValueText('gadget', null), 'n/d');
});

test("groupLines : valeur, note, poids, et la raison d'une composante sans note", () => {
  const lines = groupLines(group);
  assert.deepEqual(
    lines.map((l) => [l.key, l.value, l.note, l.weight, l.reason]),
    [
      ['share_kills', '40 %', '14,0', 2, null],
      ['share_deaths', '25 %', '10,0', 2, null],
      ['gadget', 'n/d', 'n/d', 1, 'secondaire non établi (délai ou lecture manquants)'],
    ],
  );
  assert.equal(lines[1].down, true);
  assert.deepEqual(groupLines(null), []);
});

test('groupCoverage : part du poids qui a une note', () => {
  assert.equal(groupCoverage(group), 4 / 5);
  assert.equal(groupCoverage(null), null);
  const detail = { individual: group, teamplay: group } as unknown as RatingDetail;
  assert.match(coverageText(detail), /individuelle : 80 %.*teamplay : 80 %/);
});

test('assistSourceText : tableau de fin de game ou repli', () => {
  assert.match(assistSourceText('tableau'), /tableau de fin de game/);
  assert.match(assistSourceText('repli'), /3 m/);
  assert.match(assistSourceText(null), /inconnue/);
});

test('meanRatingCell : la moyenne dit sur combien de games elle porte, n/d sans game notée', () => {
  const c = meanRatingCell(11.5, 2, 3);
  assert.equal(c.text, '11,5');
  assert.match(c.title ?? '', /2 games notées sur 3/);
  assert.equal(meanRatingCell(null, 0, 3).text, 'n/d');
  assert.equal(meanRatingCell(10, 0, 3).text, 'n/d'); // aucune game notée : jamais une moyenne
  assert.match(meanRatingCell(10, 1, 4).title ?? '', /1 game notée sur 4/);
});

test('meanRatings : une moyenne par note sur les games où elle existe, null sinon', () => {
  const m = meanRatings([{ individual: 12, teamplay: 14, overall: 13 }, { individual: 8, teamplay: null, overall: null }, null]);
  assert.deepEqual(m, { individual: 10, teamplay: 14, overall: 13, games_rated: 1 });
  assert.deepEqual(meanRatings([]), { individual: null, teamplay: null, overall: null, games_rated: 0 });
});

const pg = (over: Partial<PlayerGameRow> = {}): PlayerGameRow => ({
  game_id: 1, map: 'Polaris', start_s: 10, team: 'NCT', opponent: 'SNV', side: 'A', slot: 1, kills: 5, deaths: 2, kd: 2.5, alive_s: 100, v_mean: 2, v_p98: 4,
  gadget_uses: 3, gadget_unused_at_death: 1, gadget_possible: 4, duels_won: 3, duels_lost: 1, duels_other: 0, score_sum: 2,
  rating: { individual: 12, teamplay: 14, overall: 13, assists: 2, assist_source: 'repli' }, has_stats: true, ...over,
});

test("total d'un joueur : moyenne des notes des games notées, avec leur nombre, assistances en somme stricte", () => {
  const total = totalPlayerGames([pg(), pg({ game_id: 2, rating: { individual: 8, teamplay: null, overall: null, assists: 1, assist_source: 'tableau' } }), pg({ game_id: 3, rating: null })]);
  assert.equal(total.rating?.individual, 10);
  assert.equal(total.rating?.teamplay, 14);
  assert.equal(total.rating?.overall, 13);
  assert.equal(total.rating?.games_rated, 1);
  assert.equal(total.rating?.assists, null); // une game sans note : pas de somme partielle
  const cols = playerGameColumns();
  const cell = (id: string, row: PlayerGameRow) => cols.find((c) => c.id === id)!.cell(row);
  assert.equal(cell('rating_overall', pg()).text, '13,0');
  assert.equal(cell('rating_teamplay', pg({ rating: { individual: 8, teamplay: null, overall: null, assists: null, assist_source: null } })).text, 'n/d');
  assert.equal(cell('rating_overall', pg({ rating: null })).text, 'n/d');
  assert.match(cell('rating_overall', total).title ?? '', /Moyenne de 1 game notée/);
});

test("total d'une équipe : moyenne des notes d'équipe des games où les quatre joueurs sont notés", () => {
  const tg = (rating: TeamGameRow['rating']): TeamGameRow => ({
    game_id: 1, map: 'Polaris', start_s: 10, side: 'A', opponent: 'SNV', winner: null, final_capture: null, kills: 10, deaths: 8, kd: 1.25,
    duels_won: 4, duels_lost: 2, duels_other: 1, gadget_uses: 6, gadget_possible: 8, point_changes: 4, rating, has_stats: true,
  });
  const total = totalTeamGames([tg({ individual: 10, teamplay: 12, overall: 11 }), tg({ individual: null, teamplay: null, overall: null })]);
  assert.deepEqual(total.rating, { individual: 10, teamplay: 12, overall: 11, games_rated: 1 });
  assert.equal(teamGameColumns().find((c) => c.id === 'rating_overall')!.cell(tg({ individual: 10, teamplay: 12, overall: 11 })).text, '11,0');
});

test('colonnes globales : notes moyennes, games notées, n/d sans game notée', () => {
  const mean = (over: object) => ({ individual: 11, teamplay: 12, overall: 11.5, games_rated: 2, individual_games: 3, teamplay_games: 2, ...over });
  const row = (over: Partial<PlayerSummaryRow>): PlayerSummaryRow => ({
    key: 'a', name: 'Alexo', team: 'NCT', games: 3, games_with_stats: 3, maps: ['Polaris'], kills: 10, deaths: 5, kd: 2, alive_s: 600, v_mean: 2.1, v_p98_median: 4.5,
    gadget_uses: 2, gadget_unused_at_death: null, gadget_possible: null, duels_won: 4, duels_lost: 4, duels_other: 1, kill_score_sum: 3, death_score_sum: -1, score_sum: 2, rating: mean({}), ...over,
  });
  const cols = playerSummaryColumns(5);
  const cell = (id: string, r: PlayerSummaryRow) => cols.find((c) => c.id === id)!.cell(r);
  assert.equal(cell('rating_overall', row({})).text, '11,5');
  assert.match(cell('rating_overall', row({})).title ?? '', /2 games notées sur 3/);
  assert.equal(cell('rating_individual', row({})).text, '11,0');
  assert.match(cell('rating_individual', row({})).title ?? '', /3 games notées sur 3/);
  assert.equal(cell('rating_games', row({})).text, '2 sur 3');
  const none = row({ rating: mean({ overall: null, games_rated: 0 }) });
  assert.equal(cell('rating_overall', none).text, 'n/d');
  assert.equal(cols.find((c) => c.id === 'rating_overall')!.value(none), null);
  const teamRow: TeamSummaryRow = {
    key: 'x', name: 'SNV', games: 2, games_with_stats: 2, maps: ['Polaris'], kills: 20, deaths: 18, kd: 1.1, duels_won: 1, duels_lost: 1, duels_other: 0, gadget_uses: 5, gadget_unused_at_death: null,
    gadget_possible: null, point_changes: 4, final_capture_avg: null, rating: mean({ games_rated: 1 }),
  };
  assert.equal(teamSummaryColumns(5).find((c) => c.id === 'rating_games')!.cell(teamRow).text, '1 sur 2');
});
