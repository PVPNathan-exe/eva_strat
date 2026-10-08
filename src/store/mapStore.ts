// État global de l'app + persistance auto dans localStorage (middleware persist).
// Les cartes sont sauvegardées automatiquement à chaque modification, donc tu
// ne refais pas tes murs/étages à chaque visite. Les états d'UI éphémères
// (outil actif, sélection...) ne sont volontairement PAS persistés.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  createEmptyFloor,
  createEmptyMap,
  MAX_FLOORS,
  type MapConfig,
  type Shape,
  type Tool,
} from '../types/map';

interface MapState {
  maps: MapConfig[];
  activeMapId: string | null;
  activeFloorLevel: number;

  // --- UI de dessin (éphémère) ---
  activeTool: Tool;
  strokeColor: string;
  strokeWidth: number;
  selectedShapeId: string | null;
  showOtherFloors: boolean; // calque grisé de référence (pelure d'oignon)

  // --- Module armes (éphémère) ---
  selectedStuffName: string | null; // arme/secondaire choisi dans le panneau
  // Armes posées sur la carte (plusieurs possibles pour comparer leurs portées).
  placedStuffs: { id: string; name: string; x: number; y: number }[];

  // --- Cartes ---
  addMap: (name: string) => void;
  removeMap: (id: string) => void;
  setActiveMap: (id: string) => void;
  upsertMap: (map: MapConfig) => void; // utilisé par l'import JSON
  setBackground: (mapId: string, dataUrl: string) => void;
  setMapScale: (mapId: string, pixelsPerMeter: number | null) => void;

  // --- Étages ---
  setActiveFloor: (level: number) => void;
  addFloor: (mapId: string) => void;
  removeFloor: (mapId: string, level: number) => void;

  // --- Outils de dessin ---
  setActiveTool: (tool: Tool) => void;
  setStrokeColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setSelectedShape: (id: string | null) => void;
  toggleOtherFloors: () => void;

  // --- Module armes ---
  selectStuff: (name: string | null) => void;
  placeStuff: (x: number, y: number) => void;
  movePlacedStuff: (id: string, x: number, y: number) => void;
  removePlacedStuff: (id: string) => void;
  clearPlacedStuff: () => void;

  // --- Formes ---
  addShape: (mapId: string, level: number, shape: Shape) => void;
  updateShape: (mapId: string, level: number, shape: Shape) => void;
  removeShape: (mapId: string, level: number, shapeId: string) => void;
  clearShapes: (mapId: string, level: number) => void;

  // Helpers de lecture
  getActiveMap: () => MapConfig | null;
}

/** Applique une transformation aux formes d'un étage précis. */
function mapFloorShapes(
  maps: MapConfig[],
  mapId: string,
  level: number,
  fn: (shapes: Shape[]) => Shape[],
): MapConfig[] {
  return maps.map((m) =>
    m.id === mapId
      ? {
          ...m,
          floors: m.floors.map((f) =>
            f.level === level ? { ...f, shapes: fn(f.shapes) } : f,
          ),
        }
      : m,
  );
}

export const useMapStore = create<MapState>()(
  persist(
    (set, get) => ({
      maps: [],
      activeMapId: null,
      activeFloorLevel: 0,

      activeTool: 'select',
      strokeColor: '#ff3b3b',
      strokeWidth: 3,
      selectedShapeId: null,
      showOtherFloors: false,
      selectedStuffName: null,
      placedStuffs: [],

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

      setActiveMap: (id) =>
        set({ activeMapId: id, activeFloorLevel: 0, selectedShapeId: null }),

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

      setMapScale: (mapId, pixelsPerMeter) =>
        set((state) => ({
          maps: state.maps.map((m) =>
            m.id === mapId ? { ...m, pixelsPerMeter } : m,
          ),
        })),

      setActiveFloor: (level) =>
        set({ activeFloorLevel: level, selectedShapeId: null }),

      addFloor: (mapId) =>
        set((state) => ({
          maps: state.maps.map((m) => {
            if (m.id !== mapId || m.floors.length >= MAX_FLOORS) return m;
            const nextLevel = m.floors.length;
            return { ...m, floors: [...m.floors, createEmptyFloor(nextLevel)] };
          }),
        })),

      // Supprime un étage et renumérote les étages restants pour qu'ils
      // restent contigus (0, 1, 2…) : le bouton « + étage » se base sur le
      // nombre d'étages pour le niveau suivant. On garde toujours ≥ 1 étage.
      removeFloor: (mapId, level) =>
        set((state) => {
          const target = state.maps.find((m) => m.id === mapId);
          if (!target || target.floors.length <= 1) return state;

          const maps = state.maps.map((m) => {
            if (m.id !== mapId) return m;
            const floors = m.floors
              .filter((f) => f.level !== level)
              .sort((a, b) => a.level - b.level)
              .map((f, i) => ({ ...f, level: i }));
            return { ...m, floors };
          });

          const newCount = target.floors.length - 1;
          const activeFloorLevel =
            state.activeMapId === mapId
              ? Math.min(state.activeFloorLevel, newCount - 1)
              : state.activeFloorLevel;

          return { maps, activeFloorLevel, selectedShapeId: null };
        }),

      setActiveTool: (tool) => set({ activeTool: tool, selectedShapeId: null }),
      setStrokeColor: (color) => set({ strokeColor: color }),
      setStrokeWidth: (width) => set({ strokeWidth: width }),
      setSelectedShape: (id) => set({ selectedShapeId: id }),
      toggleOtherFloors: () =>
        set((state) => ({ showOtherFloors: !state.showOtherFloors })),

      selectStuff: (name) => set({ selectedStuffName: name }),
      placeStuff: (x, y) =>
        set((state) => {
          const name = state.selectedStuffName;
          if (!name) return state;
          // Même arme déjà posée => on la déplace ; sinon on ajoute.
          const exists = state.placedStuffs.some((p) => p.name === name);
          if (exists) {
            return {
              placedStuffs: state.placedStuffs.map((p) =>
                p.name === name ? { ...p, x, y } : p,
              ),
            };
          }
          return {
            placedStuffs: [
              ...state.placedStuffs,
              { id: crypto.randomUUID(), name, x, y },
            ],
          };
        }),
      movePlacedStuff: (id, x, y) =>
        set((state) => ({
          placedStuffs: state.placedStuffs.map((p) => (p.id === id ? { ...p, x, y } : p)),
        })),
      removePlacedStuff: (id) =>
        set((state) => ({
          placedStuffs: state.placedStuffs.filter((p) => p.id !== id),
        })),
      clearPlacedStuff: () => set({ placedStuffs: [] }),

      addShape: (mapId, level, shape) =>
        set((state) => ({
          maps: mapFloorShapes(state.maps, mapId, level, (shapes) => [
            ...shapes,
            shape,
          ]),
        })),

      updateShape: (mapId, level, shape) =>
        set((state) => ({
          maps: mapFloorShapes(state.maps, mapId, level, (shapes) =>
            shapes.map((s) => (s.id === shape.id ? shape : s)),
          ),
        })),

      removeShape: (mapId, level, shapeId) =>
        set((state) => ({
          maps: mapFloorShapes(state.maps, mapId, level, (shapes) =>
            shapes.filter((s) => s.id !== shapeId),
          ),
          selectedShapeId:
            state.selectedShapeId === shapeId ? null : state.selectedShapeId,
        })),

      clearShapes: (mapId, level) =>
        set((state) => ({
          maps: mapFloorShapes(state.maps, mapId, level, () => []),
          selectedShapeId: null,
        })),

      getActiveMap: () => {
        const { maps, activeMapId } = get();
        return maps.find((m) => m.id === activeMapId) ?? null;
      },
    }),
    {
      name: 'eva_strat:maps',
      // Incrémenté pour repartir d'un état vierge : à la montée de version,
      // `migrate` ignore les données précédentes (reset des cartes sauvegardées).
      // v2 : purge les cartes corrompues par l'ancien bug d'écrasement de fond.
      version: 2,
      migrate: () => ({ maps: [], activeMapId: null, activeFloorLevel: 0 }),
      // On ne persiste que les données de cartes, pas l'état d'UI.
      partialize: (state) => ({
        maps: state.maps,
        activeMapId: state.activeMapId,
        activeFloorLevel: state.activeFloorLevel,
      }),
    },
  ),
);
