// Issues d'une vague de la vue Retakes (docs/PLAN_STATS_AGENTS.md, section 11 ; analysis/retakes.py) : libellés français, ton, forme du repère sur la frise, groupe de filtre,
// rôle dans le taux de retake réussi, et tolérance aux anciennes lignes d'une base non recalculée (issues de la révision 2 : no_push, series_*, success et fail sans `data.wave`).
// Vocabulaire de l'utilisateur : « retake » seulement quand le point est capturé après un teamfight GAGNÉ ; un retake raté est un teamfight PERDU de l'équipe attaquante.
// Fonctions pures, aucune dépendance au navigateur.

import type { Episode } from '../types/stats.ts';
import type { Tone } from './episodeFormat.ts';

/** Groupes du menu « Issues » : un groupe par famille d'issues. */
export type IssueGroup = 'success' | 'fail' | 'won_no_capture' | 'duel' | 'initial' | 'other';

/** Forme du repère d'une vague sur la frise (une forme par issue, voir stats-chrono.css). */
export type MarkShape = 'success' | 'fail' | 'won' | 'initial' | 'initial_lost' | 'duel' | 'indecis' | 'no_contact';

/** Rôle dans le taux de retake réussi : réussie, ratée, ou teamfight gagné sans capture (au dénominateur) ; null : hors taux. */
export type RateRole = 'success' | 'fail' | 'won';

export interface IssueDef {
  label: string;
  /** Libellé court (liste, tableau, info-bulle de la frise). */
  short: string;
  tone: Tone;
  shape: MarkShape;
  group: IssueGroup;
  role: RateRole | null;
}

/** Issues écrites par analysis/retakes.py (révision 3). */
export const WAVE_ISSUES: Record<string, IssueDef> = {
  initial: { label: 'Prise initiale (pas un retake)', short: 'Prise initiale', tone: 'neutral', shape: 'initial', group: 'initial', role: null },
  success: { label: 'Retake réussi (teamfight gagné et point capturé)', short: 'Retake réussi', tone: 'good', shape: 'success', group: 'success', role: 'success' },
  fail: { label: 'Retake raté (teamfight perdu)', short: 'Retake raté', tone: 'bad', shape: 'fail', group: 'fail', role: 'fail' },
  initial_lost: { label: "Teamfight d'ouverture perdu", short: 'Ouverture perdue', tone: 'bad', shape: 'initial_lost', group: 'initial', role: null },
  won_no_capture: { label: 'Teamfight gagné sans capture du point', short: 'Teamfight gagné, sans capture', tone: 'good', shape: 'won', group: 'won_no_capture', role: 'won' },
  duel: { label: 'Duel (ni teamfight ni retake)', short: 'Duel', tone: 'neutral', shape: 'duel', group: 'duel', role: null },
  indecis: { label: 'Indécis (égalité, moins de 2 morts)', short: 'Indécis', tone: 'doubt', shape: 'indecis', group: 'other', role: null },
  no_contact: { label: 'Vague sans contact (aucun kill)', short: 'Sans contact', tone: 'neutral', shape: 'no_contact', group: 'other', role: null },
};

const OLD = ' (ancien calcul)';
const legacy = (label: string, short: string, tone: Tone, shape: MarkShape, group: IssueGroup): IssueDef => ({ label: label + OLD, short: short + OLD, tone, shape, group, role: null });

/**
 * Correspondance des anciennes issues (révision 2) vers le vocabulaire actuel, d'après l'en-tête de analysis/retakes.py. Une ancienne ligne n'est jamais comptée dans les taux :
 * sa définition n'est pas celle d'une vague. `series_collapse` dépend du changement de main (data.changed_hands) : prise du point donc retake réussi, sinon teamfight gagné sans capture.
 */
const LEGACY: Record<string, IssueDef> = {
  success: legacy('Retake réussi', 'Retake réussi', 'good', 'success', 'success'),
  fail: legacy('Retake raté', 'Retake raté', 'bad', 'fail', 'fail'),
  no_push: legacy('Changement de point sans départ lu (prise hors vague)', 'Prise sans départ', 'doubt', 'indecis', 'other'),
  series_fail: legacy('Teamfight perdu (série de kills), retake raté', 'Retake raté', 'bad', 'fail', 'fail'),
  series_changed: legacy('Teamfight suivi de la prise du point, retake réussi', 'Retake réussi', 'good', 'success', 'success'),
  series_hold: legacy('Défense qui tient (plus affichée)', 'Défense tenue', 'neutral', 'indecis', 'other'),
  series_neutral: legacy('Série de kills sur un point neutre (prise initiale ou ouverture)', 'Série, point neutre', 'neutral', 'initial', 'initial'),
};
const COLLAPSE_CAPTURED = legacy('Teamfight gagné et point capturé, retake réussi', 'Retake réussi', 'good', 'success', 'success');
const COLLAPSE_HELD = legacy('Teamfight gagné sans capture du point', 'Teamfight gagné, sans capture', 'good', 'won', 'won_no_capture');

/** Issues de l'ancien calcul (sert aussi à reconnaître une ancienne ligne dans une liste d'issues). */
export const LEGACY_OUTCOMES: string[] = [...Object.keys(LEGACY), 'series_collapse'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Vrai si la ligne porte le détail d'une vague (`data.wave`, révision 3) : sinon c'est une ligne de l'ancien calcul. */
export const hasWave = (ep: Pick<Episode, 'data'>): boolean => isObj(ep.data) && isObj(ep.data.wave);

export interface IssueInfo extends IssueDef {
  /** Issue brute (celle de la base), null si absente. */
  key: string | null;
  /** Ligne de l'ancien calcul : mappée d'après la table de correspondance, jamais comptée dans les taux. */
  legacy: boolean;
}

/** Libellé, ton, forme, groupe et rôle d'une ligne de retake ; une issue inconnue reste « à vérifier » et hors taux. */
export function waveIssueInfo(ep: Pick<Episode, 'outcome' | 'data'>): IssueInfo {
  const key = ep.outcome ?? null;
  if (key && hasWave(ep) && WAVE_ISSUES[key]) return { ...WAVE_ISSUES[key], key, legacy: false };
  if (key === 'series_collapse') return { ...(isObj(ep.data) && ep.data.changed_hands === true ? COLLAPSE_CAPTURED : COLLAPSE_HELD), key, legacy: true };
  if (key && LEGACY[key]) return { ...LEGACY[key], key, legacy: true };
  const label = key ?? 'Inconnu';
  return { label, short: label, tone: 'doubt', shape: 'indecis', group: 'other', role: null, key, legacy: !hasWave(ep) };
}

/** Libellé et ton d'une issue donnée seule (sans ligne) : la version actuelle d'une issue connue, sinon l'ancienne ; null si inconnue. */
export function issueLabel(outcome: string | null): { label: string; tone: Tone } | null {
  if (!outcome) return null;
  const def = WAVE_ISSUES[outcome] ?? (outcome === 'series_collapse' ? COLLAPSE_HELD : LEGACY[outcome]);
  return def ? { label: def.label, tone: def.tone } : null;
}

/** Ordre des formes dans la légende de la frise. */
export const SHAPE_ORDER: MarkShape[] = ['success', 'fail', 'won', 'initial', 'initial_lost', 'duel', 'indecis', 'no_contact'];

/** Libellé court de chaque forme de repère (légende de la frise). */
export const SHAPE_LABELS = Object.fromEntries(Object.values(WAVE_ISSUES).map((d) => [d.shape, d.short])) as Record<MarkShape, string>;

/** Formes présentes dans un lot de lignes, dans l'ordre de la légende. */
export function shapesOf(eps: Pick<Episode, 'outcome' | 'data'>[]): MarkShape[] {
  const seen = new Set(eps.map((e) => waveIssueInfo(e).shape));
  return SHAPE_ORDER.filter((s) => seen.has(s));
}

/** Groupes du menu « Issues », dans l'ordre d'affichage. */
export const ISSUE_GROUPS: { id: IssueGroup; label: string }[] = [
  { id: 'success', label: 'Retakes réussis' },
  { id: 'fail', label: 'Retakes ratés' },
  { id: 'won_no_capture', label: 'Teamfights gagnés sans capture' },
  { id: 'duel', label: 'Duels' },
  { id: 'initial', label: 'Prises initiales (et ouvertures perdues)' },
  { id: 'other', label: 'Autres (indécis, sans contact)' },
];

/** Vitesses d'une vague : rapide (départ, contact et résolution en quelques secondes) ou progressive (au moins un arrêt avant le premier kill). */
export type SpeedKey = 'rapide' | 'progressif';

export const SPEED_LABELS: Record<SpeedKey, string> = { rapide: 'Rapide', progressif: 'Progressif' };

/** Libellé d'une vitesse ; une vague sans contact n'en a pas. */
export const speedLabel = (speed: string | null): string => (speed === 'rapide' || speed === 'progressif' ? SPEED_LABELS[speed] : 'Non mesurée (aucun contact)');
