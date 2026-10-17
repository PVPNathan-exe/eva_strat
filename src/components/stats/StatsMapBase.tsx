// Base de dessin partagée des vues Stats : le plan de la carte (ou la médiane de sa minimap), le masque des couloirs, les tyroliennes et les zones de départ.
// Les vues dessinent par-dessus avec `children(frame)` : `frame.at(x, y)` donne la position en pourcentage du plan pour une position de la minimap.
// Le plan, le cadre et le masque viennent de lib/builtinMaps, lib/planInsets et lib/mapReading (comme la carte des couloirs de l'onglet Lecture).

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { builtinMaps } from '../../lib/builtinMaps';
import { loadTinted, readingOf, type MapReading } from '../../lib/mapReading';
import { leafCorners } from '../../lib/doorBlocks';
import { doorSetup } from '../../lib/doorData';
import { defaultInset, isAligned, project } from '../../lib/planInsets';
import { frameBox, isWarped, projectPath } from '../../lib/planWarp';
import { PlanCanvas } from '../PlanCanvas';
import { tokenRgb } from './useStats';

export interface MapFrame {
  /** Position de la minimap (0 à 1) vers un pourcentage de l'image du plan. */
  at: (x: number, y: number) => { x: number; y: number };
  /** Style qui place un élément exactement sur la minimap dans le plan (left, top, width, height en pourcentage) ; tout le plan pour une carte à maillage (couches déjà tracées dans le plan). */
  boxStyle: CSSProperties;
  /** Nom de la carte quand elle a un maillage minimap vers plan (Artefact) : les couches en pixels doivent être tracées déformées (PlanCanvas `warp`), les formes passer par `at`. */
  warp?: string;
  reading: MapReading;
}

/** Couche de couloirs : l'image du masque, teintée avec la couleur du jeton (tracée déformée sur le plan quand la carte a un maillage). Le parent la remonte (`key`) à chaque carte : pas de masque de la carte précédente. */
function MaskLayer({ url, token, warp }: { url: string; token: string; warp?: string }) {
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadTinted(url, tokenRgb(token, [91, 99, 120]), 110)
      .then((tinted) => {
        if (!cancelled) setSrc(tinted);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url, token]);
  return <PlanCanvas canvas={src} warp={warp} scale={2} smooth={false} className="statsmap__canvas" />;
}

/** Contour d'un rectangle de la minimap (x0, y0, x1, y1) projeté sur le plan : les quatre côtés suivent la déformation d'un maillage (pourcentages du plan). */
function rectOutline(inset: Parameters<typeof projectPath>[0], r: [number, number, number, number]): string {
  const ring: [number, number][] = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]], [r[0], r[1]]];
  return projectPath(inset, ring).map((p) => `${p.x},${p.y}`).join(' ');
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
  const warp = isWarped(inset) ? inset.warp : undefined;
  const boxStyle: CSSProperties = frameBox(inset);
  if (!background) return <p className="stats__empty">Pas de plan ni de minimap pour la carte {map}.</p>;
  return (
    <div className="statsmap">
      <img src={background} alt={aligned ? `Plan ${map}` : `Minimap de ${map}`} draggable={false} />
      {corridors && reading.maskUrl && (
        <div className="statsmap__layer" style={boxStyle}>
          <MaskLayer key={reading.maskUrl} url={reading.maskUrl} token="--c-border-strong" warp={warp} />
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
            if (warp) return <polygon key={`${s.team}${i}`} points={rectOutline(inset, s.rect)} className={`statsmap__spawn statsmap__spawn--${s.team}`} vectorEffect="non-scaling-stroke" />;
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
      {children?.({ at, boxStyle, warp, reading })}
    </div>
  );
}
