// Détail d'une vague (champ `data.wave` d'un épisode retake, analysis/retakes.py révision 3) : lecture prudente et phrases de la vue Retakes.
// Temps en secondes depuis le début de la game, distances en mètres. Un champ absent ou mal formé devient null ; `waveInfo` renvoie null pour une ligne de l'ancien calcul (sans `data.wave`).

import type { Episode, TeamSide } from '../types/stats.ts';
import type { SpeedKey } from './waveOutcome.ts';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const side = (v: unknown): TeamSide | null => (v === 'A' || v === 'B' ? v : null);

export interface WaveFight {
  nKills: number | null;
  /** Morts de chaque équipe dans la série entière. */
  losses: { A: number; B: number } | null;
  winner: TeamSide | null;
  tFirst: number | null;
  tLast: number | null;
  /** Part des victimes tuées à moins de 7 m du point (0 à 1). */
  nearPoint: number | null;
}

export interface WaveInfo {
  team: TeamSide | null;
  tStart: number;
  tContact: number | null;
  tEnd: number;
  /** Durée du départ de la vague à sa résolution (dernier kill du teamfight ou prise du point). */
  durationS: number | null;
  /** Durée du départ du spawn au premier kill. */
  toContactS: number | null;
  size: number | null;
  speed: SpeedKey | null;
  nStops: number | null;
  stopS: number | null;
  point: string | null;
  holderBefore: TeamSide | null;
  holderAfter: TeamSide | null;
  /** won, lost, draw, duel ou none. */
  tfResult: string;
  kind: 'teamfight' | 'duel' | null;
  capturedT: number | null;
  captureFrom: TeamSide | null;
  opening: boolean;
  survivorsRetreated: number | null;
  /** 0 au spawn de l'équipe de la vague, 1 à celui de l'adversaire ; null sur Outlaw (départs neutres) ou sans combat. */
  axisFrac: number | null;
  fight: WaveFight | null;
}

/** `data.wave` d'un épisode, ou null pour une ligne de l'ancien calcul. `tStart` et `tEnd` retombent sur les bornes de l'épisode si le détail les omet. */
export function waveInfo(ep: Pick<Episode, 'data' | 't0' | 't1' | 'team' | 'point'>): WaveInfo | null {
  const w = isObj(ep.data) && isObj(ep.data.wave) ? ep.data.wave : null;
  if (!w) return null;
  const f = isObj(w.fight) ? w.fight : null;
  const loss = f && isObj(f.losses) ? f.losses : null;
  const speed = w.speed === 'rapide' || w.speed === 'progressif' ? w.speed : null;
  return {
    team: side(w.team) ?? ep.team,
    tStart: num(w.t_start) ?? ep.t0,
    tContact: num(w.t_contact),
    tEnd: num(w.t_end) ?? ep.t1,
    durationS: num(w.duration_s),
    toContactS: num(w.to_contact_s),
    size: num(w.size),
    speed,
    nStops: num(w.n_stops),
    stopS: num(w.stop_s),
    point: typeof w.point === 'string' ? w.point : ep.point,
    holderBefore: side(w.holder_before),
    holderAfter: side(w.holder_after),
    tfResult: typeof w.tf_result === 'string' ? w.tf_result : 'none',
    kind: w.kind === 'teamfight' || w.kind === 'duel' ? w.kind : null,
    capturedT: num(w.captured_t),
    captureFrom: side(w.capture_from),
    opening: w.opening === true,
    survivorsRetreated: num(w.survivors_retreated),
    axisFrac: num(w.axis_frac),
    fight: f ? { nKills: num(f.n_kills), losses: loss && num(loss.A) !== null && num(loss.B) !== null ? { A: num(loss.A) as number, B: num(loss.B) as number } : null, winner: side(f.winner), tFirst: num(f.t_first), tLast: num(f.t_last), nearPoint: num(f.near_point) } : null,
  };
}

const sec = (s: number): string => `${s.toFixed(1).replace('.', ',')} s`;

/** Résultat du teamfight pour l'équipe de la vague (champ `tf_result`). */
export function tfResultLabel(result: string): string {
  switch (result) {
    case 'won':
      return 'teamfight gagné';
    case 'lost':
      return 'teamfight perdu';
    case 'draw':
      return 'teamfight à égalité';
    case 'duel':
      return 'duel (ni gagné ni perdu)';
    default:
      return 'aucun kill';
  }
}

/** Où se tient le combat, en pourcentage du trajet entre les deux spawns (0 % : spawn de l'équipe de la vague, 100 % : celui de l'adversaire). */
export function axisSentence(frac: number | null, hasFight: boolean): string {
  if (!hasFight) return 'aucun combat';
  if (frac === null) return 'non mesurée (départs neutres, ou combat hors du trajet)';
  return `${Math.round(frac * 100)} % du trajet entre le spawn de la vague (0 %) et celui de l'adversaire (100 %)`;
}

/** Tenant d'un point : nom de l'équipe, ou « personne » (point neutre). `nameOf` donne le nom d'un côté. */
export const holderLabel = (holder: TeamSide | null, nameOf: (s: TeamSide) => string): string => (holder ? nameOf(holder) : 'personne (neutre)');

/** Survivants repliés : « 2 sur 3 survivants repliés à plus de 7 m du point ». */
export function retreatSentence(retreated: number | null, survivors: number): string {
  if (retreated === null) return 'inconnu';
  if (survivors === 0) return 'aucun survivant 3 s après le teamfight';
  return `${retreated} sur ${survivors} survivant${survivors > 1 ? 's' : ''} replié${retreated > 1 ? 's' : ''} à plus de 7 m du point`;
}

/** Vitesse en phrase : « rapide » ou « progressive (2 arrêts, 7,5 s à l'arrêt avant le premier kill) ». */
export function speedSentence(w: Pick<WaveInfo, 'speed' | 'nStops' | 'stopS'>): string {
  if (w.speed === null) return 'non mesurée (aucun contact)';
  if (w.speed === 'rapide') return 'rapide (aucun arrêt avant le premier kill)';
  const stops = w.nStops ?? 0;
  return `progressive (${stops} arrêt${stops > 1 ? 's' : ''}${w.stopS !== null ? `, ${sec(w.stopS)} à l'arrêt` : ''} avant le premier kill)`;
}

/** Signale une prise du point malgré un teamfight perdu ou nul : le propriétaire lu sur la minimap prime sur le décompte des morts, la ligne est à vérifier. */
export const doubtfulCapture = (w: Pick<WaveInfo, 'capturedT' | 'tfResult'>): boolean => w.capturedT !== null && (w.tfResult === 'lost' || w.tfResult === 'draw');

/** Résumé d'une ligne de liste : « 3 joueurs, premier kill après 3,5 s, teamfight de 5 kills ». */
export function waveSummary(w: WaveInfo): string {
  const parts: string[] = [];
  if (w.size !== null) parts.push(`${w.size} joueur${w.size > 1 ? 's' : ''}`);
  parts.push(w.toContactS !== null ? `premier kill après ${sec(w.toContactS)}` : 'aucun kill');
  if (w.fight && w.fight.nKills !== null) parts.push(w.kind === 'duel' ? 'duel' : `teamfight de ${w.fight.nKills} kill${w.fight.nKills > 1 ? 's' : ''}`);
  return parts.join(', ');
}
