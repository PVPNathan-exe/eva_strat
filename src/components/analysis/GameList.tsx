// Panneau latéral : une ligne par game. Carte, bornes (position courante du lecteur),
// suppression, et pose des marqueurs début puis fin d'une nouvelle game.

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
  const pendingStart = useAnalysisStore((s) => s.pendingStart);
  const setPendingStart = useAnalysisStore((s) => s.setPendingStart);
  const [error, setError] = useState<string | null>(null);

  // Toute action serveur passe par ici : on rafraîchit la liste, on affiche l'erreur éventuelle.
  // Renvoie true si l'action a réussi.
  const act = async (fn: () => Promise<unknown>): Promise<boolean> => {
    try {
      setError(null);
      await fn();
      await refreshGames();
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  const markStart = () => {
    setError(null);
    setPendingStart(Math.floor(currentTime));
  };

  const markEnd = async () => {
    if (pendingStart === null) return;
    if (currentTime <= pendingStart) {
      setError('La fin doit être après le début');
      return;
    }
    // Le début en attente n'est vidé que si le serveur accepte la game (sinon : chevauchement, message affiché).
    const ok = await act(() => analysisApi.createGame(videoId, pendingStart, Math.min(duration, currentTime)));
    if (ok) setPendingStart(null);
  };

  const row = (g: Game, index: number) => (
    <li key={g.id} className={`game${g.id === selectedGameId ? ' is-selected' : ''}`}>
      <div className="game__head" onClick={() => { selectGame(g.id); requestSeek(g.start_s); }}>
        <strong>Game {index + 1}</strong>
        <span className="game__time">
          {formatTime(g.start_s)} → {formatTime(g.end_s)}
        </span>
      </div>
      {g.status === 'detected' && (
        <div className="game__check">
          <span>Détectée automatiquement{g.doubts.length ? ' — à vérifier :' : ''}</span>
          {g.doubts.map((d, i) => (
            <button key={i} className="game__doubt" onClick={() => requestSeek(d.start_s)}>
              {formatTime(d.start_s)} · {d.label}
            </button>
          ))}
          <button onClick={() => void act(() => analysisApi.patchGame(g.id, { status: 'confirmed' }))}>Confirmer</button>
        </div>
      )}
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
        {pendingStart === null ? (
          <div className="games__marking">
            <button onClick={markStart}>▶ Début de game ici</button>
            <button
              title="Crée une game couvrant toute la vidéo"
              disabled={games.length > 0}
              onClick={() => void act(() => useAnalysisStore.getState().createWholeGame())}
            >
              Toute la vidéo
            </button>
          </div>
        ) : (
          <div className="games__marking">
            <button onClick={() => void markEnd()}>■ Fin de game ici</button>
            <button onClick={() => setPendingStart(null)}>Annuler</button>
          </div>
        )}
      </div>
      {pendingStart !== null && <p className="games__pending">Début posé à {formatTime(pendingStart)}</p>}
      {error && <p className="games__error">{error}</p>}
      {games.length === 0 ? (
        <p className="games__empty">Aucune game. Place la lecture au début d'une game et clique sur « Début de game ici », puis à la fin sur « Fin de game ici ».</p>
      ) : (
        <ul className="games__list">{games.map(row)}</ul>
      )}
    </div>
  );
}
