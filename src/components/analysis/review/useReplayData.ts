// Données du replay d'une game : lignes de suivi et score de capture.

import { useEffect, useState } from 'react';
import { analysisApi } from '../../../lib/analysisApi';
import { useAnalysisStore } from '../../../store/analysisStore';
import type { CaptureSeries, Game, Sample } from '../../../types/analysis';

export function useReplayData(game: Game) {
  const dataVersion = useAnalysisStore((s) => s.dataVersion);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capture, setCapture] = useState<CaptureSeries | null>(null);

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
  }, [game.id, game.samples, dataVersion]);

  return { samples, error, capture };
}
