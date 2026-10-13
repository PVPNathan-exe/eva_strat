// Pastille en haut à gauche de la vidéo : numéro de la game dans la vidéo et nom de sa carte, tant que la lecture est à l'intérieur d'une game.

import { useAnalysisStore } from '../../store/analysisStore';

export function GameBadge() {
  const games = useAnalysisStore((s) => s.games);
  const currentTime = useAnalysisStore((s) => s.currentTime);
  const index = games.findIndex((g) => currentTime >= g.start_s - 0.5 && currentTime <= g.end_s + 0.5);
  if (index < 0) return null;
  const game = games[index];
  return (
    <div className="game-badge" aria-live="off">
      <strong>Game {index + 1}</strong>
      <span>{game.map ?? 'carte ?'}</span>
    </div>
  );
}
