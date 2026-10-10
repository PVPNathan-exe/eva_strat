import { useEffect, useState } from 'react';
import { useAnalysisStore } from '../../store/analysisStore';
import { CalibrationEditor } from './CalibrationEditor';
import { GameList } from './GameList';
import { CommentsPanel } from './CommentsPanel';
import { AnalysisPlan } from './AnalysisPlan';
import { IngestBar } from './IngestBar';
import { ReplayPanel } from './ReplayPanel';
import { SegmentTimeline } from './SegmentTimeline';
import { VideoPlayer } from './VideoPlayer';

export function AnalysisTab() {
  const loadVideos = useAnalysisStore((s) => s.loadVideos);
  const videoId = useAnalysisStore((s) => s.videoId);
  const video = useAnalysisStore((s) => s.videos.find((v) => v.id === s.videoId));

  const [calibrating, setCalibrating] = useState(false);
  const [replayLarge, setReplayLarge] = useState(false);
  const games = useAnalysisStore((s) => s.games);
  const selectedGame = useAnalysisStore((s) => s.games.find((g) => g.id === s.selectedGameId));
  const gameNumber = selectedGame ? games.findIndex((g) => g.id === selectedGame.id) + 1 : 0;

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  return (
    <div className="analysis">
      <div className="analysis__body">
        <section className="analysis__main">
          <IngestBar />
          {videoId !== null && video ? (
            <>
              <VideoPlayer key={videoId} videoId={videoId} duration={video.duration_s} />
              <SegmentTimeline duration={video.duration_s} />
              <AnalysisPlan />
              <CommentsPanel videoName={video.path.split(/[\\/]/).pop() ?? ''} />
              <button className="analysis__calibrate" onClick={() => setCalibrating(true)}>
                Calibrer les zones du HUD
              </button>
            </>
          ) : (
            <p className="analysis__empty">Colle un chemin de vidéo ou une URL pour commencer.</p>
          )}
        </section>
        {videoId !== null && video && (
          <aside className="analysis__side">
            {selectedGame && selectedGame.samples > 0 && (
              <section className="replay-box">
                <header>
                  <strong>Replay · Game {gameNumber}</strong>
                  <button onClick={() => setReplayLarge(true)}>Agrandir</button>
                </header>
                <ReplayPanel key={`${selectedGame.id}-${selectedGame.map}`} game={selectedGame} />
              </section>
            )}
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
