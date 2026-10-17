// Frise zoomée d'Outlaw : barre grise sur les moments où le point actif n'appartient à personne (/api/stats/owners).
// Sans cela la barre garde la couleur de la dernière équipe qui a capturé, et le temps où le point est neutre ne se voit pas.

import { useEffect, useMemo, useState } from 'react';
import { statsApi } from '../../lib/statsApi';
import { formatTime, spanToPct } from '../../lib/timeline';
import { uncapturedPeriods } from '../../lib/uncapturedPeriods';
import type { Game } from '../../types/analysis';
import type { PointOwner } from '../../types/stats';

export function TimelineUncaptured({ game }: { game: Game }) {
  // Périodes gardées avec l'identifiant de leur game : une réponse d'une autre game n'est jamais affichée.
  const [loaded, setLoaded] = useState<{ gameId: number; owners: PointOwner[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    statsApi
      .owners(game.id)
      .then((owners) => !cancelled && setLoaded({ gameId: game.id, owners }))
      .catch(() => !cancelled && setLoaded({ gameId: game.id, owners: [] }));
    return () => {
      cancelled = true;
    };
  }, [game.id, game.samples]);

  const owners = loaded?.gameId === game.id ? loaded.owners : null;
  const periods = useMemo(() => (owners ? uncapturedPeriods(owners, game.end_s - game.start_s) : []), [owners, game.start_s, game.end_s]);
  const pct = (gameT: number) => spanToPct(game.start_s + gameT, game.start_s, game.end_s);

  return (
    <>
      {periods.map((p) => (
        <div
          key={`${p.point}${p.t0}`}
          className="timeline__uncaptured"
          style={{ left: `${pct(p.t0)}%`, width: `${pct(p.t1) - pct(p.t0)}%` }}
          title={`Point ${p.point} pas capturé : ${formatTime(p.t0)} à ${formatTime(p.t1)}`}
        />
      ))}
    </>
  );
}
