// Outil de correction de l'onglet Lecture : choisir un joueur, poser sa position (clic) et son regard (glisser) sur la minimap agrandie, puis recalculer le suivi avec ces vérités.

import { useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { formatTime } from '../../lib/timeline';
import type { Game, UserMark } from '../../types/analysis';

const PLAYERS = [1, 2, 3, 4, 5, 6, 7, 8]; // créneaux ; le numéro affiché dans le jeu est créneau + 1 à partir du 5
const numberOf = (slot: number) => (slot <= 4 ? slot : slot + 1);

export function MarkPanel({
  game,
  marks,
  error,
  correcting,
  onCorrecting,
  pick,
  onPick,
  onRemove,
  onRecomputed,
  level,
  onLevel,
}: {
  game: Game;
  marks: UserMark[];
  error: string | null;
  correcting: boolean;
  onCorrecting: (on: boolean) => void;
  pick: number | null;
  onPick: (slot: number | null) => void;
  onRemove: (id: number) => void;
  onRecomputed: () => void;
  level: 'etage' | 'dessous' | null;
  onLevel: (level: 'etage' | 'dessous' | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const recompute = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await analysisApi.resolveGame(game.id);
      setMessage('Suivi recalculé avec tes corrections.');
      onRecomputed();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="marks">
      <label>
        <input type="checkbox" checked={correcting} onChange={(e) => onCorrecting(e.target.checked)} /> Corriger : poser un joueur à la main
      </label>
      {correcting && (
        <>
          <div className="marks__players" role="group" aria-label="Joueur à placer">
            {PLAYERS.map((slot) => (
              <button key={slot} className={pick === slot ? 'is-active' : ''} onClick={() => onPick(pick === slot ? null : slot)}>
                {numberOf(slot)}
              </button>
            ))}
          </div>
          <label className="marks__level">
            Niveau du joueur (Atlantis, The Cliff : la lecture est ambiguë entre l'étage et le dessous){' '}
            <select value={level ?? ''} onChange={(e) => onLevel(e.target.value === '' ? null : (e.target.value as 'etage' | 'dessous'))}>
              <option value="">non précisé</option>
              <option value="etage">étage</option>
              <option value="dessous">dessous</option>
            </select>
          </label>
          <p className="marks__help">
            1. Mets la vidéo à l'instant voulu. 2. Choisis le joueur. 3. Clique sur le centre de sa pastille pour la position, ou clique et glisse vers la direction de la pointe pour la
            position et le regard. Plusieurs corrections valent mieux qu'une, surtout autour d'une erreur.
          </p>
        </>
      )}
      {marks.length > 0 && (
        <ul className="marks__list">
          {marks.map((m) => (
            <li key={m.id}>
              <span>
                {formatTime(m.t - game.start_s)} · joueur {numberOf(m.slot)} · {m.angle === null ? 'position' : `position et regard ${Math.round(m.angle)}°`}
                {m.level === 'etage' ? ' · étage' : m.level === 'dessous' ? ' · dessous' : ''}
              </span>
              <button onClick={() => onRemove(m.id)}>Retirer</button>
            </li>
          ))}
        </ul>
      )}
      <div className="marks__bar">
        <button disabled={busy || marks.length === 0} onClick={() => void recompute()}>
          {busy ? 'Recalcul…' : 'Recalculer avec mes corrections'}
        </button>
        {message && <span className="marks__message">{message}</span>}
        {error && <span className="games__error">{error}</span>}
      </div>
    </div>
  );
}
