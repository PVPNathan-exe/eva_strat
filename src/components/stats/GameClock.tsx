// Commandes de la chronologie de rejeu (Parcours, Morts) : lecture et pause, curseur de temps, vitesse. L'état vient de useGameClock.

import type { ReactNode } from 'react';
import { Pause, Play } from 'lucide-react';
import { SPEEDS } from '../../lib/gameClock';
import { formatTime } from '../../lib/timeline';
import type { Clock } from './useGameClock';
import '../../styles/stats-replay.css';

interface Props {
  clock: Clock;
  children?: ReactNode;
}

export function GameClock({ clock, children }: Props) {
  return (
    <div className="clock">
      <button type="button" className="clock__play" onClick={clock.toggle} aria-label={clock.playing ? 'Pause' : 'Lecture'} title={clock.playing ? 'Pause' : 'Lecture'}>
        {clock.playing ? <Pause className="ic" /> : <Play className="ic" />}
      </button>
      <span className="clock__time" aria-live="off">
        {formatTime(clock.t)} / {formatTime(clock.duration)}
      </span>
      <input
        type="range"
        className="clock__range"
        min={0}
        max={clock.duration}
        step={0.1}
        value={clock.t}
        onChange={(e) => clock.seek(Number(e.target.value))}
        aria-label="Instant de la game"
      />
      <label className="clock__speed">
        Vitesse
        <select value={clock.speed} onChange={(e) => clock.setSpeed(Number(e.target.value))}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              x{s}
            </option>
          ))}
        </select>
      </label>
      {children}
    </div>
  );
}
