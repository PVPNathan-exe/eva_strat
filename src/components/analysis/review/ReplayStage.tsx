// Plan de la game avec les joueurs : traînées, calques (zones peu fiables, zone de tir), pastilles numérotées et notes de review (fantômes, gadgets).
// Les positions sont normalisées sur la minimap : `place` les ramène sur l'image du plan (cadre réglable par carte, lib/planInsets.ts).

import type { ReactNode, PointerEvent } from 'react';
import { X } from 'lucide-react';
import { flagKey } from '../../../lib/replayFlags';
import type { NoteMark } from '../../../lib/reviewNotes';
import type { Reliability } from '../../../types/analysis';
import { ReliabilityLayer } from '../ReliabilityLayer';
import { NoteLayer } from './NoteLayer';
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
  /** Pose d'une note avec un joueur choisi : le plan reçoit le geste (clic = fantôme ou gadget) et les pastilles ne réagissent plus. */
  placing: boolean;
  /** Notes de review à dessiner (dans leur fenêtre d'affichage) et brouillon en cours. */
  noteMarks: NoteMark[];
  dragHandlers: { onPointerDown: (e: PointerEvent<HTMLDivElement>) => void; onPointerMove: (e: PointerEvent<HTMLDivElement>) => void; onPointerUp: (e: PointerEvent<HTMLDivElement>) => void };
  onDot: (slot: number) => void;
}

function dotTitle(p: Shown, name: string | undefined, observed: boolean, unconfirmed: boolean): string {
  return `${name ?? 'Joueur'} · n° ${numberOfSlot(p.slot)}${p.alive ? '' : ' (mort)'}${observed ? ' · observé dans la vidéo' : ''}${unconfirmed ? ' · non confirmé par la vraie minimap' : ''}${p.confidence !== null && p.confidence < 1 ? ` · fiabilité ${Math.round(p.confidence * 100)} %` : ''}${p.alive && p.coherence !== null ? ` · cohérence du regard ${Math.round(p.coherence * 100)} %` : ''}`;
}

export function ReplayStage(props: Props) {
  const { plan, place, trails, shown, nameOf, observed, unconfirmed, selected, placing } = props;

  return (
    <div className={`replay__stage${placing ? ' is-marking' : ''}`} {...(placing ? props.dragHandlers : {})}>
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
          placing ? 'is-passive' : 'is-pickable',
        ];
        return (
          <div
            key={p.slot}
            className={cls.filter(Boolean).join(' ')}
            onClick={placing ? undefined : () => props.onDot(p.slot)}
            style={{ left: `${x}%`, top: `${y}%`, ['--c' as string]: teamVar(p.team) }}
            title={dotTitle(p, nameOf.get(p.slot), p.slot === observed, bad) + ' · clic : choisir ce joueur'}
          >
            {p.alive && p.angle !== null && <i className={`replay__dir${p.coherence !== null && p.coherence < 0.4 ? ' is-doubtful' : ''}`} style={{ transform: `rotate(${p.angle}deg)`, opacity: p.coherence === null ? 1 : 0.35 + 0.65 * p.coherence }} />}
            <b>{p.alive ? numberOfSlot(p.slot) : <X className="ic" strokeWidth={3} />}</b>
            {props.labels && nameOf.get(p.slot) && <em className="replay__name">{nameOf.get(p.slot)}</em>}
          </div>
        );
      })}
      <NoteLayer marks={props.noteMarks} place={place} />
      {!plan && <p className="replay__hint">Choisis la carte de la game pour afficher son plan.</p>}
    </div>
  );
}
