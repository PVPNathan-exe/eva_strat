// Chargement des données de l'onglet Stats : games de la base, vies et liens, lignes de suivi, présence.
// Chaque chargement a une clé : le résultat n'est montré que s'il correspond à la clé demandée (pas de setState synchrone dans l'effet).

import { useEffect, useRef, useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { toGameTime } from '../../lib/pathCut';
import { statsApi, StatsUnavailableError, type PresenceQuery } from '../../lib/statsApi';
import type { Game, Sample } from '../../types/analysis';
import { parseHex, type Rgb } from '../../lib/heatGrid';
import type { StatsFilterState } from './StatsFilters';
import type { KillLink, Life, PresenceGrid, TeamSide } from '../../types/stats';

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  /** Message d'erreur (null si tout va bien). */
  error: string | null;
  /** Le serveur répond 501 : la route n'est pas encore branchée. */
  unavailable: boolean;
}

interface Done<T> {
  key: string;
  data: T | null;
  error: string | null;
  unavailable: boolean;
}

/** Charge `load()` quand `key` change (key null : rien à charger). Un résultat périmé est ignoré. */
export function useLoad<T>(key: string | null, load: () => Promise<T>): Loaded<T> {
  const [done, setDone] = useState<Done<T> | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    loadRef
      .current()
      .then((data) => !cancelled && setDone({ key, data, error: null, unavailable: false }))
      .catch((e: unknown) => !cancelled && setDone({ key, data: null, error: e instanceof Error ? e.message : String(e), unavailable: e instanceof StatsUnavailableError }));
    return () => {
      cancelled = true;
    };
  }, [key]);
  if (key === null) return { data: null, loading: false, error: null, unavailable: false };
  if (!done || done.key !== key) return { data: null, loading: true, error: null, unavailable: false };
  return { data: done.data, loading: false, error: done.error, unavailable: done.unavailable };
}

/** Une game de la base, réduite à ce que les filtres de Stats utilisent. */
export interface StatsGame {
  id: number;
  videoId: number;
  map: string;
  teamA: string | null;
  teamB: string | null;
  startS: number;
  players: Game['players'];
}

/** Toutes les games dont la carte est connue et dont les positions sont lues, toutes vidéos confondues. */
export function useStatsGames(): Loaded<StatsGame[]> {
  return useLoad('games', async () => {
    const videos = await analysisApi.videos();
    const perVideo = await Promise.all(videos.map((v) => analysisApi.games(v.id)));
    return perVideo
      .flat()
      .filter((g) => g.map && g.samples > 0)
      .map((g) => ({ id: g.id, videoId: g.video_id, map: g.map as string, teamA: g.team_a, teamB: g.team_b, startS: g.start_s, players: g.players }))
      .sort((a, b) => a.videoId - b.videoId || a.startS - b.startS);
  });
}

export interface LivesAndLinks {
  lives: Life[];
  links: KillLink[];
}

/** Vies et liens de kills des games demandées (une requête par game). */
export function useLivesAndLinks(gameIds: number[]): Loaded<LivesAndLinks> {
  const key = gameIds.length ? `lives:${gameIds.join(',')}` : null;
  return useLoad(key, async () => {
    const perGame = await Promise.all(gameIds.map(async (id) => ({ lives: await statsApi.lives(id), links: await statsApi.links(id) })));
    return { lives: perGame.flatMap((g) => g.lives), links: perGame.flatMap((g) => g.links) };
  });
}

/** Lignes de suivi des games demandées (pour dessiner les trajets), par game, converties en temps de game. `enabled` faux : rien n'est chargé. */
export function useSamples(games: StatsGame[], enabled: boolean): Loaded<Map<number, Sample[]>> {
  const key = enabled && games.length ? `samples:${games.map((g) => g.id).join(',')}` : null;
  return useLoad(key, async () => {
    // Temps de game (comme les vies), pas de vidéo
    const entries = await Promise.all(games.map(async (g) => [g.id, toGameTime(await analysisApi.samples(g.id), g.startS)] as const));
    return new Map(entries);
  });
}

/** Grille de présence agrégée par le serveur ; query null : rien à charger. */
export function usePresence(query: PresenceQuery | null): Loaded<PresenceGrid> {
  const key = query && query.games.length ? `presence:${query.map}:${query.games.join(',')}:${query.team ?? ''}:${query.slot ?? ''}:${query.n ?? ''}` : null;
  return useLoad(key, () => statsApi.presence(query as PresenceQuery));
}

/** Slots d'une équipe : 1 à 4 pour l'orange (A), 5 à 8 pour la bleue (B). */
export const slotsOfTeam = (team: TeamSide): number[] => (team === 'A' ? [1, 2, 3, 4] : [5, 6, 7, 8]);

/** Filtre sur l'équipe et le joueur : team 'all' garde les deux ; slot 0 garde tous les joueurs. */
export function filterBySlot<T extends { slot: number }>(rows: T[], team: TeamSide | 'all', slot: number): T[] {
  return rows.filter((r) => (team === 'all' || (r.slot <= 4) === (team === 'A')) && (slot === 0 || r.slot === slot));
}

/** Message à afficher à la place de la vue tant que les données ne sont pas prêtes : chargement, route pas encore branchée (501) ou erreur. null : tout est prêt. */
export function noticeOf(...loaded: Loaded<unknown>[]): string | null {
  const unavailable = loaded.find((l) => l.unavailable);
  if (unavailable) return unavailable.error ?? 'Les statistiques ne sont pas encore disponibles sur le serveur.';
  const failed = loaded.find((l) => l.error);
  if (failed) return `Lecture impossible : ${failed.error}`;
  if (loaded.some((l) => l.loading)) return 'Chargement…';
  return null;
}

export const INITIAL_FILTERS: StatsFilterState = { map: null, excluded: [], team: 'all', slot: 0 };

/** Cartes qui ont des games (positions lues, voir useStatsGames), avec leur nombre de games ; la plus fournie en premier. */
export function mapsOf(games: StatsGame[]): [string, number][] {
  const count = new Map<string, number>();
  for (const g of games) count.set(g.map, (count.get(g.map) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); // la carte qui a le plus de games d'abord
}

/** Nom d'une game dans les listes : numéro et équipes si elles sont connues. */
export const gameLabel = (g: StatsGame): string => `Game ${g.id}${g.teamA || g.teamB ? ` : ${g.teamA ?? '?'} contre ${g.teamB ?? '?'}` : ''}`;

/** Couleur d'un jeton de tokens.css (« --c-... ») lue dans la page, ou `fallback` si elle n'est pas au format #rrggbb. */
export function tokenRgb(name: string, fallback: Rgb): Rgb {
  return parseHex(getComputedStyle(document.documentElement).getPropertyValue(name)) ?? fallback;
}
