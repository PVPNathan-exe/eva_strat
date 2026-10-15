// Base de dessin partagée des vues Stats : le plan de la carte (ou la médiane de sa minimap), le masque des couloirs, les tyroliennes et les zones de départ.
// Les vues dessinent par-dessus avec `children(frame)` : `frame.at(x, y)` donne la position en pourcentage du plan pour une position de la minimap.
// Le plan, le cadre et le masque viennent de lib/builtinMaps, lib/planInsets et lib/mapReading (comme la carte des couloirs de l'onglet Lecture).

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { builtinMaps } from '../../lib/builtinMaps';
import { loadTinted, readingOf, type MapReading } from '../../lib/mapReading';
import { leafCorners } from '../../lib/doorBlocks';
import { doorSetup } from '../../lib/doorData';
import { defaultInset, isAligned, project } from '../../lib/planInsets';
import { tokenRgb } from './useStats';

export interface MapFrame {
  /** Position de la minimap (0 à 1) vers un pourcentage de l'image du plan. */
  at: (x: number, y: number) => { x: number; y: number };
  /** Style qui place un élément exactement sur la minimap dans le plan (left, top, width, height en pourcentage). */
  boxStyle: CSSProperties;
  reading: MapReading;
}

/** Couche de couloirs : l'image du masque, teintée avec la couleur du jeton. */
function MaskLayer({ url, token }: { url: string; token: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    loadTinted(url, tokenRgb(token, [91, 99, 120]), 110)
      .then((src) => {
        const canvas = ref.current;
        if (cancelled || !canvas) return;
        canvas.width = src.width;
        canvas.height = src.height;
        canvas.getContext('2d')?.drawImage(src, 0, 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url, token]);
  return <canvas ref={ref} className="statsmap__canvas" />;
}

interface Props {
  map: string;
  /** Couloirs praticables, teintés. */
  corridors?: boolean;
  /** Entrées et sorties de tyrolienne, reliées par un trait. */
  stations?: boolean;
  /** Zones de départ des équipes. */
  spawns?: boolean;
  children?: (frame: MapFrame) => ReactNode;
}

export function StatsMapBase({ map, corridors = false, stations = false, spawns = false, children }: Props) {
  const reading = readingOf(map);
  const aligned = isAligned(map); // plan aligné sur la minimap : il sert de fond ; sinon la médiane de la minimap elle-même
  const background = (aligned ? builtinMaps.find((m) => m.name === map)?.src : undefined) ?? reading.medianUrl;
  const inset = aligned ? defaultInset(map) : { l: 0, t: 0, r: 0, b: 0 };
  const at = (x: number, y: number) => project(inset, x, y);
  const doors = doorSetup(map); // portes à boutons (Reef Point) dans leur état de départ : les portes fermées sont des blocs, les ouvertes ne se voient pas
  const boxStyle: CSSProperties = { left: `${inset.l * 100}%`, top: `${inset.t * 100}%`, width: `${(1 - inset.l - inset.r) * 100}%`, height: `${(1 - inset.t - inset.b) * 100}%` };
  if (!background) return <p className="stats__empty">Pas de plan ni de minimap pour la carte {map}.</p>;
  return (
    <div className="statsmap">
      <img src={background} alt={aligned ? `Plan ${map}` : `Minimap de ${map}`} draggable={false} />
      {corridors && reading.maskUrl && (
        <div className="statsmap__layer" style={boxStyle}>
          <MaskLayer url={reading.maskUrl} token="--c-border-strong" />
        </div>
      )}
      <svg className="statsmap__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {doors?.doors
          .filter((d) => d.initial === 'closed')
          .flatMap((d) =>
            leafCorners(d).map((leaf, i) => (
              <polygon key={`${d.id}-${i}`} points={leaf.map(([x, y]) => `${(x / doors.plan[0]) * 100},${(y / doors.plan[1]) * 100}`).join(' ')} className="statsmap__door" vectorEffect="non-scaling-stroke" />
            )),
          )}
        {spawns &&
          reading.spawns.map((s, i) => {
            const a = at(s.rect[0], s.rect[1]);
            const b = at(s.rect[2], s.rect[3]);
            return <rect key={`${s.team}${i}`} x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} className={`statsmap__spawn statsmap__spawn--${s.team}`} vectorEffect="non-scaling-stroke" />;
          })}
        {stations &&
          reading.stations.map(([p, q]) => {
            const a = at(p[0], p[1]);
            const b = at(q[0], q[1]);
            return (
              <g key={`${p[0]}-${p[1]}`}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="statsmap__ride" vectorEffect="non-scaling-stroke" />
                <ellipse cx={a.x} cy={a.y} rx={0.6} ry={1.1} className="statsmap__station" />
                <ellipse cx={b.x} cy={b.y} rx={0.6} ry={1.1} className="statsmap__station" />
              </g>
            );
          })}
      </svg>
      {children?.({ at, boxStyle, reading })}
    </div>
  );
}
