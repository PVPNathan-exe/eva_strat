// Crochet de l'horloge de rejeu d'une game : instant courant, lecture et pause, vitesse. Le temps avance image par image (requestAnimationFrame) tant que la lecture est active.
// L'horloge est liée à une clé (la game rejouée) : changer de game remet le temps à zéro et arrête la lecture, sans setState dans un effet.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { advance, clampTime, DEFAULT_SPEED } from '../../lib/gameClock';

interface State {
  key: string;
  t: number;
  playing: boolean;
  speed: number;
}

export interface Clock {
  /** Instant courant, secondes depuis le début de la game. */
  t: number;
  duration: number;
  playing: boolean;
  speed: number;
  seek: (t: number) => void;
  toggle: () => void;
  pause: () => void;
  setSpeed: (speed: number) => void;
}

export function useGameClock(key: string, duration: number): Clock {
  const [state, setState] = useState<State>({ key, t: 0, playing: false, speed: DEFAULT_SPEED });
  // État d'une autre game : on repart de zéro, à l'arrêt (la vitesse choisie reste)
  const cur = useMemo<State>(() => (state.key === key ? state : { key, t: 0, playing: false, speed: state.speed }), [state, key]);
  const playing = cur.playing;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setState((prev) => {
        const base: State = prev.key === key ? prev : { key, t: 0, playing: false, speed: prev.speed };
        if (!base.playing) return base;
        const r = advance(base.t, dt, base.speed, duration);
        return { ...base, t: r.t, playing: !r.ended };
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, key, duration]);

  const seek = useCallback((t: number) => setState({ ...cur, t: clampTime(t, duration) }), [cur, duration]);
  const toggle = useCallback(() => {
    // Relancer depuis la fin repart du début
    if (cur.playing) setState({ ...cur, playing: false });
    else setState({ ...cur, t: cur.t >= duration - 0.05 ? 0 : cur.t, playing: true });
  }, [cur, duration]);
  const pause = useCallback(() => setState({ ...cur, playing: false }), [cur]);
  const setSpeed = useCallback((speed: number) => setState({ ...cur, speed }), [cur]);
  return { t: clampTime(cur.t, duration), duration, playing, speed: cur.speed, seek, toggle, pause, setSpeed };
}
