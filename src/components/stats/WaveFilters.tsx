// Filtres de la vue Retakes : deux menus (classe .menu), un par critère. « Issues » : retakes réussis, ratés, teamfights gagnés sans capture, duels, prises initiales, autres.
// « Vitesse » : vagues rapides ou progressives. Les filtres changent la frise et la liste ; le taux et le tableau par équipe comptent toutes les vagues du choix d'équipe et de joueur.

import { Filter, Gauge } from 'lucide-react';
import { ISSUE_GROUPS, SPEED_LABELS, type IssueGroup, type SpeedKey } from '../../lib/waveOutcome';
import type { WaveFilter } from '../../lib/waveStats';

interface Props {
  filter: WaveFilter;
  onChange: (next: WaveFilter) => void;
  /** Nombre de vagues par groupe d'issue (avant filtre), écrit à côté de chaque case. */
  counts: Record<IssueGroup, number>;
}

const SPEEDS: SpeedKey[] = ['rapide', 'progressif'];

export function WaveFilters({ filter, onChange, counts }: Props) {
  const offGroups = ISSUE_GROUPS.filter((g) => !filter.groups[g.id]).length;
  const offSpeeds = SPEEDS.filter((s) => !filter.speeds[s]).length;
  return (
    <>
      <details className="menu">
        <summary>
          <Filter className="ic" /> Issues{offGroups > 0 ? ` (${ISSUE_GROUPS.length - offGroups} sur ${ISSUE_GROUPS.length})` : ''}
        </summary>
        <div className="menu__panel">
          {ISSUE_GROUPS.map((g) => (
            <label key={g.id}>
              <input type="checkbox" checked={filter.groups[g.id]} onChange={(e) => onChange({ ...filter, groups: { ...filter.groups, [g.id]: e.target.checked } })} /> {g.label} ({counts[g.id]})
            </label>
          ))}
        </div>
      </details>
      <details className="menu">
        <summary>
          <Gauge className="ic" /> Vitesse{offSpeeds > 0 ? ` (${SPEEDS.length - offSpeeds} sur ${SPEEDS.length})` : ''}
        </summary>
        <div className="menu__panel">
          {SPEEDS.map((s) => (
            <label key={s}>
              <input type="checkbox" checked={filter.speeds[s]} onChange={(e) => onChange({ ...filter, speeds: { ...filter.speeds, [s]: e.target.checked } })} /> {SPEED_LABELS[s]}
            </label>
          ))}
        </div>
      </details>
    </>
  );
}
