// Onglet « Lecture » : ce que le programme sait de la carte (couloirs) et la forme des joueurs qu'il a lue sur la minimap.

import { useEffect } from 'react';
import { mapsWithReading } from '../../lib/mapReading';
import { useAnalysisStore } from '../../store/analysisStore';
import { CorridorMap } from './CorridorMap';
import { ShapeViewer } from './ShapeViewer';

export function ReadingTab() {
  const loadVideos = useAnalysisStore((s) => s.loadVideos);
  const games = useAnalysisStore((s) => s.games);
  const selectedId = useAnalysisStore((s) => s.selectedGameId);
  const selectGame = useAnalysisStore((s) => s.selectGame);
  const analysed = games.filter((g) => g.samples > 0);
  const game = analysed.find((g) => g.id === selectedId) ?? analysed[0];
  const maps = mapsWithReading();

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  return (
    <div className="reading">
      <section className="reading__section">
        <h3>Couloirs lus par le programme</h3>
        {maps.length === 0 ? <p className="games__empty">Aucune carte n'a de masque de couloirs (analysis/map_mask.py).</p> : maps.map((m) => <CorridorMap key={m} map={m} />)}
      </section>
      <section className="reading__section">
        <h3>Forme des joueurs sur la minimap</h3>
        {analysed.length === 0 ? (
          <p className="games__empty">Aucune game analysée : lance l'analyse dans l'onglet Analyse.</p>
        ) : (
          <>
            <label className="reading__pick">
              Game :{' '}
              <select value={game?.id} onChange={(e) => selectGame(Number(e.target.value))}>
                {analysed.map((g) => (
                  <option key={g.id} value={g.id}>
                    Game {games.indexOf(g) + 1}{g.map ? ` · ${g.map}` : ''}
                  </option>
                ))}
              </select>
            </label>
            {game && <ShapeViewer key={game.id} game={game} />}
          </>
        )}
      </section>
    </div>
  );
}
