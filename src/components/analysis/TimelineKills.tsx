// Une rangée de kills sur la frise zoomée : au-dessus de la barre l'équipe orange, en dessous la bleue, puis une rangée grise
// pour les kills sans équipe tueuse sûre. Chaque kill est une tête de mort de la couleur de la rangée ; un tueur déduit est entouré
// d'un cercle en pointillé, un marqueur regroupé porte le nombre de kills. Un clic place la vidéo KILL_LEAD_S avant le kill
// (lecture ou pause gardée).

import { useMemo } from 'react';
import { Skull } from 'lucide-react';
import { KILL_MARK_PX, killLabel, killRow, killSeekTime, laneCount, stackKills, type KillRow } from '../../lib/killTimeline';
import { spanToPct } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';
import type { Game } from '../../types/analysis';

const ROW_LABEL: Record<KillRow, string> = { A: 'Kills de l’équipe orange', B: 'Kills de l’équipe bleue', neutral: 'Kills sans équipe (suicide, décor, tueur non lu)' };

/** Hauteur d'une sous-rangée (pixels), reprise par le CSS (--lane) : marqueur de 16 px, pastille qui dépasse de 3 px en haut. */
const LANE_PX = 20;

export function TimelineKills({ game, row, width }: { game: Game; row: KillRow; width: number }) {
  const requestSeek = useAnalysisStore((s) => s.requestSeek);
  const span = game.end_s - game.start_s;
  // Écart minimal entre deux marqueurs d'une sous-rangée, en secondes : largeur d'un marqueur ramenée à l'échelle de la barre.
  const minGap = width > 0 ? (KILL_MARK_PX / width) * span : 0;
  const markers = useMemo(
    () => stackKills(game.kills.filter((k) => killRow(k) === row && k.t >= game.start_s && k.t <= game.end_s), minGap),
    [game.kills, game.start_s, game.end_s, row, minGap],
  );
  const nameOf = (slot: number) => game.players.find((p) => p.slot === slot)?.name;

  return (
    <div
      className={`timeline__kills timeline__kills--${row}`}
      style={{ height: laneCount(markers) * LANE_PX, ['--lane' as string]: `${LANE_PX}px` }}
      title={ROW_LABEL[row]}
    >
      {markers.map((m) => {
        const labels = m.kills.map((k) => killLabel(k, game.start_s, nameOf));
        return (
          <button
            key={`${m.t}-${m.kills[0].victim}`}
            type="button"
            className={`timeline__kill${m.kills.every((k) => k.kind === 'inferred') ? ' is-inferred' : ''}`}
            style={{ ['--x' as string]: `${spanToPct(m.t, game.start_s, game.end_s)}%`, ['--lane-i' as string]: m.lane }}
            title={labels.join('\n')}
            aria-label={`${m.kills.length > 1 ? `${m.kills.length} kills : ` : 'Kill : '}${labels.join(' ; ')}`}
            onClick={() => requestSeek(killSeekTime(m.kills[0], game.start_s))}
          >
            <Skull className="ic" aria-hidden="true" />
            {m.kills.length > 1 && <span className="timeline__kill-count">{m.kills.length}</span>}
          </button>
        );
      })}
    </div>
  );
}
