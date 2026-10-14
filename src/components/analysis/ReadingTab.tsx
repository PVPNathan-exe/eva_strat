// Onglet « Lecture » : ce que le programme sait de la carte (couloirs), la forme des joueurs qu'il a lue sur la minimap, et la cartographie à la main.
// Trois sous-onglets : une seule chose à la fois à l'écran.

import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { mapsWithReading } from '../../lib/mapReading';
import { useAnalysisStore } from '../../store/analysisStore';
import { CaptureSchedule } from './CaptureSchedule';
import { CorridorLegend } from './CorridorLegend';
import { CorridorMap } from './CorridorMap';
import { MapMapping } from './MapMapping';
import { ShapeViewer } from './ShapeViewer';

type Sub = 'couloirs' | 'joueurs' | 'cartographie';
const SUBS: { id: Sub; label: string }[] = [
  { id: 'couloirs', label: 'Couloirs lus' },
  { id: 'joueurs', label: 'Joueurs sur la minimap' },
  { id: 'cartographie', label: 'Cartographie à la main' },
];

export function ReadingTab() {
  const loadVideos = useAnalysisStore((s) => s.loadVideos);
  const games = useAnalysisStore((s) => s.games);
  const selectedId = useAnalysisStore((s) => s.selectedGameId);
  const selectGame = useAnalysisStore((s) => s.selectGame);
  const analysed = games.filter((g) => g.samples > 0);
  const game = analysed.find((g) => g.id === selectedId) ?? analysed[0];
  const maps = mapsWithReading();
  const [chosenMap, setChosenMap] = useState('Polaris');
  const [sub, setSub] = useState<Sub>('couloirs');
  const map = maps.includes(chosenMap) ? chosenMap : maps[0];

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  const mapPicker = (
    <label className="reading__pick">
      Carte
      <select value={map} onChange={(e) => setChosenMap(e.target.value)}>
        {maps.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="reading">
      <div className="advanced-note" role="note">
        <AlertTriangle className="ic" />
        <span>
          Onglet avancé : ce qui est modifié ici (cartographie, corrections, « Appliquer au programme ») change les calculs de l'analyse. Sauvegarde <code>data/eva.db</code> avant de t'y aventurer.
        </span>
      </div>
      <div className="reading__bar">
        <nav className="subtabs" aria-label="Sections de l'onglet Lecture">
          {SUBS.map((s) => (
            <button key={s.id} className={sub === s.id ? 'is-active' : ''} onClick={() => setSub(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>
        {sub !== 'joueurs' && maps.length > 0 && mapPicker}
        {sub === 'joueurs' && analysed.length > 0 && (
          <label className="reading__pick">
            Game
            <select value={game?.id} onChange={(e) => selectGame(Number(e.target.value))}>
              {analysed.map((g) => (
                <option key={g.id} value={g.id}>
                  Game {games.indexOf(g) + 1}
                  {g.map ? ` · ${g.map}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {sub === 'couloirs' &&
        (maps.length === 0 ? (
          <p className="games__empty">Aucune carte n'a de masque de couloirs (analysis/map_mask.py).</p>
        ) : (
          <div className="reading__split">
            <CorridorMap key={map} map={map} />
            <aside className="reading__side">
              <CorridorLegend />
              <CaptureSchedule key={`${map}-${game?.map === map ? game.id : 'none'}`} map={map} gameId={game?.map === map ? game.id : undefined} />
            </aside>
          </div>
        ))}

      {sub === 'joueurs' &&
        (analysed.length === 0 ? <p className="games__empty">Aucune game analysée : lance l'analyse dans l'onglet Analyse.</p> : game && <ShapeViewer key={game.id} game={game} />)}

      {sub === 'cartographie' && maps.length > 0 && <MapMapping key={map} map={map} />}
    </div>
  );
}
