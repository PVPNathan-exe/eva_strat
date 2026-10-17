// Carte des couloirs lus par le programme : le masque des zones praticables, les traits de murs, les stations de tyrolienne et les zones de départ, posés sur le plan
// de la carte (cadre aligné sur ses murs, voir planInsets.ts). Tout ce qui n'est pas en rouge est « hors limites » pour le programme.

import { useEffect, useState } from 'react';
import { Layers } from 'lucide-react';
import { builtinMaps } from '../../lib/builtinMaps';
import { loadTinted, readingOf, rotorsOf, type Rgb } from '../../lib/mapReading';
import { arcPoints, solidArcs, windowArcs } from '../../lib/rotors';
import { defaultInset, isAligned, project } from '../../lib/planInsets';
import { frameBox, isWarped, projectPath } from '../../lib/planWarp';
import { PlanCanvas } from '../PlanCanvas';
import { ReliabilityLayer } from './ReliabilityLayer';
import { useGameFlags } from './useGameFlags';

const RED: Rgb = [255, 59, 59];
const YELLOW: Rgb = [255, 214, 10];
const CYAN: Rgb = [90, 220, 235]; // étages superposés : sol gardé par un passage en dessous

/** Affiche une image en niveaux de gris comme une couche colorée (tracée déformée sur le plan quand la carte a un maillage : `warp` = nom de la carte). */
function Tinted({ url, color, alpha, warp }: { url: string; color: Rgb; alpha: number; warp?: string }) {
  const [src, setSrc] = useState<HTMLCanvasElement | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadTinted(url, color, alpha)
      .then((tinted) => {
        if (!cancelled) setSrc(tinted);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [url, color, alpha]);
  return <PlanCanvas canvas={src} warp={warp} scale={2} smooth={false} className="corridor__canvas" />;
}

export function CorridorMap({ map }: { map: string }) {
  const aligned = isAligned(map); // plan aligné sur la minimap : le plan sert de fond ; sinon la médiane de la minimap elle-même (aucun recalage nécessaire)
  const reading = readingOf(map);
  const plan = aligned ? builtinMaps.find((m) => m.name === map) : undefined;
  const background = plan?.src ?? reading.medianUrl;
  const inset = aligned ? defaultInset(map) : { l: 0, t: 0, r: 0, b: 0 };
  const [corridors, setCorridors] = useState(true);
  const [walls, setWalls] = useState(false);
  const [stations, setStations] = useState(true);
  const [spawns, setSpawns] = useState(true);
  const [zones, setZones] = useState(false);
  const [capture, setCapture] = useState(true);
  const [under, setUnder] = useState(true);
  const [lines, setLines] = useState(false);
  const rotors = rotorsOf(map); // anneaux tournants (Engine) : arcs pleins à l'instant choisi
  const [rings, setRings] = useState(true);
  const [ringTime, setRingTime] = useState(15);
  const { reliability } = useGameFlags(-1, map, 0);

  // Cadre de la minimap sur le plan, en fractions du plan
  const frame = frameBox(inset); // tout le plan pour une carte à maillage (couches déjà tracées dans le plan)
  const warp = isWarped(inset) ? inset.warp : undefined;
  const at = (x: number, y: number) => project(inset, x, y);
  const outline = (pts: [number, number][]) => projectPath(inset, pts).map((p) => `${p.x},${p.y}`).join(' '); // lignes brisées : suivent la déformation d'un maillage

  return (
    <div className="corridor">
      <details className="menu corridor__layers">
        <summary><Layers className="ic" /> Calques ({[corridors, walls, stations, spawns, zones, capture, under, lines, ...(rotors ? [rings] : [])].filter(Boolean).length})</summary>
        <div className="menu__panel corridor__opts">
        <label><input type="checkbox" checked={corridors} onChange={(e) => setCorridors(e.target.checked)} /> Couloirs (le joueur peut s'y trouver)</label>
        <label><input type="checkbox" checked={walls} onChange={(e) => setWalls(e.target.checked)} /> Traits de murs lus</label>
        <label><input type="checkbox" checked={stations} onChange={(e) => setStations(e.target.checked)} /> Tyroliennes</label>
        <label><input type="checkbox" checked={spawns} onChange={(e) => setSpawns(e.target.checked)} /> Zones de départ</label>
        <label><input type="checkbox" checked={zones} onChange={(e) => setZones(e.target.checked)} /> Zones peu fiables</label>
        <label><input type="checkbox" checked={capture} onChange={(e) => setCapture(e.target.checked)} /> Points de capture (zones jouables)</label>
        <label><input type="checkbox" checked={under} onChange={(e) => setUnder(e.target.checked)} /> Passage en dessous (étages superposés, en bleu clair)</label>
        {rotors && (
          <>
            <label><input type="checkbox" checked={rings} onChange={(e) => setRings(e.target.checked)} /> Anneaux tournants (arcs pleins ; fenêtres en bleu ; extérieur horaire, intérieur anti-horaire)</label>
            <label className="corridor__time">
              Instant de game : {ringTime} s
              <input type="range" min={0} max={120} step={1} value={ringTime} disabled={!rings} onChange={(e) => setRingTime(Number(e.target.value))} />
            </label>
          </>
        )}
        <label><input type="checkbox" checked={lines} onChange={(e) => setLines(e.target.checked)} /> Portes, fenêtres, murs et tirs tracés (trait pointillé : passage en dessous)</label>
        </div>
      </details>
      <div className="corridor__stage">
        {background && <img src={background} alt={aligned ? `Plan ${map}` : `Minimap de ${map}`} draggable={false} />}
        {corridors && reading.maskUrl && (
          <div className="corridor__layer" style={frame}>
            <Tinted url={reading.maskUrl} color={RED} alpha={115} warp={warp} />
          </div>
        )}
        {under && reading.underUrl && (
          <div className="corridor__layer" style={frame}>
            <Tinted url={reading.underUrl} color={CYAN} alpha={190} warp={warp} />
          </div>
        )}
        {walls && reading.linesUrl && (
          <div className="corridor__layer" style={frame}>
            <Tinted url={reading.linesUrl} color={YELLOW} alpha={200} warp={warp} />
          </div>
        )}
        <svg className="corridor__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {capture &&
            reading.capture.map((polygon, i) => (
              <polygon key={`cap${i}`} points={outline([...polygon, polygon[0]])} className="corridor__capture" vectorEffect="non-scaling-stroke" />
            ))}
          {rings &&
            rotors?.anneaux.flatMap((ring) =>
              solidArcs(ring, ringTime, rotors.t_ref).map((arc, i) => (
                <polyline
                  key={`ring${ring.nom}${i}`}
                  points={arcPoints(rotors, ring, arc)
                    .map(([x, y]) => `${at(x, y).x},${at(x, y).y}`)
                    .join(' ')}
                  className={`corridor__ring corridor__ring--${ring.nom}`}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}
          {rings &&
            rotors?.anneaux.flatMap((ring) =>
              windowArcs(ring, ringTime, rotors.t_ref).map((arc, i) => (
                <polyline
                  key={`win${ring.nom}${i}`}
                  points={arcPoints(rotors, ring, arc, 1)
                    .map(([x, y]) => `${at(x, y).x},${at(x, y).y}`)
                    .join(' ')}
                  className="corridor__ring-window"
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}
          {lines &&
            reading.openings.map((o, i) => {
              const cls = `corridor__line corridor__line--${o.kind}${o.under ? ' is-under' : ''}`;
              if (warp) return <polyline key={`line${i}`} points={outline([o.from, o.to])} fill="none" className={cls} vectorEffect="non-scaling-stroke" />;
              const a = at(o.from[0], o.from[1]);
              const b = at(o.to[0], o.to[1]);
              return <line key={`line${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={cls} vectorEffect="non-scaling-stroke" />;
            })}
          {spawns &&
            reading.spawns.map((s, i) => {
              if (warp) return <polygon key={`${s.team}${i}`} points={outline([[s.rect[0], s.rect[1]], [s.rect[2], s.rect[1]], [s.rect[2], s.rect[3]], [s.rect[0], s.rect[3]], [s.rect[0], s.rect[1]]])} className={`corridor__spawn corridor__spawn--${s.team}`} />;
              const a = at(s.rect[0], s.rect[1]);
              const b = at(s.rect[2], s.rect[3]);
              return <rect key={`${s.team}${i}`} x={a.x} y={a.y} width={b.x - a.x} height={b.y - a.y} className={`corridor__spawn corridor__spawn--${s.team}`} />;
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
      <details className="help">
        <summary>Comment lire cette carte</summary>
        <p className="help__body">
        Rouge : couloirs lus par le programme (construits à partir du fond de la minimap). Hors du rouge, une pastille est refusée (reflet, effet d'écran) et une position
        calculée est ramenée au couloir le plus proche. Un joueur peut longer un mur, pas sortir de ces limites. Sur Polaris, le cadre de la minimap sur le plan est aligné
        automatiquement sur les murs du plan ; les autres cartes sont montrées sur la médiane de leur minimap.
        </p>
      </details>
    </div>
  );
}
