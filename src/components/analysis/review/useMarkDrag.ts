// Geste de correction sur le plan du replay : un clic pose la position du joueur choisi, un glisser y ajoute le regard (direction de la pointe).
// Le résultat est donné en position normalisée de la minimap, comme les corrections de l'onglet Lecture (useMarks).

import { useState, type PointerEvent } from 'react';
import type { Inset } from '../../../lib/planInsets';
import { gazeAngle, planToMinimap, stageFraction, type Drag } from './markPlacement';

/** `active` : un joueur est choisi et le mode correction est ouvert ; `onDone` reçoit la position (minimap) et le regard (null : clic simple). */
export function useMarkDrag(slot: number | null, active: boolean, inset: Inset, onDone: (slot: number, x: number, y: number, angle: number | null) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);

  const fraction = (e: PointerEvent<HTMLDivElement>) => stageFraction(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!active || slot === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = fraction(e);
    setDrag({ slot, x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const p = fraction(e);
    setDrag({ ...drag, x1: p.x, y1: p.y });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const angle = gazeAngle((drag.x1 - drag.x0) * rect.width, (drag.y1 - drag.y0) * rect.height);
    const at = planToMinimap(inset, drag.x0, drag.y0);
    setDrag(null);
    onDone(drag.slot, at.x, at.y, angle);
  };

  return { drag, handlers: { onPointerDown, onPointerMove, onPointerUp } };
}
