// Notes de review d'une game (liste, ajout, suppression), équipement par vie et états du gadget des joueurs (pastilles de gadget, gadget d'une action).
// Une erreur réseau ou une route absente (501) donne un message, jamais un écran cassé : la liste reste vide.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { reviewNotesApi, type ReviewNoteInput } from '../../../lib/reviewNotesApi';
import { sortNotes } from '../../../lib/reviewNotes';
import { statsApi } from '../../../lib/statsApi';
import { useAnalysisStore } from '../../../store/analysisStore';
import type { GadgetState, LifeLoadoutAt, ReviewNote } from '../../../types/stats';

export function useReviewNotes(gameId: number) {
  const [notes, setNotes] = useState<ReviewNote[]>([]);
  const [loadouts, setLoadouts] = useState<LifeLoadoutAt[]>([]);
  const [gadgetStates, setGadgetStates] = useState<GadgetState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const weapons = useAnalysisStore((st) => st.weapons);

  useEffect(() => {
    let cancelled = false;
    reviewNotesApi
      .list(gameId)
      .then((rows) => !cancelled && (setNotes(rows), setError(null)))
      .catch((err: Error) => !cancelled && (setNotes([]), setError(err.message)));
    statsApi
      .lifeLoadouts(gameId)
      .then((rows) => !cancelled && setLoadouts(rows))
      .catch(() => !cancelled && setLoadouts([])); // sans équipement par vie : les gadgets sont « inconnu » (choix « Autre »)
    reviewNotesApi
      .gadgetStates(gameId)
      .then((rows) => !cancelled && setGadgetStates(rows))
      .catch(() => !cancelled && setGadgetStates([])); // sans états du gadget : tous « inconnu »
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
  // Les routes donnent l'identifiant de l'icône (G20) : on le remplace par son nom (DX3, SONAR, SHIELD...), null quand l'icône n'a pas de nom (la pastille dit « inconnu »)
  const named = useMemo(() => {
    const names = new Map((weapons ?? []).filter((w) => w.kind === 'gadget').map((w) => [w.id, w.name?.trim() || null] as const));
    const nameOf = (icon: string | null): string | null => (icon ? (names.get(icon) ?? null) : null);
    return {
      loadouts: loadouts.map((l) => ({ ...l, gadget: nameOf(l.gadget) })),
      gadgetStates: gadgetStates.map((g) => ({ ...g, gadget: nameOf(g.gadget) })),
    };
  }, [weapons, loadouts, gadgetStates]);
  return { notes: sorted, loadouts: named.loadouts, gadgetStates: named.gadgetStates, error, add, remove };
}
