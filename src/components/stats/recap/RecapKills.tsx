// Liste des kills du Récap avec leur note (impact de -2 à +3, convention). Chaque ligne : l'instant (clic : ouvre la vidéo 5 s avant), tueur et victime à la couleur de leur équipe,
// la note du kill et celle de la mort (l'opposée), et une ligne dépliable avec les raisons en clair. Temps en secondes de game (comme les tables Stats).

import { Play } from 'lucide-react';
import { impactTone, killSeek, killSentence, opposite, reasonsText, signed } from '../../../lib/recapFormat';
import { VIDEO_LEAD_S } from '../../../lib/episodeFormat';
import { palClass, paletteOf, type FollowSpec } from '../../../lib/teamFollow';
import { formatTime } from '../../../lib/timeline';
import { useAnalysisStore } from '../../../store/analysisStore';
import type { KillRow } from '../../../types/statsRecap';
import type { StatsGame } from '../useStats';

interface Props {
  rows: KillRow[];
  replay: StatsGame;
  spec: FollowSpec;
  /** Pseudo d'un joueur (null : inconnu). */
  nameOf: (slot: number) => string | null | undefined;
}

export function RecapKills({ rows, replay, spec, nameOf }: Props) {
  const openAt = useAnalysisStore((s) => s.openAt);
  return (
    <ol className="recap__kills">
      {rows.map((r) => {
        const killerPal = r.killer !== null ? palClass(paletteOf(replay, spec, r.killer), r.killer) : 'recap__nobody';
        const victimPal = palClass(paletteOf(replay, spec, r.victim), r.victim);
        const death = opposite(r.impact);
        return (
          <li key={r.key} className="recap__kill">
            <button type="button" className="recap__when" title={`Ouvre la vidéo ${VIDEO_LEAD_S} s avant`} onClick={() => void openAt(replay.videoId, replay.id, killSeek(replay.startS, r.t))}>
              <Play className="ic" /> {formatTime(r.t)}
            </button>
            <span className="recap__sentence">
              <i className={`recap__dot ${killerPal}`} aria-hidden />
              <i className={`recap__dot ${victimPal}`} aria-hidden />
              {killSentence(r, nameOf)}
            </span>
            <span className={`recap__note recap__note--${impactTone(r.impact)}`} title="Note du kill, du point de vue de l'équipe du tueur (convention)">
              Kill {signed(r.impact)}
            </span>
            <span className={`recap__note recap__note--${impactTone(death)}`} title="Note de la mort : l'opposée de celle du kill">
              Mort {signed(death)}
            </span>
            <details className="recap__why">
              <summary>Raisons</summary>
              <p>{reasonsText(r.reasons)}</p>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
