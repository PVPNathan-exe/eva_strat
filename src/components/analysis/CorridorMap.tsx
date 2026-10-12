// Carte des couloirs lus par le programme : le masque des zones praticables, les traits de murs, les stations de tyrolienne et les zones de départ, posés sur le plan
// de la carte (cadre aligné sur ses murs, voir planInsets.ts). Tout ce qui n'est pas en rouge est « hors limites » pour le programme.

import { useEffect, useRef, useState } from 'react';
import { builtinMaps } from '../../lib/builtinMaps';
import { loadTinted, readingOf, type Rgb } from '../../lib/mapReading';
import { defaultInset, project } from '../../lib/planInsets';
import { ReliabilityLayer } from './ReliabilityLayer';
import { useGameFlags } from './useGameFlags';

const RED: Rgb = [255, 59, 59];
const YELLOW: Rgb = [255, 214, 10];

/** Affiche une image en niveaux de gris comme une couche colorée. */
function Tinted({ url, color, alpha }: { url: string; color: Rgb; alpha: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    loadTinted(url, color, alpha)
      .then((src) => {
        const canvas = ref.current;
        if (cancelled || !canvas) return;
        canvas.width = src.width;
        canvas.height = src.height;
        canvas.getContext('2d')?.drawImage(src, 0, 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url, color, alpha]);
  return <canvas ref={ref} className="corridor__canvas" />;
}

export function CorridorMap({ map }: { map: string }) {
  const plan = builtinMaps.find((m) => m.name === map);
  const reading = readingOf(map);
  const inset = defaultInset(map);
  const [corridors, setCorridors] = useState(true);
  const [walls, setWalls] = useState(false);
  const [stations, setStations] = useState(true);
  const [spawns, setSpawns] = useState(true);
  const [zones, setZones] = useState(false);
  const { reliability } = useGameFlags(-1, map, 0);

  // Cadre de la minimap sur le plan, en fractions du plan
  const frame = { left: `${inset.l * 100}%`, top: `${inset.t * 100}%`, width: `${(1 - inset.l - inset.r) * 100}%`, height: `${(1 - inset.t - inset.b) * 100}%` };
  const at = (x: number, y: number) => project(inset, x, y);

  return (
    <div className="corridor">
      <div className="corridor__stage">
        {plan && <img src={plan.src} alt={`Plan ${map}`} draggable={false} />}
        {corridors && reading.maskUrl && (
          <div className="corridor__layer" style={frame}>
            <Tinted url={reading.maskUrl} color={RED} alpha={115} />
          </div>
        )}
        {walls && reading.linesUrl && (
          <div className="corridor__layer" style={frame}>
            <Tinted url={reading.linesUrl} color={YELLOW} alpha={200} />
          </div>
        )}
        <svg className="corridor__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {spawns &&
            reading.spawns.map((s) => {
              const a = at(s.rect[0], s.rect[1]);
              const b = at(s.rect[2], s.rect[3]);
              return <rect key={s.team} x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} className={`corridor__spawn corridor__spawn--${s.team}`} />;
            })}
          {stations &&
            reading.stations.map(([p, q]) => {
              const a = at(p[0], p[1]);
              const b = at(q[0], q[1]);
              return (
                <g key={`${p[0]}-${p[1]}`}>
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="corridor__ride" vectorEffect="non-scaling-stroke" />
                  <ellipse cx={a.x} cy={a.y} rx={0.8} ry={1.4} className="corridor__station" />
                  <ellipse cx={b.x} cy={b.y} rx={0.8} ry={1.4} className="corridor__station" />
                </g>
              );
            })}
        </svg>
        {zones && <ReliabilityLayer reliability={reliability} project={at} showPos showGaze />}
      </div>
      <div className="corridor__opts">
        <label><input type="checkbox" checked={corridors} onChange={(e) => setCorridors(e.target.checked)} /> Couloirs (le joueur peut s'y trouver)</label>
        <label><input type="checkbox" checked={walls} onChange={(e) => setWalls(e.target.checked)} /> Traits de murs lus</label>
        <label><input type="checkbox" checked={stations} onChange={(e) => setStations(e.target.checked)} /> Tyroliennes</label>
        <label><input type="checkbox" checked={spawns} onChange={(e) => setSpawns(e.target.checked)} /> Zones de départ</label>
        <label><input type="checkbox" checked={zones} onChange={(e) => setZones(e.target.checked)} /> Zones peu fiables</label>
      </div>
      <p className="corridor__note">
        Rouge : couloirs lus par le programme (construits à partir du fond de la minimap). Hors du rouge, une pastille est refusée (reflet, effet d'écran) et une position
        calculée est ramenée au couloir le plus proche. Un joueur peut longer un mur, pas sortir de ces limites. Le cadre de la minimap sur le plan est aligné
        automatiquement sur les murs du plan.
      </p>
    </div>
  );
}
