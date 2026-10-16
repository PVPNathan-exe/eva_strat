// Gadget de chaque joueur à l'instant affiché, équipe par équipe (même ordre, mêmes couleurs et mêmes numéros que les pions du plan).
// Une pastille : numéro, pseudo, nom du gadget, état (disponible, utilisé, inconnu). Un clic choisit le joueur ET son gadget pour une note d'action.

import { STATUS_LABEL, type GadgetChip } from '../../../lib/gadgetStates';
import { teamVar } from './replayFrames';

interface Props {
  chips: GadgetChip[];
  nameOf: Map<number, string>;
  /** Joueurs vivants à l'instant (un joueur mort garde sa pastille, atténuée). */
  alive: Set<number>;
  selected: number | null;
  onPick: (slot: number, gadget: string | null) => void;
}

export function GadgetChips({ chips, nameOf, alive, selected, onPick }: Props) {
  if (chips.length === 0) return null;
  return (
    <div className={`gchips${selected !== null ? ' has-selected' : ''}`}>
      {(['A', 'B'] as const).map((team) => {
        const row = chips.filter((c) => c.team === team);
        if (row.length === 0) return null;
        return (
          <div key={team} className="gchips__team">
            {row.map((c) => {
              const name = nameOf.get(c.slot);
              const cls = ['gchip', `is-${c.status}`, c.slot === selected ? 'is-selected' : '', alive.has(c.slot) ? '' : 'is-dead'];
              return (
                <button
                  key={c.slot}
                  className={cls.filter(Boolean).join(' ')}
                  style={{ ['--c' as string]: teamVar(c.team) }}
                  aria-pressed={c.slot === selected}
                  onClick={() => onPick(c.slot, c.name)}
                  title={`${name ?? 'Joueur'} · n° ${c.number} · ${c.label} ${STATUS_LABEL[c.status]}${alive.has(c.slot) ? '' : ' · mort'} : choisir ce joueur et ce gadget`}
                >
                  <b>{c.number}</b>
                  <span className="gchip__who">{name ?? 'joueur'}</span>
                  <span className="gchip__gad">{c.label}</span>
                  <span className="gchip__state">{STATUS_LABEL[c.status]}</span>
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
