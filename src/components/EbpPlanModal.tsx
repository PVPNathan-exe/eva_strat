// Fenêtre de l'onglet Stratégie qui montre un plan importé d'EBP.GG (pions, regards, lecture entre les étapes). Le plan vient du bouton « Importer JSON » de la barre d'outils.
// Le lecteur est celui de la vue Plans de Stats (PlanPlayer) ; le plan modifiable de la Stratégie ne reçoit pas encore ces pions (cet onglet sera repris plus tard).

import type { ImportedPlan } from '../lib/ebpImport';
import { PlanPlayer } from './stats/PlanPlayer';

interface Props {
  map: string;
  file: string;
  plan: ImportedPlan;
  onClose: () => void;
}

export function EbpPlanModal({ map, file, plan, onClose }: Props) {
  return (
    <div className="calib" role="dialog" aria-modal="true" aria-label={`Plan EBP.GG de ${map}`}>
      <div className="calib__panel replay-modal">
        <div className="calib__head">
          <h3>
            Plan EBP.GG · {map} · {file}
          </h3>
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
        <PlanPlayer map={map} plan={plan} clockKey={`ebp:${file}:${map}`} />
      </div>
    </div>
  );
}
