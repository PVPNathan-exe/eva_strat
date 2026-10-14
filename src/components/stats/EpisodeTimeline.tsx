// Frise du chrono d'une vague : une ligne par point avec les bandes de propriétaire (équipe suivie, adversaires, gris), les repères (départ du spawn, premier kill, prise du point),
// les morts numérotées et un curseur qui suit la souris. La fenêtre est celle du détail (`data.window` : 5 s de marge de chaque côté de la vague). Le bouton ouvre la vidéo 5 s avant l'instant clé (analysisStore.openAt : changement d'onglet et déplacement).
// Temps de game en entrée (secondes depuis le début de la game) : la conversion en temps de vidéo est faite par `videoSeek`.

import { useState, type MouseEvent } from 'react';
import { Play, X } from 'lucide-react';
import { causeLabel, episodeMarks, keyInstant, pctInWindow, playerLabel, timelineDeaths, timelineRows, VIDEO_LEAD_S, videoSeek, windowOf } from '../../lib/episodeFormat';
import { paletteOfSide, toneOfOwner } from '../../lib/episodeClock';
import type { FollowSpec } from '../../lib/teamFollow';
import { formatTime } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';
import type { Episode, PointOwner } from '../../types/stats';
import type { StatsGame } from './useStats';

interface Props {
  episode: Episode;
  owners: PointOwner[];
  game: StatsGame;
  /** Réglage d'équipe suivie : les bandes et les morts prennent la couleur de l'équipe par son nom. */
  spec: FollowSpec;
}

export function EpisodeTimeline({ episode, owners, game, spec }: Props) {
  const openAt = useAnalysisStore((s) => s.openAt);
  const [cursor, setCursor] = useState<number | null>(null); // position du curseur en pourcentage de la fenêtre
  const win = windowOf(episode);
  const rows = timelineRows({ ...episode, ...win }, owners, (o) => toneOfOwner(game, spec, o));
  const deaths = timelineDeaths(episode);
  const marks = episodeMarks(episode);
  const span = win.t1 - win.t0;
  const nameOf = (slot: number) => game.players.find((p) => p.slot === slot)?.name;

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setCursor(box.width > 0 ? Math.min(100, Math.max(0, ((e.clientX - box.left) / box.width) * 100)) : null);
  };

  return (
    <div className="eptl">
      <div className="eptl__plot">
        <div className="eptl__labels">
          {rows.map((row) => (
            <span key={row.point} className="eptl__label">Point {row.point}</span>
          ))}
          <span className="eptl__label">Morts</span>
        </div>
        <div className="eptl__tracks" onMouseMove={onMove} onMouseLeave={() => setCursor(null)}>
          {rows.map((row) => (
            <div key={row.point} className="eptl__track">
              {row.bands.map((b, i) => (
                <span key={i} className={`eptl__band eptl__band--${b.tone}`} style={{ left: `${b.left}%`, width: `${b.width}%` }} title={b.owner === 'none' ? 'Point neutre' : `Point à ${b.owner === 'A' ? (game.teamA ?? "l'équipe orange") : (game.teamB ?? "l'équipe bleue")}`} />
              ))}
              {row.bands.length === 0 && <span className="eptl__nodata">propriétaire non lu</span>}
            </div>
          ))}
          <div className="eptl__track eptl__track--deaths">
            {deaths.map((d) => (
              <span
                key={`${d.slot}:${d.t}`}
                tabIndex={0}
                className={`eptl__death eptl__death--${paletteOfSide(game, spec, d.team)}`}
                style={{ left: `${pctInWindow(win, d.t)}%` }}
                title={`${formatTime(d.t)} : ${playerLabel(d.slot, nameOf(d.slot))}${d.killer !== null ? `, tué par ${playerLabel(d.killer, nameOf(d.killer))}` : ''} (${causeLabel(d.cause)})`}
                aria-label={`Mort ${d.n}, ${playerLabel(d.slot, nameOf(d.slot))}, à ${formatTime(d.t)}`}
              >
                <X className="ic" />
                <span>{d.n}</span>
              </span>
            ))}
          </div>
          {/* Repères et curseur : lignes verticales sur toute la hauteur de la frise */}
          <div className="eptl__overlay" aria-hidden>
            {marks.map((m) => (
              <span key={m.label} className="eptl__mark" style={{ left: `${pctInWindow(win, m.t)}%` }} />
            ))}
            {cursor !== null && <span className="eptl__cursor" style={{ left: `${cursor}%` }} />}
          </div>
        </div>
      </div>
      <div className="eptl__axis">
        <div className="eptl__axisbar">
          <span>{formatTime(win.t0)}</span>
          {marks.map((m) => (
            <span key={m.label} className="eptl__marklabel" style={{ left: `${pctInWindow(win, m.t)}%` }}>
              {m.label} {formatTime(m.t)}
            </span>
          ))}
          <span>{formatTime(win.t1)}</span>
        </div>
      </div>
      <div className="eptl__foot">
        <span className="eptl__time">{cursor !== null ? `Curseur : ${formatTime(win.t0 + (cursor / 100) * span)}` : 'Survoler la frise pour lire le chrono.'}</span>
        <button type="button" className="eptl__video" onClick={() => void openAt(game.videoId, game.id, videoSeek(game.startS, keyInstant(episode)))} title={`Ouvre la vidéo ${VIDEO_LEAD_S} s avant l'instant clé`}>
          <Play className="ic" /> Voir dans la vidéo ({VIDEO_LEAD_S} s avant)
        </button>
      </div>
    </div>
  );
}
