// Notes de review : fonctions pures (fenêtre d'affichage, tri, libellés, fantôme, choix de gadget, corps d'une note à enregistrer).
// Une note de review ne change AUCUNE donnée (ni le suivi, ni les stats) : elle sert à se souvenir d'une erreur vue, plus tard de base aux idées de stratégie.
// Temps des notes : secondes depuis le début de la game. Positions : fractions de la minimap. Testé dans tests/reviewNotes.test.ts.

import type { LifeLoadoutAt, ReviewNote, ReviewNoteKind } from '../types/stats.ts';

/** Une note se voit à partir de ce temps avant son instant (secondes de game). */
export const NOTE_BEFORE_S = 3;
/** Une note se voit jusqu'à ce temps après son instant (secondes de game). */
export const NOTE_AFTER_S = 8;
/** Une position lue et son fantôme plus proches que cela (fractions de la minimap) ne sont pas reliés par un trait. */
export const GHOST_MIN_LINK = 0.004;

export const KIND_LABEL: Record<ReviewNoteKind, string> = {
  position: 'Position à corriger',
  action: 'Action',
  note: 'Remarque',
};

/** Numéro affiché dans le jeu (même règle que numberOfSlot du replay : le créneau 5 à 8 de l'équipe B s'affiche 6 à 9). */
export const slotNumber = (slot: number) => (slot <= 4 ? slot : slot + 1);

/** La note est dessinée sur le plan quand l'instant `gameT` (secondes de game) est dans [t - NOTE_BEFORE_S, t + NOTE_AFTER_S]. */
export function isNoteShown(noteT: number, gameT: number): boolean {
  return gameT >= noteT - NOTE_BEFORE_S && gameT <= noteT + NOTE_AFTER_S;
}

/** Notes triées par instant, puis par identifiant (copie, l'entrée n'est pas modifiée). */
export function sortNotes(notes: ReviewNote[]): ReviewNote[] {
  return [...notes].sort((a, b) => a.t - b.t || a.id - b.id);
}

/** « 3 · Spirit » ou « 3 » si le pseudo est inconnu ; « Aucun joueur » sans créneau. */
export function playerLabel(slot: number | null, nameOf: Map<number, string>): string {
  if (slot === null) return 'Aucun joueur';
  const name = nameOf.get(slot);
  return name ? `${slotNumber(slot)} · ${name}` : `${slotNumber(slot)}`;
}

/** Ce qui est dessiné d'une note sur le plan (positions en fractions de la minimap). */
export interface NoteMark {
  key: string;
  kind: ReviewNoteKind;
  slot: number | null;
  /** Où la note est posée : fantôme du joueur, ou gadget. */
  at: { x: number; y: number };
  /** Position lue du joueur à l'instant de la note (trait vers le fantôme) ; null si inconnue. */
  read: { x: number; y: number } | null;
  /** Regard voulu du fantôme (degrés, 0 = droite, 90 = bas). */
  angle: number | null;
  /** Texte de la pastille (nom du gadget). */
  label: string | null;
  /** Brouillon en cours de pose (toujours visible, rendu plus appuyé). */
  draft: boolean;
}

/** Les champs d'une note nécessaires au dessin ; un brouillon n'a pas d'identifiant. */
export interface NoteShape {
  id?: number;
  kind: ReviewNoteKind;
  slot: number | null;
  t: number;
  x: number | null;
  y: number | null;
  angle: number | null;
  gadget: string | null;
}

/** Marque d'une note : null pour une remarque, ou tant que rien n'est posé sur le plan. `readAt(slot, t)` : position lue du joueur (fractions de la minimap). */
export function markOf(n: NoteShape, draft: boolean, readAt: (slot: number, t: number) => { x: number; y: number } | null): NoteMark | null {
  if (n.kind === 'note' || n.x === null || n.y === null) return null;
  const at = { x: n.x, y: n.y };
  let read = n.slot !== null ? readAt(n.slot, n.t) : null;
  if (n.kind === 'action' || (read && Math.hypot(read.x - at.x, read.y - at.y) < GHOST_MIN_LINK)) read = null;
  return {
    key: draft ? 'draft' : `note-${n.id}`,
    kind: n.kind,
    slot: n.slot,
    at,
    read,
    angle: n.kind === 'position' ? n.angle : null,
    label: n.kind === 'action' ? (n.gadget && n.gadget.trim() ? n.gadget.trim() : 'Gadget') : null,
    draft,
  };
}

/** Marques à dessiner à l'instant `gameT` : les notes dans leur fenêtre, puis le brouillon (toujours). */
export function noteMarks(
  notes: ReviewNote[],
  draft: NoteShape | null,
  gameT: number,
  readAt: (slot: number, t: number) => { x: number; y: number } | null,
): NoteMark[] {
  const out: NoteMark[] = [];
  for (const n of notes) {
    if (!isNoteShown(n.t, gameT)) continue;
    const m = markOf(n, false, readAt);
    if (m) out.push(m);
  }
  const d = draft ? markOf(draft, true, readAt) : null;
  if (d) out.push(d);
  return out;
}

/** Gadgets proposés pour une action : celui de la vie du joueur à l'instant (`current`), puis ceux de ses autres vies. */
export function gadgetChoices(loadouts: LifeLoadoutAt[], slot: number | null, gameT: number): { current: string | null; others: string[] } {
  if (slot === null) return { current: null, others: [] };
  const mine = loadouts.filter((l) => l.slot === slot && l.gadget);
  const now = mine.find((l) => l.t0 <= gameT && gameT <= l.t1);
  const current = now?.gadget ?? null;
  const others = [...new Set(mine.map((l) => l.gadget as string))].filter((g) => g !== current).sort();
  return { current, others };
}

/** Brouillon en cours d'écriture dans le volet. */
export interface NoteDraftFields {
  kind: ReviewNoteKind;
  slot: number | null;
  /** Instant figé (secondes de game). */
  t: number;
  x: number | null;
  y: number | null;
  angle: number | null;
  gadget: string;
  text: string;
}

/** Ce qui manque pour enregistrer la note (null : on peut enregistrer). */
export function draftProblem(d: NoteDraftFields): string | null {
  if (d.kind === 'position') {
    if (d.slot === null) return 'Choisis un joueur (pastille, clic sur le plan ou liste).';
    if (d.x === null || d.y === null) return 'Glisse le joueur sur le plan, ou clique pour poser le fantôme.';
  }
  if (d.kind === 'action') {
    if (d.slot === null) return 'Choisis un joueur (pastille de gadget ou liste).';
    if (!d.gadget.trim()) return 'Choisis un gadget (ou « Autre »).';
    if (d.x === null || d.y === null) return 'Clique sur le plan pour poser le gadget.';
  }
  if (d.kind === 'note' && !d.text.trim()) return 'Écris la remarque.';
  return null;
}

/** Corps du POST /api/review-notes (sans game_id). Les champs inutiles à la sorte de note sont mis à null. */
export function draftBody(d: NoteDraftFields) {
  const placed = d.kind !== 'note';
  return {
    t: Math.max(0, d.t),
    kind: d.kind,
    slot: d.slot,
    x: placed ? d.x : null,
    y: placed ? d.y : null,
    angle: d.kind === 'position' ? d.angle : null,
    gadget: d.kind === 'action' ? d.gadget.trim() : null,
    text: d.text.trim(),
  };
}
