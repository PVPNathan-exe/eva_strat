import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actionText,
  autoNoteText,
  gadgetChips,
  gadgetLabel,
  gadgetNameAt,
  gadgetSegmentAt,
  gadgetStatusAt,
  OTHER_GADGET,
  playerName,
  positionText,
} from '../src/lib/gadgetStates.ts';
import type { GadgetState, LifeLoadoutAt } from '../src/types/stats.ts';

const seg = (slot: number, t0: number, t1: number, state: GadgetState['state'], gadget: string | null = null): GadgetState => ({ game_id: 1, slot, t0, t1, gadget, state });
const life = (slot: number, t0: number, t1: number, gadget: string | null): LifeLoadoutAt => ({
  game_id: 1, slot, life_idx: 0, weapon1: null, weapon2: null, gadget, held: null, source: 'vie', t0, t1,
});

test('nom affichable : majuscules, inconnu sans nom ou pour Autre', () => {
  assert.equal(gadgetLabel('sonar'), 'SONAR');
  assert.equal(gadgetLabel(' DX3 '), 'DX3');
  assert.equal(gadgetLabel(null), 'inconnu');
  assert.equal(gadgetLabel(''), 'inconnu');
  assert.equal(gadgetLabel(OTHER_GADGET), 'inconnu');
});

test('segment de gadget : celui qui contient l instant, le plus récent à la jointure, inconnu hors segment', () => {
  const states = [seg(2, 0, 30, 'ready'), seg(2, 30, 60, 'used'), seg(3, 0, 100, 'ready')];
  assert.equal(gadgetStatusAt(states, 2, 10), 'ready');
  assert.equal(gadgetStatusAt(states, 2, 30), 'used', 'jointure : le segment qui commence');
  assert.equal(gadgetStatusAt(states, 2, 60), 'used', 'fin comprise');
  assert.equal(gadgetStatusAt(states, 2, 61), 'unknown');
  assert.equal(gadgetStatusAt(states, 4, 10), 'unknown', 'joueur sans segment');
  assert.equal(gadgetSegmentAt(states, 3, 50)?.state, 'ready');
  assert.equal(gadgetStatusAt([], 2, 10), 'unknown');
});

test('nom du gadget : équipement de la vie, sinon segment d état, sinon rien', () => {
  const lo = [life(2, 0, 60, 'STICKY'), life(2, 70, 130, 'DX3')];
  const states = [seg(2, 60, 70, 'unknown', 'SONAR'), seg(4, 0, 100, 'ready', 'SHIELD')];
  assert.equal(gadgetNameAt(lo, states, 2, 20), 'STICKY');
  assert.equal(gadgetNameAt(lo, states, 2, 100), 'DX3');
  assert.equal(gadgetNameAt(lo, states, 2, 65), 'SONAR', 'entre deux vies : le segment');
  assert.equal(gadgetNameAt(lo, states, 4, 10), 'SHIELD', 'sans équipement lu : le segment');
  assert.equal(gadgetNameAt(lo, states, 5, 10), null);
});

test('pastilles : ordre des créneaux, numéro du jeu, équipe, nom et état', () => {
  const lo = [life(1, 0, 100, 'STICKY'), life(5, 0, 100, 'MEDPACK')];
  const states = [seg(1, 0, 50, 'used'), seg(5, 0, 100, 'ready')];
  const chips = gadgetChips([5, 1, 2], lo, states, 20);
  assert.deepEqual(chips.map((c) => c.slot), [1, 2, 5]);
  assert.deepEqual(chips[0], { slot: 1, number: 1, team: 'A', name: 'STICKY', label: 'STICKY', status: 'used' });
  assert.deepEqual(chips[1], { slot: 2, number: 2, team: 'A', name: null, label: 'inconnu', status: 'unknown' });
  assert.deepEqual(chips[2], { slot: 5, number: 6, team: 'B', name: 'MEDPACK', label: 'MEDPACK', status: 'ready' });
});

test('textes préremplis : action, position, joueur sans pseudo, gadget inconnu', () => {
  const names = new Map([[2, 'SNVXPRIME']]);
  assert.equal(playerName(2, names), 'SNVXPRIME');
  assert.equal(playerName(5, names), 'Joueur 6');
  assert.equal(actionText('SNVXPRIME', 'SONAR'), 'SNVXPRIME pose sa SONAR ici');
  assert.equal(actionText('SNVXPRIME', 'dx3'), 'SNVXPRIME pose son DX3 ici');
  assert.equal(actionText('SNVXPRIME', OTHER_GADGET), 'SNVXPRIME pose son gadget ici');
  assert.equal(positionText('SNVXPRIME'), 'SNVXPRIME aurait dû être ici');
  assert.equal(autoNoteText('action', 2, 'SONAR', false, names), 'SNVXPRIME pose sa SONAR ici');
  assert.equal(autoNoteText('position', 2, null, true, names), 'SNVXPRIME aurait dû être ici');
  assert.equal(autoNoteText('position', 2, null, false, names), '', 'rien posé : pas de texte');
  assert.equal(autoNoteText('action', null, 'SONAR', false, names), '', 'sans joueur');
  assert.equal(autoNoteText('note', 2, 'SONAR', true, names), '');
});

test('texte prérempli du SHIELD (durée de la référence) et du CLONE (phrase d arrêt)', () => {
  assert.equal(actionText('SNVXALEXO', 'SHIELD'), 'SNVXALEXO pose son SHIELD ici (10 s)');
  assert.equal(actionText('SNVXPRIME', 'CLONE'), 'SNVXPRIME envoie son CLONE vers ce point');
  assert.equal(actionText('SNVXPRIME', 'CLONE', 'arrêt sur un mur à 8,2 m'), 'SNVXPRIME envoie son CLONE vers ce point : arrêt sur un mur à 8,2 m');
  assert.equal(actionText('SNVXPRIME', 'echo', 'arrêt sur un joueur à 4 m'), 'SNVXPRIME envoie son ECHO vers ce point : arrêt sur un joueur à 4 m');
  const names = new Map([[3, 'SNVXPRIME']]);
  assert.equal(autoNoteText('action', 3, 'CLONE', true, names, 'arrêt sur un mur à 8,2 m'), 'SNVXPRIME envoie son CLONE vers ce point : arrêt sur un mur à 8,2 m');
  assert.equal(autoNoteText('action', 3, 'DX3', true, names, 'ignoré'), 'SNVXPRIME pose son DX3 ici');
});
