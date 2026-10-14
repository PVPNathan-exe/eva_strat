// Statistiques des vagues de la vue Retakes : filtres (issue, vitesse), taux de retake réussi, tableau par équipe nommée ou par côté.
// Taux de retake réussi = retakes réussis / (retakes réussis + retakes ratés + teamfights gagnés sans capture) : les prises initiales, les duels, les vagues sans contact et les indécis sont exclus.
// Une ligne de l'ancien calcul (sans `data.wave`) et une vague jugée fausse (verdict « ko ») ne sont comptées nulle part. Aucune dépendance au navigateur.

import type { Episode, TeamSide } from '../types/stats.ts';
import { nameKey, type FollowGame } from './teamFollow.ts';
import { waveInfo } from './waveInfo.ts';
import { ISSUE_GROUPS, waveIssueInfo, type IssueGroup, type SpeedKey } from './waveOutcome.ts';

/** Nombre minimal de vagues décidées (retakes réussis, ratés ou teamfights gagnés sans capture) pour afficher un pourcentage. */
export const MIN_DECIDED = 5;

export type Verdicts = Record<number, 'ok' | 'ko' | null>;

// ---------------------------------------------------------------- filtres

export interface WaveFilter {
  groups: Record<IssueGroup, boolean>;
  speeds: Record<SpeedKey, boolean>;
}

/** Tout est montré. */
export const ALL_WAVES: WaveFilter = {
  groups: Object.fromEntries(ISSUE_GROUPS.map((g) => [g.id, true])) as Record<IssueGroup, boolean>,
  speeds: { rapide: true, progressif: true },
};

/** Vitesse d'une ligne : null pour une vague sans contact ou une ancienne ligne. */
export function speedOf(ep: Pick<Episode, 'data' | 't0' | 't1' | 'team' | 'point'>): SpeedKey | null {
  return waveInfo(ep)?.speed ?? null;
}

/** La vague passe les filtres : son groupe d'issue est coché ; sa vitesse l'est aussi (une vague sans vitesse passe seulement si les deux vitesses sont cochées). */
export function passesFilter(ep: Episode, f: WaveFilter): boolean {
  if (!f.groups[waveIssueInfo(ep).group]) return false;
  const speed = speedOf(ep);
  return speed ? f.speeds[speed] : f.speeds.rapide && f.speeds.progressif;
}

export const filterWaves = (eps: Episode[], f: WaveFilter): Episode[] => eps.filter((e) => passesFilter(e, f));

/** Vrai si au moins un filtre est décoché. */
export const isFiltered = (f: WaveFilter): boolean => Object.values(f.groups).some((v) => !v) || !f.speeds.rapide || !f.speeds.progressif;

// ---------------------------------------------------------------- taux

const judgedKo = (e: Episode, verdicts: Verdicts): boolean => (e.id in verdicts ? verdicts[e.id] : e.verdict) === 'ko';

export interface WaveRate {
  /** Vagues comptées (anciennes lignes et verdicts « ko » écartés). */
  waves: number;
  success: number;
  fail: number;
  won: number;
  /** Prises initiales (point neutre pris). */
  initial: number;
  /** Teamfights d'ouverture perdus (point neutre, aucune prise). */
  openingLost: number;
  duel: number;
  /** Indécis et vagues sans contact. */
  other: number;
  /** Vagues décidées : réussies + ratées + teamfights gagnés sans capture. */
  decided: number;
  /** Part de retakes réussis parmi les vagues décidées ; null sous le minimum. */
  rate: number | null;
  hidden: boolean;
  /** Lignes de l'ancien calcul, non comptées. */
  legacy: number;
  /** Vagues jugées fausses par l'utilisateur, non comptées. */
  ko: number;
}

/** Taux de retake réussi d'un lot de vagues. `verdicts` : jugements posés pendant la session (ils l'emportent sur la base). */
export function retakeRate(eps: Episode[], verdicts: Verdicts = {}, min = MIN_DECIDED): WaveRate {
  const out: WaveRate = { waves: 0, success: 0, fail: 0, won: 0, initial: 0, openingLost: 0, duel: 0, other: 0, decided: 0, rate: null, hidden: true, legacy: 0, ko: 0 };
  for (const e of eps) {
    const info = waveIssueInfo(e);
    if (info.legacy) out.legacy += 1;
    else if (judgedKo(e, verdicts)) out.ko += 1;
    else {
      out.waves += 1;
      if (info.role) out[info.role] += 1;
      else if (info.key === 'initial') out.initial += 1;
      else if (info.key === 'initial_lost') out.openingLost += 1;
      else if (info.group === 'duel') out.duel += 1;
      else out.other += 1;
    }
  }
  out.decided = out.success + out.fail + out.won;
  out.hidden = out.decided < min;
  out.rate = out.hidden ? null : out.success / out.decided;
  return out;
}

const pc = (r: number): string => `${Math.round(r * 100)} %`;
const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

/** Phrase de bilan : vagues par issue et taux de retake réussi (ou raison de son masquage). */
export function rateSentence(r: WaveRate, min = MIN_DECIDED): string {
  const parts = [plural(r.success, 'retake réussi', 'retakes réussis'), plural(r.fail, 'retake raté', 'retakes ratés'), plural(r.won, 'teamfight gagné sans capture', 'teamfights gagnés sans capture'), plural(r.duel, 'duel', 'duels'), plural(r.initial, 'prise initiale', 'prises initiales')];
  const head = `${plural(r.waves, 'vague', 'vagues')} (${parts.join(', ')})`;
  const tail = r.rate !== null ? `retake réussi : ${pc(r.rate)} (${r.success} sur ${r.decided})` : `taux masqué (${plural(r.decided, 'vague décidée', 'vagues décidées')}, minimum ${min})`;
  return `${head}, ${tail}`;
}

// ---------------------------------------------------------------- tableau par équipe

export interface TeamRow {
  /** Clé de regroupement : nom normalisé de l'équipe, ou « side:A » / « side:B » quand la vidéo n'a pas de nom. */
  key: string;
  label: string;
  waves: number;
  success: number;
  fail: number;
  won: number;
  fast: number;
  progressive: number;
  /** Médiane de la durée du départ au premier kill (s), sur les vagues avec contact ; null sans contact. */
  medianToContactS: number | null;
  decided: number;
  rate: number | null;
}

/** Médiane d'une liste de nombres (moyenne des deux valeurs du milieu si le nombre est pair) ; null si la liste est vide. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Équipe d'une vague : nom normalisé et libellé (par nom d'équipe si la vidéo en a un, sinon par côté). */
export function teamOfWave(team: TeamSide | null, game: Pick<FollowGame, 'teamA' | 'teamB'> | undefined): { key: string; label: string } {
  const side = team ?? 'A';
  const name = side === 'A' ? game?.teamA : game?.teamB;
  const key = nameKey(name);
  if (key) return { key, label: (name as string).trim() };
  return { key: `side:${side}`, label: side === 'A' ? 'Équipe orange (côté gauche)' : 'Équipe bleue (côté droit)' };
}

/**
 * Une ligne par équipe : vagues, retakes réussis et ratés, teamfights gagnés sans capture, vagues rapides et progressives, médiane du départ au premier kill.
 * Les équipes nommées sont regroupées d'une game à l'autre même quand elles changent de côté. `gameOf` donne la game d'une ligne ; l'équipe qui en a le plus de vagues vient d'abord.
 */
export function teamTable(eps: Episode[], gameOf: (gameId: number) => Pick<FollowGame, 'teamA' | 'teamB'> | undefined, verdicts: Verdicts = {}, min = MIN_DECIDED): TeamRow[] {
  const by = new Map<string, TeamRow & { contact: number[] }>();
  for (const e of eps) {
    const info = waveIssueInfo(e);
    const w = waveInfo(e);
    if (info.legacy || !w || judgedKo(e, verdicts)) continue;
    const t = teamOfWave(w.team, gameOf(e.game_id));
    const row = by.get(t.key) ?? { key: t.key, label: t.label, waves: 0, success: 0, fail: 0, won: 0, fast: 0, progressive: 0, medianToContactS: null, decided: 0, rate: null, contact: [] };
    row.waves += 1;
    if (info.role) row[info.role] += 1;
    if (w.speed === 'rapide') row.fast += 1;
    else if (w.speed === 'progressif') row.progressive += 1;
    if (w.toContactS !== null) row.contact.push(w.toContactS);
    by.set(t.key, row);
  }
  return [...by.values()]
    .map(({ contact, ...row }) => {
      const decided = row.success + row.fail + row.won;
      return { ...row, medianToContactS: median(contact), decided, rate: decided < min ? null : row.success / decided };
    })
    .sort((a, b) => b.waves - a.waves || a.label.localeCompare(b.label));
}
