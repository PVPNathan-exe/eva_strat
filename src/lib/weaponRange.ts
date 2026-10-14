// Portée utile d'une arme, d'après les bandes de dégâts (falloff) de lib/stuffs.ts.
// Hypothèse de docs/PLAN_STATS_AGENTS.md section 6 : la portée utile s'arrête à la fin de la dernière bande (en partant du tireur) dont les dégâts restent à
// USEFUL_FRACTION ou plus du maximum de l'arme. Une bande sans fin (« à partir de 35 m ») qui reste au-dessus du seuil donne une portée sans limite.

import { stuffs } from './stuffs.ts';
import { canonicalName } from './weaponNames.ts';
import type { FalloffBand, Firearm } from '../types/stuff';

/** Part des dégâts maximaux en dessous de laquelle une bande ne compte plus dans la portée utile (hypothèse à confirmer). */
export const USEFUL_FRACTION = 0.5;
/** Portée donnée à une arme sans limite (plus que la diagonale de l'arène, 35,1 m) : la ligne de vue seule décide. */
export const OPEN_RANGE_M = 60;

const firearms = stuffs.filter((s): s is Firearm => s.kind === 'firearm');
const firearmNames = firearms.map((f) => f.name);

export interface UsefulRange {
  /** Mètres (OPEN_RANGE_M quand `open`). */
  rangeM: number;
  /** Aucune limite de distance : toute la ligne de vue est couverte. */
  open: boolean;
}

/** Portée utile d'une série de bandes (ordre croissant de distance). Aucune bande valide : portée nulle. */
export function usefulRange(falloff: FalloffBand[], fraction = USEFUL_FRACTION): UsefulRange {
  const max = Math.max(...falloff.map((b) => b.pct));
  let range = 0;
  for (const band of falloff) {
    if (band.pct < max * fraction) break; // la première bande trop faible ferme la portée utile
    if (band.toM === null) return { rangeM: OPEN_RANGE_M, open: true };
    range = band.toM;
  }
  return { rangeM: range, open: false };
}

/** Noms donnés aux identifiants d'icônes (B25, G9...) : les équipements lus par l'analyse sont des identifiants, leurs noms viennent de /api/weapons (names.json). */
export type IconNames = Record<string, string>;

/** Nom d'arme d'un équipement lu : le nom de l'identifiant d'icône s'il en a un, sinon la valeur telle quelle (déjà un nom). Identifiant sans nom : null. */
export function resolveName(value: string | null | undefined, names: IconNames = {}): string | null {
  if (!value) return null;
  if (names[value] !== undefined) return names[value].trim() || null;
  return /^[A-Z]\d+$/.test(value) ? null : value;
}

/** Arme du catalogue pour un nom lu (casse, espaces et tirets ignorés), ou null. */
export function firearmOf(value: string | null | undefined, names: IconNames = {}): Firearm | null {
  const name = resolveName(value, names);
  if (!name) return null;
  const canon = canonicalName(name, firearmNames);
  return firearms.find((f) => f.name === canon) ?? null;
}

/** Portée utile d'une arme par son nom, ou null si le nom n'est pas une arme connue. */
export function rangeOfWeapon(name: string | null | undefined, names: IconNames = {}): (UsefulRange & { weapon: string }) | null {
  const f = firearmOf(name, names);
  return f ? { ...usefulRange(f.falloff), weapon: f.name } : null;
}

/** Médiane de nombres (0 pour une liste vide). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Portée médiane des armes données (celles de la game) ; sans aucune arme connue, des armes du catalogue. */
export function medianRange(weapons: (string | null | undefined)[], names: IconNames = {}): UsefulRange {
  const known = weapons.map((w) => rangeOfWeapon(w, names)).filter((r): r is UsefulRange & { weapon: string } => r !== null);
  const ranges = (known.length ? known : firearms.map((f) => ({ ...usefulRange(f.falloff) }))) as UsefulRange[];
  const m = median(ranges.map((r) => r.rangeM));
  return { rangeM: m, open: m >= OPEN_RANGE_M };
}

export interface PlayerRange extends UsefulRange {
  /** Arme qui donne la portée (la plus longue des deux armes lues), ou null quand elle est estimée. */
  weapon: string | null;
  /** Portée estimée par la médiane des armes de la game : l'équipement de ce joueur n'est pas lu. */
  estimated: boolean;
}

/** Portée d'un joueur : la plus longue de ses deux armes lues ; si aucune n'est connue, la médiane `fallback` (marquée estimée). */
export function rangeOfPlayer(weapon1: string | null | undefined, weapon2: string | null | undefined, fallback: UsefulRange, names: IconNames = {}): PlayerRange {
  const mine = [rangeOfWeapon(weapon1, names), rangeOfWeapon(weapon2, names)].filter((r) => r !== null);
  if (mine.length === 0) return { ...fallback, weapon: null, estimated: true };
  const best = mine.reduce((a, b) => (b.rangeM > a.rangeM ? b : a));
  return { rangeM: best.rangeM, open: best.open, weapon: best.weapon, estimated: false };
}
