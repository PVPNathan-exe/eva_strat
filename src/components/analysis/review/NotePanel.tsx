// Volet « Notes de review » : écrire une note (position à corriger, action, remarque) et relire celles de la game.
// Une note ne change AUCUNE donnée : elle sert à se souvenir d'une erreur vue. La pose sur le plan se fait avec useNoteDraft (geste) et NoteLayer (dessin).

import { useState } from 'react';
import { Save, Trash2, Undo2 } from 'lucide-react';
import { draftBody, draftProblem, KIND_LABEL, playerLabel } from '../../../lib/reviewNotes';
import { formatTime } from '../../../lib/timeline';
import type { Game } from '../../../types/analysis';
import type { ReviewNote, ReviewNoteKind } from '../../../types/stats';
import type { useNoteDraft } from './useNoteDraft';
import type { useReviewNotes } from './useReviewNotes';

const KINDS: ReviewNoteKind[] = ['position', 'action', 'note'];
const FREE = '__free__';

const GUIDE: Record<ReviewNoteKind, string> = {
  position: 'Clique sur le plan pour poser le fantôme (où le joueur aurait dû être), glisse pour l\'ajuster, glisse depuis le fantôme pour donner son regard.',
  action: 'Clique sur le plan pour poser le gadget à l\'endroit voulu.',
  note: 'Remarque libre à cet instant, le joueur est facultatif.',
};

interface Props {
  game: Game;
  nameOf: Map<number, string>;
  /** Gadgets proposés pour le joueur choisi à l'instant de la note (équipement de sa vie). */
  gadgets: { current: string | null; others: string[] };
  api: ReturnType<typeof useReviewNotes>;
  note: ReturnType<typeof useNoteDraft>;
  /** Place la reconstruction à un instant de la game (secondes de game) et choisit le joueur de la note. */
  onOpenNote: (n: ReviewNote) => void;
}

export function NotePanel({ game, nameOf, gadgets, api, note, onOpenNote }: Props) {
  const { draft } = note;
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<number | null>(null); // note dont la suppression attend sa confirmation
  const problem = draftProblem(draft);
  const known = [gadgets.current, ...gadgets.others].filter((g): g is string => !!g);
  const choice = known.includes(draft.gadget) ? draft.gadget : FREE;

  const save = async () => {
    if (problem) return;
    setError(null);
    const saved = await api.add({ game_id: game.id, ...draftBody(draft) });
    if (saved) note.reset();
    else setError('La note n\'a pas été enregistrée.');
  };

  return (
    <div className="review__notes">
      <details className="review__fold" open onToggle={(e) => note.setOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>Notes de review ({api.notes.length})</summary>
        <details className="help">
          <summary>À quoi servent ces notes</summary>
          <p className="help__body">
            Ces notes ne changent <strong>aucune donnée</strong> : ni le suivi des joueurs, ni les statistiques. Elles servent à se souvenir plus tard des erreurs vues (un joueur trop avancé, un gadget pas utilisé) et, un jour, de base à un
            jeu d'échecs de stratégie. Un fantôme est un faux emplacement : la vraie position lue reste inchangée, un trait la relie au fantôme. Les corrections qui influent sur les données (position, regard, mort) restent dans l'onglet Lecture,
            option avancée. Une note se voit sur le plan de 3 s avant à 8 s après son instant (menu Affichage, « Afficher les notes »).
          </p>
        </details>

        <div className="review__noteform">
          <label className="review__pick">
            Sorte de note
            <select value={draft.kind} onChange={(e) => note.setKind(e.target.value as ReviewNoteKind)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </select>
          </label>
          <p className="review__guide">{GUIDE[draft.kind]}</p>

          {draft.kind === 'action' && (
            <div className="review__row">
              {known.length > 0 && (
                <select value={choice} onChange={(e) => note.setGadget(e.target.value === FREE ? '' : e.target.value)} title="Gadget de la vie du joueur à cet instant">
                  {gadgets.current && <option value={gadgets.current}>{gadgets.current} (sa vie)</option>}
                  {gadgets.others.map((g) => (
                    <option key={g} value={g}>{g} (autre vie)</option>
                  ))}
                  <option value={FREE}>Autre (écrire)</option>
                </select>
              )}
              {choice === FREE && <input type="text" value={draft.gadget} placeholder="Nom du gadget" onChange={(e) => note.setGadget(e.target.value)} />}
            </div>
          )}

          <textarea
            rows={3}
            value={draft.text}
            placeholder="Ton commentaire (la vidéo se met en pause quand tu cliques ici)"
            onFocus={note.startFreeze}
            onChange={(e) => note.setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
            }}
          />
          <div className="review__row">
            <span className="review__at">À {formatTime(draft.t)} dans la game</span>
            {note.frozen && (
              <button onClick={note.unfreeze} title="Reprendre l'instant affiché">
                <Undo2 className="ic" /> Instant courant
              </button>
            )}
            {draft.kind === 'position' && draft.angle !== null && <button onClick={note.clearGaze}>Retirer le regard</button>}
            <button className="review__send" disabled={problem !== null} onClick={() => void save()} title={problem ?? 'Ctrl + Entrée'}>
              <Save className="ic" /> Enregistrer
            </button>
          </div>
          {problem && <p className="review__done review__done--todo">{problem}</p>}
          {(error || api.error) && <p className="games__error">{error ?? api.error}</p>}
        </div>

        {api.notes.length > 0 && (
          <ul className="review__notelist">
            {api.notes.map((n) => (
              <li key={n.id}>
                <button className="review__noteopen" onClick={() => onOpenNote(n)} title="Placer la reconstruction à cet instant">
                  <span className="review__at">{formatTime(n.t)}</span>
                  <strong>{KIND_LABEL[n.kind]}</strong>
                  <span>{playerLabel(n.slot, nameOf)}{n.kind === 'action' && n.gadget ? ` · ${n.gadget}` : ''}</span>
                </button>
                {n.text && <p>{n.text}</p>}
                {confirm === n.id ? (
                  <span className="review__row">
                    <button onClick={() => { setConfirm(null); void api.remove(n.id); }}>Confirmer la suppression</button>
                    <button onClick={() => setConfirm(null)}>Garder</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirm(n.id)} title="Supprimer cette note">
                    <Trash2 className="ic" /> Supprimer
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </details>
    </div>
  );
}
