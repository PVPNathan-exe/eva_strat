// Lecteur HTML5 sur la vidéo locale (servie avec Range) : pas de contrôles natifs,
// la barre de lecture (PlayerControls) est placée sous l'image.

import { useEffect, useRef } from 'react';
import { streamUrl } from '../../lib/analysisApi';
import { setVideoElement } from '../../lib/videoRef';
import { useAnalysisStore } from '../../store/analysisStore';
import { PlayerControls } from './PlayerControls';

export function VideoPlayer({ videoId, duration }: { videoId: number; duration: number }) {
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

  const togglePlay = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  };

  return (
    <div className="player-box">
      <video
        key={videoId}
        ref={ref}
        className="player"
        src={streamUrl(videoId)}
        preload="metadata"
        onClick={togglePlay}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
      />
      <PlayerControls key={videoId} video={ref} duration={duration} />
    </div>
  );
}
