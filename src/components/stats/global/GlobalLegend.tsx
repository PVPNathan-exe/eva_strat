// Légende toujours visible de la vue Global : ce que signifie le calque, une couleur par côté (palette .pal), l'échelle et le nombre de games.

import { globalLayerDef, type GlobalLayerId } from '../../../lib/globalView';

interface Props {
  layer: GlobalLayerId;
  games: number;
}

export function GlobalLegend({ layer, games }: Props) {
  const def = globalLayerDef(layer);
  return (
    <div className="global__legend" role="group" aria-label="Légende du calque">
      <p className="global__legend-text">
        <strong>{def.label}</strong> : {def.meaning}
      </p>
      <div className="global__legend-row">
        <span className="global__chip pal pal--a">Côté gauche (orange)</span>
        <span className="global__chip pal pal--b">Côté droit (bleu)</span>
        <span className="global__scale">
          peu <i className="global__scale-bar" /> beaucoup
        </span>
        <span className="global__legend-games">
          {games} game{games > 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
}
