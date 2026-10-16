// Corrections à la main d'une game dans l'écran de review : liste (useMarks), mode correction, niveau et mort posés avec les prochaines corrections.

import { useState } from 'react';
import { TWO_LEVEL_MAPS } from '../../../lib/twoLevelMaps';
import type { Game } from '../../../types/analysis';
import { useMarks } from '../useMarks';

export function useReviewMarks(game: Game) {
  const { marks, error, add, remove } = useMarks(game.id);
  const [correcting, setCorrecting] = useState(false);
  const [level, setLevel] = useState<'etage' | 'dessous'>('dessous'); // rez-de-chaussée par défaut (Atlantis et The Cliff)
  const [markDead, setMarkDead] = useState(false); // les prochaines corrections posent le joueur mort à cet endroit

  /** Pose une correction à l'instant `t` (secondes de vidéo) : position de la minimap, regard (null : position seule). */
  const place = (slot: number, t: number, x: number, y: number, angle: number | null) =>
    add({ game_id: game.id, slot, t, x, y, angle: markDead ? null : angle, level: TWO_LEVEL_MAPS.includes(game.map ?? '') ? level : null, dead: markDead });

  return { marks, error, remove, place, correcting, setCorrecting, level, setLevel, markDead, setMarkDead };
}
