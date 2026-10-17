// Filtres communs des vues Stats : carte, games, équipe suivie (par nom), côté, joueur, avec le nombre de games retenues.
// Par défaut UNE seule game est retenue : la plus récente de la carte. Le menu Games en ajoute d'autres (cumul). Une équipe suivie garde une couleur fixe
// (celle de l'équipe A du thème), ses adversaires l'autre, quel que soit leur côté dans la game ; sans équipe suivie, les équipes sont prises par côté (orange à gauche, bleue à droite).

import { Layers } from 'lucide-react';
import { numberOfSlot } from '../../lib/killTimeline';
import { ROOM_LABEL, type RoomFilter } from '../../lib/roomFilter';
import { playerChoices, type ShowFilter, type SideFilter, type TeamName } from '../../lib/teamFollow';
import { gameLabel, specOf, type StatsGame } from './useStats';

export interface StatsFilterState {
  /** Contexte de jeu : toutes les games, intersalle seulement ou même salle seulement. */
  room: RoomFilter;
  /** Carte choisie ; null : la première carte qui a des games. */
  map: string | null;
  /** Identifiants des games choisies dans le menu Games ; null : la plus récente seulement. */
  chosen: number[] | null;
  /** Équipe suivie (nom normalisé) ; null : les équipes sont prises par côté. */
  team: string | null;
  side: SideFilter;
  show: ShowFilter;
  /** Sans équipe suivie : joueur (slot 1 à 8), 0 pour tous. */
  slot: number;
  /** Avec une équipe suivie : pseudo normalisé du joueur, null pour tous. */
  player: string | null;
}

interface Props {
  maps: [string, number][];
  /** Carte effectivement affichée (le choix, ou la première). */
  map: string | null;
  /** Games de cette carte qui entrent dans le réglage d'équipe et de côté. */
  mapGames: StatsGame[];
  /** Nombre de games de la carte avant le réglage d'équipe. */
  mapTotal: number;
  /** Games retenues parmi mapGames. */
  selected: StatsGame[];
  /** Équipes vues sur la carte. */
  teams: TeamName[];
  state: StatsFilterState;
  onChange: (next: StatsFilterState) => void;
}

export function StatsFilters({ maps, map, mapGames, mapTotal, selected, teams, state, onChange }: Props) {
  const chosenIds = new Set(selected.map((g) => g.id));
  const toggle = (id: number) => onChange({ ...state, chosen: chosenIds.has(id) ? [...chosenIds].filter((e) => e !== id) : [...chosenIds, id] });
  const spec = specOf(state);
  // Pseudo d'un numéro de joueur : celui de la dernière game retenue qui le connaît
  const nameOf = (slot: number) => [...selected].reverse().flatMap((g) => g.players.filter((p) => p.slot === slot).map((p) => p.name))[0];
  const players = state.team ? playerChoices(selected, spec) : [];
  const latest = mapGames.length ? mapGames.reduce((best, g) => (g.id > best.id ? g : best)).id : null;
  return (
    <div className="stats__filters">
      <label className="stats__field" title="Intersalle : chaque équipe joue dans sa propre salle (case à cocher de la vidéo dans l'onglet Analyse). Le gameplay diffère : les joueurs courent plus et plus vite.">
        Salle
        <select value={state.room} onChange={(e) => onChange({ ...state, room: e.target.value as RoomFilter, map: null, chosen: null, team: null, side: 'both', show: 'both', slot: 0, player: null })}>
          {(Object.keys(ROOM_LABEL) as RoomFilter[]).map((r) => (
            <option key={r} value={r}>
              {ROOM_LABEL[r]}
            </option>
          ))}
        </select>
      </label>
      <label className="stats__field">
        Carte
        <select value={map ?? ''} onChange={(e) => onChange({ ...state, map: e.target.value, chosen: null, team: null, side: 'both', show: 'both', slot: 0, player: null })}>
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
            <button type="button" onClick={() => onChange({ ...state, chosen: null })}>Plus récente</button>
            <button type="button" onClick={() => onChange({ ...state, chosen: mapGames.map((g) => g.id) })}>Toutes</button>
            <button type="button" onClick={() => onChange({ ...state, chosen: [] })}>Aucune</button>
          </div>
          {mapGames.map((g) => (
            <label key={g.id}>
              <input type="checkbox" checked={chosenIds.has(g.id)} onChange={() => toggle(g.id)} /> {gameLabel(g)}
              {g.id === latest ? ' (la plus récente)' : ''}
            </label>
          ))}
        </div>
      </details>
      <label className="stats__field">
        Équipe suivie
        <select value={state.team ?? ''} onChange={(e) => onChange({ ...state, team: e.target.value || null, show: 'both', slot: 0, player: null, chosen: null })}>
          <option value="">Aucune (par côté)</option>
          {teams.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label} ({t.games})
            </option>
          ))}
        </select>
      </label>
      <label className="stats__field">
        Côté
        <select value={state.side} onChange={(e) => onChange({ ...state, side: e.target.value as SideFilter, chosen: state.team ? null : state.chosen })}>
          <option value="both">Les deux</option>
          <option value="left">{state.team ? 'À gauche (orange)' : 'Équipe de gauche (orange, joueurs 1 à 4)'}</option>
          <option value="right">{state.team ? 'À droite (bleue)' : 'Équipe de droite (bleue, joueurs 6 à 9)'}</option>
        </select>
      </label>
      {state.team && (
        <label className="stats__field">
          Afficher
          <select value={state.show} onChange={(e) => onChange({ ...state, show: e.target.value as ShowFilter })}>
            <option value="both">L'équipe et ses adversaires</option>
            <option value="followed">L'équipe suivie seule</option>
            <option value="opponents">Ses adversaires seuls</option>
          </select>
        </label>
      )}
      {state.team ? (
        <label className="stats__field">
          Joueur
          <select value={state.player ?? ''} onChange={(e) => onChange({ ...state, player: e.target.value || null })}>
            <option value="">Tous</option>
            {players.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <label className="stats__field">
          Joueur
          <select value={state.slot} onChange={(e) => onChange({ ...state, slot: Number(e.target.value), side: 'both' })}>
            <option value={0}>Tous</option>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((slot) => (
              <option key={slot} value={slot}>
                N° {numberOfSlot(slot)}
                {nameOf(slot) ? ` (${nameOf(slot)})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <span className="stats__count" aria-live="polite">
        {selected.length} {selected.length > 1 ? 'games retenues' : 'game retenue'}
        {state.team && mapGames.length < mapTotal ? ` (${mapGames.length} sur ${mapTotal} avec cette équipe)` : ''}
      </span>
    </div>
  );
}
