// Lecteur d'un plan importé (EBP.GG) : pions et regards sur le plan de la carte, lecture entre les étapes. Partagé par la vue Plans de Stats et par l'import de l'onglet Stratégie.

import { useMemo } from 'react';
import { pawnsAt, planDuration, stepStarts, type ImportedPlan } from '../../lib/ebpImport';
import { GameClock } from './GameClock';
import { StatsMapBase } from './StatsMapBase';
import { useGameClock } from './useGameClock';
import '../../styles/stats-plans.css';

interface Props {
  map: string;
  plan: ImportedPlan;
  /** Clé qui remet la lecture à zéro (fichier, carte). */
  clockKey: string;
}

export function PlanPlayer({ map, plan, clockKey }: Props) {
  const duration = planDuration(plan);
  const clock = useGameClock(clockKey, duration);
  const pawns = useMemo(() => pawnsAt(plan, clock.t), [plan, clock.t]);
  const starts = useMemo(() => stepStarts(plan), [plan]);
  const stepNow = starts.filter((s) => s <= clock.t + 1e-6).length; // étape de départ du passage en cours (1 à n)
  return (
    <>
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
      <GameClock clock={clock} />
      <p className="stats__count">{stepNow >= plan.steps.length ? `Étape ${plan.steps.length} (dernière)` : `Étape ${stepNow} vers ${stepNow + 1}`}</p>
    </>
  );
}
