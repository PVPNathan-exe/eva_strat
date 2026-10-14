// Rotations d'une game, vues comme des changements du POINT ACTIF (analysis/rotations.py) : regroupement des deux épisodes d'un même changement (un par équipe),
// fenêtre « 20 s avant, 20 s après », lecture prudente du champ data.flow (comportement de l'équipe) et data.opponent (équipe adverse), résultat (data.result) et phrases en français.
// Temps en secondes depuis le début de la game ; les instants de `flow` sont relatifs au changement (négatif = avant). Fonctions pures.

import type { Episode, TeamSide } from '../types/stats.ts';
import { bandOf, type EpisodeMark } from './episodeClock.ts';
import { playerLabel, rotationInfo } from './episodeFormat.ts';
import { formatTime, spanToPct } from './timeline.ts';

/** Fenêtre de lecture d'une rotation : 20 s avant le changement de point actif, 20 s après. */
export const ROT_BEFORE_S = 20;
export const ROT_AFTER_S = 20;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
const side = (v: unknown): TeamSide | null => (v === 'A' || v === 'B' ? v : null);

/** Un changement de point actif : les épisodes des équipes concernées (un ou deux) partagent l'ancien point, le nouveau et l'instant. */
export interface RotationEvent {
  key: string;
  gameId: number;
  point: string;
  pointTo: string;
  /** Instant où le nouveau point devient actif (s depuis le début de la game). */
  switchT: number;
  episodes: Episode[];
}

/** Changements de point actif d'une liste d'épisodes de rotation : les deux équipes d'un même changement sont regroupées, dans l'ordre du temps. */
export function rotationEvents(eps: Episode[]): RotationEvent[] {
  const by = new Map<string, RotationEvent>();
  for (const e of eps) {
    if (e.kind !== 'rotation' || !e.point || !e.point_to) continue;
    const switchT = rotationInfo(e).switchT ?? e.t0 + ROT_BEFORE_S;
    const key = `${e.game_id}:${e.point}>${e.point_to}@${Math.round(switchT)}`;
    const known = by.get(key);
    if (known) known.episodes.push(e);
    else by.set(key, { key, gameId: e.game_id, point: e.point, pointTo: e.point_to, switchT, episodes: [e] });
  }
  return [...by.values()].sort((a, b) => a.gameId - b.gameId || a.switchT - b.switchT);
}

/** Instant où le curseur se place quand on clique une rotation : 20 s avant le changement (sans reculer avant le début de la game). */
export const rotationSeek = (ev: Pick<RotationEvent, 'switchT'>): number => Math.max(0, ev.switchT - ROT_BEFORE_S);

/** Fenêtre « 20 s avant, 20 s après » d'une rotation, en secondes de game. */
export const rotationSpan = (ev: Pick<RotationEvent, 'switchT'>): { from: number; to: number } => ({ from: ev.switchT - ROT_BEFORE_S, to: ev.switchT + ROT_AFTER_S });

/** Repère d'une rotation sur la frise : au nouveau point, à l'instant du changement, avec la fenêtre de 40 s en fond. */
export function rotationMark(ev: RotationEvent, duration: number): EpisodeMark {
  const win = bandOf(ev.switchT - ROT_BEFORE_S, ev.switchT + ROT_AFTER_S, duration);
  return {
    key: ev.key,
    point: ev.pointTo,
    kind: 'rotation',
    tone: 'doubt',
    t: ev.switchT,
    left: spanToPct(ev.switchT, 0, duration),
    spanLeft: win?.left ?? 0,
    spanWidth: win?.width ?? 0,
    palette: null,
    label: `${formatTime(ev.switchT)} : point ${ev.point} vers point ${ev.pointTo}`,
  };
}

// ---------------------------------------------------------------- comportement d'une équipe

export type LeavePhase = 'avant' | 'au_changement' | 'apres' | 'reste' | 'jamais';

export interface FlowDeath {
  slot: number;
  /** Instant de la mort (s de game) et décalage par rapport au changement (s). */
  t: number | null;
  offset: number | null;
  killer: number | null;
}

/** Comportement d'une équipe pendant la fenêtre d'une rotation (champ data.flow ou data.opponent). */
export interface TeamFlow {
  team: TeamSide | null;
  wasOnOld: boolean | null;
  staysOnOld: boolean | null;
  /** Instant où l'équipe n'a plus 2 joueurs sur l'ancien point, relatif au changement (négatif : elle anticipe). */
  leaveOffset: number | null;
  leavePhase: LeavePhase | null;
  aliveAtLeave: number | null;
  /** Début de la première période de 2 joueurs ou plus sur le nouveau point, relatif au changement. */
  concentrateOffset: number | null;
  alreadyOnNew: boolean | null;
  firstArrival: number | null;
  secondArrival: number | null;
  /** Rapprochement du centre de l'équipe vers le nouveau point (m) à +10 s et +20 s : positif = elle s'en approche. */
  toward: { s10: number | null; s20: number | null };
  ownsOldAtChange: boolean | null;
  ownsNewBefore: boolean | null;
  deaths: FlowDeath[];
  kills: number | null;
}

const PHASES: LeavePhase[] = ['avant', 'au_changement', 'apres', 'reste', 'jamais'];

/** Lit `flow` ou `opponent` avec prudence ; null si le champ manque (anciens calculs). `switchT` sert à déduire le décalage d'une mort quand il manque. */
export function parseFlow(raw: unknown, switchT: number): TeamFlow | null {
  if (!isObj(raw)) return null;
  const toward = isObj(raw.toward_new_m) ? raw.toward_new_m : {};
  const deaths = (Array.isArray(raw.deaths) ? raw.deaths.filter(isObj) : []).flatMap((o): FlowDeath[] => {
    const slot = num(o.slot);
    if (slot === null) return [];
    const t = num(o.t);
    return [{ slot, t, offset: num(o.offset_s) ?? (t !== null ? t - switchT : null), killer: num(o.killer) }];
  });
  const phase = PHASES.find((p) => p === raw.leave_phase) ?? null;
  return {
    team: side(raw.team),
    wasOnOld: bool(raw.was_on_old),
    staysOnOld: bool(raw.stays_on_old),
    leaveOffset: num(raw.leave_old_offset_s),
    leavePhase: phase,
    aliveAtLeave: num(raw.alive_at_leave),
    concentrateOffset: num(raw.concentrate_new_offset_s),
    alreadyOnNew: bool(raw.already_on_new),
    firstArrival: num(raw.first_arrival_s),
    secondArrival: num(raw.second_arrival_s),
    toward: { s10: num(toward['10']), s20: num(toward['20']) },
    ownsOldAtChange: bool(raw.owns_old_at_change),
    ownsNewBefore: bool(raw.owns_new_before),
    deaths: deaths.sort((a, b) => (a.offset ?? 0) - (b.offset ?? 0)),
    kills: num(raw.kills),
  };
}

/** Comportement d'une équipe lors d'un changement : son propre épisode (data.flow) s'il existe, sinon le champ data.opponent de l'épisode de l'équipe adverse. null si aucun des deux. */
export function flowOfTeam(ev: RotationEvent, team: TeamSide): TeamFlow | null {
  for (const e of ev.episodes) {
    if (e.team !== team) continue;
    const f = parseFlow(e.data?.flow, ev.switchT);
    if (f) return f;
  }
  for (const e of ev.episodes) {
    if (!e.team || e.team === team) continue;
    const f = parseFlow(e.data?.opponent, ev.switchT);
    if (f && (f.team === null || f.team === team)) return f;
  }
  return null;
}

/** Résultat de la rotation (data.result) : qui a le nouveau point, qui gagne. */
export interface RotationResult {
  winner: TeamSide | null;
  firstTeam: TeamSide | null;
  ownerFirst: TeamSide | null;
  ownerT10: TeamSide | null;
  ownerT20: TeamSide | null;
}

/** Résultat lu dans le premier épisode qui en a un (les deux équipes d'un changement portent le même). null si absent. */
export function resultOf(ev: RotationEvent): RotationResult | null {
  for (const e of ev.episodes) {
    const r = e.data?.result;
    if (!isObj(r)) continue;
    return { winner: side(r.winner), firstTeam: side(r.first_team), ownerFirst: side(r.owner_first), ownerT10: side(r.owner_t10), ownerT20: side(r.owner_t20) };
  }
  return null;
}

// ---------------------------------------------------------------- repères et phrases

export type WindowKind = 'leave' | 'concentrate' | 'first' | 'second' | 'death';

/** Un repère sur l'axe « 20 s avant, 20 s après » d'une équipe (décalage par rapport au changement). */
export interface WindowMark {
  kind: WindowKind;
  offset: number;
  label: string;
  /** Joueur concerné (morts). */
  slot: number | null;
}

/** Position (0 à 100) d'un décalage sur l'axe de la fenêtre, bornée. */
export const windowPct = (offset: number): number => spanToPct(offset, -ROT_BEFORE_S, ROT_AFTER_S);

/** Décalage signé : « -1,5 s » (avant le changement) ou « +3,5 s » (après). */
export function signedSeconds(s: number): string {
  return `${s < 0 ? '-' : '+'}${Math.abs(s).toFixed(1).replace('.', ',')} s`;
}

/** Repères de l'axe d'une équipe : départ de l'ancien point, concentration sur le nouveau, première et deuxième arrivée, morts, dans l'ordre du temps. */
export function windowMarks(f: TeamFlow): WindowMark[] {
  const out: WindowMark[] = [];
  if (f.leaveOffset !== null) out.push({ kind: 'leave', offset: f.leaveOffset, label: `Quitte l'ancien point ${signedSeconds(f.leaveOffset)}`, slot: null });
  if (f.concentrateOffset !== null) out.push({ kind: 'concentrate', offset: f.concentrateOffset, label: `Se concentre sur le nouveau point ${signedSeconds(f.concentrateOffset)}`, slot: null });
  if (f.firstArrival !== null) out.push({ kind: 'first', offset: f.firstArrival, label: `Première arrivée ${signedSeconds(f.firstArrival)}`, slot: null });
  if (f.secondArrival !== null) out.push({ kind: 'second', offset: f.secondArrival, label: `Deuxième arrivée ${signedSeconds(f.secondArrival)}`, slot: null });
  for (const d of f.deaths) if (d.offset !== null) out.push({ kind: 'death', offset: d.offset, label: `Mort de ${playerLabel(d.slot)} ${signedSeconds(d.offset)}`, slot: d.slot });
  return out.sort((a, b) => a.offset - b.offset);
}

/** Quand l'équipe quitte l'ancien point, relativement au changement : négatif = elle anticipe. */
export function leaveSentence(f: TeamFlow): string {
  if (f.leavePhase === 'reste') return "Reste sur l'ancien point jusqu'à la fin de la fenêtre.";
  if (f.leavePhase === 'jamais' || (f.leaveOffset === null && f.wasOnOld === false)) return "N'était pas sur l'ancien point (moins de deux joueurs deux secondes de suite).";
  if (f.leaveOffset === null) return 'Départ de l\'ancien point non lu.';
  const how = f.leavePhase === 'avant' ? 'Anticipe' : f.leavePhase === 'apres' ? 'Part en retard' : 'Part au moment du changement';
  const alive = f.aliveAtLeave !== null ? `, ${f.aliveAtLeave} vivant${f.aliveAtLeave > 1 ? 's' : ''}` : '';
  return `${how} : ${signedSeconds(f.leaveOffset)} par rapport au changement${alive}.`;
}

/** Quand l'équipe se concentre (au moins deux joueurs) sur le nouveau point. */
export function concentrateSentence(f: TeamFlow): string {
  if (f.alreadyOnNew) return 'Déjà sur le nouveau point au début de la fenêtre.';
  if (f.concentrateOffset === null) return 'Ne se concentre pas sur le nouveau point dans la fenêtre.';
  return `Se concentre sur le nouveau point ${signedSeconds(f.concentrateOffset)}${f.concentrateOffset < 0 ? ' (avant le changement)' : ''}.`;
}

/** Arrivées au nouveau point (premier et deuxième joueur) depuis le changement. */
export function arrivalSentence(f: TeamFlow): string {
  if (f.firstArrival === null) return 'Personne n\'arrive au nouveau point.';
  return f.secondArrival === null ? `Un seul arrivé (${signedSeconds(f.firstArrival)}).` : `Première arrivée ${signedSeconds(f.firstArrival)}, deuxième ${signedSeconds(f.secondArrival)}.`;
}

/** Rapprochement du centre de l'équipe vers le nouveau point à +10 s et +20 s. */
export function approachSentence(f: TeamFlow): string | null {
  const part = (label: string, v: number | null) => (v === null ? null : `${v >= 0 ? 'se rapproche de' : "s'éloigne de"} ${Math.abs(v).toFixed(1).replace('.', ',')} m à ${label}`);
  const parts = [part('+10 s', f.toward.s10), part('+20 s', f.toward.s20)].filter((p): p is string => p !== null);
  return parts.length ? `Le centre de l'équipe ${parts.join(', ')}.` : null;
}

/** Qui gagne la rotation : l'équipe qui tient le nouveau point 20 s après (sinon la première à le tenir). `name` donne le nom d'un côté. */
export function winnerSentence(r: RotationResult | null, name: (s: TeamSide) => string): string {
  if (!r || !r.winner) return 'Gagnant non lu (le nouveau point reste sans propriétaire).';
  const owner = (o: TeamSide | null) => (o ? name(o) : 'personne');
  return `Gagnée par ${name(r.winner)} (propriétaire du nouveau point : ${owner(r.ownerT10)} à +10 s, ${owner(r.ownerT20)} à +20 s).`;
}
