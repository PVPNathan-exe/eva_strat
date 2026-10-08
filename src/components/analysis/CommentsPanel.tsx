// Commentaires sous la vidéo, liés à un instant : on écrit « ici, le joueur 2 est mal suivi » au moment où on le voit.
// L'instant est pris quand on clique dans le champ (la vidéo se met en pause), et chaque commentaire ramène la vidéo juste avant.

import { Check, ClipboardCopy, Clock, MessageSquarePlus, Trash2, Undo2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { commentsToMarkdown, gameIndexAt, TAG_LABEL } from '../../lib/comments';
import { formatTime } from '../../lib/timeline';
import { getVideoElement } from '../../lib/videoRef';
import { useAnalysisStore } from '../../store/analysisStore';
import type { CommentTag } from '../../types/analysis';

const TAGS: CommentTag[] = ['suivi', 'equipe', 'note'];
const numberOfSlot = (slot: number) => (slot <= 4 ? slot : slot + 1);

export function CommentsPanel({ videoName }: { videoName: string }) {
  const comments = useAnalysisStore((s) => s.comments);
  const games = useAnalysisStore((s) => s.games);
  const currentTime = useAnalysisStore((s) => s.currentTime);
  const requestSeek = useAnalysisStore((s) => s.requestSeek);
  const addComment = useAnalysisStore((s) => s.addComment);
  const updateComment = useAnalysisStore((s) => s.updateComment);
  const removeComment = useAnalysisStore((s) => s.removeComment);

  const [text, setText] = useState('');
  const [tag, setTag] = useState<CommentTag>('suivi');
  const [slots, setSlots] = useState<number[]>([]);
  const [noteTime, setNoteTime] = useState<number | null>(null);
  const [filter, setFilter] = useState<'ouverts' | 'tous' | CommentTag>('ouverts');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const at = noteTime ?? currentTime;
  const gameIndex = gameIndexAt(games, at);
  const game = gameIndex === null ? null : games[gameIndex - 1];
  const choices = game && game.players.length ? game.players.map((p) => p.slot) : [1, 2, 3, 4, 5, 6, 7, 8];
  const nameOf = (slot: number) => games.flatMap((g) => g.players).find((p) => p.slot === slot)?.name;

  const visible = useMemo(
    () => comments.filter((c) => (filter === 'ouverts' ? !c.resolved : filter === 'tous' ? true : c.tag === filter)),
    [comments, filter],
  );

  const startNote = () => {
    if (noteTime !== null) return;
    getVideoElement()?.pause(); // on écrit sur l'image qu'on regarde
    setNoteTime(useAnalysisStore.getState().currentTime);
  };

  const submit = async () => {
    if (!text.trim()) return;
    try {
      setError(null);
      await addComment(at, text.trim(), tag, slots);
      setText('');
      setSlots([]);
      setNoteTime(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const copy = async () => {
    const md = commentsToMarkdown(videoName, comments, games, formatTime);
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copie impossible : autorise le presse-papiers pour cette page.');
    }
  };

  const toggleSlot = (slot: number) => setSlots((s) => (s.includes(slot) ? s.filter((x) => x !== slot) : [...s, slot].sort((a, b) => a - b)));

  return (
    <section className="comments">
      <header className="comments__head">
        <h3>Commentaires</h3>
        <span className="comments__live" title="Position actuelle de la vidéo">
          <Clock className="ic" /> {formatTime(currentTime)}
        </span>
        <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} title="Filtrer la liste">
          <option value="ouverts">En attente</option>
          <option value="tous">Tous</option>
          {TAGS.map((t) => (
            <option key={t} value={t}>{TAG_LABEL[t]}</option>
          ))}
        </select>
        <button onClick={() => void copy()} title="Copie les commentaires en attente sous forme de texte, à coller dans la conversation">
          <ClipboardCopy className="ic" /> {copied ? 'Copié' : 'Copier le texte'}
        </button>
      </header>

      <div className="comments__form">
        <textarea
          rows={2}
          value={text}
          placeholder="Écris ce que tu vois à cet instant de la vidéo (la vidéo se met en pause quand tu cliques ici)"
          onFocus={startNote}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit();
          }}
        />
        <div className="comments__row">
          <span className="comments__at">
            À {formatTime(at)}
            {gameIndex !== null && game ? ` · game ${gameIndex}${game.map ? ` (${game.map})` : ''}, ${formatTime(at - game.start_s)} dans la game` : ' · hors game'}
          </span>
          {noteTime !== null && (
            <button onClick={() => setNoteTime(null)} title="Reprendre l'instant courant de la vidéo">
              <Undo2 className="ic" /> Instant courant
            </button>
          )}
        </div>
        <div className="comments__row">
          <select value={tag} onChange={(e) => setTag(e.target.value as CommentTag)} title="Catégorie">
            {TAGS.map((t) => (
              <option key={t} value={t}>{TAG_LABEL[t]}</option>
            ))}
          </select>
          <span className="comments__players" title="Joueurs concernés (facultatif)">
            {choices.map((slot) => (
              <button
                key={slot}
                className={slots.includes(slot) ? 'is-on' : ''}
                style={{ ['--c' as string]: slot <= 4 ? '#ff9f1c' : '#3d8bff' }}
                onClick={() => toggleSlot(slot)}
                title={nameOf(slot) ?? `Joueur ${numberOfSlot(slot)}`}
              >
                {numberOfSlot(slot)}
              </button>
            ))}
          </span>
          <button className="comments__send" disabled={!text.trim()} onClick={() => void submit()} title="Ctrl + Entrée">
            <MessageSquarePlus className="ic" /> Ajouter
          </button>
        </div>
        {error && <p className="games__error">{error}</p>}
      </div>

      {visible.length === 0 ? (
        <p className="games__empty">{comments.length === 0 ? 'Aucun commentaire pour cette vidéo.' : 'Aucun commentaire dans ce filtre.'}</p>
      ) : (
        <ul className="comments__list" ref={listRef}>
          {visible.map((c) => {
            const n = gameIndexAt(games, c.t);
            return (
              <li key={c.id} className={`comment comment--${c.tag}${c.resolved ? ' is-resolved' : ''}${Math.abs(currentTime - c.t) < 3 ? ' is-now' : ''}`}>
                <button className="comment__time" onClick={() => requestSeek(Math.max(0, c.t - 2))} title="Aller à cet instant dans la vidéo">
                  {formatTime(c.t)}
                </button>
                <div className="comment__body">
                  <div className="comment__meta">
                    <span className="comment__tag">{TAG_LABEL[c.tag]}</span>
                    {n !== null && <span>game {n}</span>}
                    {c.slots.map((s) => (
                      <span key={s} className="comment__slot" style={{ ['--c' as string]: s <= 4 ? '#ff9f1c' : '#3d8bff' }} title={nameOf(s)}>
                        {numberOfSlot(s)}
                      </span>
                    ))}
                  </div>
                  <p>{c.text}</p>
                </div>
                <div className="comment__actions">
                  <button onClick={() => void updateComment(c.id, { resolved: !c.resolved })} title={c.resolved ? 'Remettre en attente' : 'Marquer comme traité'}>
                    {c.resolved ? <Undo2 className="ic" /> : <Check className="ic" />}
                  </button>
                  <button onClick={() => window.confirm('Supprimer ce commentaire ?') && void removeComment(c.id)} title="Supprimer">
                    <Trash2 className="ic" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
