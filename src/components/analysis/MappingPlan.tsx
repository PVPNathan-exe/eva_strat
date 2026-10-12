// Outil « Alignement » de la cartographie : le plan stratégique de la carte, où l'on clique le même repère que sur la minimap (coin, bout de mur) ; la médiane est
// superposée selon le cadre calculé pour contrôler l'alignement.

import type { Inset } from '../../lib/planInsets';
import type { LandmarkPair, Point } from '../../lib/mapAnnotation';

interface Props {
  planUrl: string;
  medianUrl: string;
  pairs: LandmarkPair[];
  inset: Inset | null;
  error: number | null; // écart moyen des repères, en fraction du plan
  waiting: boolean; // un repère de la minimap attend son pendant sur le plan
  overlay: boolean;
  onClick: (p: Point) => void;
}

export function MappingPlan({ planUrl, medianUrl, pairs, inset, error, waiting, overlay, onClick }: Props) {
  const frame = inset ? { left: `${inset.l * 100}%`, top: `${inset.t * 100}%`, width: `${(1 - inset.l - inset.r) * 100}%`, height: `${(1 - inset.t - inset.b) * 100}%` } : null;
  const click = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onClick([Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]);
  };
  const status =
    pairs.length < 2
      ? `${pairs.length} repère sur 2 minimum.`
      : inset
        ? `Cadre calculé avec ${pairs.length} repères${error !== null ? `, écart moyen ${(error * 100).toFixed(2)} % du plan` : ''}.`
        : 'Repères trop proches sur un axe : écarte-les.';
  return (
    <div className="mapping__plan">
      <div className={`mapping__plan-stage${waiting ? ' is-waiting' : ''}`} onClick={click}>
        <img src={planUrl} alt="Plan stratégique" draggable={false} />
        {overlay && frame && <img src={medianUrl} alt="" className="mapping__plan-overlay" style={frame} draggable={false} />}
        <svg className="mapping__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {pairs.map((p, i) => (
            <g key={i}>
              <line x1={p.plan[0] * 100 - 1} y1={p.plan[1] * 100} x2={p.plan[0] * 100 + 1} y2={p.plan[1] * 100} className="mapping__landmark" vectorEffect="non-scaling-stroke" />
              <line x1={p.plan[0] * 100} y1={p.plan[1] * 100 - 1} x2={p.plan[0] * 100} y2={p.plan[1] * 100 + 1} className="mapping__landmark" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
        </svg>
      </div>
      <p className="mapping__hint">
        {waiting ? 'Clique maintenant le même repère sur le plan.' : 'Clique un repère sur la minimap (à gauche), puis le même sur le plan.'} {status}
      </p>
    </div>
  );
}
