// Appels HTTP vers /api/stats/* (voir docs/PLAN_STATS_AGENTS.md, section 2) et petites aides sur leurs réponses. Types dans types/stats.ts.
// Une route pas encore branchée côté serveur répond 501 : StatsUnavailableError, que l'interface affiche comme un message clair.

import { jsonInit, parse } from './analysisApi.ts';
import type { Episode, EpisodeKind, KillLink, Life, PointOwner, PresenceGrid, TeamAggregate } from '../types/stats.ts';

/** La route existe mais le calcul n'est pas encore disponible (réponse 501). */
export class StatsUnavailableError extends Error {
  constructor(message = 'Les statistiques ne sont pas encore disponibles sur le serveur.') {
    super(message);
    this.name = 'StatsUnavailableError';
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 501) throw new StatsUnavailableError();
  return parse<T>(res);
}

const list = (ids: number[]) => ids.join(',');

export interface PresenceQuery {
  map: string;
  games: number[];
  /** Équipe (A ou B) ; absent : les deux. */
  team?: 'A' | 'B';
  /** Joueur (slot 1 à 8) ; absent : tous. */
  slot?: number;
  /** Côté de la grille (64 par défaut côté serveur). */
  n?: number;
}

export const statsApi = {
  lives: (gameId: number) => getJson<Life[]>(`/api/stats/lives?game=${gameId}`),
  links: (gameId: number) => getJson<KillLink[]>(`/api/stats/links?game=${gameId}`),
  owners: (gameId: number) => getJson<PointOwner[]>(`/api/stats/owners?game=${gameId}`),
  presence: async (q: PresenceQuery): Promise<PresenceGrid> => {
    const params = new URLSearchParams({ map: q.map, games: list(q.games) });
    if (q.team) params.set('team', q.team);
    if (q.slot) params.set('slot', String(q.slot));
    if (q.n) params.set('n', String(q.n));
    const res = await getJson<Partial<PresenceGrid>>(`/api/stats/presence?${params}`);
    return { n: res.n ?? q.n ?? 64, games: res.games ?? q.games.length, cells: res.cells ?? [] };
  },
  episodesOfGame: (gameId: number) => getJson<Episode[]>(`/api/stats/episodes?game=${gameId}`),
  episodesOfMap: (map: string, kind: EpisodeKind) => getJson<Episode[]>(`/api/stats/episodes?map=${encodeURIComponent(map)}&kind=${kind}`),
  setVerdict: (id: number, verdict: 'ok' | 'ko' | null) => fetch(`/api/stats/episodes/${id}`, jsonInit('PUT', { verdict })).then(parse<{ ok: true }>),
  teams: (map: string, team: string) => getJson<TeamAggregate>(`/api/stats/teams?map=${encodeURIComponent(map)}&team=${encodeURIComponent(team)}`),
};

/** Écart (s) toléré entre la fin d'une vie (dernière ligne vivante) et le temps d'un lien : le temps du kill n'est pas celui de la dernière ligne. */
export const LINK_TOL_S = 2;
/** Délai (s) dans lequel un coéquipier venge une victime (définition figée du revenge). */
export const REVENGE_S = 5;

export interface DeathLinks {
  /** Mort croisée : le tueur est mort presque en même temps. */
  trade: KillLink | null;
  /** Cette mort a été vengée : un coéquipier a tué le tueur dans les 5 s qui suivent. */
  avengedBy: KillLink | null;
  /** Cette mort est elle-même une vengeance : le joueur tué venait de tuer un coéquipier de son tueur (`other_slot`). */
  revengeKill: KillLink | null;
}

/**
 * Liens d'une mort, retrouvés dans les lignes de `kill_links` de la même game (une seule game à la fois dans `links`, ou filtrée ici sur game_id).
 * trade : ligne du joueur mort ; revenge : la ligne est portée par le kill vengeur (`victim_slot` = tueur vengé, `other_slot` = joueur vengé).
 */
export function linksOfDeath(life: Life, links: KillLink[]): DeathLinks {
  const none: DeathLinks = { trade: null, avengedBy: null, revengeKill: null };
  if (life.ended !== 'death') return none;
  const mine = links.filter((l) => l.game_id === life.game_id);
  const close = (l: KillLink) => Math.abs(l.t - life.t1) <= LINK_TOL_S;
  return {
    trade: mine.find((l) => l.kind === 'trade' && l.victim_slot === life.slot && close(l)) ?? null,
    avengedBy: mine.find((l) => l.kind === 'revenge' && l.other_slot === life.slot && l.t >= life.t1 - 1 && l.t <= life.t1 + REVENGE_S + LINK_TOL_S) ?? null,
    revengeKill: mine.find((l) => l.kind === 'revenge' && l.victim_slot === life.slot && close(l)) ?? null,
  };
}
