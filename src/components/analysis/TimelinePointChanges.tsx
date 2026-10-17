// Repères des changements de point de capture sur la barre zoomée : une bande de 10 s avant le changement et un trait au changement.
// Données : /api/stats/active (périodes du point actif). Carte sans changement ou route absente : aucun repère. Un clic place la vidéo au début de la bande.

import { useEffect, useMemo, useState } from 'react';
import { pointChangeLabel, pointChangeMarks } from '../../lib/pointChangeMarks';
import { statsApi } from '../../lib/statsApi';
import { formatTime, spanToPct } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';
import type { Game } from '../../types/analysis';
import type { PointActive } from '../../types/stats';

export function TimelinePointChanges({ game }: { game: Game }) {
  const requestSeek = useAnalysisStore((s) => s.requestSeek);
  // Périodes gardées avec l'identifiant de leur game : une réponse d'une autre game n'est jamais affichée.
  const [loaded, setLoaded] = useState<{ gameId: number; active: PointActive[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    statsApi
      .active(game.id)
      .then((active) => !cancelled && setLoaded({ gameId: game.id, active }))
      .catch(() => !cancelled && setLoaded({ gameId: game.id, active: [] }));
    return () => {
      cancelled = true;
    };
  }, [game.id, game.samples]); // relues quand l'analyse a écrit de nouvelles positions

  const active = loaded?.gameId === game.id ? loaded.active : null;
  const marks = useMemo(() => (active ? pointChangeMarks(active, game.start_s, game.end_s) : []), [active, game.start_s, game.end_s]);
  const pct = (videoT: number) => spanToPct(videoT, game.start_s, game.end_s);

  return (
    <>
      {marks.map((m) => (
        <div key={m.videoT} className="timeline__pc-window" style={{ left: `${pct(m.windowStartVideoT)}%`, width: `${pct(m.videoT) - pct(m.windowStartVideoT)}%` }} />
      ))}
      {marks.map((m) => (
        <button
          key={`l${m.videoT}`}
          type="button"
          className="timeline__pc-line"
          style={{ left: `${pct(m.videoT)}%` }}
          title={pointChangeLabel(m, formatTime)}
          aria-label={pointChangeLabel(m, formatTime)}
          onClick={(e) => {
            e.stopPropagation();
            requestSeek(m.windowStartVideoT);
          }}
        >
          <span className="timeline__pc-tag">{m.point}</span>
        </button>
      ))}
    </>
  );
}
