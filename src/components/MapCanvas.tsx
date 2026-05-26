// Canvas Konva : affiche l'image de fond de la carte active et la couche des
// murs de l'étage courant. Le dessin interactif des murs viendra plus tard ;
// pour l'instant on rend ce qui est en mémoire.

import { useEffect, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Line } from 'react-konva';
import { useMapStore } from '../store/mapStore';

const STAGE_WIDTH = 900;
const STAGE_HEIGHT = 600;

export function MapCanvas() {
  const map = useMapStore((s) => s.getActiveMap());
  const activeFloorLevel = useMapStore((s) => s.activeFloorLevel);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);

  // Recharge l'objet Image quand la data URL de fond change.
  useEffect(() => {
    if (!map?.backgroundImage) {
      setBgImage(null);
      return;
    }
    const img = new window.Image();
    img.src = map.backgroundImage;
    img.onload = () => setBgImage(img);
  }, [map?.backgroundImage]);

  const floor = map?.floors.find((f) => f.level === activeFloorLevel);

  return (
    <div className="map-canvas">
      <Stage width={STAGE_WIDTH} height={STAGE_HEIGHT}>
        <Layer>
          {bgImage && (
            <KonvaImage
              image={bgImage}
              width={STAGE_WIDTH}
              height={STAGE_HEIGHT}
            />
          )}
        </Layer>
        <Layer>
          {floor?.walls.map((wall) => (
            <Line
              key={wall.id}
              points={wall.points}
              stroke="#ff3b3b"
              strokeWidth={3}
              lineCap="round"
              lineJoin="round"
            />
          ))}
        </Layer>
      </Stage>
      {!map && <p className="hint">Crée ou importe une carte pour commencer.</p>}
      {map && !bgImage && (
        <p className="hint">Importe une image de plan comme fond de carte.</p>
      )}
    </div>
  );
}
