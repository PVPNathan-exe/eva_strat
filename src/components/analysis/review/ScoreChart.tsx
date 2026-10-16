// Courbe du score de capture de chaque équipe (0 à 100 %), avec la position courante. Un clic déplace le replay.

import type { CaptureSeries } from '../../../types/analysis';

type Points = { t: number; v: number }[];

export function ScoreChart({ capture, start, end, time, onSeek }: { capture: CaptureSeries; start: number; end: number; time: number; onSeek: (t: number) => void }) {
  const span = Math.max(end - start, 1);
  const line = (pts: Points) => pts.map((p) => `${(((p.t - start) / span) * 100).toFixed(2)},${(100 - p.v).toFixed(2)}`).join(' ');
  const last = (pts: Points) => (pts.length ? Math.round(pts[pts.length - 1].v) : 0);
  const at = (pts: Points) => {
    let v = 0;
    for (const p of pts) if (p.t <= time) v = p.v;
    return Math.round(v);
  };
  const cursor = ((time - start) / span) * 100;
  return (
    <div className="replay__score" title="Score de capture de chaque équipe">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onSeek(start + ((e.clientX - r.left) / r.width) * span);
        }}
      >
        <polyline points={line(capture.A)} fill="none" className="replay__score-a" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <polyline points={line(capture.B)} fill="none" className="replay__score-b" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        <line x1={cursor} x2={cursor} y1={0} y2={100} className="replay__score-cursor" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.7} />
      </svg>
      <span>
        <b className="replay__team-a">{at(capture.A)} %</b> · <b className="replay__team-b">{at(capture.B)} %</b>
        <em> (fin : {last(capture.A)} % / {last(capture.B)} %)</em>
      </span>
    </div>
  );
}
