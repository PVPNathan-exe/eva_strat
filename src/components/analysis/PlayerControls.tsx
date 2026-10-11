// Barre de lecture sous la vidéo : lecture/pause, ±5 s, ±1 s, ±1 image, position, vitesse et son.
// L'état lecture/pause vient des événements du <video> ; les déplacements passent par requestSeek.

import { useEffect, useState } from 'react';
import { Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { formatTime, parseTime } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';

const RATES = [0.5, 1, 1.5, 2, 4];

export function PlayerControls({ video, duration, fps }: { video: React.RefObject<HTMLVideoElement | null>; duration: number; fps: number }) {
  const currentTime = useAnalysisStore((s) => s.currentTime);
  const requestSeek = useAnalysisStore((s) => s.requestSeek);
  const game = useAnalysisStore((s) => s.games.find((g) => g.id === s.selectedGameId));
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [goto, setGoto] = useState('');
  const [gotoInvalid, setGotoInvalid] = useState(false);

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

  // Pas fin pour la relecture : une image de la vidéo (1 / fps) ou une seconde. La vidéo est mise en pause pour que l'image reste fixe.
  const nudge = (delta: number) => {
    const el = video.current;
    el?.pause();
    // On part de la position réelle de la vidéo (l'événement timeupdate n'arrive que toutes les ~250 ms : des clics rapprochés partiraient d'une position périmée).
    requestSeek(Math.min(duration, Math.max(0, (el ? el.currentTime : currentTime) + delta)));
  };
  const frame = 1 / (fps > 0 ? fps : 30);

  const jump = () => {
    if (goto.trim() === '') return;
    const t = parseTime(goto);
    setGotoInvalid(t === null);
    if (t === null) return;
    requestSeek(Math.min(duration, t));
    setGoto('');
  };

  const changeRate = (value: number) => {
    setRate(value);
    const el = video.current;
    // L'élément <video> est un objet DOM externe : l'écrire est voulu.
    // eslint-disable-next-line react-hooks/immutability
    if (el) el.playbackRate = value;
  };

  const toggleMute = () => {
    setMuted(!muted);
    const el = video.current;
    // L'élément <video> est un objet DOM externe : l'écrire est voulu.
    // eslint-disable-next-line react-hooks/immutability
    if (el) el.muted = !muted;
  };

  return (
    <div className="controls">
      <button onClick={togglePlay} title={playing ? 'Pause' : 'Lecture'}>
        {playing ? <Pause className="ic" /> : <Play className="ic" />}
      </button>
      <button onClick={() => skip(-5)}>−5 s</button>
      <button onClick={() => nudge(-1)} title="Reculer d'une seconde">−1 s</button>
      <button onClick={() => nudge(-frame)} title="Image précédente de la vidéo">−1 i</button>
      <button onClick={() => nudge(frame)} title="Image suivante de la vidéo">+1 i</button>
      <button onClick={() => nudge(1)} title="Avancer d'une seconde">+1 s</button>
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
      <input
        className={`controls__goto${gotoInvalid ? ' is-invalid' : ''}`}
        type="text"
        inputMode="numeric"
        placeholder="aller à"
        title="Aller à un instant : 1:23, 1:02:03 ou 83 (secondes), puis Entrée"
        value={goto}
        onChange={(e) => {
          setGoto(e.target.value);
          setGotoInvalid(false);
        }}
        onKeyDown={(e) => e.key === 'Enter' && jump()}
        onBlur={jump}
      />
      <span className="controls__time">
        {formatTime(Math.floor(currentTime))}.{String(Math.floor((currentTime % 1) * 100)).padStart(2, '0')} / {formatTime(duration)}
      </span>
      {game && currentTime >= game.start_s && currentTime <= game.end_s && (
        <span className="controls__time" title="Temps de la game sélectionnée, comme dans la reconstitution">
          game {formatTime(Math.floor(currentTime - game.start_s))}.{String(Math.floor(((currentTime - game.start_s) % 1) * 100)).padStart(2, '0')}
        </span>
      )}
      <select value={rate} onChange={(e) => changeRate(Number(e.target.value))} title="Vitesse">
        {RATES.map((r) => (
          <option key={r} value={r}>{r}×</option>
        ))}
      </select>
      <button onClick={toggleMute} title={muted ? 'Activer le son' : 'Couper le son'}>
        {muted ? <VolumeX className="ic" /> : <Volume2 className="ic" />}
      </button>
    </div>
  );
}
