// Tracés de la cartographie dessinés sur la médiane : stations de tyrolienne (cercle, direction, lien), portes et fenêtres (sens unique), carrés de capture, zones de départ,
// repères d'alignement et tracé en cours. Coordonnées en fractions de l'image ; `aspect` = largeur / hauteur pour que les cercles restent ronds.

import { visionArrow, type MapAnnotation, type Point, type Rect, type Station } from '../../lib/mapAnnotation';

/** Ce qui est en train d'être tracé (clic en attente, cercle, rectangle). */
export interface Draft {
  pending: Point | null; // première extrémité d'un trait
  circle: { c: Point; r: number } | null; // station dont on règle le rayon, puis la direction
  awaitingDirection: boolean;
  first: Station | null; // première station d'une tyrolienne déjà posée
  segment: { from: Point; to: Point } | null; // trait de sens unique qui attend le côté qui voit
  rect: Rect | null;
  poly: Point[]; // forme libre en cours (points posés)
  cursor: Point | null;
}

const pct = (v: number) => v * 100;
const ARROW_FACTOR = 2.2; // longueur de la flèche de direction, en rayons

/** Station : cercle, et flèche de direction (par où l'on entre et l'on sort) quand elle est donnée. */
function StationShape({ s, aspect, className }: { s: Station; aspect: number; className: string }) {
  const rad = s.angle === null ? null : (s.angle * Math.PI) / 180;
  return (
    <g>
      <ellipse cx={pct(s.x)} cy={pct(s.y)} rx={pct(s.r)} ry={pct(s.r * aspect)} className={className} vectorEffect="non-scaling-stroke" />
      {rad !== null && (
        <line
          x1={pct(s.x)}
          y1={pct(s.y)}
          x2={pct(s.x + Math.cos(rad) * s.r * ARROW_FACTOR)}
          y2={pct(s.y + Math.sin(rad) * s.r * ARROW_FACTOR * aspect)}
          className="mapping__station-dir"
          markerEnd="url(#mapping-arrow)"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </g>
  );
}

const rectProps = (r: Rect) => ({ x: pct(r[0]), y: pct(r[1]), width: pct(r[2] - r[0]), height: pct(r[3] - r[1]) });

export function MappingShapes({ annotation, draft, aspect }: { annotation: MapAnnotation; draft: Draft; aspect: number }) {
  return (
    <svg className="mapping__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <defs>
        <marker id="mapping-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
          <path d="M0,0 L10,5 L0,10 z" className="mapping__arrowhead" />
        </marker>
      </defs>
      {annotation.tps.map((t, i) => (
        <g key={`tp${i}`}>
          <line x1={pct(t.a.x)} y1={pct(t.a.y)} x2={pct(t.b.x)} y2={pct(t.b.y)} className="mapping__tp" vectorEffect="non-scaling-stroke" />
          <StationShape s={t.a} aspect={aspect} className="mapping__station" />
          <StationShape s={t.b} aspect={aspect} className="mapping__station" />
        </g>
      ))}
      {annotation.doors.map((d, i) => {
        const arrow = visionArrow(d.from, d.to, d.side, aspect);
        const cls = d.kind === 'fenetre' ? 'mapping__window' : d.kind === 'mur' ? 'mapping__wall' : d.glass ? 'mapping__door mapping__door--glass' : 'mapping__door';
        return (
          <g key={`door${i}`}>
            <line x1={pct(d.from[0])} y1={pct(d.from[1])} x2={pct(d.to[0])} y2={pct(d.to[1])} className={cls} vectorEffect="non-scaling-stroke" />
            {arrow && (
              <line x1={pct(arrow[0][0])} y1={pct(arrow[0][1])} x2={pct(arrow[1][0])} y2={pct(arrow[1][1])} className="mapping__vision" markerEnd="url(#mapping-arrow)" vectorEffect="non-scaling-stroke" />
            )}
          </g>
        );
      })}
      {annotation.capture.map((polygon, i) => (
        <polygon key={`cap${i}`} points={polygon.map((p) => `${pct(p[0])},${pct(p[1])}`).join(' ')} className="mapping__capture" vectorEffect="non-scaling-stroke" />
      ))}
      {(['A', 'B'] as const).flatMap((team) =>
        annotation.spawns[team].map((r, i) => <rect key={`${team}${i}`} {...rectProps(r)} className={`mapping__spawn mapping__spawn--${team}`} vectorEffect="non-scaling-stroke" />),
      )}
      {annotation.pairs.map((p, i) => (
        <g key={`pair${i}`}>
          <line x1={pct(p.minimap[0]) - 1} y1={pct(p.minimap[1])} x2={pct(p.minimap[0]) + 1} y2={pct(p.minimap[1])} className="mapping__landmark" vectorEffect="non-scaling-stroke" />
          <line x1={pct(p.minimap[0])} y1={pct(p.minimap[1]) - 1} x2={pct(p.minimap[0])} y2={pct(p.minimap[1]) + 1} className="mapping__landmark" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
      {draft.rect && <rect {...rectProps(draft.rect)} className="mapping__spawn mapping__spawn--drag" vectorEffect="non-scaling-stroke" />}
      {draft.poly.length > 0 && (
        <>
          <polyline
            points={[...draft.poly, ...(draft.cursor ? [draft.cursor] : [])].map((p) => `${pct(p[0])},${pct(p[1])}`).join(' ')}
            className="mapping__pending-line"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          {draft.poly.map((p, i) => (
            <circle key={i} cx={pct(p[0])} cy={pct(p[1])} r={i === 0 ? 1.1 : 0.7} className="mapping__pending" vectorEffect="non-scaling-stroke" />
          ))}
        </>
      )}
      {draft.first && <StationShape s={draft.first} aspect={aspect} className="mapping__station mapping__station--draft" />}
      {draft.circle && (
        <>
          <StationShape s={{ x: draft.circle.c[0], y: draft.circle.c[1], r: draft.circle.r, angle: null }} aspect={aspect} className="mapping__station mapping__station--draft" />
          {draft.awaitingDirection && draft.cursor && (
            <line x1={pct(draft.circle.c[0])} y1={pct(draft.circle.c[1])} x2={pct(draft.cursor[0])} y2={pct(draft.cursor[1])} className="mapping__station-dir" markerEnd="url(#mapping-arrow)" vectorEffect="non-scaling-stroke" />
          )}
        </>
      )}
      {draft.pending && <circle cx={pct(draft.pending[0])} cy={pct(draft.pending[1])} r={0.9} className="mapping__pending" vectorEffect="non-scaling-stroke" />}
      {draft.pending && draft.cursor && (
        <line x1={pct(draft.pending[0])} y1={pct(draft.pending[1])} x2={pct(draft.cursor[0])} y2={pct(draft.cursor[1])} className="mapping__pending-line" vectorEffect="non-scaling-stroke" />
      )}
      {draft.segment && (
        <line x1={pct(draft.segment.from[0])} y1={pct(draft.segment.from[1])} x2={pct(draft.segment.to[0])} y2={pct(draft.segment.to[1])} className="mapping__pending-line" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
