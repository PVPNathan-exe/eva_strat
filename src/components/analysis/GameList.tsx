// Panneau latéral : une ligne par game. Carte, bornes (position courante du lecteur),
// confirmation, suppression, et ajout d'un segment manquant.

import { useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { builtinMaps } from '../../lib/builtinMaps';
import { formatTime } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';
import type { Game } from '../../types/analysis';

export function GameList({ videoId, duration }: { videoId: number; duration: number }) {
  const games = useAnalysisStore((s) => s.games);
  const selectedGameId = useAnalysisStore((s) => s.selectedGameId);
  const currentTime = useAnalysisStore((s) => s.currentTime);
  const selectGame = useAnalysisStore((s) => s.selectGame);
  const requestSeek = useAnalysisStore((s) => s.requestSeek);
  const refreshGames = useAnalysisStore((s) => s.refreshGames);
  const [error, setError] = useState<string | null>(null);

  // Toute action serveur passe par ici : on rafraîchit la liste, on affiche l'erreur éventuelle.
  const act = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      await refreshGames();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const addGame = () => {
    const start = Math.floor(currentTime);
    const end = Math.min(duration, start + 600);
    void act(() => analysisApi.createGame(videoId, start, end));
  };

  const row = (g: Game, index: number) => (
    <li key={g.id} className={`game${g.id === selectedGameId ? ' is-selected' : ''}`}>
      <div className="game__head" onClick={() => { selectGame(g.id); requestSeek(g.start_s); }}>
        <strong>Game {index + 1}</strong>
        <span className={`game__badge game__badge--${g.status}`}>
          {g.status === 'confirmed' ? 'confirmée' : 'détectée'}
        </span>
        <span className="game__time">
          {formatTime(g.start_s)} → {formatTime(g.end_s)}
        </span>
      </div>
      <div className="game__actions">
        <select value={g.map ?? ''} onChange={(e) => void act(() => analysisApi.patchGame(g.id, { map: e.target.value || null }))}>
          <option value="">Carte ?</option>
          {builtinMaps.map((m) => (
            <option key={m.id} value={m.name}>{m.name}</option>
          ))}
        </select>
        <button title="Début = position actuelle" onClick={() => void act(() => analysisApi.patchGame(g.id, { start_s: currentTime }))}>
          ⇤ début ici
        </button>
        <button title="Fin = position actuelle" onClick={() => void act(() => analysisApi.patchGame(g.id, { end_s: currentTime }))}>
          fin ici ⇥
        </button>
        <button
          onClick={() => void act(() => analysisApi.patchGame(g.id, { status: g.status === 'confirmed' ? 'detected' : 'confirmed' }))}
        >
          {g.status === 'confirmed' ? 'Dé-confirmer' : 'Confirmer'}
        </button>
        <button
          className="game__delete"
          onClick={() => window.confirm('Supprimer cette game ?') && void act(() => analysisApi.deleteGame(g.id))}
        >
          Supprimer
        </button>
      </div>
    </li>
  );

  return (
    <div className="games">
      <div className="games__head">
        <h3>Games ({games.length})</h3>
        <button onClick={addGame}>+ Ajouter ici</button>
      </div>
      {error && <p className="games__error">{error}</p>}
      {games.length === 0 ? (
        <p className="games__empty">Aucune game détectée. Place le lecteur au début d'une game et clique sur « + Ajouter ici ».</p>
      ) : (
        <ul className="games__list">{games.map(row)}</ul>
      )}
    </div>
  );
}
