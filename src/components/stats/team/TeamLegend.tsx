// Légende toujours visible de la vue Équipe : ce que signifie le calque, une couleur par équipe (palette .pal), l'échelle et le nombre de games.

import { layerDef, type LayerId } from '../../../lib/teamView';

interface Props {
  layer: LayerId;
  /** Nom de l'équipe suivie (palette a). */
  team: string;
  games: number;
  /** Pseudo du joueur choisi, null pour l'équipe entière. */
  player: string | null;
}

export function TeamLegend({ layer, team, games, player }: Props) {
  const def = layerDef(layer);
  return (
    <div className="team__legend" role="group" aria-label="Légende du calque">
      <p className="team__legend-text">
        <strong>{def.label}</strong>
        {player ? ` (joueur ${player})` : ''} : {def.meaning}
      </p>
      <div className="team__legend-row">
        <span className="team__chip pal pal--a">{team}</span>
        <span className="team__chip pal pal--b">Adversaires</span>
        {def.kind === 'diverging' ? (
          <span className="team__scale">
            plus de morts <i className="team__scale-bar team__scale-bar--div" /> plus de kills
          </span>
        ) : (
          <span className="team__scale pal pal--a">
            peu <i className="team__scale-bar" /> beaucoup
          </span>
        )}
        <span className="team__legend-games">
          {games} game{games > 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}
