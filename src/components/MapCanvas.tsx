// Canvas Konva : image de fond + formes dessinées de l'étage courant.
// Selon l'outil actif :
//  - 'select' : clic pour sélectionner, glisser pour déplacer, Suppr pour effacer.
//  - 'line' / 'rect' / 'ellipse' : glisser pour dessiner.
//  - 'pen' : glisser pour un tracé libre.

import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Rect, Ellipse } from 'react-konva';
import type Konva from 'konva';
import { useMapStore } from '../store/mapStore';
import type { Shape } from '../types/map';

const STAGE_WIDTH = 900;
const STAGE_HEIGHT = 600;
const MIN_SIZE = 3; // ignore les dessins trop petits (clic accidentel)

type StageMouseEvent = Konva.KonvaEventObject<MouseEvent>;

export function MapCanvas() {
  const map = useMapStore((s) => s.getActiveMap());
  const level = useMapStore((s) => s.activeFloorLevel);
  const tool = useMapStore((s) => s.activeTool);
  const strokeColor = useMapStore((s) => s.strokeColor);
  const strokeWidth = useMapStore((s) => s.strokeWidth);
  const selectedId = useMapStore((s) => s.selectedShapeId);
  const setSelected = useMapStore((s) => s.setSelectedShape);
  const addShape = useMapStore((s) => s.addShape);
  const updateShape = useMapStore((s) => s.updateShape);
  const removeShape = useMapStore((s) => s.removeShape);

  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [draft, setDraft] = useState<Shape | null>(null);
  const isDrawing = useRef(false);

  // Recharge l'image de fond quand la data URL change.
  useEffect(() => {
    if (!map?.backgroundImage) {
      setBgImage(null);
      return;
    }
    const img = new window.Image();
    img.src = map.backgroundImage;
    img.onload = () => setBgImage(img);
  }, [map?.backgroundImage]);

  // Suppr / Backspace efface la forme sélectionnée.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId && map) {
        removeShape(map.id, level, selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, map, level, removeShape]);

  const floor = map?.floors.find((f) => f.level === level);
  const isDrawingTool = tool !== 'select';

  const pointerPos = (e: StageMouseEvent) => e.target.getStage()?.getPointerPosition() ?? null;

  const handleMouseDown = (e: StageMouseEvent) => {
    if (!map) return;

    if (tool === 'select') {
      // Clic dans le vide => désélectionne.
      if (e.target === e.target.getStage()) setSelected(null);
      return;
    }

    const pos = pointerPos(e);
    if (!pos) return;
    isDrawing.current = true;
    const base = { id: crypto.randomUUID(), stroke: strokeColor, strokeWidth };

    if (tool === 'rect') {
      setDraft({ ...base, kind: 'rect', x: pos.x, y: pos.y, width: 0, height: 0 });
    } else if (tool === 'ellipse') {
      setDraft({ ...base, kind: 'ellipse', x: pos.x, y: pos.y, width: 0, height: 0 });
    } else if (tool === 'line') {
      setDraft({ ...base, kind: 'line', points: [pos.x, pos.y, pos.x, pos.y] });
    } else if (tool === 'pen') {
      setDraft({ ...base, kind: 'pen', points: [pos.x, pos.y] });
    }
  };

  const handleMouseMove = (e: StageMouseEvent) => {
    if (!isDrawing.current || !draft) return;
    const pos = pointerPos(e);
    if (!pos) return;

    if (draft.kind === 'rect' || draft.kind === 'ellipse') {
      setDraft({ ...draft, width: pos.x - (draft.x ?? 0), height: pos.y - (draft.y ?? 0) });
    } else if (draft.kind === 'line') {
      const [x0, y0] = draft.points!;
      setDraft({ ...draft, points: [x0, y0, pos.x, pos.y] });
    } else if (draft.kind === 'pen') {
      setDraft({ ...draft, points: [...draft.points!, pos.x, pos.y] });
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing.current || !draft || !map) {
      isDrawing.current = false;
      return;
    }
    isDrawing.current = false;

    let shape = draft;

    // Normalise les boîtes (width/height positifs, x/y = coin haut-gauche).
    if (shape.kind === 'rect' || shape.kind === 'ellipse') {
      const w = shape.width ?? 0;
      const h = shape.height ?? 0;
      if (Math.abs(w) < MIN_SIZE && Math.abs(h) < MIN_SIZE) {
        setDraft(null);
        return;
      }
      shape = {
        ...shape,
        x: Math.min(shape.x ?? 0, (shape.x ?? 0) + w),
        y: Math.min(shape.y ?? 0, (shape.y ?? 0) + h),
        width: Math.abs(w),
        height: Math.abs(h),
      };
    } else if (shape.kind === 'line') {
      const [x0, y0, x1, y1] = shape.points!;
      if (Math.hypot(x1 - x0, y1 - y0) < MIN_SIZE) {
        setDraft(null);
        return;
      }
    } else if (shape.kind === 'pen' && (shape.points?.length ?? 0) < 4) {
      setDraft(null);
      return;
    }

    addShape(map.id, level, shape);
    setDraft(null);
  };

  const shapesToRender = draft ? [...(floor?.shapes ?? []), draft] : floor?.shapes ?? [];

  return (
    <div className={`map-canvas${isDrawingTool ? ' is-drawing' : ''}`}>
      <Stage
        width={STAGE_WIDTH}
        height={STAGE_HEIGHT}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <Layer listening={false}>
          {bgImage && (
            <KonvaImage image={bgImage} width={STAGE_WIDTH} height={STAGE_HEIGHT} />
          )}
        </Layer>
        <Layer>
          {shapesToRender.map((shape) => (
            <ShapeView
              key={shape.id}
              shape={shape}
              selected={shape.id === selectedId}
              selectable={tool === 'select' && shape.id !== draft?.id}
              onSelect={() => setSelected(shape.id)}
              onChange={(next) => map && updateShape(map.id, level, next)}
            />
          ))}
        </Layer>
      </Stage>

      {!map && <p className="hint">Crée ou importe une carte pour commencer.</p>}
      {map && !bgImage && (
        <p className="hint">Importe une image de plan, puis dessine tes murs.</p>
      )}
    </div>
  );
}

interface ShapeViewProps {
  shape: Shape;
  selected: boolean;
  selectable: boolean;
  onSelect: () => void;
  onChange: (shape: Shape) => void;
}

function ShapeView({ shape, selected, selectable, onSelect, onChange }: ShapeViewProps) {
  const common = {
    stroke: shape.stroke,
    strokeWidth: shape.strokeWidth,
    draggable: selectable,
    onClick: selectable ? onSelect : undefined,
    onTap: selectable ? onSelect : undefined,
    shadowColor: '#4da3ff',
    shadowBlur: selected ? 12 : 0,
    shadowOpacity: selected ? 1 : 0,
  };

  // Déplacement d'une forme à base de points (line/pen) : on applique le
  // décalage du nœud à tous les points, puis on remet le nœud à l'origine.
  const handlePointsDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const dx = node.x();
    const dy = node.y();
    const moved = (shape.points ?? []).map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
    node.position({ x: 0, y: 0 });
    onChange({ ...shape, points: moved });
  };

  if (shape.kind === 'rect') {
    return (
      <Rect
        {...common}
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        onDragEnd={(e) => onChange({ ...shape, x: e.target.x(), y: e.target.y() })}
      />
    );
  }

  if (shape.kind === 'ellipse') {
    const w = shape.width ?? 0;
    const h = shape.height ?? 0;
    return (
      <Ellipse
        {...common}
        x={(shape.x ?? 0) + w / 2}
        y={(shape.y ?? 0) + h / 2}
        radiusX={Math.abs(w) / 2}
        radiusY={Math.abs(h) / 2}
        onDragEnd={(e) =>
          onChange({
            ...shape,
            x: e.target.x() - w / 2,
            y: e.target.y() - h / 2,
          })
        }
      />
    );
  }

  // line ou pen
  return (
    <Line
      {...common}
      points={shape.points ?? []}
      lineCap="round"
      lineJoin="round"
      tension={shape.kind === 'pen' ? 0.4 : 0}
      hitStrokeWidth={Math.max(shape.strokeWidth, 12)}
      onDragEnd={handlePointsDragEnd}
    />
  );
}
