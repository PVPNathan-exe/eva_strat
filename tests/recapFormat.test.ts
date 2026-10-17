import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assistsCell,
  captureScoreOf,
  fmtCount,
  fmtDecimal,
  fmtSpeed,
  gadgetCell,
  impactTone,
  keepKillRows,
  killRows,
  killSeek,
  killSentence,
  killsOnDeaths,
  notesMissingNotice,
  officialTitle,
  opposite,
  orderPlayers,
  playerName,
  pointChangesLabel,
  reasonsText,
  scoreSumCell,
  signed,
  speedMaxTitle,
  statsMissingNotice,
  unusedCell,
} from '../src/lib/recapFormat.ts';
import type { GameSummary, RecapNote, RecapPlayer } from '../src/types/statsRecap.ts';

const note = (t: number, other: number | null, impact: number, reasons: string[] | null = ['premier kill']): RecapNote => ({ t, other_slot: other, impact, reasons });

/** Joueur de test : slot 1 (équipe A) ou 6 (équipe B), avec ses notes. */
function player(slot: number, over: Partial<RecapPlayer> = {}): RecapPlayer {
  return {
    game_id: 7,
    slot,
    team: slot <= 4 ? 'A' : 'B',
    name: `J${slot}`,
    has_stats: true,
    kills: 0,
    deaths: 0,
    kill_score_sum: 0,
    death_score_sum: 0,
    score_sum: 0,
    rating: null,
    kill_notes: [],
    death_notes: [],
    scoreboard: null,
    ...over,
  };
}

function summary(players: RecapPlayer[]): GameSummary {
  const zero = { kills: 0, deaths: 0, gadget_uses: null, gadget_unused_at_death: null, gadget_possible: null, duels_won: 0, duels_lost: 0, duels_other: 0, kill_score_sum: 0, death_score_sum: 0, rating: { individual: null, teamplay: null, overall: null } };
  return { game: { id: 7, map: 'Polaris', team_a: 'SNV', team_b: 'NCT', start_s: 100, end_s: 400, duration_s: 300 }, map: 'Polaris', point_changes: 0, players, teams: { A: zero, B: zero }, games: 1, min: 5 };
}

test('fmtDecimal : virgule, sans zéro inutile, sans -0', () => {
  assert.equal(fmtDecimal(3), '3');
  assert.equal(fmtDecimal(3.25, 1), '3,3');
  assert.equal(fmtDecimal(12.04, 1), '12');
  assert.equal(fmtDecimal(-0.02, 1), '0');
});

test('signed : plus, moins et zéro', () => {
  assert.equal(signed(2), '+2');
  assert.equal(signed(-1), '-1');
  assert.equal(signed(0), '0');
  assert.equal(signed(-0.01), '0');
  assert.equal(signed(1.5), '+1,5');
  assert.equal(opposite(0), 0);
  assert.equal(Object.is(opposite(0), -0), false);
  assert.equal(opposite(3), -3);
});

test('impactTone : bon, mauvais, neutre', () => {
  assert.deepEqual([impactTone(1), impactTone(-2), impactTone(0)], ['good', 'bad', 'neutral']);
});

test('vitesses : n/d sans valeur, infobulle avec le maximum brut et la mention d\'erreurs de lecture', () => {
  assert.equal(fmtSpeed(null), 'n/d');
  assert.equal(fmtSpeed(undefined), 'n/d');
  assert.equal(fmtSpeed(4.26), '4,3');
  const title = speedMaxTitle({ v_p98: 6.1, v_max: 31.4 });
  assert.match(title, /31,4 m\/s/);
  assert.match(title, /peut contenir des erreurs de lecture/);
  assert.match(speedMaxTitle({ v_p98: null, v_max: null }), /non disponible/);
});

test('gadgetCell : possible null donne « non établi », jamais 0', () => {
  assert.equal(gadgetCell(2, null).text, 'non établi');
  assert.match(gadgetCell(2, null).title ?? '', /2 secondaires utilisés/);
  assert.equal(gadgetCell(null, null).text, 'non établi');
  assert.equal(gadgetCell(undefined, undefined).text, 'n/d');
  assert.equal(gadgetCell(2, 4).text, '2 sur 4');
  assert.equal(gadgetCell(0, 3.5).text, '0 sur 3,5');
  assert.equal(gadgetCell(0, 0).text, '0 sur 0'); // un possible établi à 0 reste une valeur
});

test('unusedCell : null non établi, absent n/d, nombre brut', () => {
  assert.equal(unusedCell(null).text, 'non établi');
  assert.equal(unusedCell(undefined).text, 'n/d');
  assert.equal(unusedCell(0).text, '0');
  assert.equal(unusedCell(3).text, '3');
});

test('killsOnDeaths : rapport, sans mort, absent', () => {
  assert.equal(killsOnDeaths(6, 4).text, '1,5');
  assert.equal(killsOnDeaths(3, 0).text, 'sans mort');
  assert.equal(killsOnDeaths(0, 0).text, '0');
  assert.equal(killsOnDeaths(undefined, undefined).text, 'n/d');
  assert.equal(killsOnDeaths(2, 1).title, '2 kills pour 1 mort');
  assert.equal(fmtCount(undefined), 'n/d');
  assert.equal(fmtCount(0), '0');
});

test('scoreSumCell : n/d sans note, somme signée avec le détail', () => {
  assert.equal(scoreSumCell(player(1)).text, 'n/d');
  const p = player(1, { kill_notes: [note(10, 6, 3)], death_notes: [note(50, 7, -1)], kill_score_sum: 3, death_score_sum: -1, score_sum: 2 });
  assert.equal(scoreSumCell(p).text, '+2');
  assert.match(scoreSumCell(p).title ?? '', /Notes des kills : \+3 \(1\)/);
});

test('playerName : numéro de jeu (1 à 4, 6 à 9) et pseudo', () => {
  assert.equal(playerName(1, 'Ana'), 'n° 1 (Ana)');
  assert.equal(playerName(5, null), 'n° 6');
  assert.equal(playerName(8, 'Zed'), 'n° 9 (Zed)');
});

test('orderPlayers : équipe demandée d\'abord, puis numéro, avec filtre', () => {
  const all = [player(6), player(2), player(1), player(5)];
  assert.deepEqual(orderPlayers(all, 'A').map((p) => p.slot), [1, 2, 5, 6]);
  assert.deepEqual(orderPlayers(all, 'B').map((p) => p.slot), [5, 6, 1, 2]);
  assert.deepEqual(orderPlayers(all, 'B', (s) => s >= 5).map((p) => p.slot), [5, 6]);
});

test('killRows : un kill par note de tueur, mort sans tueur ajoutée, pas de doublon, trié par temps', () => {
  // Le joueur 1 tue le 6 à 20 s (+3) ; le 6 a la note de mort opposée ; le 5 meurt à 10 s sans tueur lu (note de mort -1).
  const p1 = player(1, { kill_notes: [note(20, 6, 3)] });
  const p6 = player(6, { death_notes: [note(20, 1, -3)] });
  const p5 = player(5, { death_notes: [note(10, null, -1, null)] });
  const rows = killRows([p1, p6, p5]);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => [r.t, r.killer, r.victim, r.impact]),
    [
      [10, null, 5, 1], // le kill d'un mort sans tueur vaut l'opposé de la note de mort
      [20, 1, 6, 3],
    ],
  );
  assert.equal(rows[0].reasons, null);
  assert.equal(Object.is(killRows([player(5, { death_notes: [note(1, null, 0)] })])[0].impact, -0), false);
});

test('keepKillRows : garde un kill si le tueur ou la victime est retenu', () => {
  const rows = killRows([player(1, { kill_notes: [note(20, 6, 1)] }), player(2, { kill_notes: [note(30, 7, 1)] })]);
  assert.deepEqual(keepKillRows(rows, (s) => s === 1).map((r) => r.t), [20]);
  assert.deepEqual(keepKillRows(rows, (s) => s === 7).map((r) => r.t), [30]);
  assert.equal(keepKillRows(rows, () => false).length, 0);
});

test('killSentence et reasonsText', () => {
  const names: Record<number, string> = { 1: 'Ana', 6: 'Bob' };
  const row = killRows([player(1, { kill_notes: [note(20, 6, 1)] })])[0];
  assert.equal(killSentence(row, (s) => names[s]), 'n° 1 (Ana) a tué n° 7 (Bob)');
  const lone = killRows([player(5, { death_notes: [note(10, null, -1)] })])[0];
  assert.equal(killSentence(lone, (s) => names[s]), 'n° 6 mort, tueur non lu');
  assert.equal(reasonsText(['premier kill', 'prise du point']), 'premier kill ; prise du point');
  assert.equal(reasonsText(null), 'raisons non enregistrées');
  assert.equal(reasonsText([]), 'raisons non enregistrées');
});

test('killSeek : 5 s avant le kill, sans reculer avant le début de la game', () => {
  assert.equal(killSeek(100, 62), 157);
  assert.equal(killSeek(100, 3), 100);
});

test('pointChangesLabel : Engine et Helios disent que la carte n\'a pas de changement', () => {
  assert.equal(pointChangesLabel('Engine', 0), 'aucun changement de point sur cette carte');
  assert.equal(pointChangesLabel('Helios Station', 0), 'aucun changement de point sur cette carte');
  assert.equal(pointChangesLabel('Outlaw', 0), 'aucun changement de point');
  assert.equal(pointChangesLabel('Outlaw', 1), '1 changement de point');
  assert.equal(pointChangesLabel('Atlantis', 6), '6 changements de point');
  assert.equal(pointChangesLabel(null, 2), '2 changements de point');
});

test('captureScoreOf : dernière lecture de chaque équipe, null si une série manque', () => {
  assert.deepEqual(captureScoreOf({ A: [{ v: 10 }, { v: 99 }], B: [{ v: 27 }] }), { A: 99, B: 27 });
  assert.equal(captureScoreOf({ A: [], B: [{ v: 1 }] }), null);
  assert.equal(captureScoreOf(null), null);
});

test('messages quand les tables ne sont pas calculées', () => {
  const none = summary([player(1, { has_stats: false }), player(6, { has_stats: false })]);
  assert.match(statsMissingNotice(none) ?? '', /pas calculé pour cette game, lancer npm run stats -- --game 7/);
  assert.match(notesMissingNotice(none) ?? '', /npm run stats -- --game 7/);
  const done = summary([player(1, { kills: 2, kill_notes: [note(20, 6, 1)] }), player(6, { death_notes: [note(20, 1, -1)] })]);
  assert.equal(statsMissingNotice(done), null);
  assert.equal(notesMissingNotice(done), null);
  // bilan calculé mais aucun kill dans la game : rien à noter, pas de message
  assert.equal(notesMissingNotice(summary([player(1), player(6)])), null);
  // des kills au bilan mais aucune note : notes pas calculées
  assert.match(notesMissingNotice(summary([player(1, { kills: 3 }), player(6)])) ?? '', /Notes des kills pas calculées/);
});

test('assistsCell : valeur officielle, n/d sans tableau ou lecture illisible (jamais 0 par défaut)', () => {
  assert.deepEqual(assistsCell(player(1, { scoreboard: { kills: 10, deaths: 5, assists: 1, score: 700 } })).text, '1');
  assert.equal(assistsCell(player(1, { scoreboard: { kills: 10, deaths: 5, assists: 0, score: 700 } })).text, '0');
  const unread = assistsCell(player(1, { scoreboard: { kills: 10, deaths: 5, assists: null, score: 700 } }));
  assert.equal(unread.text, 'n/d');
  assert.match(unread.title ?? '', /illisibles/);
  const none = assistsCell(player(1));
  assert.equal(none.text, 'n/d');
  assert.match(none.title ?? '', /Pas de tableau/);
});

test('officialTitle : rien sans tableau, valeurs officielle et calculée quand elles diffèrent', () => {
  const board = { kills: 10, deaths: 5, assists: 1, score: 700 };
  assert.equal(officialTitle('kills', 9, null), undefined);
  assert.match(officialTitle('kills', 9, board) ?? '', /officiels \(tableau de fin de game\) : 10 ; calculés par l'analyse : 9/);
  assert.match(officialTitle('deaths', 5, board) ?? '', /identiques/);
  assert.match(officialTitle('deaths', null, board) ?? '', /non calculés/);
  assert.match(officialTitle('kills', 3, { ...board, kills: null }) ?? '', /illisibles/);
});
