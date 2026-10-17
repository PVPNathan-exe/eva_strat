// Couche de dessin des zones couvertes et sûres, réutilisable sur le plan de StatsMapBase (ou du replay) : un canevas étiré sur la minimap,
// les contours de vue de chaque joueur, les portes (fermée ou ouverte) et les pastilles numérotées des joueurs. Tout est en fractions de la minimap : la couche se pose dans le cadre `boxStyle`.

import { useMemo, type CSSProperties } from 'react';
import { numberOfSlot } from '../../lib/killTimeline';
import { projectInset, projectPath } from '../../lib/planWarp';
import { outlinesOf, zonePixels, type DoorState, type ZoneColors, type ZoneResult, type ZoneShow } from '../../lib/safeZones';
import { PlanCanvas } from '../PlanCanvas';

interface Props {
  result: ZoneResult;
  colors: ZoneColors;
  /** Cadre de la minimap dans l'image (MapFrame.boxStyle). */
  boxStyle: CSSProperties;
  /** Nom de la carte quand elle a un maillage minimap vers plan (MapFrame.warp) : `boxStyle` couvre alors tout le plan, le canevas est tracé déformé et contours, portes et pastilles sont projetés. */
  warp?: string;
  /** Équipe dont la zone sûre est montrée ('all' : les deux). */
  only?: 'A' | 'B' | 'all';
  /** Contours de vue : tous les joueurs (true), un seul slot (nombre), aucun (false). */
  outlines?: boolean | number;
  /** Pastilles numérotées des joueurs. */
  pins?: boolean;
  /** Ce qui est colorié : les zones sûres (défaut), la zone de tir seule ou la zone de vision seule. */
  show?: ZoneShow;
  /** Contour dessiné : la zone de vision (défaut) ou la zone de tir de chaque joueur. */
  outlineKind?: 'vue' | 'tir';
  /** Portes de l'instant (Instant.doors) : trait fermé ou ouvert ; absent ou vide : aucune porte dessinée. */
  doors?: DoorState[];
  /** Palette de l'onglet quand l'équipe suivie est celle de droite : contours et pastilles de la bleue prennent la couleur de l'orange et inversement (les couleurs des zones sont échangées par l'appelant). */
  swapColors?: boolean;
}

export function SafeZoneLayer({ result, colors, boxStyle, warp, only = 'all', outlines = false, pins = true, show = 'safe', outlineKind = 'vue', doors = [], swapColors = false }: Props) {
  const palette = (team: 'A' | 'B') => (swapColors ? (team === 'A' ? 'B' : 'A') : team); // classe de couleur d'un côté
  const pixels = useMemo(() => zonePixels(result, colors, only, show), [result, colors, only, show]);
  const inset = { l: 0, t: 0, r: 0, b: 0, warp }; // cadre nul : seul le maillage (s'il y en a un) projette
  const at = (x: number, y: number) => projectInset(inset, x, y);

  const lines = useMemo(() => (outlines === false ? [] : outlinesOf(result, outlineKind).filter((o) => outlines === true || o.slot === outlines)), [result, outlines, outlineKind]);

  return (
    <div className="statsmap__layer" style={boxStyle}>
      <PlanCanvas pixels={pixels} w={result.w} h={result.h} warp={warp} smooth={false} className="statsmap__canvas" />
      {(lines.length > 0 || doors.length > 0) && (
        <svg className="statsmap__svg" viewBox={warp ? '0 0 100 100' : '0 0 1 1'} preserveAspectRatio="none" aria-hidden>
          {lines.map((o) => (
            <polygon
              key={o.slot}
              points={(warp ? projectPath(inset, o.points as [number, number][]).map((p) => [p.x, p.y]) : o.points).map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(' ')}
              className={`safe__view safe__view--${palette(o.team)}`}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {doors.map((d, i) => (
            <line
              key={i}
              x1={warp ? at(d.segment[0][0], d.segment[0][1]).x : d.segment[0][0]}
              y1={warp ? at(d.segment[0][0], d.segment[0][1]).y : d.segment[0][1]}
              x2={warp ? at(d.segment[1][0], d.segment[1][1]).x : d.segment[1][0]}
              y2={warp ? at(d.segment[1][0], d.segment[1][1]).y : d.segment[1][1]}
              className={`safe__door ${d.open ? 'safe__door--open' : 'safe__door--closed'}${d.glass ? ' safe__door--glass' : ''}`}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      )}
      {pins &&
        result.shooters.map((s) => (
          <span key={s.slot} className={`safe__pin safe__pin--${palette(s.team)}${s.estimated ? ' is-estimated' : ''}${s.level === 'etage' ? ' is-upper' : ''}`} style={warp ? { left: `${at(s.x, s.y).x}%`, top: `${at(s.x, s.y).y}%` } : { left: `${s.x * 100}%`, top: `${s.y * 100}%` }}>
            {numberOfSlot(s.slot)}
          </span>
        ))}
    </div>
  );
}
