// Canvas Konva : image de fond + formes dessinées de l'étage courant.
// Selon l'outil actif :
//  - 'select' : clic pour sélectionner, glisser pour déplacer, Suppr pour effacer.
//  - 'line' / 'rect' / 'ellipse' : glisser pour dessiner.
//  - 'pen' : glisser pour un tracé libre.

import { useEffect, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Rect, Ellipse, Circle, Text } from 'react-konva';
import type Konva from 'konva';
import { useMapStore } from '../store/mapStore';
import type { Shape } from '../types/map';
import { findStuff, bandLabel, falloffColor } from '../lib/stuffs';

// Cadre de dessin : la map est affichée SANS déformation, ajustée à l'intérieur
// de cette boîte max en conservant son ratio. Le Stage prend donc la taille de
// l'image (mise à l'échelle), pas une taille fixe.
const MAX_WIDTH = 900;
const MAX_HEIGHT = 600;
const MIN_SIZE = 3; // ignore les dessins trop petits (clic accidentel)

type StageMouseEvent = Konva.KonvaEventObject<MouseEvent>;

export function MapCanvas() {
  const map = useMapStore((s) => s.getActiveMap());
  const level = useMapStore((s) => s.activeFloorLevel);
  const tool = useMapStore((s) => s.activeTool);
  const strokeColor = useMapStore((s) => s.strokeColor);
  const strokeWidth = useMapStore((s) => s.strokeWidth);
  const selectedId = useMapStore((s) => s.selectedShapeId);
  const showOtherFloors = useMapStore((s) => s.showOtherFloors);
  const setSelected = useMapStore((s) => s.setSelectedShape);
  const addShape = useMapStore((s) => s.addShape);
  const updateShape = useMapStore((s) => s.updateShape);
  const removeShape = useMapStore((s) => s.removeShape);
  const setMapScale = useMapStore((s) => s.setMapScale);
  const placedStuff = useMapStore((s) => s.placedStuff);
  const placeStuff = useMapStore((s) => s.placeStuff);
  const clearPlacedStuff = useMapStore((s) => s.clearPlacedStuff);

  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ width: MAX_WIDTH, height: MAX_HEIGHT });
  const [draft, setDraft] = useState<Shape | null>(null);
  const isDrawing = useRef(false);

  // Recharge l'image de fond quand la data URL change, et ajuste la taille du
  // Stage au ratio de l'image (fit dans MAX_WIDTH×MAX_HEIGHT) pour éviter toute
  // déformation : le cadre de dessin colle alors exactement à la map.
  useEffect(() => {
    if (!map?.backgroundImage) {
      setBgImage(null);
      setStageSize({ width: MAX_WIDTH, height: MAX_HEIGHT });
      return;
    }
    const img = new window.Image();
    img.src = map.backgroundImage;
    img.onload = () => {
      setBgImage(img);
      const scale = Math.min(MAX_WIDTH / img.naturalWidth, MAX_HEIGHT / img.naturalHeight);
      setStageSize({
        width: Math.round(img.naturalWidth * scale),
        height: Math.round(img.naturalHeight * scale),
      });
    };
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

  // Les coordonnées de l'arme posée sont en pixels du Stage courant : on la
  // retire quand on change de carte (sinon le marqueur serait au mauvais endroit).
  useEffect(() => {
    clearPlacedStuff();
  }, [map?.id, clearPlacedStuff]);

  const floor = map?.floors.find((f) => f.level === level);
  const isDrawingTool = tool !== 'select';
  const ppm = map?.pixelsPerMeter ?? null;

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

    // Poser l'arme sélectionnée : un simple clic, pas de glisser.
    if (tool === 'weapon') {
      placeStuff(pos.x, pos.y);
      return;
    }

    isDrawing.current = true;
    const base = { id: crypto.randomUUID(), stroke: strokeColor, strokeWidth };

    if (tool === 'rect') {
      setDraft({ ...base, kind: 'rect', x: pos.x, y: pos.y, width: 0, height: 0 });
    } else if (tool === 'ellipse') {
      setDraft({ ...base, kind: 'ellipse', x: pos.x, y: pos.y, width: 0, height: 0 });
    } else if (tool === 'line' || tool === 'calibrate') {
      // La calibration utilise un trait droit (réutilise le rendu 'line').
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

    // Calibration : mesure le trait, demande la distance réelle, fixe l'échelle.
    if (tool === 'calibrate') {
      if (draft.kind === 'line' && draft.points) {
        const [x0, y0, x1, y1] = draft.points;
        const px = Math.hypot(x1 - x0, y1 - y0);
        if (px >= MIN_SIZE) {
          const input = window.prompt('Distance réelle de cette ligne, en mètres :', '31');
          const meters = input ? parseFloat(input.replace(',', '.')) : NaN;
          if (Number.isFinite(meters) && meters > 0) {
            setMapScale(map.id, px / meters);
          }
        }
      }
      setDraft(null);
      return;
    }

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

  // Calque de référence (pelure d'oignon) : formes des autres étages, grisées.
  const ghostShapes = showOtherFloors
    ? (map?.floors ?? [])
        .filter((f) => f.level !== level)
        .flatMap((f) => f.shapes)
    : [];

  return (
    <div className={`map-canvas${isDrawingTool ? ' is-drawing' : ''}`}>
      <Stage
        width={stageSize.width}
        height={stageSize.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <Layer listening={false}>
          {bgImage && (
            <KonvaImage image={bgImage} width={stageSize.width} height={stageSize.height} />
          )}
        </Layer>
        {ghostShapes.length > 0 && (
          <Layer listening={false} opacity={0.35}>
            {ghostShapes.map((shape) => (
              <ShapeView
                key={`ghost-${shape.id}`}
                shape={shape}
                selected={false}
                selectable={false}
                ghost
                onSelect={() => {}}
                onChange={() => {}}
              />
            ))}
          </Layer>
        )}
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
        {placedStuff && ppm && (
          <Layer listening={false}>
            <StuffRange placed={placedStuff} ppm={ppm} stageSize={stageSize} />
          </Layer>
        )}
      </Stage>

      {!map && <p className="hint">Crée ou importe une carte pour commencer.</p>}
      {map && !bgImage && (
        <p className="hint">Importe une image de plan, puis dessine tes murs.</p>
      )}
    </div>
  );
}

/** Convertit une couleur hex (#rrggbb) en rgba() avec l'alpha donné. */
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface StuffRangeProps {
  placed: { name: string; x: number; y: number };
  ppm: number;
  stageSize: { width: number; height: number };
}

/** Cercles de portée / falloff de l'arme posée, dessinés depuis son point. */
function StuffRange({ placed, ppm, stageSize }: StuffRangeProps) {
  const stuff = findStuff(placed.name);
  if (!stuff) return null;

  const { x, y } = placed;
  const maxRadiusPx = Math.hypot(stageSize.width, stageSize.height);

  // Construit la liste des anneaux à dessiner (rayon px décroissant pour empiler).
  type Ring = { radius: number; color: string; label: string };
  let rings: Ring[] = [];

  if (stuff.kind === 'firearm') {
    rings = stuff.falloff
      .filter((b) => b.pct > 0)
      .map((b) => {
        const radius = b.toM === null ? maxRadiusPx : b.toM * ppm;
        const dmg = Math.round(stuff.damage.body * (b.pct / 100) * 10) / 10;
        return {
          radius,
          color: falloffColor(b.pct),
          label: `${bandLabel(b)} · ${b.pct}% · ${dmg} dmg`,
        };
      });
  } else if (stuff.kind === 'grenade') {
    rings = [
      {
        radius: stuff.damageLimitRadiusM * ppm,
        color: '#ff9500',
        label: `limite ${stuff.damageLimitRadiusM} m`,
      },
      {
        radius: stuff.maxDamageRadiusM * ppm,
        color: '#ff3b3b',
        label: `dégâts max ${stuff.maxDamageRadiusM} m · ${stuff.maxDamage}`,
      },
    ];
  } else if (stuff.kind === 'utility' && stuff.radiusM) {
    rings = [
      { radius: stuff.radiusM * ppm, color: '#4da3ff', label: `détection ${stuff.radiusM} m` },
    ];
  }

  // Tri décroissant : le plus grand dessous, le plus petit par-dessus.
  rings.sort((a, b) => b.radius - a.radius);

  return (
    <>
      {rings.map((ring, i) => (
        <Circle
          key={i}
          x={x}
          y={y}
          radius={ring.radius}
          fill={hexToRgba(ring.color, 0.16)}
          stroke={ring.color}
          strokeWidth={1.5}
        />
      ))}
      {rings.map((ring, i) => (
        <Text
          key={`lbl-${i}`}
          x={x + 4}
          y={y - Math.min(ring.radius, maxRadiusPx) - 14}
          text={ring.label}
          fontSize={12}
          fill="#fff"
          shadowColor="#000"
          shadowBlur={3}
        />
      ))}
      {/* marqueur central */}
      <Circle x={x} y={y} radius={5} fill="#ffffff" stroke="#000000" strokeWidth={1.5} />
      <Text x={x + 8} y={y + 6} text={stuff.name} fontSize={12} fill="#fff" shadowColor="#000" shadowBlur={3} />
    </>
  );
}

interface ShapeViewProps {
  shape: Shape;
  selected: boolean;
  selectable: boolean;
  ghost?: boolean;
  onSelect: () => void;
  onChange: (shape: Shape) => void;
}

function ShapeView({ shape, selected, selectable, ghost, onSelect, onChange }: ShapeViewProps) {
  const common = {
    stroke: ghost ? '#9aa0aa' : shape.stroke,
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
