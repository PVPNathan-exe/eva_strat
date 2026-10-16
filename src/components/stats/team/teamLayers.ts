// Calcul des pixels du calque choisi de la vue Équipe : une ou deux couches RGBA n par n, selon le type du calque (voir lib/teamView.ts).
// Les couleurs sont passées en paramètre (lues dans tokens.css par l'appelant), rien n'est lu dans la page ici.

import { heatPixels, type Rgb } from '../../../lib/heatGrid';
import { divergingPixels, heatNorm, isBlank, killsMinusDeaths, pairNorm, playerCells, type LayerId, type PlayerGroup } from '../../../lib/teamView';
import type { TeamCell, TeamSummary } from '../../../types/statsTeam';

/** Couleurs du calque (jetons de tokens.css). */
export interface LayerColors {
  low: Rgb;
  /** Équipe suivie (palette a). */
  a: Rgb;
  /** Adversaires (palette b). */
  b: Rgb;
  /** Différence positive (plus de kills que de morts). */
  good: Rgb;
  /** Différence négative. */
  bad: Rgb;
}

/** Une couche à dessiner : pixels et vrai si elle est vide. */
export interface LayerImage {
  pixels: Uint8ClampedArray;
  blank: boolean;
}

/** Cases d'un calque de chaleur simple (équipe entière, ou un joueur pour la présence). */
function heatCells(data: TeamSummary, id: LayerId, group: PlayerGroup | null): TeamCell[] {
  if (id === 'presence_left' || id === 'presence_right') {
    const side = id === 'presence_left' ? 'left' : 'right';
    return group ? playerCells(data.players, group.key, side) : data.presence[side];
  }
  if (id === 'deaths') return data.death_grid;
  if (id === 'duels_lost') return data.duel_lost_grid;
  return data.duel_won_grid;
}

/** Couches du calque `id` : une seule (chaleur ou différence) ou deux (kills : morts de l'équipe puis morts des adversaires, même échelle). */
export function layerImages(data: TeamSummary, id: LayerId, sigma: number, group: PlayerGroup | null, c: LayerColors): LayerImage[] {
  const n = data.n;
  if (id === 'kd') {
    const norm = killsMinusDeaths(data.kill_grid, data.death_grid, n, sigma);
    return [{ pixels: divergingPixels(norm, n, c.bad, c.good), blank: isBlank(norm) }];
  }
  if (id === 'kills') {
    const [mine, theirs] = pairNorm(data.death_grid, data.kill_grid, n, sigma);
    return [
      { pixels: heatPixels(mine, n, c.low, c.a), blank: isBlank(mine) },
      { pixels: heatPixels(theirs, n, c.low, c.b), blank: isBlank(theirs) },
    ];
  }
  const norm = heatNorm(heatCells(data, id, group), n, sigma);
  return [{ pixels: heatPixels(norm, n, c.low, c.a), blank: isBlank(norm) }];
}
