// Outil de correction de l'onglet Lecture : choisir un joueur, poser sa position (clic) et son regard (glisser) sur la minimap agrandie, puis recalculer le suivi avec ces vérités.

import { useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { useAnalysisStore } from '../../store/analysisStore';
import { TWO_LEVEL_MAPS } from '../../lib/twoLevelMaps';
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
  markDead,
  onMarkDead,
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
  level: 'etage' | 'dessous';
  onLevel: (level: 'etage' | 'dessous') => void;
  markDead: boolean;
  onMarkDead: (dead: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const bumpData = useAnalysisStore((s) => s.bumpData);

  const recompute = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await analysisApi.resolveGame(game.id);
      await bumpData(); // positions, contrôles, kills et liste des games relus partout
      setMessage('Suivi recalculé avec tes corrections : positions, contrôle à la minimap et page mis à jour.');
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
          <label className="marks__dead">
            <input type="checkbox" checked={markDead} onChange={(e) => onMarkDead(e.target.checked)} /> Le joueur est mort (clique l'endroit de sa mort : il reste mort 14 s, ou jusqu'à ta correction suivante pour lui)
          </label>
          {TWO_LEVEL_MAPS.includes(game.map ?? '') && (
            <label className="marks__level">
              Niveau du joueur (la lecture est ambiguë entre le rez-de-chaussée et l'étage){' '}
              <select value={level} onChange={(e) => onLevel(e.target.value as 'etage' | 'dessous')}>
                <option value="dessous">rdc</option>
                <option value="etage">étage 1</option>
              </select>
            </label>
          )}
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
                {formatTime(m.t - game.start_s)} · joueur {numberOf(m.slot)} · {m.dead ? 'mort' : m.angle === null ? 'position' : `position et regard ${Math.round(m.angle)}°`}
                {m.level === 'etage' ? ' · étage 1' : m.level === 'dessous' ? ' · rdc' : ''}
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
