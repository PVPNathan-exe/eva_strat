// Schéma des rotations d'une équipe : un cercle par point (surface en rapport avec le temps de présence estimé, sinon le nombre d'arrivées),
// une flèche par trajet (épaisseur = nombre de rotations, étiquette = nombre et durée moyenne de la deuxième arrivée).
// Les points sont posés sur une ellipse (la position réelle des boîtes varie d'une game à l'autre). Géométrie calculée ici, agrégat dans lib/episodeFormat.

import { formatSeconds, type FlowArrow, type FlowNode } from '../../lib/episodeFormat';
import type { TeamSide } from '../../types/stats';

interface Props {
  team: TeamSide;
  title: string;
  nodes: FlowNode[];
  arrows: FlowArrow[];
  /** Au moins un séjour est mesuré : la taille des cercles suit le temps de présence. */
  measured: boolean;
}

const W = 320;
const H = 230;

/** Centre de chaque point : sur une ellipse, le premier en haut ; un point seul au milieu. */
function layout(points: string[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  points.forEach((p, i) => {
    if (points.length === 1) out.set(p, { x: W / 2, y: H / 2 });
    else {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / points.length;
      out.set(p, { x: W / 2 + 105 * Math.cos(a), y: H / 2 + 78 * Math.sin(a) });
    }
  });
  return out;
}

/** Une flèche : tracé décalé sur le côté pour que l'aller et le retour ne se superposent pas, pointe en polygone. */
function Arrow({ a, b, ra, rb, width, label }: { a: { x: number; y: number }; b: { x: number; y: number }; ra: number; rb: number; width: number; label: string }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy * 8; // décalage latéral : l'aller et le retour passent de part et d'autre
  const py = ux * 8;
  const x1 = a.x + ux * (ra + 2) + px;
  const y1 = a.y + uy * (ra + 2) + py;
  const x2 = b.x - ux * (rb + 2) + px;
  const y2 = b.y - uy * (rb + 2) + py;
  const head = 7 + width;
  const bx = x2 - ux * head;
  const by = y2 - uy * head;
  const tip = `${x2},${y2} ${bx - uy * head * 0.45},${by + ux * head * 0.45} ${bx + uy * head * 0.45},${by - ux * head * 0.45}`;
  return (
    <g className="rflow__arrow">
      <line x1={x1} y1={y1} x2={bx} y2={by} strokeWidth={width} />
      <polygon points={tip} />
      <text x={(x1 + x2) / 2 + px * 1.3} y={(y1 + y2) / 2 + py * 1.3} textAnchor="middle" dominantBaseline="middle">
        {label}
      </text>
    </g>
  );
}

export function RotationFlow({ team, title, nodes, arrows, measured }: Props) {
  if (nodes.length === 0) {
    return (
      <figure className={`rflow rflow--${team}`}>
        <figcaption>{title}</figcaption>
        <p className="stats__empty">Aucune rotation pour ce choix.</p>
      </figure>
    );
  }
  const weight = (n: FlowNode) => (measured ? n.seconds : n.visits);
  const maxWeight = Math.max(1, ...nodes.map(weight));
  const maxCount = Math.max(1, ...arrows.map((a) => a.count));
  const centers = layout(nodes.map((n) => n.point));
  const radius = (n: FlowNode) => 13 + 22 * Math.sqrt(weight(n) / maxWeight); // surface proportionnelle au poids
  const radii = new Map(nodes.map((n) => [n.point, radius(n)]));
  return (
    <figure className={`rflow rflow--${team}`}>
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Rotations : ${title}`}>
        {arrows.map((a) => {
          const from = centers.get(a.from);
          const to = centers.get(a.to);
          if (!from || !to) return null;
          const label = `${a.count} × ${a.meanTravelS !== null ? formatSeconds(a.meanTravelS) : 'durée ?'}`;
          return <Arrow key={`${a.from}>${a.to}`} a={from} b={to} ra={radii.get(a.from) ?? 13} rb={radii.get(a.to) ?? 13} width={1.5 + (3.5 * a.count) / maxCount} label={label} />;
        })}
        {nodes.map((n) => {
          const c = centers.get(n.point) as { x: number; y: number };
          return (
            <g key={n.point} className="rflow__node">
              <circle cx={c.x} cy={c.y} r={radii.get(n.point)} />
              <text x={c.x} y={c.y - 2} textAnchor="middle" dominantBaseline="middle" className="rflow__name">
                {n.point}
              </text>
              <text x={c.x} y={c.y + 11} textAnchor="middle" dominantBaseline="middle" className="rflow__sub">
                {measured ? (n.seconds > 0 ? formatSeconds(n.seconds) : '?') : `${n.visits} arr.`}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="rflow__note">{measured ? 'Taille du cercle : temps estimé sur le point.' : "Taille du cercle : nombre d'arrivées (aucun séjour mesurable)."}</p>
    </figure>
  );
}
