// Sélecteur d'étage de la carte active (1 à MAX_FLOORS niveaux).
// Permet d'ajouter, sélectionner et supprimer un étage, et d'afficher les
// autres étages en calque grisé de référence (pelure d'oignon).

import { useMapStore } from '../store/mapStore';
import { MAX_FLOORS } from '../types/map';

export function FloorSelector() {
  const map = useMapStore((s) => s.getActiveMap());
  const activeFloorLevel = useMapStore((s) => s.activeFloorLevel);
  const setActiveFloor = useMapStore((s) => s.setActiveFloor);
  const addFloor = useMapStore((s) => s.addFloor);
  const removeFloor = useMapStore((s) => s.removeFloor);
  const showOtherFloors = useMapStore((s) => s.showOtherFloors);
  const toggleOtherFloors = useMapStore((s) => s.toggleOtherFloors);

  if (!map) return null;

  const floors = map.floors.slice().sort((a, b) => a.level - b.level);

  const handleRemove = (level: number) => {
    const floor = floors.find((f) => f.level === level);
    const hasShapes = (floor?.shapes.length ?? 0) > 0;
    if (hasShapes && !window.confirm(`Supprimer l'étage ${level + 1} et ses dessins ?`)) {
      return;
    }
    removeFloor(map.id, level);
  };

  return (
    <div className="floor-selector">
      <span className="floor-selector__label">Étage :</span>
      {floors.map((floor) => (
        <span key={floor.id} className="floor-selector__item">
          <button
            className={floor.level === activeFloorLevel ? 'is-active' : ''}
            onClick={() => setActiveFloor(floor.level)}
          >
            {floor.level + 1}
          </button>
          {floors.length > 1 && (
            <button
              className="floor-selector__remove"
              title={`Supprimer l'étage ${floor.level + 1}`}
              onClick={() => handleRemove(floor.level)}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {map.floors.length < MAX_FLOORS && (
        <button className="floor-selector__add" onClick={() => addFloor(map.id)}>
          + étage
        </button>
      )}

      <label className="floor-selector__ghost-toggle">
        <input
          type="checkbox"
          checked={showOtherFloors}
          onChange={toggleOtherFloors}
        />
        Voir les autres étages
      </label>
    </div>
  );
}
