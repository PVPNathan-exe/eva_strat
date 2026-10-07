// Lecteur HTML5 sur la vidéo locale (servie avec Range) : aucune barre YouTube.

import { useEffect, useRef } from 'react';
import { streamUrl } from '../../lib/analysisApi';
import { setVideoElement } from '../../lib/videoRef';
import { useAnalysisStore } from '../../store/analysisStore';

export function VideoPlayer({ videoId }: { videoId: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const seekRequest = useAnalysisStore((s) => s.seekRequest);
  const setCurrentTime = useAnalysisStore((s) => s.setCurrentTime);

  useEffect(() => {
    setVideoElement(ref.current);
    return () => setVideoElement(null);
  }, [videoId]);

  useEffect(() => {
    if (seekRequest && ref.current) ref.current.currentTime = seekRequest.t;
  }, [seekRequest]);

  return (
    <video
      key={videoId}
      ref={ref}
      className="player"
      src={streamUrl(videoId)}
      controls
      preload="metadata"
      onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
    />
  );
}
