// Formes des gadgets posés dans une note de review : trait du SHIELD (bleu, longueur en mètres), trajet du CLONE (pointillé, point qui avance à sa vitesse, arrêt) et cercles des rayons connus.
// Purement visuel : une note ne change aucune donnée. Les positions sont des fractions de la minimap, `place` les ramène sur le plan ; les cercles sont des ellipses du plan (mètres de la carte).

import { Fragment } from 'react';
import { cloneAlong, type ClonePathResult } from '../../../lib/clonePath';
import { CLONE_EXPLOSIVES, formatMetres, knownRadii, shieldLengthM } from '../../../lib/gadgetParams';
import type { NoteMark } from '../../../lib/reviewNotes';

/** Ce dont le dessin des gadgets a besoin en plus des marques. */
export interface GadgetView {
  /** Instant affiché (secondes de game) : fait avancer le clone. */
  gameT: number;
  /** Trajet du clone de chaque marque (clé de la marque), calculé avec la grille des obstacles. */
  clones: Map<string, ClonePathResult>;
  /** Vitesse du clone en m/s (référence) ; null : pas de point qui avance. */
  speedMs: number | null;
  /** Rayon en mètres vers les demi-axes d'une ellipse du plan, en pourcentages (notePlacement.radiusInPlan). */
  radiusOf: (m: number, at?: { x: number; y: number }) => { rx: number; ry: number };
}

interface Ring {
  key: string;
  at: { x: number; y: number };
  m: number;
  label: string;
}

interface Props {
  marks: NoteMark[];
  place: (x: number, y: number) => { x: number; y: number };
  view: GadgetView;
}

/** Cercles d'une marque : rayons connus du STICKY posé, ou rayons connus des grenades à l'arrêt du clone sur un mur ou un joueur. */
function ringsOf(m: NoteMark, clone: ClonePathResult | undefined): Ring[] {
  if (m.gadgetKind === 'point') return knownRadii(m.gadget).map((r) => ({ key: `${m.key}-${r.m}`, at: m.at, m: r.m, label: `${r.label} : ${formatMetres(r.m)}` }));
  if (m.gadgetKind !== 'clone' || !clone || clone.reason === 'portee') return [];
  return CLONE_EXPLOSIVES.flatMap((name) => knownRadii(name).map((r) => ({ key: `${m.key}-${name}-${r.m}`, at: clone.stop, m: r.m, label: `${name} ${r.label} : ${formatMetres(r.m)}` })));
}

export function GadgetShapes({ marks, place, view }: Props) {
  const actions = marks.filter((m) => m.kind === 'action');
  if (actions.length === 0) return null;
  const shields = actions.filter((m) => m.gadgetKind === 'shield' && m.to);
  const clones = actions.filter((m) => m.gadgetKind === 'clone' && view.clones.has(m.key));
  const rings = actions.flatMap((m) => ringsOf(m, view.clones.get(m.key)));

  return (
    <>
      <svg className="replay__trails" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        {rings.map((r) => {
          const c = place(r.at.x, r.at.y);
          const { rx, ry } = view.radiusOf(r.m, r.at);
          return <ellipse key={r.key} cx={c.x} cy={c.y} rx={rx} ry={ry} className="note__radius" vectorEffect="non-scaling-stroke" />;
        })}
        {shields.map((m) => {
          const a = place(m.at.x, m.at.y);
          const b = place(m.to!.x, m.to!.y);
          return <line key={m.key} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={`note__shield${m.draft ? ' is-draft' : ''}`} vectorEffect="non-scaling-stroke" />;
        })}
        {clones.map((m) => {
          const r = view.clones.get(m.key)!;
          const a = place(m.at.x, m.at.y);
          const s = place(r.stop.x, r.stop.y);
          const aim = m.to ? place(m.to.x, m.to.y) : null;
          return (
            <Fragment key={m.key}>
              {aim && r.distanceM < r.wantedM && <line x1={s.x} y1={s.y} x2={aim.x} y2={aim.y} className="note__aimline" vectorEffect="non-scaling-stroke" />}
              <line x1={a.x} y1={a.y} x2={s.x} y2={s.y} className={`note__clonepath${m.draft ? ' is-draft' : ''}`} vectorEffect="non-scaling-stroke" />
            </Fragment>
          );
        })}
      </svg>
      {rings.map((r) => {
        const c = place(r.at.x, r.at.y);
        return (
          <em key={`l-${r.key}`} className="note__rlabel" style={{ left: `${c.x}%`, top: `${c.y - view.radiusOf(r.m, r.at).ry}%` }} title={r.label}>
            {formatMetres(r.m)}
          </em>
        );
      })}
      {shields.map((m) => {
        const a = place(m.at.x, m.at.y);
        const b = place(m.to!.x, m.to!.y);
        return (
          <em key={`len-${m.key}`} className="note__len" style={{ left: `${(a.x + b.x) / 2}%`, top: `${(a.y + b.y) / 2}%` }} title="Longueur du trait du shield">
            {formatMetres(shieldLengthM(m.at, m.to!))}
          </em>
        );
      })}
      {clones.map((m) => {
        const r = view.clones.get(m.key)!;
        const walk = view.speedMs !== null ? cloneAlong(m.at, r, view.gameT - m.t, view.speedMs) : { at: r.stop, arrived: true };
        const c = place(walk.at.x, walk.at.y);
        const s = place(r.stop.x, r.stop.y);
        return (
          <Fragment key={m.key}>
            <i className="note__stop" style={{ left: `${s.x}%`, top: `${s.y}%` }} title="Point d'arrêt du clone" />
            <i className={`note__clone${walk.arrived ? ' is-arrived' : ''}`} style={{ left: `${c.x}%`, top: `${c.y}%` }} title="Clone (avance à sa vitesse de jeu)" />
          </Fragment>
        );
      })}
    </>
  );
}
