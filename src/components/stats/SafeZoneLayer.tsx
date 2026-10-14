// Couche de dessin des zones couvertes et sûres, réutilisable sur le plan de StatsMapBase (ou du replay) : un canevas étiré sur la minimap,
// les contours de vue de chaque joueur et leurs pastilles numérotées. Tout est en fractions de la minimap : la couche se pose dans le cadre `boxStyle`.

import { useEffect, useMemo, useRef, type CSSProperties } from 'react';
import { numberOfSlot } from '../../lib/killTimeline';
import { outlinesOf, zonePixels, type ZoneColors, type ZoneResult } from '../../lib/safeZones';

interface Props {
  result: ZoneResult;
  colors: ZoneColors;
  /** Cadre de la minimap dans l'image (MapFrame.boxStyle). */
  boxStyle: CSSProperties;
  /** Équipe dont la zone sûre est montrée ('all' : les deux). */
  only?: 'A' | 'B' | 'all';
  /** Contours de vue : tous les joueurs (true), un seul slot (nombre), aucun (false). */
  outlines?: boolean | number;
  /** Pastilles numérotées des joueurs. */
  pins?: boolean;
}

export function SafeZoneLayer({ result, colors, boxStyle, only = 'all', outlines = false, pins = true }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pixels = useMemo(() => zonePixels(result, colors, only), [result, colors, only]);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx) ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), result.w, result.h), 0, 0);
  }, [pixels, result.w, result.h]);

  const lines = useMemo(() => (outlines === false ? [] : outlinesOf(result).filter((o) => outlines === true || o.slot === outlines)), [result, outlines]);

  return (
    <div className="statsmap__layer" style={boxStyle}>
      <canvas ref={canvas} width={result.w} height={result.h} className="statsmap__canvas" />
      {lines.length > 0 && (
        <svg className="statsmap__svg" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
          {lines.map((o) => (
            <polygon key={o.slot} points={o.points.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(' ')} className={`safe__view safe__view--${o.team}`} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      )}
      {pins &&
        result.shooters.map((s) => (
          <span key={s.slot} className={`safe__pin safe__pin--${s.team}${s.estimated ? ' is-estimated' : ''}`} style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%` }}>
            {numberOfSlot(s.slot)}
          </span>
        ))}
    </div>
  );
}
