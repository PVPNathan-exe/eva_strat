// Brouillon d'une note de review et gestes sur le plan.
// Position à corriger : glisser un joueur du plan vers l'endroit voulu (ou cliquer pour poser le fantôme, glisser pour l'ajuster, glisser DEPUIS le fantôme pour donner le regard).
// Action : choisir une pastille de gadget (joueur et gadget), puis cliquer sur le plan. Remarque : texte seul.
// Le commentaire est prérempli (lib/gadgetStates.autoNoteText) tant qu'on ne l'a pas modifié. Rien de tout cela ne touche aux données lues : le brouillon n'existe que dans le volet.

import { useRef, useState, type PointerEvent } from 'react';
import { autoNoteText, OTHER_GADGET } from '../../../lib/gadgetStates';
import type { Inset } from '../../../lib/planInsets';
import type { NoteDraftFields } from '../../../lib/reviewNotes';
import type { Game } from '../../../types/analysis';
import type { ReviewNoteKind } from '../../../types/stats';
import { gazeAngle, isDrag, pixelDistance, planToMinimap, stageFraction } from './notePlacement';

/** Un appui à moins de ce nombre de pixels du fantôme saisit son regard au lieu de le déplacer. */
export const GHOST_GRAB_PX = 18;

interface Placed {
  slot: number;
  x: number;
  y: number;
  angle: number | null;
}

/** Appui commencé sur un pion du plan : un clic (choisir le joueur) tant qu'il ne bouge pas, un glisser ensuite. */
interface Pending {
  slot: number;
  alive: boolean;
  cx: number;
  cy: number;
  dragging: boolean;
}

interface Params {
  game: Game;
  nameOf: Map<number, string>;
  /** Joueur choisi dans l'écran de review. */
  selected: number | null;
  /** Choisit un joueur (ou personne : null). */
  onSelect: (slot: number | null) => void;
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

export function useNoteDraft({ game, nameOf, selected, onSelect, time, inset, place, freeze, defaultGadget }: Params) {
  const [kind, setKindState] = useState<ReviewNoteKind>('position');
  const [open, setOpen] = useState(true); // le volet est ouvert d'emblée
  const [frozenAt, setFrozenAt] = useState<number | null>(null); // instant figé (secondes de vidéo)
  const [placed, setPlaced] = useState<Placed | null>(null);
  const [gadget, setGadgetState] = useState<{ slot: number; name: string } | null>(null); // gadget choisi pour CE joueur ; null : celui de sa vie à cet instant
  const [typed, setTyped] = useState<string | null>(null); // commentaire écrit à la main ; null : le texte prérempli
  const [mode, setMode] = useState<'place' | 'gaze' | null>(null);
  const pending = useRef<Pending | null>(null);

  const at = frozenAt ?? time;
  // La pose ne vaut que pour le joueur pour lequel elle a été faite : changer de joueur la retire.
  const mine = placed && placed.slot === selected ? placed : null;
  const chosenGadget = gadget && gadget.slot === selected ? gadget.name : null;
  const gadgetName = chosenGadget ?? defaultGadget ?? '';
  const text = typed ?? autoNoteText(kind, selected, gadgetName, mine !== null, nameOf);
  const draft: NoteDraftFields = { kind, slot: selected, t: at - game.start_s, x: mine?.x ?? null, y: mine?.y ?? null, angle: mine?.angle ?? null, gadget: gadgetName, text };
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

  /** Gadget du joueur choisi (null : celui de sa vie). */
  const setGadget = (name: string | null) => {
    if (selected !== null) setGadgetState(name === null ? null : { slot: selected, name });
  };

  /** Clic sur une pastille de gadget : choisit ce joueur ET ce gadget pour une action ; un second clic retire le choix. */
  const pickChip = (slot: number, name: string | null) => {
    setOpen(true);
    if (selected === slot && kind === 'action') return onSelect(null);
    startFreeze();
    onSelect(slot);
    setKindState('action');
    setPlaced(null);
    setGadgetState({ slot, name: name ?? OTHER_GADGET });
  };

  const reset = () => {
    setPlaced(null);
    setFrozenAt(null);
    setGadgetState(null);
    setTyped(null);
  };

  const fraction = (e: PointerEvent<HTMLDivElement>) => stageFraction(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY);

  /** Pose (ou déplace) le fantôme ou le gadget du joueur choisi à l'endroit du pointeur. */
  const placeAtPointer = (e: PointerEvent<HTMLDivElement>) => {
    if (selected === null) return;
    const m = planToMinimap(inset, fraction(e).x, fraction(e).y);
    setPlaced({ slot: selected, x: m.x, y: m.y, angle: mine?.angle ?? null });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const dot = (e.target as Element).closest<HTMLElement>('.replay__dot');
    if (dot) {
      // Sur un pion : clic (choisir) ou glisser (déplacement), on le saura au mouvement
      e.currentTarget.setPointerCapture(e.pointerId);
      pending.current = { slot: Number(dot.dataset.slot), alive: dot.dataset.alive === '1', cx: e.clientX, cy: e.clientY, dragging: false };
      return;
    }
    if (!active || selected === null) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    startFreeze();
    const p = fraction(e);
    const rect = e.currentTarget.getBoundingClientRect();
    if (kind === 'position' && mine) {
      const g = place(mine.x, mine.y);
      if (pixelDistance(rect, p, { x: g.x / 100, y: g.y / 100 }) <= GHOST_GRAB_PX) return setMode('gaze'); // depuis le fantôme : le regard
    }
    setMode('place');
    placeAtPointer(e);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const pd = pending.current;
    if (pd) {
      if (!pd.dragging) {
        if (!pd.alive || !open || !isDrag(e.clientX - pd.cx, e.clientY - pd.cy)) return; // pas (encore) un glisser
        pd.dragging = true;
        startFreeze();
        onSelect(pd.slot);
        setKindState('position');
      }
      const m = planToMinimap(inset, fraction(e).x, fraction(e).y);
      setPlaced({ slot: pd.slot, x: m.x, y: m.y, angle: null }); // le fantôme suit le pointeur, la position lue ne bouge pas
      return;
    }
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

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const pd = pending.current;
    pending.current = null;
    setMode(null);
    if (!pd || pd.dragging || isDrag(e.clientX - pd.cx, e.clientY - pd.cy)) return; // glisser terminé (ou refusé) : le brouillon est prêt
    // Simple clic sur un pion : en pose, c'est un clic sur le plan ; sinon il choisit le joueur
    if (active) {
      startFreeze();
      placeAtPointer(e);
    } else onSelect(pd.slot === selected ? null : pd.slot);
  };

  const onPointerCancel = () => {
    pending.current = null;
    setMode(null);
  };

  return {
    draft,
    open,
    frozen: frozenAt !== null,
    active,
    setOpen,
    setKind,
    setGadget,
    pickChip,
    setText: setTyped,
    startFreeze,
    unfreeze: () => setFrozenAt(null),
    clearGaze: () => setPlaced((p) => (p ? { ...p, angle: null } : p)),
    reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
