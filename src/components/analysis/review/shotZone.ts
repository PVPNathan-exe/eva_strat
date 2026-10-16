// Zone de tir de l'arme équipée d'un joueur (calque du replay) : fonctions pures.
// Briques réutilisées sans modification : portée utile (lib/weaponRange.ts), lignes de vue et portes (lib/visibility.ts, lib/safeZones.ts).
// Ici on ne fait que choisir l'arme, trouver l'équipement de la vie en cours et ne calculer que la zone du joueur choisi.

import { computeInstant, withLevels, type LevelRow, type Shooter, type ZoneResult } from '../../../lib/safeZones.ts';
import { doorsOpenedBy, type BlockGrid, type Segment } from '../../../lib/visibility.ts';
import type { RotorModel } from '../../../lib/rotors.ts';
import { rangeOfPlayer, type IconNames, type PlayerRange, type UsefulRange } from '../../../lib/weaponRange.ts';
import type { LifeLoadoutAt } from '../../../types/stats.ts';

/** Arme dont on montre la zone : la plus longue des deux (règle des zones sûres), l'une des deux, ou l'arme tenue lue à la mort. */
export type WeaponChoice = 'longest' | 'weapon1' | 'weapon2' | 'held';

export const WEAPON_CHOICES: { id: WeaponChoice; label: string }[] = [
  { id: 'longest', label: 'la plus longue des deux armes' },
  { id: 'weapon1', label: 'arme 1' },
  { id: 'weapon2', label: 'arme 2' },
  { id: 'held', label: 'arme tenue (lue à la mort seulement)' },
];

/** Équipement d'un joueur à un instant : celui de sa vie (`vie`), sinon celui de la game (`game`, un seul pour toutes les vies). */
export interface Equipment {
  weapon1: string | null;
  weapon2: string | null;
  /** Arme tenue lue à la mort de la vie ; null pour l'équipement de la game. */
  held: string | null;
  source: 'vie' | 'game';
  /** Numéro de la vie (à partir de 0), null pour l'équipement de la game. */
  lifeIdx: number | null;
}

/**
 * Équipement du joueur à l'instant de game `gameT` : la vie qui contient l'instant, sinon la dernière vie commencée (joueur mort qui attend), sinon la première.
 * Sans aucune vie lue : équipement de la game ; sans joueur connu : null.
 */
export function equipmentAt(rows: LifeLoadoutAt[], slot: number, gameT: number, players: { slot: number; weapon1: string | null; weapon2: string | null }[]): Equipment | null {
  const lives = rows.filter((r) => r.slot === slot).sort((a, b) => a.t0 - b.t0);
  const life = lives.find((r) => gameT >= r.t0 && gameT <= r.t1) ?? lives.filter((r) => r.t0 <= gameT).at(-1) ?? lives[0];
  if (life) return { weapon1: life.weapon1, weapon2: life.weapon2, held: life.held, source: 'vie', lifeIdx: life.life_idx };
  const p = players.find((q) => q.slot === slot);
  return p ? { weapon1: p.weapon1, weapon2: p.weapon2, held: null, source: 'game', lifeIdx: null } : null;
}

/** Portée du joueur pour l'arme choisie ; arme absente ou non lue : médiane `fallback`, marquée estimée. */
export function weaponRangeOf(eq: Equipment | null, choice: WeaponChoice, names: IconNames, fallback: UsefulRange): PlayerRange {
  const pair: [string | null, string | null] =
    choice === 'weapon1' ? [eq?.weapon1 ?? null, null] : choice === 'weapon2' ? [eq?.weapon2 ?? null, null] : choice === 'held' ? [eq?.held ?? null, null] : [eq?.weapon1 ?? null, eq?.weapon2 ?? null];
  return rangeOfPlayer(pair[0], pair[1], fallback, names);
}

/** Instant arrondi au pas `step` (0,25 s) : le calcul d'une zone ne se refait pas à chaque image. */
export const quantize = (t: number, step = 0.25) => Math.round(t / step) * step;

/** Portes fermées : celles dont aucun joueur vivant (toutes équipes) n'est assez près pour l'ouvrir. */
export function closedDoors(doors: Segment[], living: { x: number; y: number }[]): Segment[] {
  const open = doorsOpenedBy(doors, living);
  return doors.filter((_, i) => !open[i]);
}

export interface Living {
  slot: number;
  team: 'A' | 'B';
  x: number;
  y: number;
}

export interface ShotZoneInput {
  base: BlockGrid;
  doors: Segment[];
  glassDoors: Segment[];
  rotors: RotorModel | null;
  /** Instant de game (s), utile aux anneaux d'Engine. */
  t: number;
  /** Tous les joueurs vivants à cet instant (ils ouvrent les portes). */
  living: Living[];
  slot: number;
  range: PlayerRange;
  /** Niveaux des joueurs (cartes à deux étages), null ou vide : inconnus. */
  levels?: LevelRow[] | null;
}

export interface ShotZone {
  result: ZoneResult;
  shooter: Shooter;
}

/**
 * Zone de tir du seul joueur choisi (mode `balles` : murs, vitres, fenêtres et portes fermées bloquent). L'état des portes vient de tous les joueurs vivants,
 * mais seul le joueur choisi lance des rayons. Joueur mort ou absent : null.
 */
export function playerShotZone(input: ShotZoneInput): ShotZone | null {
  const me = input.living.find((p) => p.slot === input.slot);
  if (!me) return null;
  const shooter: Shooter = { slot: me.slot, team: me.team, x: me.x, y: me.y, rangeM: input.range.rangeM, estimated: input.range.estimated, weapon: input.range.weapon, open: input.range.open };
  const [leveled] = withLevels([shooter], input.levels, input.t);
  const result = computeInstant({
    base: input.base,
    mode: 'balles',
    doors: closedDoors(input.doors, input.living),
    glassDoors: closedDoors(input.glassDoors, input.living),
    rotors: input.rotors,
    t: input.t,
    shooters: [leveled],
  }).result;
  return { result, shooter: leveled };
}
