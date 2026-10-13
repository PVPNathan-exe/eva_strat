// Kills de la game à marquer « libanaise » : le tueur est collé à un mur, décale son arme dans l'ouverture et tire à l'aveugle en restant protégé. Son regard ne vise pas sa victime :
// la règle du kill du suivi ne s'applique pas à ce kill (au prochain recalcul de la game).

import { useCallback, useEffect, useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { formatTime } from '../../lib/timeline';
import type { Game } from '../../types/analysis';

const numberOf = (slot: number) => (slot <= 4 ? slot : slot + 1);
const same = (a: number, b: number) => Math.abs(a - b) < 0.05;

export function KillFlagsPanel({ game }: { game: Game }) {
  const [flags, setFlags] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);
  const kills = game.kills.filter((k) => k.killer !== null && k.kind !== 'suicide' && k.kind !== 'environment');

  const reload = useCallback(() => {
    analysisApi
      .killFlags(game.id)
      .then(setFlags)
      .catch((e: Error) => setError(e.message));
  }, [game.id]);
  useEffect(reload, [reload]);

  const isFlagged = (t: number, victim: number) => flags.some(([ft, fv]) => fv === victim && same(ft, t));
  const toggle = async (t: number, victim: number, libanaise: boolean) => {
    try {
      await analysisApi.setKillFlag({ game_id: game.id, t, victim, libanaise });
      setError(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (kills.length === 0) return null;
  return (
    <details className="killflags">
      <summary>Kills à la libanaise ({flags.length} marqué{flags.length > 1 ? 's' : ''})</summary>
      <p className="marks__help">
        Coche un kill où le tueur est collé à un mur, décale son arme dans l'ouverture et tire à l'aveugle : son regard ne vise pas sa victime, le programme n'y applique plus la règle du
        kill. Pris en compte au prochain recalcul de la game.
      </p>
      <ul className="marks__list">
        {kills.map((k) => (
          <li key={`${k.t}-${k.victim}`}>
            <label>
              <input type="checkbox" checked={isFlagged(k.t, k.victim)} onChange={(e) => void toggle(k.t, k.victim, e.target.checked)} /> {formatTime(k.t - game.start_s)} · joueur {numberOf(k.killer ?? 0)} tue le{' '}
              {numberOf(k.victim)}
              {k.weaponName ? ` (${k.weaponName})` : ''}
            </label>
          </li>
        ))}
      </ul>
      {error && <span className="games__error">{error}</span>}
    </details>
  );
}
