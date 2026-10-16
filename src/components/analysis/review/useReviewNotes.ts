// Notes de review d'une game (liste, ajout, suppression) et équipement par vie des joueurs (pour proposer le gadget d'une action).
// Une erreur réseau ou une route absente (501) donne un message, jamais un écran cassé : la liste reste vide.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { reviewNotesApi, type ReviewNoteInput } from '../../../lib/reviewNotesApi';
import { sortNotes } from '../../../lib/reviewNotes';
import { statsApi } from '../../../lib/statsApi';
import type { LifeLoadoutAt, ReviewNote } from '../../../types/stats';

export function useReviewNotes(gameId: number) {
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const [loadouts, setLoadouts] = useState<LifeLoadoutAt[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    reviewNotesApi
      .list(gameId)
      .then((rows) => !cancelled && (setNotes(rows), setError(null)))
      .catch((err: Error) => !cancelled && (setNotes([]), setError(err.message)));
    statsApi
      .lifeLoadouts(gameId)
      .then((rows) => !cancelled && setLoadouts(rows))
      .catch(() => !cancelled && setLoadouts([])); // sans équipement par vie : le gadget s'écrit à la main
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  /** Enregistre une note ; renvoie true si elle est créée (sinon le message d'erreur est affiché). */
  const add = useCallback(async (input: ReviewNoteInput): Promise<boolean> => {
    try {
      const created = await reviewNotesApi.create(input);
      setNotes((prev) => [...prev, created]);
      setError(null);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }, []);

  const remove = useCallback(async (id: number) => {
    try {
      await reviewNotesApi.remove(id);
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const sorted = useMemo(() => sortNotes(notes), [notes]);
  return { notes: sorted, loadouts, error, add, remove };
}
