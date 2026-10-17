// Notes de review dessinées sur le plan : fantôme en pointillé (numéro du joueur, regard voulu) relié par un trait à la position lue, gadget posé avec une pastille portant son nom.
// Les formes des gadgets (trait du SHIELD, trajet du CLONE, cercles des rayons) sont dans GadgetShapes.
// Purement visuel : une note ne change aucune donnée. Les positions viennent de lib/reviewNotes.noteMarks (fractions de la minimap), `place` les ramène sur le plan.

import { Fragment } from 'react';
import { slotNumber, type NoteMark } from '../../../lib/reviewNotes';
import { GadgetShapes, type GadgetView } from './GadgetShapes';
import { teamVar } from './replayFrames';

interface Props {
  marks: NoteMark[];
  place: (x: number, y: number) => { x: number; y: number };
  view: GadgetView;
}

export function NoteLayer({ marks, place, view }: Props) {
  if (marks.length === 0) return null;
  const links = marks.filter((m) => m.read);
  return (
    <>
      <svg className="replay__trails" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {links.map((m) => {
          const a = place(m.read!.x, m.read!.y);
          const b = place(m.at.x, m.at.y);
          return <line key={m.key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`note__link${m.draft ? ' is-draft' : ''}`} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      <GadgetShapes marks={marks} place={place} view={view} />
      {marks.map((m) => {
        const p = place(m.at.x, m.at.y);
        const team = m.slot !== null ? teamVar(m.slot <= 4 ? 'A' : 'B') : 'var(--c-cyan)';
        const style = { left: `${p.x}%`, top: `${p.y}%`, ['--c' as string]: team };
        if (m.kind === 'action') {
          return (
            <div key={m.key} className={`note__gadget${m.draft ? ' is-draft' : ''}`} style={style} title={`Action : ${m.label}`}>
              <i />
              <em>{m.label}</em>
            </div>
          );
        }
        const r = m.read ? place(m.read.x, m.read.y) : null;
        return (
          <Fragment key={m.key}>
            {r && <i className="note__read" style={{ left: `${r.x}%`, top: `${r.y}%`, ['--c' as string]: team }} title="Position lue (inchangée)" />}
            <div className={`note__ghost${m.draft ? ' is-draft' : ''}`} style={style} title="Fantôme : où le joueur aurait dû être (la position lue reste inchangée)">
              {m.angle !== null && <i className="replay__dir" style={{ transform: `rotate(${m.angle}deg)` }} />}
              <b>{m.slot !== null ? slotNumber(m.slot) : ''}</b>
            </div>
          </Fragment>
        );
      })}
    </>
  );
}
