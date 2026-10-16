// Données du replay d'une game : lignes de suivi, score de capture, échanges de joueurs déjà faits.

import { useCallback, useEffect, useState } from 'react';
import { analysisApi } from '../../../lib/analysisApi';
import { useAnalysisStore } from '../../../store/analysisStore';
import type { CaptureSeries, Correction, Game, Sample } from '../../../types/analysis';

export function useReplayData(game: Game) {
  const dataVersion = useAnalysisStore((s) => s.dataVersion);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureSeries | null>(null);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    analysisApi
      .capture(game.id)
      .then(setCapture)
      .catch(() => setCapture(null));
  }, [game.id]);

  useEffect(() => {
    let cancelled = false;
    analysisApi
      .samples(game.id)
      .then((rows) => !cancelled && (setSamples(rows), setError(null)))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [game.id, game.samples, reload, dataVersion]);

  useEffect(() => {
    analysisApi
      .corrections(game.id)
      .then(setCorrections)
      .catch(() => setCorrections([]));
  }, [game.id, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  return { samples, error, capture, corrections, refresh };
}
