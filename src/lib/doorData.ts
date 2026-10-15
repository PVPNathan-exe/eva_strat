// Lecture des portes et boutons d'une carte dans analysis/map_door_blocks.json (écrit par analysis/plan_from_mask.py). La logique d'animation est dans doorBlocks.ts.

import blocks from '../../analysis/map_door_blocks.json';
import type { DoorSetup } from './doorBlocks';

const known = blocks as unknown as Record<string, DoorSetup>;

/** Portes et boutons d'une carte, ou null si elle n'en a pas. */
export function doorSetup(map: string | undefined): DoorSetup | null {
  return map ? (known[map] ?? null) : null;
}
