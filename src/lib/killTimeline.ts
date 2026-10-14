// Kills sur la frise zoomée d'une game : rangée de chaque kill, sous-rangées pour qu'ils ne se chevauchent pas, texte de l'infobulle
// et instant où placer la vidéo. Les temps des kills (Kill.t) sont des temps de la vidéo, comme start_s et end_s de la game.

import type { Kill } from '../types/analysis';
import { formatTime } from './timeline.ts';

/** Avance (s) prise sur un kill quand on clique dessus : la vidéo démarre 5 s avant pour voir l'action qui y mène. */
export const KILL_LEAD_S = 5;

/** Écart minimal (pixels) entre deux marqueurs d'une même sous-rangée : tête de mort de 16 px, plus la pastille du nombre de kills
 *  qui dépasse de 4 px à droite. Garder en accord avec .timeline__kill et .timeline__kill-count (analysis-timeline.css). */
export const KILL_MARK_PX = 20;

/** Sous-rangées au plus par rangée ; au-delà, un kill trop proche est regroupé avec le marqueur voisin (son nombre s'affiche). */
export const KILL_MAX_LANES = 3;

/** Rangée d'un kill : équipe du tueur (A orange, joueurs 1 à 4 ; B bleue, 5 à 8) ou neutre (suicide, décor, tueur inconnu). */
export type KillRow = 'A' | 'B' | 'neutral';

/** Marqueur posé sur une sous-rangée : un ou plusieurs kills (regroupés), placé à l'instant du premier. */
export interface KillMarker {
  t: number;
  lane: number;
  kills: Kill[];
}

/** Numéro affiché d'un joueur : 1 à 4 pour l'équipe orange, 6 à 9 pour la bleue (comme en jeu). */
export const numberOfSlot = (slot: number) => (slot <= 4 ? slot : slot + 1);

/** Le kill n'a pas d'équipe tueuse sûre : suicide, mort du décor, tueur non lu. Un tueur déduit (inferred) garde son équipe. */
export function isNeutralKill(k: Kill): boolean {
  return k.killer === null || k.killer === k.victim || k.kind === 'suicide' || k.kind === 'environment' || k.kind === 'unknown';
}

export function killRow(k: Kill): KillRow {
  if (isNeutralKill(k) || k.killer === null) return 'neutral';
  return k.killer <= 4 ? 'A' : 'B';
}

/** Instant où placer la vidéo pour un kill : KILL_LEAD_S avant, sans sortir de la game. */
export function killSeekTime(k: Kill, gameStart: number): number {
  return Math.max(gameStart, k.t - KILL_LEAD_S);
}

/** Range des kills en sous-rangées : dans une sous-rangée, deux marqueurs sont séparés d'au moins minGap secondes.
 *  Quand toutes les sous-rangées sont prises, le kill rejoint le marqueur posé le plus récemment (regroupement). */
export function stackKills(kills: Kill[], minGap: number, maxLanes = KILL_MAX_LANES): KillMarker[] {
  const markers: KillMarker[] = [];
  const laneEnd: number[] = []; // instant du dernier marqueur de chaque sous-rangée
  for (const k of [...kills].sort((a, b) => a.t - b.t)) {
    const free = laneEnd.findIndex((t) => k.t - t >= minGap);
    const lane = free >= 0 ? free : laneEnd.length < maxLanes ? laneEnd.length : -1;
    if (lane >= 0) {
      laneEnd[lane] = k.t;
      markers.push({ t: k.t, lane, kills: [k] });
    } else {
      markers[markers.length - 1].kills.push(k);
    }
  }
  return markers;
}

/** Nombre de sous-rangées utilisées (au moins 1, pour garder la hauteur de la rangée). */
export function laneCount(markers: KillMarker[]): number {
  return Math.max(1, ...markers.map((m) => m.lane + 1));
}

/** État des kills d'une game pour la frise : affichés, ou pourquoi il n'y en a pas. */
export type KillsStatus = 'shown' | 'not-analysed' | 'not-read' | 'none';

/** Message affiché à la place des kills quand la game n'en a aucun. */
export const KILLS_STATUS_TEXT: Record<Exclude<KillsStatus, 'shown'>, string> = {
  'not-analysed': 'Analyse détaillée non faite pour cette game',
  'not-read': 'Kills non lus : relance l’analyse de cette game',
  none: 'Aucun kill détecté',
};

/** Pourquoi une game n'a pas de kill à montrer. killsRead : killfeed lu (kills_meta) ; une game sans killfeed lu, sans capture
 *  ni position n'a jamais eu d'analyse détaillée ; avec l'une des deux, l'analyse a commencé mais les kills manquent. */
export function killsStatus(game: { killsRead: boolean; captureRead: boolean; samples: number; kills: { t: number }[]; start_s: number; end_s: number }): KillsStatus {
  if (game.kills.some((k) => k.t >= game.start_s && k.t <= game.end_s)) return 'shown';
  if (game.killsRead) return 'none';
  return game.captureRead || game.samples > 0 ? 'not-read' : 'not-analysed';
}

/** Nom de l'arme d'un kill : équipement réel, sinon nom de l'icône, sinon ce qu'on sait. */
function weaponLabel(k: Kill): string {
  return k.stuff ?? k.weaponName ?? (k.weapon ? 'arme non nommée' : 'arme inconnue');
}

/** Une ligne de l'infobulle : instant dans la game, tueur, victime, arme. */
export function killLabel(k: Kill, gameStart: number, nameOf: (slot: number) => string | undefined): string {
  const who = (slot: number) => nameOf(slot) ?? `n° ${numberOfSlot(slot)}`;
  const at = formatTime(k.t - gameStart);
  const hs = k.headshot ? ', headshot' : '';
  if (k.kind === 'environment') return `${at} : ${who(k.victim)} mort du décor`;
  if (k.killer === null) return `${at} : ${who(k.victim)} tué, tueur non lu (${weaponLabel(k)}${hs})`;
  if (k.killer === k.victim || k.kind === 'suicide') return `${at} : ${who(k.victim)} suicide (${weaponLabel(k)})`;
  const inferred = k.kind === 'inferred' ? ' (tueur déduit, pseudo non lu)' : '';
  return `${at} : ${who(k.killer)}${inferred} tue ${who(k.victim)} (${weaponLabel(k)}${hs})`;
}
