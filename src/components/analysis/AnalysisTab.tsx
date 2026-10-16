import { useEffect, useState } from 'react';
import { useAnalysisStore } from '../../store/analysisStore';
import { CalibrationEditor } from './CalibrationEditor';
import { GameList } from './GameList';
import { CommentsPanel } from './CommentsPanel';
import { AnalysisPlan } from './AnalysisPlan';
import { IngestBar } from './IngestBar';
import { ReplayPanel } from './ReplayPanel';
import { ReviewScreen } from './review/ReviewScreen';
import { SegmentTimeline } from './SegmentTimeline';
import { VideoPlayer } from './VideoPlayer';

// Mise en page : la colonne principale empile la vidéo, sa barre de temps, la reconstruction (écran de review) puis le plan et les commentaires ;
// la liste des games reste à droite (sous la colonne principale quand l'écran est étroit, voir analysis-shell.css).
export function AnalysisTab() {
  const loadVideos = useAnalysisStore((s) => s.loadVideos);
  const loadTeams = useAnalysisStore((s) => s.loadTeams);
  const videoId = useAnalysisStore((s) => s.videoId);
  const video = useAnalysisStore((s) => s.videos.find((v) => v.id === s.videoId));

  const [calibrating, setCalibrating] = useState(false);
  const [replayLarge, setReplayLarge] = useState(false);
  const games = useAnalysisStore((s) => s.games);
  const selectedGame = useAnalysisStore((s) => s.games.find((g) => g.id === s.selectedGameId));
  const gameNumber = selectedGame ? games.findIndex((g) => g.id === selectedGame.id) + 1 : 0;

  useEffect(() => {
    void loadVideos();
    void loadTeams().catch(() => undefined);
  }, [loadVideos, loadTeams]);

  return (
    <div className="analysis">
      <div className="analysis__body">
        <section className="analysis__main">
          <IngestBar onCalibrate={() => setCalibrating(true)} />
          {videoId !== null && video ? (
            <>
              <VideoPlayer key={videoId} videoId={videoId} duration={video.duration_s} />
              <SegmentTimeline duration={video.duration_s} />
              <ReviewScreen game={selectedGame} number={gameNumber} onEnlarge={() => setReplayLarge(true)} />
              <AnalysisPlan />
              <CommentsPanel videoName={video.path.split(/[\\/]/).pop() ?? ''} />
            </>
          ) : (
            <p className="analysis__empty">Colle un chemin de vidéo ou une URL pour commencer.</p>
          )}
        </section>
        {videoId !== null && video && (
          <aside className="analysis__side">
            <GameList videoId={videoId} duration={video.duration_s} />
          </aside>
        )}
      </div>
      {replayLarge && selectedGame && (
        <div className="calib">
          <div className="calib__panel replay-modal">
            <div className="calib__head">
              <h3>Replay · Game {gameNumber}{selectedGame.map ? ` · ${selectedGame.map}` : ''}</h3>
              <button onClick={() => setReplayLarge(false)}>Fermer</button>
            </div>
            <ReplayPanel key={`${selectedGame.id}-${selectedGame.map}`} game={selectedGame} large />
          </div>
        </div>
      )}
      {calibrating && <CalibrationEditor onClose={() => setCalibrating(false)} />}
    </div>
  );
}
