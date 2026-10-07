// Barre de lecture sous la vidéo : lecture/pause, ±5 s, position, vitesse et son.
// L'état lecture/pause vient des événements du <video> ; les déplacements passent par requestSeek.

import { useEffect, useState } from 'react';
import { formatTime } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';

const RATES = [0.5, 1, 1.5, 2, 4];

export function PlayerControls({ video, duration }: { video: React.RefObject<HTMLVideoElement | null>; duration: number }) {
  const currentTime = useAnalysisStore((s) => s.currentTime);
  const requestSeek = useAnalysisStore((s) => s.requestSeek);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    el.addEventListener('play', onPlay);
    el.addEventListener('pause', onPause);
    return () => {
      el.removeEventListener('play', onPlay);
      el.removeEventListener('pause', onPause);
    };
  }, [video]);

  const togglePlay = () => {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => {});
    else el.pause();
  };

  const skip = (delta: number) => requestSeek(Math.min(duration, Math.max(0, currentTime + delta)));

  const changeRate = (value: number) => {
    setRate(value);
    if (video.current) video.current.playbackRate = value;
  };

  const toggleMute = () => {
    setMuted(!muted);
    if (video.current) video.current.muted = !muted;
  };

  return (
    <div className="controls">
      <button onClick={togglePlay} title={playing ? 'Pause' : 'Lecture'}>
        {playing ? '⏸' : '▶'}
      </button>
      <button onClick={() => skip(-5)}>−5 s</button>
      <button onClick={() => skip(5)}>+5 s</button>
      <input
        className="controls__seek"
        type="range"
        min={0}
        max={duration}
        step={0.1}
        value={Math.min(currentTime, duration)}
        onChange={(e) => requestSeek(Number(e.target.value))}
      />
      <span className="controls__time">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
      <select value={rate} onChange={(e) => changeRate(Number(e.target.value))} title="Vitesse">
        {RATES.map((r) => (
          <option key={r} value={r}>{r}×</option>
        ))}
      </select>
      <button onClick={toggleMute} title={muted ? 'Activer le son' : 'Couper le son'}>
        {muted ? '🔇' : '🔊'}
      </button>
    </div>
  );
}
