// Couches Konva des portes à boutons : blocs hachurés de la largeur du chemin (verts pendant leur mouvement) et boutons cliquables. Les blocs se dessinent sous les formes de
// l'utilisateur, les boutons au-dessus. Un clic sur un bouton inverse les portes qu'il commande (voir lib/doorBlocks.ts pour l'animation).

import { Circle, Layer, Line } from 'react-konva';
import { blockCorners, doorView, isMoving } from '../lib/doorBlocks';
import type { Doors } from './useDoors';

const HATCH = 14; // période des rayures (pixels de l'écran)
const HATCH_LIGHT = '#aaaaaa';
const HATCH_DARK = '#0c0c0c';
const ACTIVE_FILL = 'rgba(80, 204, 79, 0.92)'; // vert de la minimap pendant le mouvement
const ACTIVE_STROKE = '#d6ffd0';

let hatchImage: HTMLCanvasElement | null = null;

/** Motif de rayures noires et grises à 45 degrés (comme les portes des autres plans), créé une seule fois. */
function hatchPattern(): HTMLCanvasElement {
  if (hatchImage) return hatchImage;
  const c = document.createElement('canvas');
  c.width = c.height = HATCH;
  const g = c.getContext('2d');
  if (g) {
    g.fillStyle = HATCH_DARK;
    g.fillRect(0, 0, HATCH, HATCH);
    g.fillStyle = HATCH_LIGHT;
    const w = HATCH / 2;
    for (const k of [-1, 0, 1]) {
      g.beginPath();
      g.moveTo(k * HATCH, HATCH);
      g.lineTo(k * HATCH + w, HATCH);
      g.lineTo(k * HATCH + HATCH + w, 0);
      g.lineTo(k * HATCH + HATCH, 0);
      g.closePath();
      g.fill();
    }
  }
  hatchImage = c;
  return c;
}

interface Props {
  doors: Doors;
  /** Taille du plan affiché, en pixels de l'écran. */
  stage: { width: number; height: number };
}

/** Blocs de porte (sans interaction). */
export function DoorBlocksLayer({ doors, stage }: Props) {
  const { setup, states, now } = doors;
  const sx = stage.width / setup.plan[0];
  const sy = stage.height / setup.plan[1];
  return (
    <Layer listening={false}>
      {setup.doors.map((door) => {
        const entry = states[door.id];
        if (!entry) return null;
        const view = doorView(entry, now, setup.anim);
        if (view.closed < 0.02 && !view.active) return null; // porte ouverte : rien à voir
        const points = blockCorners(door, Math.max(view.closed, view.active ? 0.12 : 0)).flatMap(([x, y]) => [x * sx, y * sy]);
        return view.active ? (
          <Line key={door.id} points={points} closed fill={ACTIVE_FILL} stroke={ACTIVE_STROKE} strokeWidth={1.5} />
        ) : (
          <Line key={door.id} points={points} closed fillPatternImage={hatchPattern() as unknown as HTMLImageElement} stroke="#e8e8e8" strokeWidth={1} />
        );
      })}
    </Layer>
  );
}

/** Boutons : un clic (outil Sélection) inverse leurs portes. */
export function DoorButtonsLayer({ doors, stage, enabled }: Props & { enabled: boolean }) {
  const { setup, states, now } = doors;
  const sx = stage.width / setup.plan[0];
  const sy = stage.height / setup.plan[1];
  const radius = 15 * sx;
  const setCursor = (e: { target: { getStage: () => { container: () => HTMLElement } | null } }, cursor: string) => {
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = cursor;
  };
  return (
    <Layer>
      {setup.buttons.map((b) => {
        const busy = b.toggles.every((id) => states[id] && isMoving(states[id], now, setup.anim));
        return (
          <Circle
            key={b.id}
            x={b.x * sx}
            y={b.y * sy}
            radius={radius}
            fill={busy ? '#64ff64' : b.color}
            stroke={busy ? '#d6ffd0' : '#323232'}
            strokeWidth={3}
            opacity={enabled ? 1 : 0.7}
            onClick={enabled ? () => doors.press(b) : undefined}
            onTap={enabled ? () => doors.press(b) : undefined}
            onMouseEnter={enabled ? (e) => setCursor(e, 'pointer') : undefined}
            onMouseLeave={enabled ? (e) => setCursor(e, '') : undefined}
          />
        );
      })}
    </Layer>
  );
}
