// Appels HTTP vers /api/review-notes (notes de review : annotations sans effet sur les données lues).
// Erreur réseau ou réponse 501 (route pas encore branchée) : message clair, jamais d'exception brute dans l'interface.

import { jsonInit, parse } from './analysisApi.ts';
import type { GadgetState, ReviewNote, ReviewNoteKind } from '../types/stats.ts';

/** La route existe mais n'est pas disponible (réponse 501). */
export class ReviewNotesUnavailableError extends Error {
  constructor(message = 'Les notes de review ne sont pas encore disponibles sur le serveur.') {
    super(message);
    this.name = 'ReviewNotesUnavailableError';
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new Error('Le serveur ne répond pas : les notes de review ne peuvent pas être lues ni enregistrées.');
  }
  if (res.status === 501) throw new ReviewNotesUnavailableError();
  return parse<T>(res);
}

/** Corps d'une création (game_id, t en secondes de game, positions en fractions de la minimap). */
export interface ReviewNoteInput {
  game_id: number;
  t: number;
  kind: ReviewNoteKind;
  slot: number | null;
  x: number | null;
  y: number | null;
  angle: number | null;
  gadget: string | null;
  text: string;
}

/** Champs modifiables d'une note (le PUT ne change ni la game ni la sorte). */
export type ReviewNotePatch = Partial<Pick<ReviewNote, 't' | 'slot' | 'x' | 'y' | 'angle' | 'gadget' | 'text'>>;

export const reviewNotesApi = {
  list: (gameId: number) => call<ReviewNote[]>(`/api/review-notes?game=${gameId}`),
  create: (note: ReviewNoteInput) => call<ReviewNote>('/api/review-notes', jsonInit('POST', note)),
  update: (id: number, patch: ReviewNotePatch) => call<unknown>(`/api/review-notes/${id}`, jsonInit('PUT', patch)),
  remove: (id: number) => call<unknown>(`/api/review-notes/${id}`, { method: 'DELETE' }),
  /** États du gadget de chaque joueur (lecture seule, route /api/stats/gadgets). */
  gadgetStates: (gameId: number) => call<GadgetState[]>(`/api/stats/gadgets?game=${gameId}`),
};
