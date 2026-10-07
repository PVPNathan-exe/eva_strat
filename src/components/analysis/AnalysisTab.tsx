import { useEffect } from 'react';
import { useAnalysisStore } from '../../store/analysisStore';
import { IngestBar } from './IngestBar';
import { SegmentTimeline } from './SegmentTimeline';
import { VideoPlayer } from './VideoPlayer';

export function AnalysisTab() {
  const loadVideos = useAnalysisStore((s) => s.loadVideos);
  const videoId = useAnalysisStore((s) => s.videoId);
  const video = useAnalysisStore((s) => s.videos.find((v) => v.id === s.videoId));

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  return (
    <div className="analysis">
      <IngestBar />
      {videoId !== null && video ? (
        <div className="analysis__body">
          <section className="analysis__main">
            <VideoPlayer videoId={videoId} />
            <SegmentTimeline duration={video.duration_s} />
          </section>
          <aside className="analysis__side" />
        </div>
      ) : (
        <div className="analysis__body">
          <p className="analysis__empty">Colle un chemin de vidéo ou une URL pour commencer.</p>
        </div>
      )}
    </div>
  );
}
