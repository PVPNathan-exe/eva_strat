// Joueur choisi dans la reconstruction : sert à la zone de tir et aux notes de review (volet NotePanel).
// Un clic sur une pastille du plan choisit aussi un joueur.

import { numberOfSlot } from './replayFrames';

interface Props {
  slots: number[];
  nameOf: Map<number, string>;
  selected: number | null;
  onSelect: (slot: number | null) => void;
}

export function PlayerPanel({ slots, nameOf, selected, onSelect }: Props) {
  return (
    <div className="review__player">
      <label className="review__pick">
        Joueur choisi
        <select value={selected ?? ''} onChange={(e) => onSelect(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Aucun (clic sur une pastille pour choisir)</option>
          {slots.map((s) => (
            <option key={s} value={s}>
              {numberOfSlot(s)} · {nameOf.get(s) ?? 'joueur'}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
