import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eligibleGames,
  filterByScope,
  gameEligible,
  keepsSlot,
  keptSides,
  legacyTeam,
  nameKey,
  NO_FOLLOW,
  paletteNames,
  paletteOf,
  palClass,
  pickGames,
  playerChoices,
  presenceGroups,
  sideOfTeam,
  teamNames,
  wantedSlot,
  type FollowGame,
  type FollowSpec,
} from '../src/lib/teamFollow.ts';

const players = (names: string[]) => names.map((name, i) => ({ slot: i + 1, name }));
// Game 1 : NCT à gauche (orange) contre SNV ; game 2 : SNV à gauche contre NCT (NCT passe à droite, bleue) ; game 3 : sans noms
const G1: FollowGame = { id: 1, teamA: 'NCT', teamB: 'SNV', players: players(['n1', 'n2', 'n3', 'n4', 's1', 's2', 's3', 's4']) };
const G2: FollowGame = { id: 2, teamA: ' snv ', teamB: 'Nct', players: players(['s1', 's2', 's3', 's4', 'n1', 'n2', 'n3', 'n4']) };
const G3: FollowGame = { id: 3, teamA: null, teamB: null, players: players(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) };
const follow = (over: Partial<FollowSpec>): FollowSpec => ({ ...NO_FOLLOW, team: 'nct', ...over });

test('nameKey : majuscules, accents et espaces ne comptent pas', () => {
  assert.equal(nameKey('  Team   Éclair '), 'team eclair');
  assert.equal(nameKey(null), '');
});

test('teamNames : regroupe les écritures, les plus fréquentes d\'abord', () => {
  const names = teamNames([G1, G2, G3]);
  assert.deepEqual(names.map((n) => [n.key, n.games]), [['nct', 2], ['snv', 2]]);
  assert.equal(names[0].label, 'NCT');
});

test('sideOfTeam : l\'équipe suivie est à gauche dans une game et à droite dans l\'autre', () => {
  assert.equal(sideOfTeam(G1, 'nct'), 'A');
  assert.equal(sideOfTeam(G2, 'nct'), 'B');
  assert.equal(sideOfTeam(G3, 'nct'), null);
  assert.equal(sideOfTeam(G1, null), null);
});

test('palette : l\'équipe suivie a toujours la palette a, quel que soit son côté', () => {
  const spec = follow({});
  assert.equal(paletteOf(G1, spec, 2), 'a'); // joueur 2 de NCT, à gauche
  assert.equal(paletteOf(G1, spec, 6), 'b');
  assert.equal(paletteOf(G2, spec, 6), 'a'); // NCT est à droite dans la game 2
  assert.equal(paletteOf(G2, spec, 1), 'b');
});

test('palette sans équipe suivie : gauche = a (orange), droite = b (bleue)', () => {
  assert.equal(paletteOf(G1, NO_FOLLOW, 3), 'a');
  assert.equal(paletteOf(G1, NO_FOLLOW, 7), 'b');
  // Une game où l'équipe suivie ne joue pas retombe sur les côtés
  assert.equal(paletteOf(G3, follow({}), 5), 'b');
});

test('palClass : palette et nuance selon la place dans l\'équipe', () => {
  assert.equal(palClass('b', 7), 'pal pal--b pal--r3');
  assert.equal(palClass('a', 1), 'pal pal--a pal--r1');
});

test('filtre de côté sans équipe suivie : gauche = joueurs 1 à 4, droite = 5 à 8', () => {
  const left: FollowSpec = { ...NO_FOLLOW, side: 'left' };
  assert.deepEqual(keptSides(G1, left), ['A']);
  assert.equal(keepsSlot(G1, left, 4), true);
  assert.equal(keepsSlot(G1, left, 5), false);
  assert.deepEqual(keptSides(G1, NO_FOLLOW), ['A', 'B']);
  assert.equal(legacyTeam(left), 'A');
  assert.equal(legacyTeam({ ...NO_FOLLOW, side: 'right' }), 'B');
});

test('filtre de côté avec équipe suivie : seules les games où elle est du côté demandé restent', () => {
  const left = follow({ side: 'left' });
  assert.equal(gameEligible(G1, left), true);
  assert.equal(gameEligible(G2, left), false);
  assert.equal(gameEligible(G3, left), false);
  assert.deepEqual(eligibleGames([G1, G2, G3], follow({ side: 'right' })).map((g) => g.id), [2]);
  assert.deepEqual(eligibleGames([G1, G2, G3], follow({})).map((g) => g.id), [1, 2]);
  assert.equal(legacyTeam(left), 'all'); // les vues Retakes et Rotations reçoivent « tout »
});

test('afficher : équipe suivie seule, adversaires seuls, ou les deux', () => {
  assert.deepEqual(keptSides(G2, follow({ show: 'followed' })), ['B']);
  assert.deepEqual(keptSides(G2, follow({ show: 'opponents' })), ['A']);
  assert.deepEqual(keptSides(G2, follow({ show: 'both' })), ['A', 'B']);
  assert.deepEqual(keptSides(G3, follow({})), []);
});

test('filtre joueur par pseudo : retrouve le numéro de joueur dans chaque game', () => {
  const spec = follow({ player: 'n2' });
  assert.equal(wantedSlot(G1, spec), 2);
  assert.equal(wantedSlot(G2, spec), 6);
  assert.equal(wantedSlot(G3, spec), null);
  assert.equal(keepsSlot(G2, spec, 6), true);
  assert.equal(keepsSlot(G2, spec, 2), false);
});

test('filterByScope : lignes de plusieurs games, chacune lue avec le côté de son équipe', () => {
  const rows = [
    { game_id: 1, slot: 1 },
    { game_id: 1, slot: 5 },
    { game_id: 2, slot: 1 },
    { game_id: 2, slot: 5 },
  ];
  const kept = filterByScope(rows, [G1, G2], follow({ show: 'followed' }));
  assert.deepEqual(kept, [{ game_id: 1, slot: 1 }, { game_id: 2, slot: 5 }]);
  assert.equal(filterByScope(rows, [G1], NO_FOLLOW).length, 2); // la game 2 est inconnue : ses lignes sont écartées
});

test('pickGames : par défaut la plus récente (numéro le plus grand), sinon le choix', () => {
  assert.deepEqual(pickGames([G2, G1], null).map((g) => g.id), [2]);
  assert.deepEqual(pickGames([G1, G2], [1, 2]).map((g) => g.id), [1, 2]);
  assert.deepEqual(pickGames([G1, G2], []).map((g) => g.id), []);
  assert.deepEqual(pickGames([], null), []);
});

test('presenceGroups sans équipe suivie : une requête, côté et joueur du filtre', () => {
  assert.deepEqual(presenceGroups([G1, G2], NO_FOLLOW), [{ games: [1, 2], team: undefined, slot: undefined }]);
  assert.deepEqual(presenceGroups([G1, G2], { ...NO_FOLLOW, side: 'right', slot: 6 }), [{ games: [1, 2], team: 'B', slot: 6 }]);
});

test('presenceGroups avec équipe suivie : l\'équipe demandée change de côté d\'une game à l\'autre', () => {
  const groups = presenceGroups([G1, G2, G3], follow({ show: 'followed' }));
  assert.deepEqual(groups, [
    { games: [1], team: 'A', slot: undefined },
    { games: [2], team: 'B', slot: undefined },
  ]);
  const opp = presenceGroups([G1, G2], follow({ show: 'opponents' }));
  assert.deepEqual(opp.map((g) => [g.games, g.team]), [[[1], 'B'], [[2], 'A']]);
  // Les deux équipes : pas de filtre d'équipe, une seule requête pour les deux games
  assert.deepEqual(presenceGroups([G1, G2], follow({})), [{ games: [1, 2], team: undefined, slot: undefined }]);
  // Un joueur par pseudo : une requête par numéro de joueur
  const one = presenceGroups([G1, G2], follow({ player: 'n3' }));
  assert.deepEqual(one.map((g) => [g.games, g.slot]), [[[1], 3], [[2], 7]]);
});

test('playerChoices : pseudos des deux équipes, une seule fois chacun', () => {
  const choices = playerChoices([G1, G2], follow({}));
  assert.equal(choices.length, 8);
  assert.ok(choices.some((c) => c.key === 'n1'));
});

test('paletteNames : le nom de l\'équipe suivie est toujours en a', () => {
  assert.deepEqual(paletteNames(G2, follow({})), { a: 'Nct', b: ' snv ' });
  assert.deepEqual(paletteNames(G1, NO_FOLLOW), { a: 'NCT', b: 'SNV' });
});
