// Lecteur HTML5 sur la vidéo locale (servie avec Range) : pas de contrôles natifs,
// la barre de lecture (PlayerControls) est placée sous l'image.

import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { streamUrl } from '../../lib/analysisApi';
import { setVideoElement } from '../../lib/videoRef';
import { useAnalysisStore } from '../../store/analysisStore';
import { PlayerControls } from './PlayerControls';
import { VISION_LAYER_LABELS, type VisionLayers } from '../../lib/vision';
import { VisionOverlay } from './VisionOverlay';

const LAYERS_KEY = 'eva_strat:vision';
const ON_KEY = 'eva_strat:vision-on';
const ALL_LAYERS: VisionLayers = { zones: true, minimap: true, bandeaux: true, killfeed: true };

function loadLayers(): VisionLayers {
  try {
    return { ...ALL_LAYERS, ...(JSON.parse(localStorage.getItem(LAYERS_KEY) ?? '{}') as Partial<VisionLayers>) };
  } catch {
    return ALL_LAYERS;
  }
}

function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible : le choix n'est simplement pas retenu */
  }
}

export function VideoPlayer({ videoId, duration }: { videoId: number; duration: number }) {
  const ref = useRef<HTMLVideoElement>(null);
  const seekRequest = useAnalysisStore((s) => s.seekRequest);
  const setCurrentTime = useAnalysisStore((s) => s.setCurrentTime);
  const video = useAnalysisStore((s) => s.videos.find((v) => v.id === videoId));
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [layers, setLayers] = useState<VisionLayers>(loadLayers);
  const [visionOn, setVisionOn] = useState(() => {
    try {
      return localStorage.getItem(ON_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Taille réelle de l'image dans le lecteur (la vidéo est centrée, bords noirs possibles) : les calques s'y alignent.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const toggleLayer = (key: keyof VisionLayers) => {
    const next = { ...layers, [key]: !layers[key] };
    setLayers(next);
    remember(LAYERS_KEY, next);
  };
  const toggleVision = () => {
    setVisionOn(!visionOn);
    remember(ON_KEY, !visionOn);
  };
  const scale = video ? Math.min(box.w / video.width, box.h / video.height) : 0;
  const shown = video ? { w: video.width * scale, h: video.height * scale } : { w: 0, h: 0 };

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
      <div className="vision-bar">
        <button
          type="button"
          className={`vision-bar__toggle${visionOn ? ' is-on' : ''}`}
          aria-pressed={visionOn}
          onClick={toggleVision}
          title="Afficher ou masquer sur la vidéo ce que le programme lit"
        >
          {visionOn ? <Eye className="ic" /> : <EyeOff className="ic" />} Ce que voit le programme : {visionOn ? 'activé' : 'désactivé'}
        </button>
        {visionOn && (
          <div className="vision-bar__layers">
            {(Object.keys(VISION_LAYER_LABELS) as (keyof VisionLayers)[]).map((key) => (
              <label key={key}>
                <input type="checkbox" checked={layers[key]} onChange={() => toggleLayer(key)} />
                {VISION_LAYER_LABELS[key]}
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="player-stage" ref={stage}>
      <video
        key={videoId}
        ref={ref}
        className="player"
        src={streamUrl(videoId)}
        preload="metadata"
        onClick={togglePlay}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
      />
        {visionOn && Object.values(layers).some(Boolean) && (
          <div className="player-stage__vision" style={{ left: (box.w - shown.w) / 2, top: (box.h - shown.h) / 2, width: shown.w, height: shown.h }}>
            <VisionOverlay width={shown.w} height={shown.h} layers={layers} />
          </div>
        )}
      </div>
      <PlayerControls key={videoId} video={ref} duration={duration} />
    </div>
  );
}
