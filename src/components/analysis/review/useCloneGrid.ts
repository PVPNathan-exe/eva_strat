// Grille d'obstacles d'une carte pour le trajet du clone des notes de review (masque des couloirs et classes : mur, vitre, fenêtre, porte, tir par-dessus, hors map).
// Chargée seulement quand elle sert (un joueur est choisi, ou une note de clone existe) ; sans masque pour la carte, le trajet n'est pas calculé et le dit.

import { useMemo } from 'react';
import { buildObstacleGrid } from '../../../lib/clonePath';
import type { BlockGrid } from '../../../lib/visibility';
import { useLoad } from '../../stats/useStats';
import { loadZoneSources } from './zoneSources';

export interface CloneGridState {
  grid: BlockGrid | null;
  /** Message à montrer quand la grille manque (chargement ou carte sans masque) ; null : prête, ou pas demandée. */
  notice: string | null;
}

export function useCloneGrid(map: string, enabled: boolean): CloneGridState {
  const sources = useLoad(enabled && map ? `review-clone-sources:${map}` : null, () => loadZoneSources(map));
  const grid = useMemo(() => (sources.data ? buildObstacleGrid(sources.data.walk, sources.data.classes) : null), [sources.data]);
  const notice = !enabled || !map || grid ? null : sources.error ? `Trajet du clone non calculé : ${sources.error}` : 'Chargement des murs de la carte pour le trajet du clone…';
  return { grid, notice };
}
