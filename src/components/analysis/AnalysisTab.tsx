import { useEffect, useState } from 'react';
import { useAnalysisStore } from '../../store/analysisStore';
import { CalibrationEditor } from './CalibrationEditor';
import { GameList } from './GameList';
import { IngestBar } from './IngestBar';
import { SegmentTimeline } from './SegmentTimeline';
import { VideoPlayer } from './VideoPlayer';

export function AnalysisTab() {
  const loadVideos = useAnalysisStore((s) => s.loadVideos);
  const videoId = useAnalysisStore((s) => s.videoId);
  const video = useAnalysisStore((s) => s.videos.find((v) => v.id === s.videoId));

  const [calibrating, setCalibrating] = useState(false);

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
              <VideoPlayer videoId={videoId} duration={video.duration_s} />
              <SegmentTimeline duration={video.duration_s} />
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
            <GameList videoId={videoId} duration={video.duration_s} />
          </aside>
        )}
      </div>
      {calibrating && <CalibrationEditor onClose={() => setCalibrating(false)} />}
    </div>
  );
}
