// Barre commune des vues Joueurs et Équipes : choix de l'étendue (toutes les cartes ou la carte du filtre) et légende des couleurs (équipe suivie par son nom en « a », les autres en « b »).

import type { SummaryScopeChoice } from './scopeChoice';

interface Props {
  map: string;
  scope: SummaryScopeChoice;
  onScope: (next: SummaryScopeChoice) => void;
  /** Nom de l'équipe suivie telle qu'écrite dans les données (null : aucune équipe suivie, pas de légende). */
  followed: string | null;
  /** Nombre de games dans l'étendue (celui du serveur). */
  games: number | null;
}

export function SummaryScope({ map, scope, onScope, followed, games }: Props) {
  return (
    <div className="stats__bar">
      <label className="stats__field">
        Étendue
        <select value={scope} onChange={(e) => onScope(e.target.value as SummaryScopeChoice)}>
          <option value="all">Toutes les cartes</option>
          <option value="map">Carte : {map}</option>
        </select>
      </label>
      {games !== null && (
        <span className="stats__count">
          {games} game{games > 1 ? 's' : ''}
        </span>
      )}
      {followed && (
        <ul className="stats__legend" aria-label="Couleurs des équipes">
          <li className="pal pal--a">
            <i className="sum__dot" aria-hidden /> {followed} (équipe suivie)
          </li>
          <li className="pal pal--b">
            <i className="sum__dot" aria-hidden /> autres équipes
          </li>
        </ul>
      )}
    </div>
  );
}
