// Charge, pour une game, les positions non confirmées par la vraie minimap, le joueur observé et la carte de fiabilité de sa carte du jeu.

import { useEffect, useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { useAnalysisStore } from '../../store/analysisStore';
import type { GameFlags, Reliability } from '../../types/analysis';

export function useGameFlags(gameId: number, map: string | null, samples: number) {
  const [flags, setFlags] = useState<GameFlags | null>(null);
  const [reliability, setReliability] = useState<Reliability | null>(null);
  const dataVersion = useAnalysisStore((s) => s.dataVersion);

  useEffect(() => {
    let cancelled = false;
    analysisApi
      .flags(gameId)
      .then((f) => !cancelled && setFlags(f))
      .catch(() => !cancelled && setFlags(null));
    return () => {
      cancelled = true;
    };
  }, [gameId, samples, dataVersion]);

  useEffect(() => {
    let cancelled = false;
    if (!map) return;
    analysisApi
      .reliability(map)
      .then((r) => !cancelled && setReliability(r))
      .catch(() => !cancelled && setReliability(null));
    return () => {
      cancelled = true;
    };
  }, [map]);

  return { flags, reliability: map ? reliability : null };
}
