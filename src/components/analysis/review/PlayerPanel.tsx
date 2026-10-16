// Joueur choisi dans la reconstruction : changer de joueur, corriger sa position et son regard (corrections de l'onglet Lecture), laisser un commentaire.
// Tout se fait sans quitter l'écran : les gestes se font sur le plan du replay (clic = position, glisser = position et regard).

import { MarkPanel } from '../MarkPanel';
import type { Game } from '../../../types/analysis';
import { numberOfSlot } from './replayFrames';
import { ReviewComment } from './ReviewComment';
import type { useReviewMarks } from './useReviewMarks';

interface Props {
  game: Game;
  /** Instant affiché (secondes de vidéo). */
  time: number;
  slots: number[];
  nameOf: Map<number, string>;
  selected: number | null;
  onSelect: (slot: number | null) => void;
  review: ReturnType<typeof useReviewMarks>;
  onRecomputed: () => void;
}

export function PlayerPanel({ game, time, slots, nameOf, selected, onSelect, review, onRecomputed }: Props) {
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

      {/* Refermer le volet quitte le mode correction : le plan ne reçoit plus de geste par mégarde. */}
      <details className="review__fold" onToggle={(e) => !(e.currentTarget as HTMLDetailsElement).open && review.setCorrecting(false)}>
        <summary>Corriger la position et le regard</summary>
        <MarkPanel
          game={game}
          marks={review.marks}
          error={review.error}
          correcting={review.correcting}
          onCorrecting={review.setCorrecting}
          pick={selected}
          onPick={onSelect}
          onRemove={(id) => void review.remove(id)}
          onRecomputed={onRecomputed}
          level={review.level}
          onLevel={review.setLevel}
          markDead={review.markDead}
          onMarkDead={review.setMarkDead}
        />
        <details className="help">
          <summary>Comment poser une correction ici</summary>
          <p className="help__body">
            Mets le replay (ou la vidéo) à l'instant voulu, choisis le joueur, puis clique sur le plan pour poser sa position, ou clique et glisse vers la direction de la pointe pour la position et le regard.
            La position se lit sur le plan et se convertit en position de minimap avec le cadre de la carte (menu « Alignement sur le plan ») : si le cadre est décalé, la correction l'est aussi, la vérifier dans l'onglet Lecture.
            Une correction n'est prise en compte qu'après « Recalculer avec mes corrections ».
          </p>
        </details>
      </details>

      <details className="review__fold">
        <summary>Laisser un commentaire</summary>
        <ReviewComment game={game} time={time} slot={selected} playerName={selected !== null ? nameOf.get(selected) : undefined} />
      </details>
    </div>
  );
}
