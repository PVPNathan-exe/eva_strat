// Séries de 3 ou 4 kills autour d'un point (épisodes `retake` dont l'issue commence par series_, module analysis/kill_series.py) : lecture prudente du champ `data` et phrases d'aide.
// QUESTION OUVERTE posée à l'utilisateur : quelle équipe est « la tueuse » ? Le calcul garde l'issue de la lecture « victim » par défaut (constante kill_series.SERIES_VIEW)
// et écrit aussi l'issue de l'autre lecture dans `data.outcome_by_view` : l'interface montre les deux sans trancher.

import type { Episode, TeamSide } from '../types/stats.ts';
import { outcomeInfo } from './episodeFormat.ts';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const metres = (v: number): string => `${v.toFixed(1).replace('.', ',')} m`;
const side = (v: unknown): TeamSide | null => (v === 'A' || v === 'B' ? v : null);

export interface SeriesInfo {
  /** Premier et dernier kill de la série (s depuis le début de la game). */
  seriesT: [number, number] | null;
  killerTeam: TeamSide | null;
  victimTeam: TeamSide | null;
  holderTeam: TeamSide | null;
  changedHands: boolean;
  /** Lecture écrite dans `outcome` et `team` (kill_series.SERIES_VIEW) : « victim » par défaut. */
  view: string | null;
  /** Issue selon chaque lecture de l'attribution, absente des anciens calculs. */
  outcomeByView: { victim: string | null; killer: string | null };
  /** Kills de la série dans l'ordre du temps. */
  kills: { t: number; killer: number | null; victim: number | null; weapon: string | null }[];
  /** Victimes distinctes de la série. */
  victims: number;
  /** Équipe adverse (celle qui n'est pas `team`) : décalage de son centre 5 s et 10 s après le dernier kill (m) et joueurs près du point à la fin. */
  reposition: { shift5: number | null; shift10: number | null; near: number | null } | null;
}

/** Champ `data` d'une série de kills, lu avec prudence (un champ absent ou mal formé devient null). */
export function seriesInfo(ep: Episode): SeriesInfo {
  const d = ep.data ?? {};
  const st = Array.isArray(d.series_t) && num(d.series_t[0]) !== null && num(d.series_t[1]) !== null ? ([d.series_t[0], d.series_t[1]] as [number, number]) : null;
  const by = isObj(d.outcome_by_view) ? d.outcome_by_view : {};
  const adverse = side(d.adverse_team);
  const rep = isObj(d.reposition) && adverse && isObj(d.reposition[adverse]) ? (d.reposition[adverse] as Record<string, unknown>) : null;
  const kills = Array.isArray(d.kills) ? d.kills.filter(isObj) : [];
  const list = kills.flatMap((k) => (num(k.t) === null ? [] : [{ t: num(k.t) as number, killer: num(k.killer), victim: num(k.victim), weapon: typeof k.weapon === 'string' ? k.weapon : null }])).sort((a, b) => a.t - b.t);
  const victims = new Set(list.flatMap((k) => (k.victim === null ? [] : [k.victim])));
  return {
    seriesT: st,
    killerTeam: side(d.killer_team),
    victimTeam: side(d.victim_team),
    holderTeam: side(d.holder_team),
    changedHands: d.changed_hands === true,
    view: typeof d.view === 'string' ? d.view : null,
    outcomeByView: { victim: typeof by.victim === 'string' ? by.victim : null, killer: typeof by.killer === 'string' ? by.killer : null },
    kills: list,
    victims: victims.size,
    reposition: rep ? { shift5: num(rep.shift_5_m), shift10: num(rep.shift_10_m), near: num(rep.near_point_end) } : null,
  };
}

/** Phrase sur l'issue d'une série selon les deux lectures de l'attribution, sans choisir : « lecture victime : ..., lecture tueur : ... ». null si le calcul n'a pas écrit les deux. */
export function viewsSentence(info: SeriesInfo): string | null {
  const { victim, killer } = info.outcomeByView;
  if (!victim && !killer) return null;
  const label = (o: string | null) => (o ? outcomeInfo(o).label : 'non écrite');
  return `lecture « victime » : ${label(victim)} ; lecture « tueur » : ${label(killer)}`;
}

/** Repositionnement de l'équipe adverse après la série : « 2,3 m à 5 s, 3,8 m à 10 s, 1 joueur près du point ». null si non calculé. */
export function repositionSentence(info: SeriesInfo): string | null {
  const r = info.reposition;
  if (!r) return null;
  const parts: string[] = [];
  if (r.shift5 !== null) parts.push(`centre déplacé de ${metres(r.shift5)} 5 s après`);
  if (r.shift10 !== null) parts.push(`${metres(r.shift10)} 10 s après`);
  if (r.near !== null) parts.push(`${r.near} joueur${r.near > 1 ? 's' : ''} près du point à la fin`);
  return parts.length ? parts.join(', ') : null;
}
