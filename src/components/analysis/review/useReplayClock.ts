// Horloge du replay : suit la vidéo (image par image), ou une horloge propre (lecture, vitesse) pour rejouer sans la vidéo.

import { useEffect, useRef, useState } from 'react';
import { getVideoElement } from '../../../lib/videoRef';
import { useAnalysisStore } from '../../../store/analysisStore';
import type { Game } from '../../../types/analysis';

export const RATES = [0.5, 1, 2, 4, 8];

export function useReplayClock(game: Game) {
  const currentTime = useAnalysisStore((s) => s.currentTime);
  const [follow, setFollow] = useState(true);
  const [t, setT] = useState(game.start_s);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const raf = useRef(0);
  // Position de la vidéo lue à chaque image affichée (et non toutes les ~250 ms comme l'événement timeupdate) : mouvement continu.
  const [live, setLive] = useState<number | null>(null);

  useEffect(() => {
    if (!follow) return;
    let id = 0;
    const tick = () => {
      const el = getVideoElement();
      if (el) setLive((prev) => (prev === el.currentTime ? prev : el.currentTime));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [follow]);

  // Horloge propre : avance en temps réel x vitesse, s'arrête à la fin de la game.
  useEffect(() => {
    if (!playing || follow) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((cur) => {
        const next = cur + dt * rate;
        if (next >= game.end_s) {
          setPlaying(false);
          return game.end_s;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, follow, rate, game.end_s]);

  const time = follow ? Math.min(Math.max(live ?? currentTime, game.start_s), game.end_s) : t;

  /** Déplace le replay à l'instant donné (il quitte la vidéo). */
  const seek = (value: number) => {
    setFollow(false);
    setPlaying(false);
    setT(value);
  };

  const togglePlay = () => {
    if (follow) {
      setFollow(false);
      setT(time >= game.end_s - 0.5 ? game.start_s : time);
      setPlaying(true);
    } else {
      if (!playing && t >= game.end_s - 0.5) setT(game.start_s);
      setPlaying(!playing);
    }
  };

  /** Suivre la vidéo (vrai) ou garder l'instant affiché (faux). */
  const setFollowing = (on: boolean) => {
    setFollow(on);
    setPlaying(false);
    setT(time);
  };

  return { time, follow, playing, rate, setRate, seek, togglePlay, setFollowing, backToVideo: () => { setFollow(true); setPlaying(false); } };
}
