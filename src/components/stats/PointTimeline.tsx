// Chronologie d'une game par point (vues Retakes et Rotations) : une ligne par point avec les bandes de propriétaire (équipe suivie « a », adversaires « b », gris : neutre),
// éventuellement les périodes où le point est actif, les repères marqués (forme selon le résultat), le curseur de temps partagé avec l'horloge de rejeu.
// Une vague (Retakes) est une barre du départ du spawn à la résolution, colorée par l'équipe, avec un trait au premier kill et le symbole de l'issue à la fin ; la barre est rayée quand la vague est progressive.
// Cliquer un repère ou une barre le choisit (le parent place le curseur à son début) ; cliquer ailleurs sur une ligne place le curseur à cet instant.

import type { CSSProperties, MouseEvent } from 'react';
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
  /** Si donné, l'étiquette d'un point est un bouton (le parent place le curseur au prochain moment où ce point devient actif) ; un point jamais actif dans la game est grisé. */
  onPickPoint?: (point: string) => void;
  /** Vrai si le point a un moment où aller (par défaut : il a au moins une période active). */
  canPickPoint?: (point: string) => boolean;
  /** Texte au survol d'une bande de propriétaire (nom de l'équipe). */
  ownerTitle: (band: OwnerBand) => string;
}

/** Nombre de rangées d'une ligne, lu par le CSS (hauteur de la ligne et de son étiquette). */
const rowsStyle = (lane: Lane): CSSProperties => ({ '--rows': lane.rows }) as CSSProperties;

export function PointTimeline({ lanes, duration, t, activeKey, onSeek, onPick, onPickPoint, canPickPoint, ownerTitle }: Props) {
  const ticks = axisTicks(duration);
  const hasBars = lanes.some((lane) => lane.marks.some((m) => m.bar));
  const onTrack = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (box.width > 0) onSeek(timeAtFraction((e.clientX - box.left) / box.width, duration));
  };
  const pick = (e: MouseEvent, m: EpisodeMark) => {
    e.stopPropagation();
    onPick(m);
  };
  return (
    <div className={`ptl${hasBars ? ' ptl--waves' : ''}`} role="group" aria-label="Chronologie des points">
      <div className="ptl__labels">
        {lanes.map((lane) => {
          if (!onPickPoint) {
            return (
              <span key={lane.point} className="ptl__label" style={rowsStyle(lane)}>
                Point {lane.point}
              </span>
            );
          }
          const never = canPickPoint ? !canPickPoint(lane.point) : lane.active.length === 0;
          return (
            <button
              key={lane.point}
              type="button"
              className={`ptl__label ptl__label--button${never ? ' is-never' : ''}`}
              style={rowsStyle(lane)}
              disabled={never}
              title={never ? `Le point ${lane.point} n'est jamais actif dans cette game` : `Aller au prochain moment où le point ${lane.point} devient actif (20 s avant)`}
              onClick={() => onPickPoint(lane.point)}
            >
              Point {lane.point}
            </button>
          );
        })}
      </div>
      <div className="ptl__tracks">
        {lanes.map((lane) => (
          <div key={lane.point} className="ptl__track" style={rowsStyle(lane)} onClick={onTrack}>
            {lane.owners.map((b, i) => (
              <i key={i} className={`ptl__band ptl__band--${b.tone}`} style={{ left: `${b.left}%`, width: `${b.width}%` }} title={ownerTitle(b)} />
            ))}
            {lane.active.map((b, i) => (
              <i key={`a${i}`} className="ptl__active" style={{ left: `${b.left}%`, width: `${b.width}%` }} title={`Point actif de ${formatTime(b.t0)} à ${formatTime(b.t1)}`} />
            ))}
            {lane.owners.length === 0 && lane.active.length === 0 && <span className="ptl__nodata">{onPickPoint && canPickPoint && !canPickPoint(lane.point) ? 'jamais actif dans cette game' : 'propriétaire non lu'}</span>}
            {lane.marks.map((m) =>
              m.bar ? null : <i key={`s${m.key}`} className={`ptl__span${activeKey === m.key ? ' is-active' : ''}`} style={{ left: `${m.spanLeft}%`, width: `${m.spanWidth}%` }} />,
            )}
            {lane.marks.map((m) =>
              m.bar ? (
                <button
                  key={`w${m.key}`}
                  type="button"
                  className={`ptl__wave${m.bar.speed === 'progressif' ? ' ptl__wave--progressif' : ''} pal pal--${m.palette ?? 'a'}${activeKey === m.key ? ' is-active' : ''}`}
                  style={{ left: `${m.bar.left}%`, width: `${m.bar.width}%`, '--row': m.bar.row } as CSSProperties}
                  title={m.label}
                  aria-label={`Vague ${m.label}`}
                  aria-pressed={activeKey === m.key}
                  onClick={(e) => pick(e, m)}
                >
                  {m.bar.contactLeft !== null && <i className="ptl__contact" style={{ left: `${((m.bar.contactLeft - m.bar.left) / m.bar.width) * 100}%` }} />}
                </button>
              ) : null,
            )}
            {lane.marks.map((m) => (
              <button
                key={`m${m.key}`}
                type="button"
                className={`ptl__mark ptl__mark--${m.tone} ptl__mark--${m.kind}${m.bar ? ' ptl__mark--wave' : ''}${m.palette ? ` pal pal--${m.palette}` : ''}${activeKey === m.key ? ' is-active' : ''}`}
                style={{ left: `${m.left}%`, ...(m.bar ? { '--row': m.bar.row } : {}) } as CSSProperties}
                title={m.label}
                aria-label={m.label}
                aria-pressed={activeKey === m.key}
                onClick={(e) => pick(e, m)}
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
