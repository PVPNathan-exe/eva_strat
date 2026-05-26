// État global de l'app + persistance auto dans localStorage (middleware persist).
// Les cartes sont sauvegardées automatiquement à chaque modification, donc tu
// ne refais pas tes murs/étages à chaque visite.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  createEmptyFloor,
  createEmptyMap,
  MAX_FLOORS,
  type MapConfig,
  type Wall,
} from '../types/map';

interface MapState {
  maps: MapConfig[];
  activeMapId: string | null;
  activeFloorLevel: number;

  // --- Cartes ---
  addMap: (name: string) => void;
  removeMap: (id: string) => void;
  setActiveMap: (id: string) => void;
  upsertMap: (map: MapConfig) => void; // utilisé par l'import JSON
  setBackground: (mapId: string, dataUrl: string) => void;

  // --- Étages ---
  setActiveFloor: (level: number) => void;
  addFloor: (mapId: string) => void;

  // --- Murs (stub : la vraie UI de dessin viendra plus tard) ---
  addWall: (mapId: string, level: number, wall: Wall) => void;

  // Helpers de lecture
  getActiveMap: () => MapConfig | null;
}

export const useMapStore = create<MapState>()(
  persist(
    (set, get) => ({
      maps: [],
      activeMapId: null,
      activeFloorLevel: 0,

      addMap: (name) =>
        set((state) => {
          const map = createEmptyMap(name);
          return {
            maps: [...state.maps, map],
            activeMapId: map.id,
            activeFloorLevel: 0,
          };
        }),

      removeMap: (id) =>
        set((state) => {
          const maps = state.maps.filter((m) => m.id !== id);
          return {
            maps,
            activeMapId:
              state.activeMapId === id ? (maps[0]?.id ?? null) : state.activeMapId,
          };
        }),

      setActiveMap: (id) => set({ activeMapId: id, activeFloorLevel: 0 }),

      upsertMap: (map) =>
        set((state) => {
          const exists = state.maps.some((m) => m.id === map.id);
          return {
            maps: exists
              ? state.maps.map((m) => (m.id === map.id ? map : m))
              : [...state.maps, map],
            activeMapId: map.id,
          };
        }),

      setBackground: (mapId, dataUrl) =>
        set((state) => ({
          maps: state.maps.map((m) =>
            m.id === mapId ? { ...m, backgroundImage: dataUrl } : m,
          ),
        })),

      setActiveFloor: (level) => set({ activeFloorLevel: level }),

      addFloor: (mapId) =>
        set((state) => ({
          maps: state.maps.map((m) => {
            if (m.id !== mapId || m.floors.length >= MAX_FLOORS) return m;
            const nextLevel = m.floors.length;
            return { ...m, floors: [...m.floors, createEmptyFloor(nextLevel)] };
          }),
        })),

      addWall: (mapId, level, wall) =>
        set((state) => ({
          maps: state.maps.map((m) =>
            m.id === mapId
              ? {
                  ...m,
                  floors: m.floors.map((f) =>
                    f.level === level ? { ...f, walls: [...f.walls, wall] } : f,
                  ),
                }
              : m,
          ),
        })),

      getActiveMap: () => {
        const { maps, activeMapId } = get();
        return maps.find((m) => m.id === activeMapId) ?? null;
      },
    }),
    {
      name: 'eva_strat:maps',
    },
  ),
);
