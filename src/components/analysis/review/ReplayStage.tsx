// Plan de la game avec les joueurs : traînées, calques (zones peu fiables, zone de tir), pastilles numérotées, corrections posées à la main et geste en cours.
// Les positions sont normalisées sur la minimap : `place` les ramène sur l'image du plan (cadre réglable par carte, lib/planInsets.ts).

import type { ReactNode, PointerEvent } from 'react';
import { X } from 'lucide-react';
import { flagKey } from '../../../lib/replayFlags';
import type { Reliability, UserMark } from '../../../types/analysis';
import { ReliabilityLayer } from '../ReliabilityLayer';
import type { Drag } from './markPlacement';
import { gazeAngle } from './markPlacement';
import { numberOfSlot, teamVar, type Shown, type Trail } from './replayFrames';

interface Props {
  plan: { src: string; name: string } | undefined;
  place: (x: number, y: number) => { x: number; y: number };
  trails: Trail[] | null;
  reliability: Reliability | null;
  showPos: boolean;
  showGaze: boolean;
  /** Calque posé sous les pastilles (zone de tir). */
  zoneLayer: ReactNode;
  shown: Shown[];
  nameOf: Map<number, string>;
  labels: boolean;
  observed: number | null;
  unconfirmed: Set<string>;
  showUnconfirmed: boolean;
  selected: number | null;
  /** Mode « échanger deux joueurs » : un clic sur une pastille la propose à l'échange. */
  swapping: boolean;
  pickA: number | null;
  pickB: number | null;
  /** Mode correction avec un joueur choisi : le plan reçoit le geste (clic = position, glisser = position et regard) et les pastilles ne réagissent plus. */
  marking: boolean;
  userMarks: UserMark[];
  drag: Drag | null;
  dragHandlers: { onPointerDown: (e: PointerEvent<HTMLDivElement>) => void; onPointerMove: (e: PointerEvent<HTMLDivElement>) => void; onPointerUp: (e: PointerEvent<HTMLDivElement>) => void };
  onDot: (slot: number) => void;
}

function dotTitle(p: Shown, name: string | undefined, observed: boolean, unconfirmed: boolean): string {
  return `${name ?? 'Joueur'} · n° ${numberOfSlot(p.slot)}${p.alive ? '' : ' (mort)'}${observed ? ' · observé dans la vidéo' : ''}${unconfirmed ? ' · non confirmé par la vraie minimap' : ''}${p.confidence !== null && p.confidence < 1 ? ` · fiabilité ${Math.round(p.confidence * 100)} %` : ''}${p.alive && p.coherence !== null ? ` · cohérence du regard ${Math.round(p.coherence * 100)} %` : ''}`;
}

export function ReplayStage(props: Props) {
  const { plan, place, trails, shown, nameOf, observed, unconfirmed, selected, swapping, marking, drag } = props;
  const dragAngle = drag ? gazeAngle(drag.x1 - drag.x0, drag.y1 - drag.y0, 0.02) : null; // en fractions : seuil de 2 % du plan avant de viser une direction

  return (
    <div className={`replay__stage${marking ? ' is-marking' : ''}`} {...(marking ? props.dragHandlers : {})}>
      {plan ? <img src={plan.src} alt={`Plan ${plan.name}`} draggable={false} /> : <div className="replay__noplan" />}
      {trails && (
        <svg className="replay__trails" viewBox="0 0 100 100" preserveAspectRatio="none">
          {trails.map((p) => (
            <polyline key={p.key} points={p.points} fill="none" style={{ stroke: teamVar(p.team) }} strokeWidth={2} vectorEffect="non-scaling-stroke" opacity={0.7} />
          ))}
        </svg>
      )}
      {(props.showPos || props.showGaze) && <ReliabilityLayer reliability={props.reliability} project={place} showPos={props.showPos} showGaze={props.showGaze} />}
      {props.zoneLayer}
      {shown.map((p) => {
        const { x, y } = place(p.x, p.y);
        const bad = props.showUnconfirmed && p.alive && unconfirmed.has(flagKey(p.frame, p.slot));
        const cls = [
          'replay__dot',
          p.alive ? '' : 'is-dead',
          (p.confidence ?? 1) < 0.5 ? 'is-unsure' : '',
          bad ? 'is-unconfirmed' : '',
          p.slot === observed ? 'is-observed' : '',
          p.slot === selected ? 'is-selected' : '',
          marking ? 'is-passive' : 'is-pickable',
          p.slot === props.pickA || p.slot === props.pickB ? 'is-picked' : '',
        ];
        return (
          <div
            key={p.slot}
            className={cls.filter(Boolean).join(' ')}
            onClick={marking ? undefined : () => props.onDot(p.slot)}
            style={{ left: `${x}%`, top: `${y}%`, ['--c' as string]: teamVar(p.team) }}
            title={dotTitle(p, nameOf.get(p.slot), p.slot === observed, bad) + (swapping ? ' · clic : choisir pour l\'échange' : ' · clic : choisir ce joueur')}
          >
            {p.alive && p.angle !== null && <i className={`replay__dir${p.coherence !== null && p.coherence < 0.4 ? ' is-doubtful' : ''}`} style={{ transform: `rotate(${p.angle}deg)`, opacity: p.coherence === null ? 1 : 0.35 + 0.65 * p.coherence }} />}
            <b>{p.alive ? numberOfSlot(p.slot) : <X className="ic" strokeWidth={3} />}</b>
            {props.labels && nameOf.get(p.slot) && <em className="replay__name">{nameOf.get(p.slot)}</em>}
          </div>
        );
      })}
      {props.userMarks.map((m) => {
        const { x, y } = place(m.x, m.y);
        return (
          <div key={m.id} className="replay__mark" style={{ left: `${x}%`, top: `${y}%` }} title={`Correction à la main : joueur ${numberOfSlot(m.slot)}${m.dead ? ' (mort)' : ''}`}>
            {!m.dead && m.angle !== null && <i className="replay__dir" style={{ transform: `rotate(${m.angle}deg)` }} />}
            <b>{m.dead ? <X className="ic" strokeWidth={3} /> : numberOfSlot(m.slot)}</b>
          </div>
        );
      })}
      {drag && (
        <>
          <svg className="replay__trails" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden>
            {dragAngle !== null && <line x1={drag.x0} y1={drag.y0} x2={drag.x1} y2={drag.y1} className="replay__dragline" vectorEffect="non-scaling-stroke" />}
          </svg>
          <div className="replay__mark is-drag" style={{ left: `${drag.x0 * 100}%`, top: `${drag.y0 * 100}%` }}>
            <b>{numberOfSlot(drag.slot)}</b>
          </div>
        </>
      )}
      {!plan && <p className="replay__hint">Choisis la carte de la game pour afficher son plan.</p>}
    </div>
  );
}
