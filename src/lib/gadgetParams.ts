// Paramètres de jeu des gadgets pour les notes de review : durée d'affichage, vitesse et portée du clone, rayons connus.
// Tout vient de analysis/patch_reference.json (valeurs de jeu datées) : ici aucune valeur n'est inventée, un rayon absent de la référence est INCONNU (liste vide).
// Le site nomme le clone « CLONE », la référence « ECHO ». Fonctions pures, testées dans tests/gadgetParams.test.ts.

import reference from '../../analysis/patch_reference.json' with { type: 'json' };
import { ARENA_M, metres } from './pathCut.ts';

/** Une entrée datée de la référence : le patch, sa date, et les champs qu'il fixe. */
interface Entry {
  patch: string | null;
  date: string;
  champs: Record<string, unknown>;
}

const GADGETS = (reference as unknown as { gadgets: Record<string, Entry[]> }).gadgets;

/** Nom du site vers nom de la référence (le clone du site est ECHO dans la référence). */
const REFERENCE_NAME: Record<string, string> = { CLONE: 'ECHO' };

/** Nom canonique : majuscules, sans espace ni tiret (« MED PACK » et « MEDPACK » sont le même gadget ; ECHO devient CLONE). */
export function gadgetKey(name: string | null | undefined): string {
  const key = (name ?? '').toUpperCase().replace(/[\s_-]+/g, '');
  return key === 'ECHO' ? 'CLONE' : key;
}

/** Forme de la pose : un trait (SHIELD), une direction et une distance (CLONE), ou un point (les autres). */
export type GadgetKind = 'shield' | 'clone' | 'point';

export function gadgetKind(name: string | null | undefined): GadgetKind {
  const key = gadgetKey(name);
  return key === 'SHIELD' ? 'shield' : key === 'CLONE' ? 'clone' : 'point';
}

/** Valeurs du gadget : les entrées de la référence fusionnées de la plus ancienne à la plus récente (la plus récente gagne, une valeur nulle n'écrase rien). */
export function gadgetFields(name: string | null | undefined): Record<string, unknown> {
  const key = gadgetKey(name);
  const entries = GADGETS[REFERENCE_NAME[key] ?? key] ?? GADGETS[key.replace(/^MEDPACK$/, 'MED PACK')] ?? [];
  const merged: Record<string, unknown> = {};
  for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const [k, v] of Object.entries(e.champs)) if (v !== null && v !== undefined) merged[k] = v;
  }
  return merged;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Durée (secondes) pendant laquelle le trait du SHIELD ou le clone se voit à partir de l'instant de la note ; null pour les autres gadgets. */
export function displaySeconds(name: string | null | undefined): number | null {
  return gadgetKind(name) === 'point' ? null : num(gadgetFields(name).duree_s);
}

/** Vitesse, durée de vie et portée maximale du clone (vitesse x durée) ; null si la référence ne les donne pas. */
export interface CloneParams {
  speedMs: number;
  durationS: number;
  maxRangeM: number;
}

export function cloneParams(): CloneParams | null {
  const f = gadgetFields('CLONE');
  const kmh = num(f.vitesse_kmh);
  const durationS = num(f.duree_s);
  if (kmh === null || durationS === null) return null;
  const speedMs = kmh / 3.6;
  return { speedMs, durationS, maxRangeM: speedMs * durationS };
}

/** Un rayon connu : son libellé et sa taille en mètres. */
export interface Radius {
  label: string;
  m: number;
}

/** Rayons connus d'un gadget posé, d'après la référence : STICKY 3 m (mort sur le coup) et 5 m (dégâts) ; DX3 0 à 2 m (dégâts maximaux) et 4 m (limite des dégâts) ; SONAR 4 m (8 m de diamètre) ; liste vide quand ils sont inconnus. */
export function knownRadii(name: string | null | undefined): Radius[] {
  const f = gadgetFields(name);
  const key = gadgetKey(name);
  const out: Radius[] = [];
  const add = (label: string, v: unknown) => {
    const m = num(v);
    if (m !== null) out.push({ label, m });
  };
  if (key === 'STICKY') {
    add('mort sur le coup', f.portee_os_m);
    add('dégâts', f.portee_degats_m);
  } else if (key === 'DX3') {
    add('dégâts maximaux', f.rayon_degats_max_m);
    add('limite des dégâts', f.rayon_limite_m);
  } else if (key === 'SONAR') {
    add('détection', f.rayon_m);
  }
  return out;
}

/** Gadgets dont on montre le rayon d'explosion à l'arrêt du clone : les deux grenades explosives, DX3 et STICKY (le SONAR détecte, il n'explose pas). */
export const CLONE_EXPLOSIVES = ['DX3', 'STICKY'];

/** Ligne de légende par gadget : « STICKY : 3 m (mort sur le coup), 5 m (dégâts) » ou « DX3 : rayon non connu ». */
export function explosionLegend(): { name: string; text: string }[] {
  return CLONE_EXPLOSIVES.map((name) => {
    const radii = knownRadii(name);
    const text = radii.length === 0 ? 'rayon non connu' : radii.map((r) => `${String(r.m).replace('.', ',')} m (${r.label})`).join(', ');
    return { name, text: `${name} : ${text}` };
  });
}

/** Longueur en mètres du trait d'un SHIELD entre ses deux extrémités (fractions de la minimap). */
export function shieldLengthM(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return metres(a, b);
}

/** « 3,4 m » : mètres avec une décimale seulement quand il y en a une. */
export function formatMetres(m: number): string {
  return `${m.toFixed(m % 1 ? 1 : 0).replace('.', ',')} m`;
}

/** Longueur du shield en mètres d'après la référence (mesurée sur une image du point A d'Atlantis : environ 1,9 m) ; null si absente. */
export function shieldFixedLengthM(): number | null {
  return num(gadgetFields('SHIELD').longueur_m);
}

/**
 * Trait d'un SHIELD de longueur fixe, CENTRÉ sur `center` (l'icône du shield est au milieu du trait) et orienté vers `toward` (fractions de la minimap) : renvoie les deux extrémités,
 * ou null si le pointeur est sur le centre (pas d'orientation). La longueur et l'orientation se calculent en mètres (la minimap n'est pas carrée : 31 m sur 16,5 m).
 */
export function shieldSegment(center: { x: number; y: number }, toward: { x: number; y: number }, lengthM: number): { a: { x: number; y: number }; b: { x: number; y: number } } | null {
  const dx = (toward.x - center.x) * ARENA_M[0];
  const dy = (toward.y - center.y) * ARENA_M[1];
  const d = Math.hypot(dx, dy);
  if (d === 0) return null;
  const hx = ((dx / d) * lengthM) / 2 / ARENA_M[0];
  const hy = ((dy / d) * lengthM) / 2 / ARENA_M[1];
  return { a: { x: center.x - hx, y: center.y - hy }, b: { x: center.x + hx, y: center.y + hy } };
}
