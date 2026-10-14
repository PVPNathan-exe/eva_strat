// Frise des morts d'une game : deux couloirs (équipe suivie en haut, adversaires en bas), une marque par mort avec le numéro du joueur, le curseur de temps
// et la fenêtre visible. Anneau plein : trade ; anneau pointillé : revenge. Cliquer une marque place le curseur sur la mort. Couleurs : palette « a » et « b » (teamFollow).

import { numberOfSlot } from '../../lib/killTimeline';
import type { Death } from '../../lib/deathWindow';
import type { Palette } from '../../lib/teamFollow';
import { formatTime, timeToPct } from '../../lib/timeline';
import '../../styles/stats-replay.css';

interface Props {
  deaths: Death[];
  duration: number;
  /** Instant courant. */
  t: number;
  /** Fenêtre visible en secondes avant l'instant (0 : depuis le début). */
  windowS: number;
  /** Clés des morts affichées sur le plan à cet instant. */
  shown: Set<string>;
  active: string | null;
  paletteOf: (death: Death) => Palette;
  onActive: (key: string | null) => void;
  onSeek: (t: number) => void;
}

export function DeathStrip({ deaths, duration, t, windowS, shown, active, paletteOf, onActive, onSeek }: Props) {
  const from = windowS > 0 ? Math.max(0, t - windowS) : 0;
  const lane = (palette: Palette) =>
    deaths
      .filter((d) => paletteOf(d) === palette)
      .map((d) => {
        const kind = d.links.trade ? ' is-trade' : d.links.avengedBy || d.links.revengeKill ? ' is-revenge' : '';
        return (
          <button
            key={d.key}
            type="button"
            className={`strip__mark strip__mark--${palette}${kind}${shown.has(d.key) ? ' is-shown' : ''}${active === d.key ? ' is-active' : ''}`}
            style={{ left: `${timeToPct(d.life.t1, duration)}%` }}
            aria-label={`Mort ${d.n}, joueur ${numberOfSlot(d.life.slot)}, à ${formatTime(d.life.t1)}`}
            title={`Mort ${d.n} à ${formatTime(d.life.t1)}`}
            onClick={() => {
              onSeek(d.life.t1);
              onActive(d.key);
            }}
            onMouseEnter={() => onActive(d.key)}
            onMouseLeave={() => onActive(null)}
          >
            {numberOfSlot(d.life.slot)}
          </button>
        );
      });
  return (
    <div className="strip" role="group" aria-label="Frise des morts">
      <div className="strip__lanes">
        <i className="strip__window" style={{ left: `${timeToPct(from, duration)}%`, width: `${timeToPct(t, duration) - timeToPct(from, duration)}%` }} />
        <div className="strip__lane">{lane('a')}</div>
        <div className="strip__lane">{lane('b')}</div>
        <i className="strip__cursor" style={{ left: `${timeToPct(t, duration)}%` }} />
      </div>
      <div className="strip__axis">
        <span>0:00</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
