// Barre d'outils de dessin : choix de l'outil, couleur, épaisseur du trait,
// effacer la forme sélectionnée ou tout l'étage.

import { useMapStore } from '../store/mapStore';
import type { Tool } from '../types/map';

const TOOLS: { id: Tool; label: string; title: string }[] = [
  { id: 'select', label: '⬚ Sélection', title: 'Sélectionner / déplacer (Suppr pour effacer)' },
  { id: 'line', label: '╱ Ligne', title: 'Tracer une ligne droite' },
  { id: 'rect', label: '▭ Rectangle', title: 'Dessiner un rectangle' },
  { id: 'ellipse', label: '◯ Cercle', title: 'Dessiner un cercle / une ellipse' },
  { id: 'pen', label: '✎ Crayon', title: 'Tracé libre' },
];

export function DrawToolbar() {
  const map = useMapStore((s) => s.getActiveMap());
  const level = useMapStore((s) => s.activeFloorLevel);
  const activeTool = useMapStore((s) => s.activeTool);
  const strokeColor = useMapStore((s) => s.strokeColor);
  const strokeWidth = useMapStore((s) => s.strokeWidth);
  const selectedShapeId = useMapStore((s) => s.selectedShapeId);
  const setActiveTool = useMapStore((s) => s.setActiveTool);
  const setStrokeColor = useMapStore((s) => s.setStrokeColor);
  const setStrokeWidth = useMapStore((s) => s.setStrokeWidth);
  const removeShape = useMapStore((s) => s.removeShape);
  const clearShapes = useMapStore((s) => s.clearShapes);

  if (!map) return null;

  return (
    <div className="draw-toolbar">
      <div className="draw-toolbar__group">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            title={t.title}
            className={t.id === activeTool ? 'is-active' : ''}
            onClick={() => setActiveTool(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="draw-toolbar__group">
        <label title="Couleur du trait">
          Couleur
          <input
            type="color"
            value={strokeColor}
            onChange={(e) => setStrokeColor(e.target.value)}
          />
        </label>
        <label title="Épaisseur du trait">
          Épaisseur
          <input
            type="range"
            min={1}
            max={20}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
          />
          <span className="draw-toolbar__value">{strokeWidth}px</span>
        </label>
      </div>

      <div className="draw-toolbar__group">
        <button
          disabled={!selectedShapeId}
          onClick={() => selectedShapeId && removeShape(map.id, level, selectedShapeId)}
        >
          Effacer la sélection
        </button>
        <button
          className="draw-toolbar__danger"
          onClick={() => {
            if (window.confirm("Effacer toutes les formes de cet étage ?")) {
              clearShapes(map.id, level);
            }
          }}
        >
          Tout effacer
        </button>
      </div>
    </div>
  );
}
