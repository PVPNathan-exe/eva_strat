// Vue Global de l'onglet Stats : fonctions pures (aucune lecture de la page) qui préparent la réponse de /api/stats/global (toutes les équipes d'une carte, côté gauche et côté droit séparés).
// Calques de positions : une chaleur par côté (orange à gauche, bleu à droite), les « positions fortes » étant une INTERPRÉTATION (kills moins morts, ou duels gagnés moins perdus, par case).
// Stratégies : seules les issues par vitesse (rapide ou progressif) et par taille de vague existent ; une stratégie plus fine (routes, ordre des rotations) n'est pas calculée.
// Rien n'est inventé : une valeur null reste null (« non établi »). Les grilles et le seuil de games viennent de teamView.ts.

import { blur, gridFromCells, percentile } from './heatGrid.ts';
import { duelShare, killsMinusDeathsTotal, MIN_DECIDED_WAVES, MIN_SUPPORT_SHARE, shownRate } from './teamView.ts';
import type { GlobalSide, GlobalSummary, TeamCell, TeamDuels, TeamSideName, TeamWaveTally } from '../types/statsTeam.ts';

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Calques

/** Calques du plan, un seul à la fois. */
export type GlobalLayerId = 'strong' | 'presence' | 'deaths' | 'duels';

/** Côté(s) montrés : « left » = équipe A (orange, joueurs 1 à 4), « right » = équipe B (bleue, joueurs 5 à 8). */
export type SideChoice = TeamSideName | 'both';

export interface GlobalLayerDef {
  id: GlobalLayerId;
  label: string;
  /** Vrai : le calque montre une différence (seule la part positive est dessinée, dans la couleur du côté). */
  difference: boolean;
  /** Ce que signifie le calque (légende, une phrase). */
  meaning: string;
}

export const GLOBAL_LAYERS: GlobalLayerDef[] = [
  { id: 'strong', label: 'Positions les plus fortes', difference: true, meaning: "Par case : kills du côté moins ses morts, lissés. Seules les cases où le côté marque plus qu'il ne perd sont colorées ; cases trop peu fréquentées masquées. C'est une interprétation des chiffres, pas une mesure de la cause." },
  { id: 'presence', label: 'Présence par côté', difference: false, meaning: 'Temps passé vivant par case par chaque côté (somme de toutes les équipes de la carte) : les positions préférées.' },
  { id: 'deaths', label: 'Morts', difference: false, meaning: 'Où les joueurs de chaque côté meurent (nombre de morts par case).' },
  { id: 'duels', label: 'Duels gagnés moins perdus', difference: true, meaning: "Par case : duels gagnés du côté moins duels perdus (position au moment du duel), lissés. Seules les cases où le côté gagne plus qu'il ne perd sont colorées ; cases trop peu fréquentées masquées." },
];

/** Définition d'un calque par son identifiant. */
export const globalLayerDef = (id: GlobalLayerId): GlobalLayerDef => GLOBAL_LAYERS.find((l) => l.id === id) ?? GLOBAL_LAYERS[0];

export const SIDE_CHOICES: { id: SideChoice; label: string }[] = [
  { id: 'both', label: 'Les deux côtés' },
  { id: 'left', label: 'Côté gauche (orange)' },
  { id: 'right', label: 'Côté droit (bleu)' },
];

/** Les côtés dessinés pour un choix. */
export const sidesOf = (choice: SideChoice): TeamSideName[] => (choice === 'both' ? ['left', 'right'] : [choice]);

/** Cases d'un côté pour un calque : `plus` (ce qui s'additionne) et `minus` (ce qui se retranche, null pour une chaleur simple). */
export function layerCells(side: GlobalSide, layer: GlobalLayerId): { plus: TeamCell[]; minus: TeamCell[] | null } {
  if (layer === 'strong') return { plus: side.kill_grid, minus: side.death_grid };
  if (layer === 'presence') return { plus: side.presence, minus: null };
  if (layer === 'deaths') return { plus: side.death_grid, minus: null };
  return { plus: side.duel_won_grid, minus: side.duel_lost_grid };
}

/**
 * Valeurs d'un côté avant mise à l'échelle : chaleur lissée (minus null), ou part positive de « plus moins minus » lissés ; dans ce dernier cas les cases dont l'appui
 * (plus + minus lissés) est sous `minShare` fois le 98e centile de l'appui sont masquées : trop peu d'événements pour que le signe veuille dire quelque chose.
 */
export function rawLayer(plus: TeamCell[], minus: TeamCell[] | null, n: number, sigma: number, minShare = MIN_SUPPORT_SHARE): Float32Array {
  const p = blur(gridFromCells(n, plus), n, sigma);
  if (minus === null) return p;
  const m = blur(gridFromCells(n, minus), n, sigma);
  const support = p.map((v, i) => v + m[i]);
  const floor = minShare * percentile(support, 0.98);
  return p.map((v, i) => (support[i] >= floor && support[i] > 0 ? Math.max(0, v - m[i]) : 0));
}

/** Une couche à dessiner : le côté, ses valeurs de 0 à 1 et vrai si elle est vide. */
export interface SideLayer {
  side: TeamSideName;
  norm: Float32Array;
  blank: boolean;
}

/**
 * Couches du calque pour les côtés demandés, ramenées à la MÊME échelle (le plus grand des 98e centiles) : comparer l'intensité des deux côtés reste honnête.
 * Une couche entièrement nulle est marquée vide.
 */
export function globalLayers(data: GlobalSummary, layer: GlobalLayerId, choice: SideChoice, sigma: number): SideLayer[] {
  const raws = sidesOf(choice).map((side) => {
    const { plus, minus } = layerCells(data[side], layer);
    return { side, raw: rawLayer(plus, minus, data.n, sigma) };
  });
  const top = Math.max(0, ...raws.map((r) => percentile(r.raw, 0.98)));
  return raws.map(({ side, raw }) => {
    const norm = top > 0 ? raw.map((v) => Math.min(1, v / top)) : new Float32Array(raw.length);
    return { side, norm, blank: norm.every((v) => v === 0) };
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Totaux par côté

export interface SideTotals {
  kills: number | null;
  deaths: number | null;
  /** Kills moins morts ; null si l'un des deux n'est pas établi. */
  diff: number | null;
  duels: TeamDuels;
  /** Part de duels gagnés parmi les duels décidés ; null sans duel décidé. */
  duelShare: number | null;
}

/** Totaux d'un côté de la réponse de global. */
export function sideTotals(side: Pick<GlobalSide, 'stats' | 'duels'>): SideTotals {
  return {
    kills: side.stats.kills,
    deaths: side.stats.deaths,
    diff: killsMinusDeathsTotal(side.stats.kills, side.stats.deaths),
    duels: side.duels,
    duelShare: duelShare(side.duels),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Stratégies : issues par vitesse et par taille de vague

/** Une ligne du tableau des stratégies (un groupe de vagues : une vitesse ou une taille). */
export interface StrategyRow {
  key: string;
  label: string;
  /** Vagues comptées. */
  waves: number;
  /** Vagues décidées (réussies, ratées ou gagnées sans capture). */
  decided: number;
  /** Retakes réussis. */
  success: number;
  /** Taux de retake réussi ; null sous MIN_DECIDED_WAVES vagues décidées ou sans taux. */
  rate: number | null;
}

const SPEED_ORDER = ['rapide', 'progressif'];
const SPEED_TEXT: Record<string, string> = {
  rapide: 'Rapide (aucun arrêt avant le premier kill)',
  progressif: 'Progressif (au moins un arrêt avant le premier kill)',
  none: 'Vitesse non mesurée (aucun contact)',
};

/** Ligne d'un groupe de vagues ; null si le groupe n'a aucune vague. */
function strategyRow(key: string, label: string, t: TeamWaveTally): StrategyRow | null {
  if (!t || t.waves <= 0) return null;
  return { key, label, waves: t.waves, decided: t.decided, success: t.counts?.success ?? 0, rate: shownRate(t) };
}

/** Lignes par vitesse : rapide, progressif, puis les autres (vitesse non mesurée). */
export function speedRows(bySpeed: Record<string, TeamWaveTally>): StrategyRow[] {
  const keys = [...SPEED_ORDER.filter((k) => k in bySpeed), ...Object.keys(bySpeed).filter((k) => !SPEED_ORDER.includes(k)).sort()];
  return keys.map((k) => strategyRow(k, SPEED_TEXT[k] ?? k, bySpeed[k])).filter((r): r is StrategyRow => r !== null);
}

/** Lignes par taille de vague : de la plus petite à la plus grande, la taille non lue en dernier. */
export function sizeRows(bySize: Record<string, TeamWaveTally>): StrategyRow[] {
  const sizes = Object.keys(bySize).filter((k) => Number.isFinite(Number(k))).sort((a, b) => Number(a) - Number(b));
  const others = Object.keys(bySize).filter((k) => !Number.isFinite(Number(k))).sort();
  const label = (k: string): string => (k === 'unknown' ? 'Taille non lue' : `${k} joueur${Number(k) > 1 ? 's' : ''}`);
  return [...sizes, ...others].map((k) => strategyRow(k, label(k), bySize[k])).filter((r): r is StrategyRow => r !== null);
}

export interface BestStrategy {
  /** Groupes au taux le plus élevé (plusieurs en cas d'égalité exacte). */
  best: StrategyRow[];
  /** Nombre de groupes comparables (taux affiché). */
  comparable: number;
}

/**
 * Le ou les groupes au meilleur taux de retake réussi parmi ceux dont le taux est affiché. null s'il y a moins de 2 groupes comparables :
 * un seul taux ne dit pas ce qui marche le mieux.
 */
export function bestStrategy(rows: StrategyRow[]): BestStrategy | null {
  const rated = rows.filter((r) => r.rate !== null);
  if (rated.length < 2) return null;
  const top = Math.max(...rated.map((r) => r.rate as number));
  return { best: rated.filter((r) => r.rate === top), comparable: rated.length };
}

/** Phrase de réponse pour un tableau de stratégies : le meilleur groupe, ou la raison pour laquelle on ne conclut pas. `percent` met un taux en texte. */
export function strategyAnswer(what: string, rows: StrategyRow[], percent: (v: number | null) => string): string {
  const b = bestStrategy(rows);
  if (!b) return `${what} : pas assez de vagues décidées (au moins ${MIN_DECIDED_WAVES} par groupe, dans au moins 2 groupes) pour comparer.`;
  const names = b.best.map((r) => r.label).join(' ; ');
  return `${what} : meilleur taux de retake réussi, ${percent(b.best[0].rate)}, pour « ${names} »${b.best.length > 1 ? ' (égalité)' : ''} sur ${b.comparable} groupes comparables.`;
}
