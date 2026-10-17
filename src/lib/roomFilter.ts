// Filtre « salle » des vues Stats : une vidéo intersalle est jouée avec chaque équipe dans sa propre salle ; sinon les deux équipes sont dans la même arène.
// Le gameplay diffère (les joueurs courent plus et plus vite en intersalle), donc les statistiques peuvent être séparées.

export type RoomFilter = 'all' | 'inter' | 'same';

export const ROOM_LABEL: Record<RoomFilter, string> = { all: 'Toutes', inter: 'Intersalle', same: 'Même salle' };

/** Garde les games du contexte demandé (toutes si `room` vaut « all »). */
export function filterByRoom<T extends { intersalle: boolean }>(games: T[], room: RoomFilter): T[] {
  if (room === 'all') return games;
  return games.filter((g) => g.intersalle === (room === 'inter'));
}
