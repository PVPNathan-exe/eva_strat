// Aides pures des vues Retakes et Rotations : libellés en français, durées, lecture du champ `data` (JSON) des épisodes, regroupement par point,
// taux de réussite (masqué sous un minimum d'épisodes), agrégat des rotations et géométrie de la frise. Aucune dépendance au navigateur.
// Temps en secondes depuis le début de la game (comme les tables Stats), jamais en temps de vidéo : `videoSeek` fait la conversion.

import type { Episode, PointOwner, TeamSide } from '../types/stats.ts';
import { numberOfSlot } from './killTimeline.ts';
import type { Palette } from './teamFollow.ts';
import { waveInfo } from './waveInfo.ts';
import { issueLabel } from './waveOutcome.ts';

/** Nombre minimal d'épisodes décidés (réussis ou échoués) pour afficher un pourcentage. */
export const MIN_EPISODES = 5;
/** Le lien vers la vidéo ouvre l'instant clé moins ce délai (s). */
export const VIDEO_LEAD_S = 5;

/** Ton d'un résultat : bon, mauvais, à vérifier, ou neutre (prise initiale, duel, vague sans contact : ni réussite ni échec). */
export type Tone = 'good' | 'bad' | 'doubt' | 'neutral';

/** Résultats des rotations (les issues des retakes sont dans waveOutcome.ts). */
const OUTCOMES: Record<string, { label: string; tone: Tone }> = {
  arrived: { label: 'Arrivés à deux ou plus', tone: 'good' },
  partial: { label: 'Un seul arrivé', tone: 'doubt' },
  not_arrived: { label: 'Personne arrivé', tone: 'bad' },
};

/** Vrai pour une ancienne série de 3 ou 4 kills (révision 2 des retakes : résultat series_*, plus écrite par le calcul actuel). Tolérance pour une base non recalculée. */
export const isSeries = (ep: Pick<Episode, 'outcome'>): boolean => (ep.outcome ?? '').startsWith('series_');

/** Libellé et ton d'un résultat d'épisode (rotation, issue de vague ou ancienne issue) ; un résultat inconnu reste « à vérifier ». */
export function outcomeInfo(outcome: string | null): { label: string; tone: Tone } {
  return (outcome && OUTCOMES[outcome]) || issueLabel(outcome) || { label: outcome ?? 'Inconnu', tone: 'doubt' };
}

const CAUSES: Record<string, string> = {
  tue_sur_le_point: 'tué sur le point',
  tue_a_distance: 'tué à distance',
  sans_tueur: 'tueur non lu',
  autre: 'tué ailleurs',
  en_route: 'tué en route',
};

export const causeLabel = (cause: string): string => CAUSES[cause] ?? cause;

const FATES: Record<string, string> = {
  mort: 'mort dans le teamfight',
  mort_apres: 'mort après la prise',
  recule: 'reculé',
  reste: 'resté au point',
};

/** Sort d'un défenseur d'un retake (champ `fate`). */
export const fateLabel = (fate: string | null): string => (fate ? (FATES[fate] ?? fate) : 'sort inconnu');

/** Décalage (s) par rapport à un instant de référence : « 2,0 s avant » ou « 3,5 s après ». */
export const offsetLabel = (s: number): string => (s < 0 ? `${formatSeconds(-s)} avant` : `${formatSeconds(s)} après`);

/** Décimale à virgule : 6,5 s ; au-delà d'une minute : 1 min 05 s. */
export function formatSeconds(s: number): string {
  if (s >= 60) {
    const m = Math.floor(s / 60);
    return `${m} min ${String(Math.round(s - m * 60)).padStart(2, '0')} s`;
  }
  return `${s.toFixed(1).replace('.', ',')} s`;
}

export const percent = (rate: number): string => `${Math.round(rate * 100)} %`;

/** Nom d'un joueur dans les phrases : numéro de jeu (1 à 4, 6 à 9) et pseudo s'il est connu. */
export const playerLabel = (slot: number, name?: string): string => `n° ${numberOfSlot(slot)}${name ? ` (${name})` : ''}`;

// ---------------------------------------------------------------- lecture du champ data

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const objs = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj) : []);
const team = (v: unknown): TeamSide | null => (v === 'A' || v === 'B' ? v : null);
const pos = (v: unknown): [number, number] | null => (Array.isArray(v) && num(v[0]) !== null && num(v[1]) !== null ? [v[0] as number, v[1] as number] : null);

export interface PlayerAt {
  slot: number;
  pos: [number, number] | null;
  distM: number | null;
  /** Défenseurs seulement : mort, mort_apres, recule ou reste. */
  fate: string | null;
}

export interface DeathInfo {
  slot: number;
  t: number;
  /** Équipe du joueur mort. */
  team: TeamSide;
  killer: number | null;
  weapon: string | null;
  killerDistM: number | null;
  defendersNear: number | null;
  cause: string;
  pos: [number, number] | null;
}

const playerOf = (o: Record<string, unknown>): PlayerAt | null => {
  const slot = num(o.slot);
  return slot === null ? null : { slot, pos: pos(o.pos), distM: num(o.dist_m), fate: typeof o.fate === 'string' ? o.fate : null };
};

const teamOfSlot = (slot: number): TeamSide => (slot <= 4 ? 'A' : 'B');

const deathOf = (o: Record<string, unknown>, fallback: TeamSide | null): DeathInfo | null => {
  const slot = num(o.slot);
  const t = num(o.t);
  if (slot === null || t === null) return null;
  return {
    slot,
    t,
    team: team(o.team) ?? fallback ?? teamOfSlot(slot),
    killer: num(o.killer),
    weapon: typeof o.weapon === 'string' ? o.weapon : null,
    killerDistM: num(o.killer_dist_m),
    defendersNear: num(o.defenders_near),
    cause: typeof o.cause === 'string' ? o.cause : 'autre',
    pos: pos(o.pos),
  };
};

export interface RetakeInfo {
  changeT: number | null;
  pushT: number | null;
  attackers: PlayerAt[];
  defenders: PlayerAt[];
  deaths: DeathInfo[];
  firstDeath: DeathInfo | null;
  /** Écart (s) entre l'arrivée du premier et du deuxième attaquant. */
  staggerS: number | null;
  survivors: number[];
}

/** Champ `data` d'un retake, lu avec prudence (un champ absent ou mal formé devient null ou une liste vide). */
export function retakeInfo(ep: Episode): RetakeInfo {
  const d = ep.data ?? {};
  const deaths = objs(d.deaths).map((o) => deathOf(o, null)).filter((x): x is DeathInfo => x !== null).sort((a, b) => a.t - b.t);
  const first = isObj(d.first_death) ? deathOf(d.first_death, null) : null;
  return {
    changeT: num(d.change_t),
    pushT: num(d.push_t),
    attackers: objs(d.attackers).map(playerOf).filter((x): x is PlayerAt => x !== null),
    defenders: objs(d.defenders).map(playerOf).filter((x): x is PlayerAt => x !== null),
    deaths,
    firstDeath: first ?? deaths[0] ?? null,
    staggerS: num(d.stagger_s),
    survivors: Array.isArray(d.survivors) ? d.survivors.filter((x): x is number => typeof x === 'number') : [],
  };
}

export interface RotationInfo {
  switchT: number | null;
  oldOwner: TeamSide | null;
  newOwnerAfter: TeamSide | null;
  distanceM: number | null;
  /** Joueurs partis de l'ancien point ; `leaveOffset` : instant de départ moins l'apparition de la nouvelle boîte (négatif : parti avant). */
  start: { slot: number; leaveOffset: number | null }[];
  /** Arrivées au nouveau point, de la plus rapide à la plus lente ; `travelS` : délai depuis l'apparition de la nouvelle boîte. */
  arrivals: { slot: number; t: number; travelS: number }[];
  secondArrivalS: number | null;
  deaths: DeathInfo[];
}

/** Champ `data` d'une rotation (Outlaw), lu avec prudence. */
export function rotationInfo(ep: Episode): RotationInfo {
  const d = ep.data ?? {};
  const slotOf = (o: Record<string, unknown>) => num(o.slot);
  return {
    switchT: num(d.switch_t),
    oldOwner: team(d.old_owner),
    newOwnerAfter: team(d.new_owner_after),
    distanceM: num(d.distance_points_m),
    start: objs(d.start_players).flatMap((o) => (slotOf(o) === null ? [] : [{ slot: slotOf(o) as number, leaveOffset: num(o.leave_offset_s) }])),
    arrivals: objs(d.arrivals).flatMap((o) => (slotOf(o) === null || num(o.t) === null || num(o.travel_s) === null ? [] : [{ slot: slotOf(o) as number, t: num(o.t) as number, travelS: num(o.travel_s) as number }])).sort((a, b) => a.travelS - b.travelS),
    secondArrivalS: num(d.second_arrival_s),
    deaths: objs(d.deaths_en_route).map((o) => deathOf({ ...o, cause: 'en_route' }, ep.team)).filter((x): x is DeathInfo => x !== null),
  };
}

/** Écart (s) entre la première et la deuxième arrivée d'une rotation ; null s'il y a moins de deux arrivées. */
export function arrivalGap(info: RotationInfo): number | null {
  return info.arrivals.length >= 2 ? info.arrivals[1].travelS - info.arrivals[0].travelS : null;
}

/** Phrase sur une mort : « n° 4 tué par n° 8, sur le point, 0,6 m du point ». `name` donne le pseudo d'un slot. */
export function deathSentence(d: DeathInfo, name: (slot: number) => string | undefined): string {
  const by = d.killer === null ? 'tueur non lu' : `tué par ${playerLabel(d.killer, name(d.killer))}`;
  const where = d.killerDistM !== null ? `, tueur à ${d.killerDistM.toFixed(1).replace('.', ',')} m du point` : '';
  return `${playerLabel(d.slot, name(d.slot))} : ${by}${where} (${causeLabel(d.cause)})`;
}

/** Causes des morts en une phrase : « tué à distance : 3 ; tué sur le point : 1 » (la plus fréquente d'abord). */
export function causeSummary(deaths: Pick<DeathInfo, 'cause'>[]): string {
  const count = new Map<string, number>();
  for (const d of deaths) count.set(d.cause, (count.get(d.cause) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([cause, n]) => `${causeLabel(cause)} : ${n}`).join(' ; ');
}

// ---------------------------------------------------------------- filtres et regroupements

/** Le joueur (slot 1 à 8) participe à l'épisode : attaquant, défenseur, mort, ou joueur de la rotation. slot 0 : tous. */
export function involvesSlot(ep: Episode, slot: number): boolean {
  if (slot === 0) return true;
  if (ep.kind === 'retake') {
    const r = retakeInfo(ep);
    return [...r.attackers, ...r.defenders].some((p) => p.slot === slot) || r.deaths.some((x) => x.slot === slot);
  }
  const r = rotationInfo(ep);
  return r.start.some((p) => p.slot === slot) || r.arrivals.some((p) => p.slot === slot) || r.deaths.some((x) => x.slot === slot);
}

/** Épisodes des games retenues, de l'équipe qui attaque ou tourne (`'all'` : les deux) et du joueur choisi (0 : tous), triés par game puis par temps. */
export function filterEpisodes(eps: Episode[], gameIds: number[], teamFilter: TeamSide | 'all', slot: number): Episode[] {
  const ids = new Set(gameIds);
  return eps
    .filter((e) => ids.has(e.game_id) && (teamFilter === 'all' || e.team === teamFilter) && involvesSlot(e, slot))
    .sort((a, b) => a.game_id - b.game_id || a.t0 - b.t0);
}

export interface RateStats {
  /** Épisodes pris en compte (ceux que l'utilisateur a jugés faux, verdict ko, et les séries de kills sont écartés). */
  total: number;
  /** Séries de 3 ou 4 kills, comptées à part. */
  series: number;
  good: number;
  bad: number;
  doubt: number;
  /** Épisodes décidés : réussis ou échoués. */
  decided: number;
  /** Part de réussites parmi les épisodes décidés ; null sous le minimum d'épisodes. */
  rate: number | null;
  hidden: boolean;
}

/** Taux de réussite : les épisodes à vérifier ne comptent pas, un verdict ko écarte l'épisode. `verdicts` : jugements posés pendant la session. */
export function rateOf(eps: Episode[], verdicts: Record<number, 'ok' | 'ko' | null> = {}, min = MIN_EPISODES): RateStats {
  const judged = eps.filter((e) => (e.id in verdicts ? verdicts[e.id] : e.verdict) !== 'ko');
  const kept = judged.filter((e) => !isSeries(e));
  const count = (tone: Tone) => kept.filter((e) => outcomeInfo(e.outcome).tone === tone).length;
  const good = count('good');
  const bad = count('bad');
  const decided = good + bad;
  const hidden = decided < min;
  return { total: kept.length, series: judged.length - kept.length, good, bad, doubt: count('doubt'), decided, rate: hidden ? null : good / decided, hidden };
}

export interface PointGroup {
  point: string;
  label: string;
  episodes: Episode[];
}

export const pointLabel = (point: string | null): string => (point ? `Point ${point}` : 'Point inconnu');

/** Épisodes regroupés par point (`point`), les points dans l'ordre alphabétique ; l'ordre des épisodes est conservé. */
export function groupByPoint(eps: Episode[]): PointGroup[] {
  const by = new Map<string, Episode[]>();
  for (const e of eps) by.set(e.point ?? '?', [...(by.get(e.point ?? '?') ?? []), e]);
  return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([point, episodes]) => ({ point, label: pointLabel(point === '?' ? null : point), episodes }));
}

// ---------------------------------------------------------------- agrégat des rotations

export interface FlowNode {
  point: string;
  /** Temps estimé passé sur le point par l'équipe (s), voir `rotationFlow`. */
  seconds: number;
  /** Nombre d'arrivées sur ce point. */
  visits: number;
}

export interface FlowArrow {
  from: string;
  to: string;
  count: number;
  /** Moyenne du délai de la deuxième arrivée (s) ; null si aucune rotation du lot n'a deux arrivées. */
  meanTravelS: number | null;
}

/** Signature d'une flèche de rotation : l'ancien point puis le nouveau (« C>B »). */
export const flowSignature = (ep: Episode): string => `${ep.point ?? '?'}>${ep.point_to ?? '?'}`;

/**
 * Agrégat des rotations d'un lot d'épisodes (une équipe, une ou plusieurs games) : une flèche par signature, un cercle par point.
 * Temps de présence : estimation, de la deuxième arrivée sur un point (ou de la première s'il n'y en a qu'une) jusqu'au départ lu à la rotation suivante
 * de la même équipe dans la même game, quand celle-ci part bien de ce point ; sinon le séjour n'est pas compté. `measured` faux : aucun séjour mesurable,
 * la taille des cercles retombe sur le nombre d'arrivées.
 */
export function rotationFlow(eps: Episode[]): { nodes: FlowNode[]; arrows: FlowArrow[]; measured: boolean } {
  const arrows = new Map<string, { from: string; to: string; count: number; travel: number[] }>();
  const nodes = new Map<string, FlowNode>();
  const node = (p: string) => nodes.get(p) ?? nodes.set(p, { point: p, seconds: 0, visits: 0 }).get(p)!;
  const sorted = [...eps].filter((e) => e.kind === 'rotation' && e.point && e.point_to).sort((a, b) => a.game_id - b.game_id || a.t0 - b.t0);
  sorted.forEach((e, i) => {
    const from = e.point as string;
    const to = e.point_to as string;
    const info = rotationInfo(e);
    const sig = flowSignature(e);
    const a = arrows.get(sig) ?? { from, to, count: 0, travel: [] };
    a.count += 1;
    if (info.secondArrivalS !== null) a.travel.push(info.secondArrivalS);
    arrows.set(sig, a);
    node(from);
    if (info.arrivals.length > 0) {
      node(to).visits += 1;
      // Séjour : de l'arrivée à la rotation suivante de la même équipe, si elle part de ce point
      const next = sorted.slice(i + 1).find((n) => n.game_id === e.game_id && n.team === e.team);
      if (next && next.point === to) {
        const n = rotationInfo(next);
        const leaves = n.start.flatMap((p) => (p.leaveOffset === null ? [] : [p.leaveOffset])).sort((x, y) => x - y);
        const leaveAt = (n.switchT ?? next.t0) + (leaves.length ? leaves[Math.floor(leaves.length / 2)] : 0);
        const arriveAt = (info.switchT ?? e.t0) + (info.secondArrivalS ?? info.arrivals[0].travelS);
        if (leaveAt > arriveAt) node(to).seconds += leaveAt - arriveAt;
      }
    } else node(to);
  });
  const list = [...nodes.values()].sort((x, y) => x.point.localeCompare(y.point));
  const flows = [...arrows.values()].map((a) => ({ from: a.from, to: a.to, count: a.count, meanTravelS: a.travel.length ? a.travel.reduce((s, x) => s + x, 0) / a.travel.length : null }));
  return { nodes: list, arrows: flows.sort((x, y) => y.count - x.count || x.from.localeCompare(y.from)), measured: list.some((n) => n.seconds > 0) };
}

// ---------------------------------------------------------------- frise du chrono

/** Instant clé d'un épisode (départ de la poussée, ou apparition de la nouvelle boîte) : le lien vers la vidéo l'ouvre 5 s avant. */
export function keyInstant(ep: Episode): number {
  if (isSeries(ep)) return num(Array.isArray(ep.data?.series_t) ? ep.data.series_t[0] : null) ?? ep.t0; // série : le premier kill
  return ep.kind === 'retake' ? (retakeInfo(ep).pushT ?? retakeInfo(ep).changeT ?? ep.t0) : (rotationInfo(ep).switchT ?? ep.t0);
}

/** Temps de vidéo (s) du lien : début de la game plus l'instant (temps de game) moins le délai, sans reculer avant le début de la game. */
export const videoSeek = (gameStartS: number, t: number): number => gameStartS + Math.max(0, t - VIDEO_LEAD_S);

/** Repères de la frise : (instant, libellé) du départ du spawn, du premier kill, de la prise du point ou du changement de point actif. */
export function episodeMarks(ep: Episode): { t: number; label: string }[] {
  if (ep.kind === 'rotation') {
    const t = rotationInfo(ep).switchT;
    return t === null ? [] : [{ t, label: 'Nouveau point actif' }];
  }
  const r = retakeInfo(ep);
  const contact = waveInfo(ep)?.tContact ?? null;
  const marks: { t: number; label: string }[] = [];
  if (r.pushT !== null) marks.push({ t: r.pushT, label: 'Départ' });
  if (contact !== null) marks.push({ t: contact, label: 'Premier kill' });
  if (r.changeT !== null) marks.push({ t: r.changeT, label: 'Prise du point' });
  return marks.sort((a, b) => a.t - b.t);
}

/** Fenêtre de la frise détaillée d'un épisode : `data.window` (5 s de marge de chaque côté) si elle est écrite, sinon les bornes de l'épisode. */
export function windowOf(ep: Pick<Episode, 't0' | 't1' | 'data'>): { t0: number; t1: number } {
  const w = ep.data?.window;
  if (Array.isArray(w) && num(w[0]) !== null && num(w[1]) !== null && (w[1] as number) > (w[0] as number)) return { t0: w[0] as number, t1: w[1] as number };
  return { t0: ep.t0, t1: ep.t1 };
}

/** Position (0 à 100) d'un instant dans la fenêtre de l'épisode, bornée. */
export function pctInWindow(ep: Pick<Episode, 't0' | 't1'>, t: number): number {
  const span = ep.t1 - ep.t0;
  return span <= 0 ? 0 : Math.min(100, Math.max(0, ((t - ep.t0) / span) * 100));
}

export interface BandRow {
  point: string;
  /** `tone` : « a » ou « b » (palette de teamFollow, équipe suivie par nom) ou « none » ; par défaut A donne « a » et B donne « b ». */
  bands: { left: number; width: number; owner: TeamSide | 'none'; tone: Palette | 'none' }[];
}

const defaultTone = (owner: TeamSide | 'none'): Palette | 'none' => (owner === 'A' ? 'a' : owner === 'B' ? 'b' : 'none');

/** Bandes de propriétaire du ou des points de l'épisode (deux lignes pour une rotation), coupées à la fenêtre de l'épisode, en pourcentages. */
export function timelineRows(ep: Episode, owners: PointOwner[], toneOf: (owner: TeamSide | 'none') => Palette | 'none' = defaultTone): BandRow[] {
  const points = [ep.point, ep.point_to].filter((p): p is string => !!p);
  return points.map((point) => ({
    point,
    bands: owners
      .filter((o) => o.game_id === ep.game_id && o.point === point && o.t1 > ep.t0 && o.t0 < ep.t1)
      .map((o) => ({ left: pctInWindow(ep, o.t0), width: pctInWindow(ep, o.t1) - pctInWindow(ep, o.t0), owner: o.owner, tone: toneOf(o.owner) })),
  }));
}

export interface TimelineDeath extends DeathInfo {
  /** Numéro d'ordre dans l'épisode (1 pour la première mort). */
  n: number;
}

/** Morts de l'épisode dans l'ordre du temps, numérotées. */
export function timelineDeaths(ep: Episode): TimelineDeath[] {
  const deaths = ep.kind === 'retake' ? retakeInfo(ep).deaths : rotationInfo(ep).deaths;
  return [...deaths].sort((a, b) => a.t - b.t).map((d, i) => ({ ...d, n: i + 1 }));
}
