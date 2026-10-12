// Outil « Couleurs » de la cartographie : loupe du pixel sous le pointeur, choix de la classe, liste des couleurs prises avec leur tolérance.

import { useEffect, useRef } from 'react';
import { CLASS_INFO, MAX_TOLERANCE, hex, pixelColor, type ClassName, type ColorConflict, type MapAnnotation } from '../../lib/mapAnnotation';
import type { Pixel } from './MappingCanvas';

const LOUPE_RADIUS = 7; // 15 x 15 pixels
const CELL = 12; // taille d'un pixel de la médiane dans la loupe

/** Loupe : les pixels autour du pointeur, agrandis, avec la couleur exacte du pixel central. */
export function Loupe({ image, pixel }: { image: ImageData | null; pixel: Pixel | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx || !image) return;
    const side = LOUPE_RADIUS * 2 + 1;
    ctx.clearRect(0, 0, side * CELL, side * CELL);
    if (!pixel) return;
    for (let dy = -LOUPE_RADIUS; dy <= LOUPE_RADIUS; dy++) {
      for (let dx = -LOUPE_RADIUS; dx <= LOUPE_RADIUS; dx++) {
        const x = pixel.x + dx;
        const y = pixel.y + dy;
        if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
        const [r, g, b] = pixelColor(image, x, y);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect((dx + LOUPE_RADIUS) * CELL, (dy + LOUPE_RADIUS) * CELL, CELL, CELL);
      }
    }
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(LOUPE_RADIUS * CELL, LOUPE_RADIUS * CELL, CELL, CELL);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(LOUPE_RADIUS * CELL - 1, LOUPE_RADIUS * CELL - 1, CELL + 2, CELL + 2);
  }, [image, pixel]);
  const rgb = image && pixel ? pixelColor(image, pixel.x, pixel.y) : null;
  return (
    <div className="mapping__loupe">
      <canvas ref={ref} width={(LOUPE_RADIUS * 2 + 1) * CELL} height={(LOUPE_RADIUS * 2 + 1) * CELL} />
      <div className="mapping__readout">
        {rgb && pixel ? (
          <>
            <span className="mapping__swatch" style={{ background: hex(rgb) }} />
            <span>
              pixel {pixel.x}, {pixel.y} : RVB {rgb.join(', ')} ({hex(rgb)})
            </span>
          </>
        ) : (
          <span>Survole la carte pour lire un pixel.</span>
        )}
      </div>
    </div>
  );
}

interface ColorsProps {
  annotation: MapAnnotation;
  cls: ClassName;
  onClass: (c: ClassName) => void;
  onChange: (i: number, patch: Partial<MapAnnotation['colors'][number]>) => void;
  onRemove: (i: number) => void;
  conflicts: ColorConflict[]; // paires de couleurs de classes différentes dont les tolérances se recouvrent
  showConflicts: boolean;
  onShowConflicts: (on: boolean) => void;
  onSeparate: () => void;
}

const TOO_CLOSE = 12; // deux couleurs plus proches que cela ne se séparent pas de façon sûre par un seuil

export function ColorPanel({ annotation, cls, onClass, onChange, onRemove, conflicts, showConflicts, onShowConflicts, onSeparate }: ColorsProps) {
  const label = (i: number) => `${hex(annotation.colors[i].rgb)} (${CLASS_INFO.find((k) => k.name === annotation.colors[i].cls)?.label ?? annotation.colors[i].cls})`;
  return (
    <div className="mapping__colors">
      <p className="mapping__hint">Choisis ce que la couleur représente, puis clique sur un pixel de la carte : sa couleur exacte est prise.</p>
      <div className="mapping__classes" role="radiogroup" aria-label="Classe de la couleur à prendre">
        {CLASS_INFO.map((c) => (
          <label key={c.name} className={`mapping__class${cls === c.name ? ' is-on' : ''}`} title={c.help}>
            <input type="radio" name="mapping-class" checked={cls === c.name} onChange={() => onClass(c.name)} />
            <span className="mapping__swatch" style={{ background: `rgb(${c.preview.join(',')})` }} />
            {c.label}
          </label>
        ))}
      </div>
      <div className="mapping__conflicts">
        <label>
          <input type="checkbox" checked={showConflicts} onChange={(e) => onShowConflicts(e.target.checked)} /> Montrer les pixels ambigus (couleurs de deux classes qui se recouvrent)
        </label>
        {conflicts.length === 0 ? (
          <p className="mapping__hint">Aucun pixel ambigu : les tolérances ne se recouvrent pas entre classes différentes.</p>
        ) : (
          <>
            <ul className="mapping__list">
              {conflicts.map((c) => (
                <li key={`${c.i}-${c.j}`}>
                  {label(c.i)} et {label(c.j)} : distance {Math.round(c.distance)}, {c.pixels} pixels ambigus
                  {c.distance < TOO_CLOSE ? ' (trop proches pour être séparées par la couleur : utilise une zone de classe ou un trait)' : ''}
                </li>
              ))}
            </ul>
            <button onClick={onSeparate}>Réduire les tolérances pour les séparer</button>
          </>
        )}
      </div>
      {annotation.colors.length === 0 ? (
        <p className="games__empty">Aucune couleur prise pour l'instant.</p>
      ) : (
        <ul className="mapping__list">
          {annotation.colors.map((c, i) => (
            <li key={`${c.rgb.join('-')}`}>
              <span className="mapping__swatch" style={{ background: hex(c.rgb) }} />
              <code>{hex(c.rgb)}</code>
              <select value={c.cls} onChange={(e) => onChange(i, { cls: e.target.value as ClassName })} aria-label="Classe">
                {CLASS_INFO.map((k) => (
                  <option key={k.name} value={k.name}>
                    {k.label}
                  </option>
                ))}
              </select>
              <label className="mapping__tol">
                tolérance {c.tol}
                <input type="range" min={0} max={MAX_TOLERANCE} value={c.tol} onChange={(e) => onChange(i, { tol: Number(e.target.value) })} />
              </label>
              <button onClick={() => onRemove(i)} aria-label="Retirer cette couleur">Retirer</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
