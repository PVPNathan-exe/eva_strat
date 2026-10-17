// Légende des gadgets posés visibles sur le plan : arrêt du clone, rayons (connus ou « rayon non connu »), longueur et durée du shield.
// Les cercles du plan portent seulement leur taille ; ce qui dit à quoi ils correspondent est ici.

import { stopText, type ClonePathResult } from '../../../lib/clonePath';
import { displaySeconds, explosionLegend, formatMetres, shieldLengthM } from '../../../lib/gadgetParams';
import { playerLabel, type NoteMark } from '../../../lib/reviewNotes';

interface Props {
  marks: NoteMark[];
  clones: Map<string, ClonePathResult>;
  nameOf: Map<number, string>;
  /** Message quand la grille des murs manque (clone non calculé). */
  notice: string | null;
}

export function NoteLegend({ marks, clones, nameOf, notice }: Props) {
  const cloneMarks = marks.filter((m) => m.gadgetKind === 'clone' && clones.has(m.key));
  const shields = marks.filter((m) => m.gadgetKind === 'shield' && m.to);
  const hasClone = marks.some((m) => m.gadgetKind === 'clone');
  const blast = cloneMarks.some((m) => clones.get(m.key)!.reason !== 'portee');
  if (cloneMarks.length === 0 && shields.length === 0 && !(hasClone && notice)) return null;
  return (
    <div className="replay__key note__legend">
      {shields.map((m) => (
        <span key={m.key}>
          <i className="key-shield" />
          Shield {playerLabel(m.slot, nameOf)} : {formatMetres(shieldLengthM(m.at, m.to!))}, {displaySeconds(m.gadget)} s
        </span>
      ))}
      {cloneMarks.map((m) => (
        <span key={m.key}>
          <i className="key-clone" />
          Clone {playerLabel(m.slot, nameOf)} : {stopText(clones.get(m.key)!, formatMetres)}
        </span>
      ))}
      {blast && explosionLegend().map((l) => <span key={l.name}>{l.text}</span>)}
      {hasClone && notice && <span>{notice}</span>}
    </div>
  );
}
