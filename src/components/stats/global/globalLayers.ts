// Pixels des couches du calque choisi de la vue Global : une couche RGBA n par n par côté, dans la couleur du côté (orange à gauche, bleu à droite).
// Les couleurs sont passées en paramètre (lues dans tokens.css par l'appelant), rien n'est lu dans la page ici.

import { heatPixels, type Rgb } from '../../../lib/heatGrid';
import type { SideLayer } from '../../../lib/globalView';
import type { TeamSideName } from '../../../types/statsTeam';

/** Couleurs des couches (jetons de tokens.css). */
export interface GlobalColors {
  low: Rgb;
  /** Côté gauche (équipe A, palette a). */
  left: Rgb;
  /** Côté droit (équipe B, palette b). */
  right: Rgb;
}

/** Une couche prête à dessiner. */
export interface GlobalImage {
  side: TeamSideName;
  pixels: Uint8ClampedArray;
  blank: boolean;
}

/** Pixels de chaque couche, dans la couleur de son côté. */
export function globalImages(layers: SideLayer[], n: number, c: GlobalColors): GlobalImage[] {
  return layers.map((l) => ({ side: l.side, blank: l.blank, pixels: heatPixels(l.norm, n, c.low, l.side === 'left' ? c.left : c.right) }));
}
