// Filtres communs des vues Stats : carte, games, équipe, joueur, avec le nombre de games retenues.
// Les games sont toutes cochées par défaut : l'état garde seulement celles que l'utilisateur a décochées.

import { Layers } from 'lucide-react';
import { numberOfSlot } from '../../lib/killTimeline';
import type { TeamSide } from '../../types/stats';
import { gameLabel, type StatsGame } from './useStats';

export interface StatsFilterState {
  /** Carte choisie ; null : la première carte qui a des games. */
  map: string | null;
  /** Identifiants des games décochées. */
  excluded: number[];
  team: TeamSide | 'all';
  /** Joueur (slot 1 à 8) ; 0 : tous. */
  slot: number;
}

interface Props {
  maps: [string, number][];
  /** Carte effectivement affichée (le choix, ou la première). */
  map: string | null;
  /** Games de cette carte. */
  mapGames: StatsGame[];
  /** Games retenues (cochées) parmi mapGames. */
  selected: StatsGame[];
  state: StatsFilterState;
  onChange: (next: StatsFilterState) => void;
}

export function StatsFilters({ maps, map, mapGames, selected, state, onChange }: Props) {
  const excluded = new Set(state.excluded);
  const toggle = (id: number) => onChange({ ...state, excluded: excluded.has(id) ? state.excluded.filter((e) => e !== id) : [...state.excluded, id] });
  // Pseudo d'un numéro de joueur : celui de la dernière game retenue qui le connaît
  const nameOf = (slot: number) => [...selected].reverse().flatMap((g) => g.players.filter((p) => p.slot === slot).map((p) => p.name))[0];
  return (
    <div className="stats__filters">
      <label className="stats__field">
        Carte
        <select value={map ?? ''} onChange={(e) => onChange({ ...state, map: e.target.value, excluded: [] })}>
          {maps.map(([name, n]) => (
            <option key={name} value={name}>
              {name} ({n})
            </option>
          ))}
        </select>
      </label>
      <details className="menu">
        <summary>
          <Layers className="ic" /> Games ({selected.length} sur {mapGames.length})
        </summary>
        <div className="menu__panel">
          <div className="stats__bulk">
            <button type="button" onClick={() => onChange({ ...state, excluded: [] })}>Toutes</button>
            <button type="button" onClick={() => onChange({ ...state, excluded: mapGames.map((g) => g.id) })}>Aucune</button>
          </div>
          {mapGames.map((g) => (
            <label key={g.id}>
              <input type="checkbox" checked={!excluded.has(g.id)} onChange={() => toggle(g.id)} /> {gameLabel(g)}
            </label>
          ))}
        </div>
      </details>
      <label className="stats__field">
        Équipe
        <select value={state.team} onChange={(e) => onChange({ ...state, team: e.target.value as StatsFilterState['team'], slot: 0 })}>
          <option value="all">Les deux</option>
          <option value="A">Orange (joueurs 1 à 4)</option>
          <option value="B">Bleue (joueurs 6 à 9)</option>
        </select>
      </label>
      <label className="stats__field">
        Joueur
        <select value={state.slot} onChange={(e) => onChange({ ...state, slot: Number(e.target.value), team: 'all' })}>
          <option value={0}>Tous</option>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => (
            <option key={slot} value={slot}>
              N° {numberOfSlot(slot)}
              {nameOf(slot) ? ` (${nameOf(slot)})` : ''}
            </option>
          ))}
        </select>
      </label>
      <span className="stats__count" aria-live="polite">
        {selected.length} {selected.length > 1 ? 'games retenues' : 'game retenue'}
      </span>
    </div>
  );
}
