// Barre de temps : games en vert, lobby en gris, début en attente en jaune, zones à vérifier hachurées en orange.
// Un clic déplace la lecture.

import { formatTime, pctToTime, timeToPct } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';

export function SegmentTimeline({ duration }: { duration: number }) {
  const games = useAnalysisStore((s) => s.games);
  const selectedGameId = useAnalysisStore((s) => s.selectedGameId);
  const currentTime = useAnalysisStore((s) => s.currentTime);
  const pendingStart = useAnalysisStore((s) => s.pendingStart);
  const requestSeek = useAnalysisStore((s) => s.requestSeek);
  const selectGame = useAnalysisStore((s) => s.selectGame);

  const onBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    requestSeek(pctToTime(((e.clientX - rect.left) / rect.width) * 100, duration));
  };

  return (
    <div className="timeline">
      <div className="timeline__bar" onClick={onBarClick}>
        {games.map((g) => (
          <div
            key={g.id}
            className={`timeline__game${g.id === selectedGameId ? ' is-selected' : ''}`}
            style={{
              left: `${timeToPct(g.start_s, duration)}%`,
              width: `${timeToPct(g.end_s, duration) - timeToPct(g.start_s, duration)}%`,
            }}
            title={`${formatTime(g.start_s)} → ${formatTime(g.end_s)}`}
            onClick={(e) => {
              e.stopPropagation();
              selectGame(g.id);
              requestSeek(g.start_s);
            }}
          />
        ))}
        {games
          .flatMap((g) => g.doubts.map((d, i) => ({ ...d, key: `${g.id}-${i}` })))
          .map((d) => (
            <div
              key={d.key}
              className="timeline__doubt"
              style={{
                left: `${timeToPct(d.start_s, duration)}%`,
                width: `${Math.max(0.4, timeToPct(d.end_s, duration) - timeToPct(d.start_s, duration))}%`,
              }}
              title={`À vérifier : ${d.label}`}
              onClick={(e) => {
                e.stopPropagation();
                requestSeek(d.start_s);
              }}
            />
          ))}
        {pendingStart !== null && <div className="timeline__pending" style={{ left: `${timeToPct(pendingStart, duration)}%` }} />}
        <div className="timeline__cursor" style={{ left: `${timeToPct(currentTime, duration)}%` }} />
      </div>
      <div className="timeline__legend">
        <span>0:00</span>
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
    </div>
  );
}
