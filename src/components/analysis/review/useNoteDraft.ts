// Brouillon d'une note de review et geste de pose sur le plan.
// Position à corriger : un clic pose le fantôme (où le joueur aurait dû être), glisser ajuste, glisser DEPUIS le fantôme donne le regard voulu.
// Action : un clic pose le gadget. Remarque : texte seul. Rien de tout cela ne touche aux données lues (le brouillon n'existe que dans le volet).

import { useState, type PointerEvent } from 'react';
import type { Inset } from '../../../lib/planInsets';
import type { NoteDraftFields } from '../../../lib/reviewNotes';
import type { Game } from '../../../types/analysis';
import type { ReviewNoteKind } from '../../../types/stats';
import { gazeAngle, pixelDistance, planToMinimap, stageFraction } from './notePlacement';

/** Un appui à moins de ce nombre de pixels du fantôme saisit son regard au lieu de le déplacer. */
export const GHOST_GRAB_PX = 18;

interface Placed {
  slot: number;
  x: number;
  y: number;
  angle: number | null;
}

interface Params {
  game: Game;
  /** Joueur choisi dans l'écran de review. */
  selected: number | null;
  /** Instant affiché (secondes de vidéo). */
  time: number;
  inset: Inset;
  /** Minimap vers plan, en pourcentages (lib/planInsets.project). */
  place: (x: number, y: number) => { x: number; y: number };
  /** Fige l'image : met la vidéo ou le replay en pause quand on commence à poser ou à écrire. */
  freeze: () => void;
  /** Gadget de la vie du joueur choisi à cet instant (lib/reviewNotes.gadgetChoices), proposé tant qu'on n'en choisit pas un autre. */
  defaultGadget: string | null;
}

export function useNoteDraft({ game, selected, time, inset, place, freeze, defaultGadget }: Params) {
  const [kind, setKindState] = useState<ReviewNoteKind>('position');
  const [open, setOpen] = useState(true); // le volet est ouvert d'emblée
  const [frozenAt, setFrozenAt] = useState<number | null>(null); // instant figé (secondes de vidéo)
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [gadget, setGadget] = useState<string | null>(null); // null : le gadget de la vie du joueur à cet instant
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'place' | 'gaze' | null>(null);

  const at = frozenAt ?? time;
  // La pose ne vaut que pour le joueur pour lequel elle a été faite : changer de joueur la retire.
  const mine = placed && placed.slot === selected ? placed : null;
  const draft: NoteDraftFields = { kind, slot: selected, t: at - game.start_s, x: mine?.x ?? null, y: mine?.y ?? null, angle: mine?.angle ?? null, gadget: gadget ?? defaultGadget ?? '', text };
  const active = open && kind !== 'note' && selected !== null;

  const startFreeze = () => {
    if (frozenAt !== null) return;
    freeze();
    setFrozenAt(time);
  };

  const setKind = (k: ReviewNoteKind) => {
    setKindState(k);
    setPlaced(null);
  };

  const reset = () => {
    setPlaced(null);
    setFrozenAt(null);
    setGadget(null);
    setText('');
  };

  const fraction = (e: PointerEvent<HTMLDivElement>) => stageFraction(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!active || selected === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startFreeze();
    const p = fraction(e);
    const rect = e.currentTarget.getBoundingClientRect();
    if (kind === 'position' && mine) {
      const g = place(mine.x, mine.y);
      if (pixelDistance(rect, p, { x: g.x / 100, y: g.y / 100 }) <= GHOST_GRAB_PX) return setMode('gaze'); // depuis le fantôme : le regard
    }
    const m = planToMinimap(inset, p.x, p.y);
    setMode('place');
    setPlaced({ slot: selected, x: m.x, y: m.y, angle: mine?.angle ?? null });
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!mode || !mine || selected === null) return;
    const p = fraction(e);
    if (mode === 'place') {
      const m = planToMinimap(inset, p.x, p.y);
      setPlaced({ ...mine, x: m.x, y: m.y });
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const g = place(mine.x, mine.y);
    const angle = gazeAngle((p.x - g.x / 100) * rect.width, (p.y - g.y / 100) * rect.height);
    if (angle !== null) setPlaced({ ...mine, angle });
  };

  const onPointerUp = () => setMode(null);

  return {
    draft,
    frozen: frozenAt !== null,
    active,
    setOpen,
    setKind,
    setGadget,
    setText,
    startFreeze,
    unfreeze: () => setFrozenAt(null),
    clearGaze: () => setPlaced((p) => (p ? { ...p, angle: null } : p)),
    reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp },
  };
}
