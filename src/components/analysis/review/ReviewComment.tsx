// Commentaire laissé depuis l'écran de review, sans quitter la reconstruction : il est lié à l'instant affiché et, au choix, au joueur choisi.
// Même catégories et même stockage que le panneau Commentaires sous la vidéo (lib/comments.ts, store), qui garde la liste, l'export et le suivi des commentaires traités.

import { useState } from 'react';
import { MessageSquarePlus, Undo2 } from 'lucide-react';
import { TAG_LABEL } from '../../../lib/comments';
import { formatTime } from '../../../lib/timeline';
import { getVideoElement } from '../../../lib/videoRef';
import { useAnalysisStore } from '../../../store/analysisStore';
import type { CommentTag, Game } from '../../../types/analysis';
import { numberOfSlot } from './replayFrames';

const TAGS: CommentTag[] = ['suivi', 'equipe', 'note'];

export function ReviewComment({ game, time, slot, playerName }: { game: Game; time: number; slot: number | null; playerName: string | undefined }) {
  const addComment = useAnalysisStore((s) => s.addComment);
  const [text, setText] = useState('');
  const [tag, setTag] = useState<CommentTag>('suivi');
  const [linked, setLinked] = useState(true);
  const [frozen, setFrozen] = useState<number | null>(null); // instant figé quand on commence à écrire
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const at = frozen ?? time;

  const start = () => {
    if (frozen !== null) return;
    getVideoElement()?.pause(); // on écrit sur l'image qu'on regarde
    setFrozen(time);
    setDone(null);
  };

  const submit = async () => {
    if (!text.trim()) return;
    try {
      setError(null);
      await addComment(at, text.trim(), tag, linked && slot !== null ? [slot] : []);
      setDone(`Commentaire ajouté à ${formatTime(at - game.start_s)} dans la game.`);
      setText('');
      setFrozen(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className="review__comment">
      <textarea
        rows={2}
        value={text}
        placeholder="Écris ce que tu vois à cet instant (la vidéo se met en pause quand tu cliques ici)"
        onFocus={start}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
        }}
      />
      <div className="review__row">
        <span className="review__at">À {formatTime(at - game.start_s)} dans la game</span>
        {frozen !== null && (
          <button onClick={() => setFrozen(null)} title="Reprendre l'instant affiché">
            <Undo2 className="ic" /> Instant courant
          </button>
        )}
      </div>
      <div className="review__row">
        <select value={tag} onChange={(e) => setTag(e.target.value as CommentTag)} title="Catégorie">
          {TAGS.map((t) => (
            <option key={t} value={t}>{TAG_LABEL[t]}</option>
          ))}
        </select>
        {slot !== null && (
          <label className="review__link">
            <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
            Joueur {numberOfSlot(slot)}{playerName ? ` (${playerName})` : ''}
          </label>
        )}
        <button className="review__send" disabled={!text.trim()} onClick={() => void submit()} title="Ctrl + Entrée">
          <MessageSquarePlus className="ic" /> Ajouter
        </button>
      </div>
      {error && <p className="games__error">{error}</p>}
      {done && <p className="review__done">{done}</p>}
    </div>
  );
}
