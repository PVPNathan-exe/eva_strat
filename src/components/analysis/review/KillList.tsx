// Liste des kills de la game : un clic ramène la vidéo (et le replay) 2 s avant le kill.

import { Crosshair } from 'lucide-react';
import { formatTime } from '../../../lib/timeline';
import type { Game } from '../../../types/analysis';
import { numberOfSlot, teamVar } from './replayFrames';

export function KillList({ game, time, nameOf, onSeek }: { game: Game; time: number; nameOf: Map<number, string>; onSeek: (t: number) => void }) {
  if (game.kills.length === 0) return null;
  return (
    <div className="replay__kills">
      <strong>Kills ({game.kills.length})</strong>
      <ul>
        {game.kills.map((k) => (
          <li key={`${k.t}-${k.victim}`} className={Math.abs(time - k.t) < 3 ? 'is-now' : ''}>
            <button onClick={() => onSeek(Math.max(game.start_s, k.t - 2))} title="Aller à ce kill dans la vidéo">
              {formatTime(k.t - game.start_s)}
            </button>
            {k.kind === 'environment' ? (
              <span className="kill__env" title="Aucun tueur sur la ligne du killfeed : mort du décor ou action d'un admin">décor</span>
            ) : k.killer === null ? (
              <span className="kill__env" title="Un tueur est affiché mais son pseudo n'a pas pu être lu">tueur ?</span>
            ) : k.killer === k.victim ? (
              <span className="kill__env" title="Même pseudo des deux côtés">suicide</span>
            ) : (
              <span
                style={{ color: teamVar(k.killer > 4 ? 'B' : 'A'), fontStyle: k.kind === 'inferred' ? 'italic' : undefined }}
                title={k.kind === 'inferred' ? "Tueur déduit par élimination : adversaire en vie, arme tenue et distance cohérentes (le pseudo n'a pas pu être lu)" : undefined}
              >
                {nameOf.get(k.killer) ?? `n° ${numberOfSlot(k.killer)}`}
                {k.kind === 'inferred' && ' ?'}
              </span>
            )}
            <i title={k.weapon ? `${k.stuff ?? k.weaponName ?? 'arme non nommée'} (icône ${k.weapon})` : 'arme inconnue'}>{k.stuff ?? k.weaponName ?? k.weapon ?? '·'}
              {k.headshot && <Crosshair className="ic ic--hs" aria-label="Headshot" />}
            </i>
            <span style={{ color: teamVar(k.victim > 4 ? 'B' : 'A') }}>{nameOf.get(k.victim) ?? `n° ${numberOfSlot(k.victim)}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
