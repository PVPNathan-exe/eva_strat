// Catalogue de noms d'armes : les noms viennent de l'onglet Stratégie (mêmes armes, mêmes écritures).
// Armes à feu pour les armes, grenades et équipements pour les gadgets ; le killfeed affiche le même logo pour toutes les grenades.

import type { WeaponKind } from '../types/analysis';
import { stuffs } from './stuffs';
import { canonicalName as canonical } from './weaponNames';

const FIREARMS = stuffs.filter((s) => s.kind === 'firearm').map((s) => s.name);
// Gadgets ajoutés par les patchs et pas encore dans l'onglet Stratégie.
const PATCH_GADGETS = ['CLONE', 'MEDPACK'];
const GADGETS = [...stuffs.filter((s) => s.kind !== 'firearm').map((s) => s.name), ...PATCH_GADGETS.filter((n) => !stuffs.some((s) => s.name === n))];

export const SUGGESTIONS: Record<WeaponKind, string[]> = {
  arme: FIREARMS,
  gadget: GADGETS,
  killfeed: [...FIREARMS, 'GRENADE'],
};

const ALL_NAMES = [...FIREARMS, ...GADGETS, 'GRENADE'];

export const canonicalName = (name: string) => canonical(name, ALL_NAMES);
