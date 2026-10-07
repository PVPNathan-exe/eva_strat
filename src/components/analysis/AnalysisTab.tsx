import { useEffect } from 'react';
import { useAnalysisStore } from '../../store/analysisStore';
import { IngestBar } from './IngestBar';

export function AnalysisTab() {
  const loadVideos = useAnalysisStore((s) => s.loadVideos);

  useEffect(() => {
    void loadVideos();
  }, [loadVideos]);

  return (
    <div className="analysis">
      <IngestBar />
      <div className="analysis__body">
        <p className="analysis__empty">Colle un chemin de vidéo ou une URL pour commencer.</p>
      </div>
    </div>
  );
}
