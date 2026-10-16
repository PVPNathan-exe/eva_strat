// Vue Plans de l'onglet Stats : import d'une stratégie exportée par EBP.GG (fichier JSON), affichée sur le plan de la carte choisie, étape par étape, avec une lecture entre les étapes.
// Test d'import seulement : le plan n'est pas encore comparé aux positions réelles d'une game (voir docs/IDEES_STRATEGIE.md). Conversion dans lib/ebpImport.ts.

import { useMemo, useState, type ChangeEvent } from 'react';
import { FileUp } from 'lucide-react';
import { parseEbp, pawnsAt, planDuration, stepStarts, type ImportedPlan } from '../../lib/ebpImport';
import { defaultInset, isAligned } from '../../lib/planInsets';
import { nameKey } from '../../lib/teamFollow';
import { GameClock } from './GameClock';
import { StatsMapBase } from './StatsMapBase';
import { useGameClock } from './useGameClock';
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
  const duration = plan ? planDuration(plan) : 0;
  const clock = useGameClock(`plan:${loaded?.file ?? ''}:${map}`, duration);
  const pawns = useMemo(() => (plan ? pawnsAt(plan, clock.t) : []), [plan, clock.t]);
  const starts = useMemo(() => (plan ? stepStarts(plan) : []), [plan]);
  const stepNow = starts.filter((s) => s <= clock.t + 1e-6).length; // étape de départ du passage en cours (1 à n)

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
            {loaded.file} : {plan.steps.length} étapes, {duration.toFixed(1).replace('.', ',')} s
          </span>
        )}
      </div>
      <details className="help">
        <summary>Comment ça marche</summary>
        <p>
          Le fichier est un export JSON d'EBP.GG (version 5). Les pions de chaque étape sont placés sur le plan de la carte choisie dans le filtre, avec leur regard ; la lecture les fait glisser d'une étape à la suivante en 2 secondes (le temps de l'export).
          Dessins, textes et spécialités du fichier sont ignorés. Pour l'instant le plan est seulement affiché : le comparer à une vraie game viendra ensuite.
        </p>
      </details>
      {error && <p className="stats__empty">{error}</p>}
      {!isAligned(map) && <p className="stats__empty">Le plan de {map} n'est pas aligné sur la minimap : les positions importées sont approximatives.</p>}
      {loaded && loaded.map !== map && <p className="stats__empty">Le plan importé était pour {loaded.map} : le réimporter pour {map}.</p>}
      <StatsMapBase map={map} spawns>
        {(frame) =>
          pawns.map((p) => {
            const pos = frame.at(p.x, p.y);
            const rank = ((p.slot - 1) % 4) + 1;
            return (
              <div
                key={p.slot}
                className={`plan__pawn pal${p.team === 'B' ? ' pal--b' : ''} pal--r${rank}${p.dead ? ' is-dead' : ''}`}
                style={{ left: `${pos.x}%`, top: `${pos.y}%`, ['--gaze' as string]: `${p.gaze}deg` }}
                title={`Joueur ${p.slot}`}
              >
                <i className="plan__gaze" />
                <b>{p.slot}</b>
              </div>
            );
          })
        }
      </StatsMapBase>
      {plan && (
        <>
          <GameClock clock={clock} />
          <p className="stats__count">{stepNow >= plan.steps.length ? `Étape ${plan.steps.length} (dernière)` : `Étape ${stepNow} vers ${stepNow + 1}`}</p>
        </>
      )}
      {!plan && !error && <p className="stats__empty">Aucun plan importé.</p>}
    </div>
  );
}
