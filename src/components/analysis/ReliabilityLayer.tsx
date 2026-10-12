// Calque « Zones peu fiables » du replay : cases de la carte où les positions (rouge) ou les regards (orange) se calculent mal, d'après les games déjà contrôlées.

import { useMemo } from 'react';
import { zoneCells } from '../../lib/replayFlags';
import type { Reliability } from '../../types/analysis';

/** project : position normalisée de la minimap (0 à 1) vers un pourcentage du plan. */
export function ReliabilityLayer({ reliability, project, showPos, showGaze }: { reliability: Reliability | null; project: (x: number, y: number) => { x: number; y: number }; showPos: boolean; showGaze: boolean }) {
  const cells = useMemo(() => zoneCells(reliability), [reliability]);
  return (
    <svg className="replay__zones" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {cells.map((c) => {
        const a = project(c.x, c.y);
        const b = project(c.x + c.w, c.y + c.h);
        const key = `${c.x}-${c.y}`;
        return (
          <g key={key}>
            {showPos && c.pos && <rect x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} className="replay__zone replay__zone--pos" />}
            {showGaze && c.gaze && <rect x={a.x + 0.3} y={a.y + 0.3} width={b.x - a.x - 0.6} height={b.y - a.y - 0.6} className="replay__zone replay__zone--gaze" />}
          </g>
        );
      })}
    </svg>
  );
}
