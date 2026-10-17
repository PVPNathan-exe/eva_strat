// Paramètres de jeu des gadgets pour les notes de review : durée d'affichage, vitesse et portée du clone, rayons connus.
// Tout vient de analysis/patch_reference.json (valeurs de jeu datées) : ici aucune valeur n'est inventée, un rayon absent de la référence est INCONNU (liste vide).
// Le site nomme le clone « CLONE », la référence « ECHO ». Fonctions pures, testées dans tests/gadgetParams.test.ts.

import reference from '../../analysis/patch_reference.json' with { type: 'json' };
import { metres } from './pathCut.ts';

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

/** Rayons connus d'un gadget posé (STICKY : portée de mort sur le coup 3 m, portée de dégâts 5 m, d'après la référence) ; liste vide quand ils sont inconnus. */
export function knownRadii(name: string | null | undefined): Radius[] {
  if (gadgetKey(name) !== 'STICKY') return [];
  const f = gadgetFields('STICKY');
  const out: Radius[] = [];
  const os = num(f.portee_os_m);
  const dmg = num(f.portee_degats_m);
  if (os !== null) out.push({ label: 'mort sur le coup', m: os });
  if (dmg !== null) out.push({ label: 'dégâts', m: dmg });
  return out;
}

/** Gadgets dont on montre le rayon à l'arrêt du clone (les « 2 grenades » de la demande ne sont pas nommées : on montre ce que la référence connaît et on dit le reste inconnu). */
export const CLONE_EXPLOSIVES = ['STICKY', 'DX3', 'SONAR'];

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
