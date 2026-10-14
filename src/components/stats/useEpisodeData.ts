// Données de la chronologie des vues Retakes et Rotations pour la game rejouée : propriétaires des points, périodes du point actif, positions des joueurs (index pour le curseur).
// Les propriétaires et le point actif sont facultatifs : si une route manque (ancien serveur), la frise s'affiche sans bandes. Les positions viennent de useSamples (temps de game).

import { useMemo } from 'react';
import { indexSamples, type SlotTrack } from '../../lib/episodeClock';
import { statsApi } from '../../lib/statsApi';
import type { PointActive, PointOwner } from '../../types/stats';
import { useLoad, useSamples, type Loaded, type StatsGame } from './useStats';

const NO_OWNERS: PointOwner[] = [];
const NO_ACTIVE: PointActive[] = [];

export interface StripData {
  owners: PointOwner[];
  active: PointActive[];
  loading: boolean;
}

/** Propriétaires et périodes actives des points de la game (listes vides tant que le chargement n'est pas fini ou si la route manque). */
export function useStripData(gameId: number): StripData {
  const owners = useLoad(`ep-owners:${gameId}`, () => statsApi.owners(gameId));
  const active = useLoad(`ep-active:${gameId}`, () => statsApi.active(gameId));
  return { owners: owners.data ?? NO_OWNERS, active: active.data ?? NO_ACTIVE, loading: owners.loading || active.loading };
}

/** Positions des joueurs vivants de la game, indexées par joueur pour retrouver les pions à l'instant du curseur (positionsAt). */
export function useReplayIndex(game: StatsGame): { index: Map<number, SlotTrack>; load: Loaded<unknown> } {
  const games = useMemo(() => [game], [game]);
  const load = useSamples(games, true);
  const samples = load.data?.get(game.id);
  const index = useMemo(() => indexSamples(samples ?? []), [samples]);
  return { index, load };
}
