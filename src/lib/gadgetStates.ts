// Gadget (secondaire) de chaque joueur à un instant : nom (équipement de sa vie), état (disponible, utilisé, inconnu) et textes préremplis des notes de review.
// Fonctions pures, testées dans tests/gadgetStates.test.ts. Temps : secondes depuis le début de la game (comme gadget_state et life-loadouts).

import type { GadgetState, LifeLoadoutAt, ReviewNoteKind } from '../types/stats.ts';
import { slotNumber } from './reviewNotes.ts';

export type GadgetStatus = GadgetState['state'];

/** Valeur choisie quand le gadget n'est pas dans l'équipement lu (le seul cas où l'on n'a pas de nom). */
export const OTHER_GADGET = 'Autre';

export const STATUS_LABEL: Record<GadgetStatus, string> = {
  ready: 'disponible',
  used: 'utilisé',
  unknown: 'inconnu',
};

/** Nom affichable d'un gadget : en majuscules, « inconnu » sans nom ou pour « Autre ». */
export function gadgetLabel(name: string | null | undefined): string {
  const n = (name ?? '').trim();
  return !n || n === OTHER_GADGET ? 'inconnu' : n.toUpperCase();
}

/** Segment de l'état du gadget du joueur qui contient l'instant (le plus récent si deux se touchent), null s'il n'y en a pas. */
export function gadgetSegmentAt(states: GadgetState[], slot: number, gameT: number): GadgetState | null {
  let best: GadgetState | null = null;
  for (const s of states) {
    if (s.slot !== slot || gameT < s.t0 || gameT > s.t1) continue;
    if (!best || s.t0 >= best.t0) best = s;
  }
  return best;
}

/** État du gadget du joueur à l'instant : « inconnu » hors de tout segment. */
export function gadgetStatusAt(states: GadgetState[], slot: number, gameT: number): GadgetStatus {
  return gadgetSegmentAt(states, slot, gameT)?.state ?? 'unknown';
}

/** Nom du gadget : celui de la vie du joueur à l'instant, sinon celui du segment d'état, sinon null. */
export function gadgetNameAt(loadouts: LifeLoadoutAt[], states: GadgetState[], slot: number, gameT: number): string | null {
  const life = loadouts.find((l) => l.slot === slot && l.gadget && l.t0 <= gameT && gameT <= l.t1);
  return life?.gadget ?? gadgetSegmentAt(states, slot, gameT)?.gadget ?? null;
}

/** Une pastille de gadget par joueur : même numéro que sur le plan, même équipe. */
export interface GadgetChip {
  slot: number;
  number: number;
  team: 'A' | 'B';
  name: string | null;
  label: string;
  status: GadgetStatus;
}

/** Pastilles des joueurs dans l'ordre des créneaux (équipe A puis équipe B), à l'instant `gameT`. */
export function gadgetChips(slots: number[], loadouts: LifeLoadoutAt[], states: GadgetState[], gameT: number): GadgetChip[] {
  return [...slots]
    .sort((a, b) => a - b)
    .map((slot) => {
      const name = gadgetNameAt(loadouts, states, slot, gameT);
      return { slot, number: slotNumber(slot), team: slot <= 4 ? 'A' : 'B', name, label: gadgetLabel(name), status: gadgetStatusAt(states, slot, gameT) };
    });
}

/** Pseudo du joueur, ou « Joueur 3 » (numéro du jeu) s'il est inconnu. */
export function playerName(slot: number, nameOf: Map<number, string>): string {
  return nameOf.get(slot) || `Joueur ${slotNumber(slot)}`;
}

const FEMININE = new Set(['SONAR']);

/** « SNVXPRIME pose sa SONAR ici » ; « pose son gadget » quand le gadget est inconnu. */
export function actionText(player: string, gadget: string | null | undefined): string {
  const label = gadgetLabel(gadget);
  if (label === 'inconnu') return `${player} pose son gadget ici`;
  return `${player} pose ${FEMININE.has(label) ? 'sa' : 'son'} ${label} ici`;
}

/** « SNVXPRIME aurait dû être ici ». */
export function positionText(player: string): string {
  return `${player} aurait dû être ici`;
}

/** Commentaire prérempli du brouillon (modifiable) : vide tant que le joueur ou la pose manque, et pour une remarque. */
export function autoNoteText(kind: ReviewNoteKind, slot: number | null, gadget: string | null | undefined, placed: boolean, nameOf: Map<number, string>): string {
  if (slot === null) return '';
  if (kind === 'action') return actionText(playerName(slot, nameOf), gadget);
  if (kind === 'position' && placed) return positionText(playerName(slot, nameOf));
  return '';
}
