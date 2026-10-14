// Chronologie d'une game par point (vues Retakes et Rotations) : une ligne par point avec les bandes de propriétaire (équipe suivie « a », adversaires « b », gris : neutre),
// éventuellement les périodes où le point est actif, les épisodes marqués (forme selon le résultat), le curseur de temps partagé avec l'horloge de rejeu.
// Cliquer un repère le choisit (le parent place le curseur au début de sa fenêtre) ; cliquer ailleurs sur une ligne place le curseur à cet instant.

import type { MouseEvent } from 'react';
import { axisTicks, timeAtFraction, type EpisodeMark, type Lane, type OwnerBand } from '../../lib/episodeClock';
import { formatTime, spanToPct } from '../../lib/timeline';
import '../../styles/stats-chrono.css';

interface Props {
  lanes: Lane[];
  duration: number;
  /** Instant courant (curseur). */
  t: number;
  /** Clé du repère choisi. */
  activeKey: string | null;
  onSeek: (t: number) => void;
  onPick: (mark: EpisodeMark) => void;
  /** Texte au survol d'une bande de propriétaire (nom de l'équipe). */
  ownerTitle: (band: OwnerBand) => string;
}

export function PointTimeline({ lanes, duration, t, activeKey, onSeek, onPick, ownerTitle }: Props) {
  const ticks = axisTicks(duration);
  const onTrack = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width > 0) onSeek(timeAtFraction((e.clientX - box.left) / box.width, duration));
  };
  return (
    <div className="ptl" role="group" aria-label="Chronologie des points">
      <div className="ptl__labels">
        {lanes.map((lane) => (
          <span key={lane.point} className="ptl__label">
            Point {lane.point}
          </span>
        ))}
      </div>
      <div className="ptl__tracks">
        {lanes.map((lane) => (
          <div key={lane.point} className="ptl__track" onClick={onTrack}>
            {lane.owners.map((b, i) => (
              <i key={i} className={`ptl__band ptl__band--${b.tone}`} style={{ left: `${b.left}%`, width: `${b.width}%` }} title={ownerTitle(b)} />
            ))}
            {lane.active.map((b, i) => (
              <i key={`a${i}`} className="ptl__active" style={{ left: `${b.left}%`, width: `${b.width}%` }} title={`Point actif de ${formatTime(b.t0)} à ${formatTime(b.t1)}`} />
            ))}
            {lane.owners.length === 0 && lane.active.length === 0 && <span className="ptl__nodata">propriétaire non lu</span>}
            {lane.marks.map((m) => (
              <i key={`s${m.key}`} className={`ptl__span${activeKey === m.key ? ' is-active' : ''}`} style={{ left: `${m.spanLeft}%`, width: `${m.spanWidth}%` }} />
            ))}
            {lane.marks.map((m) => (
              <button
                key={`m${m.key}`}
                type="button"
                className={`ptl__mark ptl__mark--${m.kind} ptl__mark--${m.tone}${m.palette ? ` pal pal--${m.palette}` : ''}${activeKey === m.key ? ' is-active' : ''}`}
                style={{ left: `${m.left}%` }}
                title={m.label}
                aria-label={m.label}
                aria-pressed={activeKey === m.key}
                onClick={(e) => {
                  e.stopPropagation();
                  onPick(m);
                }}
              />
            ))}
          </div>
        ))}
        <i className="ptl__cursor" style={{ left: `${spanToPct(t, 0, duration)}%` }} aria-hidden />
      </div>
      <div className="ptl__axis">
        {ticks.map((k) => (
          <span key={k.t} className="ptl__tick" style={{ left: `${k.left}%` }}>
            {k.label}
          </span>
        ))}
      </div>
    </div>
  );
}
