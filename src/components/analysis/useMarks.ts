// Corrections posées à la main pour une game (onglet Lecture) : chargement, ajout, retrait.

import { useCallback, useEffect, useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import type { UserMark } from '../../types/analysis';

export function useMarks(gameId: number) {
  const [marks, setMarks] = useState<UserMark[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    analysisApi
      .marks(gameId)
      .then((m) => {
        setMarks(m);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, [gameId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const add = useCallback(
    async (mark: Omit<UserMark, 'id'>) => {
      try {
        await analysisApi.addMark(mark);
        reload();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [reload],
  );

  const remove = useCallback(
    async (id: number) => {
      try {
        await analysisApi.deleteMark(id);
        reload();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [reload],
  );

  return { marks, error, add, remove };
}
