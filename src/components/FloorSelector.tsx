// Sélecteur d'étage de la carte active (1 à MAX_FLOORS niveaux).

import { useMapStore } from '../store/mapStore';
import { MAX_FLOORS } from '../types/map';

export function FloorSelector() {
  const map = useMapStore((s) => s.getActiveMap());
  const activeFloorLevel = useMapStore((s) => s.activeFloorLevel);
  const setActiveFloor = useMapStore((s) => s.setActiveFloor);
  const addFloor = useMapStore((s) => s.addFloor);

  if (!map) return null;

  return (
    <div className="floor-selector">
      <span className="floor-selector__label">Étage :</span>
      {map.floors
        .slice()
        .sort((a, b) => a.level - b.level)
        .map((floor) => (
          <button
            key={floor.id}
            className={floor.level === activeFloorLevel ? 'is-active' : ''}
            onClick={() => setActiveFloor(floor.level)}
          >
            {floor.level + 1}
          </button>
        ))}
      {map.floors.length < MAX_FLOORS && (
        <button className="floor-selector__add" onClick={() => addFloor(map.id)}>
          + étage
        </button>
      )}
    </div>
  );
}
