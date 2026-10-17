// Fonctions pures des notes sur 20 (individuelle, teamplay, globale) : formats français (une décimale, virgule), « n/d » quand la note n'est pas établie (jamais 0),
// valeur brute de chaque composante avec son unité, lignes du détail dépliable, texte des assistances et des moyennes. Les notes sont des CONVENTIONS sans vérité terrain.

import type { RatingComponent, RatingDetail, RatingGroupDetail } from '../types/stats.ts';
import { fmtDecimal, NA, type Cell } from './recapFormat.ts';

/** Note maximale. */
export const RATING_MAX = 20;

/** Valeur absente d'une note : le calcul n'a pas pu l'établir (données insuffisantes), jamais affichée comme 0. */
const present = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Note sur 20 à une décimale avec la virgule française, « 12,0 » : « n/d » quand elle n'est pas établie. */
export const fmtRating = (v: number | null | undefined): string => (present(v) ? v.toFixed(1).replace('.', ',') : NA);

/** Cellule d'une note : texte et infobulle (la raison de l'absence, ou le rappel de la convention). */
export function ratingCell(v: number | null | undefined, why?: string | null, extra?: string): Cell {
  if (!present(v)) return { text: NA, title: why ?? 'Note non établie : données insuffisantes pour cette game.' };
  return { text: fmtRating(v), title: `${extra ? `${extra} ` : ''}Note sur ${RATING_MAX}, 10 = médiane de la base. Convention, sans vérité terrain.` };
}

const pct = (v: number): string => `${Math.round(v * 100)} %`;

/** Valeur brute d'une composante avec son unité (le nom est celui de analysis/player_ratings.py). */
export function componentValueText(name: string, raw: number | null | undefined): string {
  if (!present(raw)) return NA;
  switch (name) {
    case 'kills_per_min':
    case 'deaths_per_min':
    case 'assists_per_min':
      return `${fmtDecimal(raw, 2)} par min`;
    case 'kill_quality':
    case 'death_quality':
      return fmtDecimal(raw, 2);
    case 'space':
      return `${fmtDecimal(raw, 2)} de l'axe`; // 0 : son départ, 1 : celui de l'adversaire (dit par le libellé de la composante)
    case 'aggro':
      return `${fmtDecimal(raw, 1)} s par min`;
    case 'cohesion':
      return `${fmtDecimal(raw, 1)} m`;
    default:
      return pct(raw); // parts d'équipe, présence, temps près du point, fight, trades, secondaires
  }
}

/** Une ligne du détail d'une note : composante, valeur brute, note sur 20, poids ; `reason` quand elle n'a pas de valeur ou pas de note. */
export interface DetailLine {
  key: string;
  label: string;
  value: string;
  note: string;
  weight: number;
  reason: string | null;
  /** Moins c'est mieux : la note est inversée. */
  down: boolean;
}

/** Lignes d'un groupe, dans l'ordre du calcul (celui de l'objet JSON). */
export function groupLines(group: RatingGroupDetail | null | undefined): DetailLine[] {
  if (!group) return [];
  return Object.entries(group.components).map(([key, c]: [string, RatingComponent]) => ({
    key,
    label: c.label,
    value: componentValueText(key, c.raw),
    note: fmtRating(c.note),
    weight: c.weight,
    reason: c.note === null ? (c.reason ?? 'donnée absente') : null,
    down: c.down,
  }));
}

/** Part du poids d'un groupe qui a une note (0 à 1) : les composantes sans donnée sont ignorées de la moyenne. */
export function groupCoverage(group: RatingGroupDetail | null | undefined): number | null {
  if (!group) return null;
  const all = Object.values(group.components);
  const total = all.reduce((a, c) => a + c.weight, 0);
  return total > 0 ? all.filter((c) => c.note !== null).reduce((a, c) => a + c.weight, 0) / total : null;
}

/** Source des assistances en clair. */
export function assistSourceText(source: string | null | undefined): string {
  if (source === 'tableau') return "tableau de fin de game (valeur du jeu)";
  if (source === 'repli') return "repli mesuré par proximité (coéquipier à moins de 3 m de la victime dans les 4,6 s avant sa mort), faute de tableau de fin de game lu";
  return 'source inconnue';
}

/** Phrase sous le détail : composantes ignorées et couverture de chaque sous-note. */
export function coverageText(detail: RatingDetail | null | undefined): string {
  if (!detail) return '';
  const parts = (['individual', 'teamplay'] as const).map((g) => {
    const cov = groupCoverage(detail[g]);
    return `${g === 'individual' ? 'individuelle' : 'teamplay'} : ${cov === null ? NA : pct(cov)} du poids disponible`;
  });
  return parts.join(' ; ');
}

/** Moyenne sur plusieurs games : texte (« 11,5 ») et infobulle avec le nombre de games notées ; « n/d » quand aucune game n'a la note. */
export function meanRatingCell(mean: number | null | undefined, ratedGames: number, totalGames: number, label = 'Note moyenne'): Cell {
  if (!present(mean) || ratedGames <= 0) return { text: NA, title: `${label} non établie : aucune game notée sur ${totalGames}.` };
  return {
    text: fmtRating(mean),
    title: `${label} sur ${ratedGames} game${ratedGames > 1 ? 's' : ''} notée${ratedGames > 1 ? 's' : ''} sur ${totalGames} (les games sans note ne comptent pas). Note sur ${RATING_MAX}, 10 = médiane de la base. Convention, sans vérité terrain.`,
  };
}
