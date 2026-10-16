// Numéro de vidéo de chaque game connue du site : les lignes du serveur (summary) ne portent que le numéro de game, le lien « ouvrir dans la vidéo » a besoin de la vidéo.

import { useMemo } from 'react';
import { useStatsGames } from '../useStats';

export function useVideoIds(): (gameId: number) => number | undefined {
  const games = useStatsGames().data;
  const byGame = useMemo(() => new Map((games ?? []).map((g) => [g.id, g.videoId])), [games]);
  return (gameId) => byGame.get(gameId);
}
