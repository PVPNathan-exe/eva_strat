// Barre de la frise zoomée sur une game : morceaux orange ou bleus selon l'équipe qui capture (règle dans lib/captureTimeline.ts).
// Sans lecture de capture (étape 2 pas faite), la barre verte de la game reste.

import { useEffect, useMemo, useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { captureSegments, type CaptureTeam } from '../../lib/captureTimeline';
import { formatTime, spanToPct } from '../../lib/timeline';
import type { CaptureSeries, Game } from '../../types/analysis';

const TEAM_LABEL: Record<'A' | 'B', string> = { A: 'orange', B: 'bleue' };

/** Texte de l'infobulle d'un morceau (temps dans la game). */
function segmentTitle(team: CaptureTeam, t0: number, t1: number, start: number): string {
  const span = `${formatTime(t0 - start)} à ${formatTime(t1 - start)}`;
  return team ? `Équipe ${TEAM_LABEL[team]} capture : ${span}` : `Personne ne capture encore, ou aucune lecture : ${span}`;
}

export function TimelineCapture({ game }: { game: Game }) {
  // Série gardée avec l'identifiant de sa game : une réponse d'une autre game n'est jamais affichée.
  const [loaded, setLoaded] = useState<{ gameId: number; series: CaptureSeries | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    analysisApi
      .capture(game.id)
      .then((series) => !cancelled && setLoaded({ gameId: game.id, series }))
      .catch(() => !cancelled && setLoaded({ gameId: game.id, series: null }));
    return () => {
      cancelled = true;
    };
  }, [game.id, game.samples, game.captureRead]); // relue quand l'analyse a écrit les scores ou les positions

  const series = loaded?.gameId === game.id ? loaded.series : null;
  const segments = useMemo(() => captureSegments(series, game.start_s, game.end_s), [series, game.start_s, game.end_s]);

  if (segments.length === 0) {
    return <div className="timeline__game is-selected" style={{ left: 0, width: '100%' }} title="Pas encore de lecture de capture pour cette game" />;
  }
  return (
    <>
      {segments.map((s) => (
        <div
          key={s.t0}
          className={`timeline__capture timeline__capture--${s.team ?? 'none'}`}
          style={{
            left: `${spanToPct(s.t0, game.start_s, game.end_s)}%`,
            width: `${spanToPct(s.t1, game.start_s, game.end_s) - spanToPct(s.t0, game.start_s, game.end_s)}%`,
          }}
          title={segmentTitle(s.team, s.t0, s.t1, game.start_s)}
        />
      ))}
    </>
  );
}
