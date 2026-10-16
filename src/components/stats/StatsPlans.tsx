// Vue Plans de l'onglet Stats : import d'une stratégie exportée par EBP.GG (fichier JSON), affichée sur le plan de la carte choisie, étape par étape, avec une lecture entre les étapes.
// Test d'import seulement : le plan n'est pas encore comparé aux positions réelles d'une game (voir docs/IDEES_STRATEGIE.md). Conversion dans lib/ebpImport.ts, lecteur dans PlanPlayer.tsx.

import { useState, type ChangeEvent } from 'react';
import { FileUp } from 'lucide-react';
import { parseEbp, planDuration, type ImportedPlan } from '../../lib/ebpImport';
import { defaultInset, isAligned } from '../../lib/planInsets';
import { nameKey } from '../../lib/teamFollow';
import { PlanPlayer } from './PlanPlayer';
import '../../styles/stats-plans.css';

interface Loaded {
  file: string;
  map: string;
  plan: ImportedPlan;
}

interface Props {
  map: string;
}

export function StatsPlans({ map }: Props) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Un plan lu pour une carte n'est valable que pour elle : changer de carte l'écarte (le cadre de conversion dépend de la carte)
  const plan = loaded && loaded.map === map ? loaded.plan : null;

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de rouvrir le même fichier
    if (!file) return;
    file
      .text()
      .then((text) => {
        const parsed = parseEbp(JSON.parse(text), defaultInset(map));
        // Un plan d'une autre carte serait posé sur le mauvais plan : refusé plutôt qu'affiché faux
        if (parsed.name && nameKey(parsed.name) !== nameKey(map)) throw new Error(`le fichier est celui de la carte « ${parsed.name} », la carte affichée est « ${map} » : choisir la même carte dans le filtre`);
        setLoaded({ file: file.name, map, plan: parsed });
        setError(null);
      })
      .catch((err: unknown) => setError(`Import impossible : ${err instanceof Error ? err.message : String(err)}`));
  };

  return (
    <div className="stats__view">
      <div className="stats__bar">
        <label className="plan__file">
          <FileUp className="ic" /> Importer un export EBP.GG
          <input type="file" accept=".json,application/json" onChange={onFile} />
        </label>
        {loaded && plan && (
          <span className="stats__count">
            {loaded.file} : {plan.steps.length} étapes, {planDuration(plan).toFixed(1).replace('.', ',')} s
          </span>
        )}
      </div>
      <details className="help">
        <summary>Comment ça marche</summary>
        <p>
          Le fichier est un export JSON d'EBP.GG (version 5). Les pions de chaque étape sont placés sur le plan de la carte choisie dans le filtre, avec leur regard ; la lecture les fait glisser d'une étape à la suivante en 2 secondes (le temps de l'export).
          Dessins, textes et spécialités du fichier sont ignorés. Pour l'instant le plan est seulement affiché : le comparer à une vraie game viendra ensuite. Le même import existe dans l'onglet Stratégie (bouton Importer JSON).
        </p>
      </details>
      {error && <p className="stats__empty">{error}</p>}
      {!isAligned(map) && <p className="stats__empty">Le plan de {map} n'est pas aligné sur la minimap : les positions importées sont approximatives.</p>}
      {loaded && loaded.map !== map && <p className="stats__empty">Le plan importé était pour {loaded.map} : le réimporter pour {map}.</p>}
      {plan ? <PlanPlayer map={map} plan={plan} clockKey={`plan:${loaded?.file ?? ''}:${map}`} /> : !error && <p className="stats__empty">Aucun plan importé.</p>}
    </div>
  );
}
