// Calendrier des points de capture d'une carte où un seul point est actif à la fois (Outlaw) : à quelle heure du chrono le point change, et, pour la game choisie, quel point
// le programme a vu sur la minimap à cet instant (capture_points.py). Pour les analyses complètes : qui tient quel point à quel moment.

import { useEffect, useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { captureCalendarOf, seenAt } from '../../lib/captureSchedule';
import { formatTime } from '../../lib/timeline';
import type { CaptureBox } from '../../types/analysis';

export function CaptureSchedule({ map, gameId }: { map: string; gameId?: number }) {
  const calendar = captureCalendarOf(map);
  const [boxes, setBoxes] = useState<CaptureBox[]>([]);

  useEffect(() => {
    if (gameId === undefined) return;
    let live = true;
    analysisApi
      .captureBoxes(gameId)
      .then((b) => live && setBoxes(b))
      .catch(() => live && setBoxes([]));
    return () => {
      live = false;
    };
  }, [gameId]);

  if (!calendar) return null;
  const shown = gameId === undefined ? [] : boxes;
  const fromPlan = Object.entries(calendar.points).filter(([, p]) => !p.vu && p.plan).map(([k]) => k);
  const unseen = Object.entries(calendar.points).filter(([, p]) => !p.vu && !p.plan).map(([k]) => k);
  return (
    <div className="capschedule">
      <h4>Changements de point de capture ({formatTime(calendar.durationS)} de jeu)</h4>
      <table className="capschedule__table">
        <thead>
          <tr>
            <th>Chrono</th>
            <th>Depuis le début</th>
            <th>Point vu dans la game</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{formatTime(calendar.durationS)}</td>
            <td>0:00</td>
            <td>début de la game</td>
          </tr>
          {calendar.schedule.map((e) => {
            const seen = seenAt(shown, e.t);
            return (
              <tr key={e.restant}>
                <td>
                  {e.restant}
                  {e.source === 'deduit' ? ' (déduit)' : ''}
                </td>
                <td>{formatTime(e.t)}</td>
                <td>{gameId === undefined ? 'aucune game' : seen ? `point ${seen.point ?? '?'}` : shown.length === 0 ? 'non lu' : 'pas de changement vu'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="marks__help">
        Un seul point est actif à la fois et il change toutes les 1 min 30. Le premier est toujours C ; la suite varie d'une game à l'autre. Les zones de capture tracées à la main ne sont que
        des indications : le programme cherche le point actif sur la minimap{fromPlan.length > 0 ? ` (point ${fromPlan.join(', ')} jamais vu sur les games lues : position lue sur le plan stratégique)` : ''}{unseen.length > 0 ? ` (point ${unseen.join(', ')} : position seulement indiquée)` : ''}.
      </p>
    </div>
  );
}
