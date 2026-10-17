import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftBody,
  draftProblem,
  gadgetChoices,
  isNoteShown,
  markOf,
  NOTE_AFTER_S,
  NOTE_BEFORE_S,
  noteMarks,
  playerLabel,
  slotNumber,
  sortNotes,
  type NoteDraftFields,
} from '../src/lib/reviewNotes.ts';
import type { LifeLoadoutAt, ReviewNote } from '../src/types/stats.ts';

const note = (id: number, t: number, over: Partial<ReviewNote> = {}): ReviewNote => ({
  id, game_id: 1, t, slot: 2, kind: 'position', x: 0.5, y: 0.5, angle: null, gadget: null, text: '', created_at: '', ...over,
});
const readAt = () => ({ x: 0.4, y: 0.5 });

test('fenêtre d affichage : de 3 s avant à 8 s après, bornes comprises', () => {
  assert.equal(NOTE_BEFORE_S, 3);
  assert.equal(NOTE_AFTER_S, 8);
  assert.equal(isNoteShown(100, 96.9), false);
  assert.equal(isNoteShown(100, 97), true);
  assert.equal(isNoteShown(100, 100), true);
  assert.equal(isNoteShown(100, 108), true);
  assert.equal(isNoteShown(100, 108.1), false);
});

test('tri par instant puis identifiant, sans modifier l entrée', () => {
  const input = [note(3, 20), note(2, 10), note(1, 20)];
  assert.deepEqual(sortNotes(input).map((n) => n.id), [2, 1, 3]);
  assert.deepEqual(input.map((n) => n.id), [3, 2, 1]);
});

test('libellés de joueur : numéro du jeu, pseudo, aucun joueur', () => {
  assert.equal(slotNumber(4), 4);
  assert.equal(slotNumber(5), 6);
  const names = new Map([[5, 'Spirit']]);
  assert.equal(playerLabel(5, names), '6 · Spirit');
  assert.equal(playerLabel(2, names), '2');
  assert.equal(playerLabel(null, names), 'Aucun joueur');
});

test('fantôme : trait vers la position lue ; pas de trait si les deux sont confondus ; remarque ou rien posé : rien à dessiner', () => {
  const ghost = markOf(note(1, 10, { x: 0.6, y: 0.5, angle: 90 }), false, readAt);
  assert.deepEqual(ghost?.read, { x: 0.4, y: 0.5 });
  assert.equal(ghost?.angle, 90);
  assert.equal(ghost?.key, 'note-1');
  assert.equal(markOf(note(2, 10, { x: 0.4, y: 0.5 }), false, readAt)?.read, null, 'confondus');
  assert.equal(markOf(note(3, 10, { kind: 'note', x: null, y: null }), false, readAt), null);
  assert.equal(markOf(note(4, 10, { x: null, y: null }), false, readAt), null, 'rien posé');
  assert.equal(markOf(note(5, 10, { slot: null, x: 0.6 }), false, readAt)?.read, null, 'sans joueur : pas de position lue');
});

test('gadget posé : pastille avec le nom, sans trait ni regard', () => {
  const m = markOf(note(1, 10, { kind: 'action', gadget: ' STICKY ', angle: 40 }), false, readAt);
  assert.equal(m?.label, 'STICKY');
  assert.equal(m?.read, null);
  assert.equal(m?.angle, null);
  assert.equal(markOf(note(2, 10, { kind: 'action', gadget: null }), false, readAt)?.label, 'Gadget');
});

test('marques à l instant : notes dans leur fenêtre puis brouillon toujours visible', () => {
  const notes = [note(1, 100), note(2, 200)];
  const draft = { kind: 'action' as const, slot: 3, t: 500, x: 0.2, y: 0.2, angle: null, gadget: 'DX3' };
  const marks = noteMarks(notes, draft, 105, readAt);
  assert.deepEqual(marks.map((m) => m.key), ['note-1', 'draft']);
  assert.equal(marks[1].draft, true);
  assert.deepEqual(noteMarks(notes, null, 150, readAt), []);
});

test('gadgets proposés : celui de la vie à l instant, puis ceux des autres vies du joueur', () => {
  const lo = (slot: number, life_idx: number, t0: number, t1: number, gadget: string | null): LifeLoadoutAt => ({
    game_id: 1, slot, life_idx, weapon1: null, weapon2: null, gadget, held: null, source: 'vie', t0, t1,
  });
  const rows = [lo(2, 0, 0, 60, 'STICKY'), lo(2, 1, 70, 130, 'DX3'), lo(2, 2, 140, 200, 'STICKY'), lo(3, 0, 0, 200, 'SONAR'), lo(2, 3, 210, 230, null)];
  assert.deepEqual(gadgetChoices(rows, 2, 80), { current: 'DX3', others: ['STICKY'] });
  assert.deepEqual(gadgetChoices(rows, 2, 65), { current: null, others: ['DX3', 'STICKY'] }, 'entre deux vies');
  assert.deepEqual(gadgetChoices(rows, null, 80), { current: null, others: [] });
  assert.deepEqual(gadgetChoices([], 2, 80), { current: null, others: [] });
});

test('brouillon : ce qui manque pour enregistrer, et corps envoyé au serveur', () => {
  const base: NoteDraftFields = { kind: 'position', slot: 2, t: 12.5, x: null, y: null, x2: null, y2: null, angle: null, gadget: '', text: '' };
  assert.match(draftProblem(base) ?? '', /plan/);
  assert.match(draftProblem({ ...base, slot: null }) ?? '', /joueur/);
  assert.equal(draftProblem({ ...base, x: 0.3, y: 0.4 }), null, 'position sans commentaire : permise');
  assert.match(draftProblem({ ...base, kind: 'action', x: 0.3, y: 0.4 }) ?? '', /gadget/);
  assert.equal(draftProblem({ ...base, kind: 'action', x: 0.3, y: 0.4, gadget: 'STICKY' }), null);
  assert.match(draftProblem({ ...base, kind: 'note', text: '  ' }) ?? '', /remarque/);
  assert.equal(draftProblem({ ...base, kind: 'note', slot: null, text: 'Mauvais placement' }), null);

  const pos = draftBody({ ...base, x: 0.3, y: 0.4, angle: 90, gadget: 'x', text: ' trop avancé ' });
  assert.deepEqual(pos, { t: 12.5, kind: 'position', slot: 2, x: 0.3, y: 0.4, x2: null, y2: null, angle: 90, gadget: null, text: 'trop avancé' });
  const act = draftBody({ ...base, kind: 'action', x: 0.3, y: 0.4, angle: 90, gadget: ' STICKY ', text: 'à poser ici' });
  assert.deepEqual(act, { t: 12.5, kind: 'action', slot: 2, x: 0.3, y: 0.4, x2: null, y2: null, angle: null, gadget: 'STICKY', text: 'à poser ici' });
  const rem = draftBody({ ...base, kind: 'note', slot: null, x: 0.3, y: 0.4, angle: 10, gadget: 'x', text: 'ok' });
  assert.deepEqual(rem, { t: 12.5, kind: 'note', slot: null, x: null, y: null, x2: null, y2: null, angle: null, gadget: null, text: 'ok' });
});

test('SHIELD et CLONE : visibles de l instant de la note à + 10 s (pas la fenêtre des autres notes)', () => {
  assert.equal(isNoteShown(100, 97, 'SHIELD'), false, 'avant l instant : rien');
  assert.equal(isNoteShown(100, 100, 'SHIELD'), true);
  assert.equal(isNoteShown(100, 110, 'SHIELD'), true);
  assert.equal(isNoteShown(100, 110.1, 'SHIELD'), false);
  assert.equal(isNoteShown(100, 105, 'CLONE'), true);
  assert.equal(isNoteShown(100, 98, 'CLONE'), false);
  assert.equal(isNoteShown(100, 98, 'STICKY'), true, 'autre gadget : 3 s avant');
  assert.equal(isNoteShown(100, 108, 'STICKY'), true, 'autre gadget : 8 s après');
  assert.equal(isNoteShown(100, 98), true, 'sans gadget : fenêtre commune');
});

test('marque d un SHIELD ou d un CLONE : deuxième point gardé ; un autre gadget n en a pas', () => {
  const shield = markOf(note(1, 10, { kind: 'action', gadget: 'SHIELD', x: 0.2, y: 0.5, x2: 0.3, y2: 0.5 }), false, readAt);
  assert.equal(shield?.gadgetKind, 'shield');
  assert.deepEqual(shield?.to, { x: 0.3, y: 0.5 });
  assert.equal(shield?.t, 10);
  const clone = markOf(note(2, 10, { kind: 'action', gadget: 'CLONE', x: 0.2, y: 0.5, x2: 0.4, y2: 0.6 }), false, readAt);
  assert.equal(clone?.gadgetKind, 'clone');
  assert.deepEqual(clone?.to, { x: 0.4, y: 0.6 });
  assert.equal(clone?.gadget, 'CLONE');
  const sticky = markOf(note(3, 10, { kind: 'action', gadget: 'STICKY', x: 0.2, y: 0.5, x2: 0.4, y2: 0.6 }), false, readAt);
  assert.equal(sticky?.gadgetKind, 'point');
  assert.equal(sticky?.to, null);
  assert.equal(markOf(note(4, 10, { kind: 'action', gadget: 'SHIELD', x: 0.2, y: 0.5 }), false, readAt)?.to, null, 'fin du trait manquante');
});

test('brouillon SHIELD et CLONE : deuxième point exigé, corps envoyé avec x2 et y2', () => {
  const base: NoteDraftFields = { kind: 'action', slot: 2, t: 12.5, x: null, y: null, x2: null, y2: null, angle: null, gadget: 'SHIELD', text: '' };
  assert.match(draftProblem(base) ?? '', /Appuyer au centre du shield/);
  assert.match(draftProblem({ ...base, x: 0.2, y: 0.5 }) ?? '', /Appuyer au centre du shield/, 'début sans fin');
  assert.equal(draftProblem({ ...base, x: 0.2, y: 0.5, x2: 0.3, y2: 0.5 }), null);
  const clone = { ...base, gadget: 'CLONE' };
  assert.match(draftProblem({ ...clone, x: 0.2, y: 0.5 }) ?? '', /direction et la distance/);
  assert.match(draftProblem({ ...clone, x2: 0.3, y2: 0.5 }) ?? '', /position lue/, 'joueur sans position lue');
  assert.equal(draftProblem({ ...clone, x: 0.2, y: 0.5, x2: 0.3, y2: 0.5 }), null);
  assert.deepEqual(draftBody({ ...base, x: 0.2, y: 0.5, x2: 0.3, y2: 0.4 }), { t: 12.5, kind: 'action', slot: 2, x: 0.2, y: 0.5, x2: 0.3, y2: 0.4, angle: null, gadget: 'SHIELD', text: '' });
  assert.equal(draftBody({ ...base, gadget: 'STICKY', x: 0.2, y: 0.5, x2: 0.3, y2: 0.4 }).x2, null, 'STICKY : pas de deuxième point');
});
