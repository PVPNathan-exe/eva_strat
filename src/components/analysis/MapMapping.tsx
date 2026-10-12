// Cartographie à la main d'une carte (onglet Lecture, sous la carte des couloirs) : pipette au pixel pour ranger les couleurs de la minimap en classes (sol, mur, tir
// par-dessus, vue seulement, chemin de tyrolienne, portes), flèches pour les tyroliennes, traits de portes, zones de départ (2 au plus par équipe) et alignement sur le plan.
// L'annotation est enregistrée en base, puis « Appliquer » la traduit en masque, murs, tyroliennes, départs et cadre (analysis/map_annotations.py).

import { useMemo, useState } from 'react';
import { builtinMaps } from '../../lib/builtinMaps';
import {
  addSpawn,
  alignmentError,
  rectFrom,
  solveAlignment,
  pixelColor,
  upsertColor,
  MAX_SPAWNS_PER_TEAM,
  type ClassName,
  type MapAnnotation,
  type Point,
  type Rect,
  type Team,
} from '../../lib/mapAnnotation';
import { readingOf } from '../../lib/mapReading';
import { ColorPanel, Loupe } from './MappingColors';
import { MappingCanvas, type Pixel } from './MappingCanvas';
import { MappingPlan } from './MappingPlan';
import { useMapAnnotation } from './useMapAnnotation';

type Tool = 'colors' | 'tps' | 'doors' | 'spawns' | 'align';
const TOOLS: { id: Tool; label: string }[] = [
  { id: 'colors', label: 'Couleurs' },
  { id: 'tps', label: 'Tyroliennes' },
  { id: 'doors', label: 'Portes' },
  { id: 'spawns', label: 'Départs' },
  { id: 'align', label: 'Alignement' },
];
const ZOOMS = [0, 1, 2, 3, 4, 6]; // 0 : ajusté à la largeur
const point = (p: Point) => p.map((v) => v.toFixed(3)).join(', ');

export function MapMapping({ map }: { map: string }) {
  const reading = readingOf(map);
  const plan = builtinMaps.find((m) => m.name === map)?.src ?? null;
  const { annotation, loaded, dirty, busy, message, update, save, apply } = useMapAnnotation(map);
  const [tool, setTool] = useState<Tool>('colors');
  const [cls, setCls] = useState<ClassName>('sol');
  const [zoom, setZoom] = useState(0);
  const [preview, setPreview] = useState(true);
  const [image, setImage] = useState<ImageData | null>(null);
  const [hover, setHover] = useState<Pixel | null>(null);
  const [pending, setPending] = useState<Point | null>(null); // premier clic d'une flèche, d'un trait de porte ou d'un repère
  const [glass, setGlass] = useState(false);
  const [team, setTeam] = useState<Team>('A');
  const [drag, setDrag] = useState<{ from: Point; to: Point } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const dragRect: Rect | null = drag ? rectFrom(drag.from, drag.to, 0) : null;
  const inset = useMemo(() => solveAlignment(annotation.pairs), [annotation.pairs]);
  const error = inset ? alignmentError(annotation.pairs, inset) : null;

  if (!reading.medianUrl) return <p className="games__empty">Pas de médiane de minimap pour {map} (analysis/map_mask.py).</p>;

  const chooseTool = (t: Tool) => {
    setTool(t);
    setPending(null);
    setDrag(null);
    setNote(null);
  };

  const onDown = (p: Pixel) => {
    setNote(null);
    if (tool === 'colors' && image) {
      update((a) => ({ ...a, colors: upsertColor(a.colors, pixelColor(image, p.x, p.y), cls) }));
    } else if (tool === 'tps' || tool === 'doors' || tool === 'align') {
      if (!pending || tool === 'align') return setPending(p.frac); // repère : le second clic se fait sur le plan
      update((a) => (tool === 'tps' ? { ...a, tps: [...a.tps, { from: pending, to: p.frac }] } : { ...a, doors: [...a.doors, { from: pending, to: p.frac, glass }] }));
      setPending(null);
    } else if (tool === 'spawns') {
      setDrag({ from: p.frac, to: p.frac });
    }
  };
  const onMove = (p: Pixel) => {
    if (drag) setDrag({ ...drag, to: p.frac });
  };
  const onUp = (p: Pixel) => {
    if (!drag) return;
    const rect = rectFrom(drag.from, p.frac);
    setDrag(null);
    if (!rect) return;
    const next = addSpawn(annotation.spawns, team, rect);
    if (!next) return setNote(`L'équipe ${team} a déjà ${MAX_SPAWNS_PER_TEAM} zones de départ : retire-en une d'abord.`);
    update((a) => ({ ...a, spawns: next }));
  };

  const onPlanClick = (p: Point) => {
    if (!pending) return;
    update((a) => {
      const pairs = [...a.pairs, { minimap: pending, plan: p }];
      return { ...a, pairs, inset: solveAlignment(pairs) ?? a.inset };
    });
    setPending(null);
  };

  const removeSegment = (key: 'tps' | 'doors', i: number) => update((a) => ({ ...a, [key]: a[key].filter((_, j) => j !== i) }) as MapAnnotation);
  const removePair = (i: number) =>
    update((a) => {
      const pairs = a.pairs.filter((_, j) => j !== i);
      return { ...a, pairs, inset: solveAlignment(pairs) };
    });

  return (
    <div className="mapping">
      <div className="mapping__bar" role="tablist" aria-label="Outils de cartographie">
        {TOOLS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tool === t.id} className={tool === t.id ? 'is-on' : ''} onClick={() => chooseTool(t.id)}>
            {t.label}
          </button>
        ))}
        <label className="mapping__zoom">
          Zoom{' '}
          <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
            {ZOOMS.map((z) => (
              <option key={z} value={z}>
                {z === 0 ? 'ajusté' : `x${z}`}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} /> Aperçu des classes
        </label>
      </div>

      <div className="mapping__body">
        <div className="mapping__left">
          {loaded && (
            <MappingCanvas
              url={reading.medianUrl}
              annotation={annotation}
              zoom={zoom}
              preview={preview}
              pendingPoint={pending}
              dragRect={dragRect}
              onImage={setImage}
              onHover={setHover}
              onDown={onDown}
              onMove={onMove}
              onUp={onUp}
            />
          )}
        </div>
        <div className="mapping__right">
          <Loupe image={image} pixel={hover} />
          {tool === 'colors' && (
            <ColorPanel
              annotation={annotation}
              cls={cls}
              onClass={setCls}
              onChange={(i, patch) => update((a) => ({ ...a, colors: a.colors.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))}
              onRemove={(i) => update((a) => ({ ...a, colors: a.colors.filter((_, j) => j !== i) }))}
            />
          )}
          {tool === 'tps' && (
            <div>
              <p className="mapping__hint">
                Clique une station, puis l'autre : une flèche à deux pointes est tracée (la tyrolienne marche dans les deux sens). Trace la flèche le long du trait qui relie les deux
                stations : sous elle, ce trait (de la couleur des murs) ne compte plus comme un mur, tant qu'il est fin et posé sur du sol. Garde la couleur des murs dans la classe Mur.
              </p>
              <ul className="mapping__list">
                {annotation.tps.map((t, i) => (
                  <li key={i}>
                    Tyrolienne {i + 1} : ({point(t.from)}) et ({point(t.to)})
                    <button onClick={() => removeSegment('tps', i)}>Retirer</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tool === 'doors' && (
            <div>
              <p className="mapping__hint">
                Clique les deux bouts d'une porte (hachures) pour la tracer. Une porte se traverse : le trait est rendu praticable. Coche « vitrée » quand la porte a une vitre. Les couleurs de
                portes se rangent aussi dans « Couleurs » (classes porte et porte vitrée).
              </p>
              <label>
                <input type="checkbox" checked={glass} onChange={(e) => setGlass(e.target.checked)} /> Porte vitrée
              </label>
              <ul className="mapping__list">
                {annotation.doors.map((d, i) => (
                  <li key={i}>
                    Porte {i + 1}
                    {d.glass ? ' vitrée' : ''}
                    <button onClick={() => removeSegment('doors', i)}>Retirer</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tool === 'spawns' && (
            <div>
              <p className="mapping__hint">
                Glisse un rectangle sur la zone de départ de l'équipe choisie ({MAX_SPAWNS_PER_TEAM} zones au plus par équipe : le départ de la vidéo peut différer du plan stratégique).
              </p>
              <div className="mapping__classes">
                {(['A', 'B'] as const).map((t) => (
                  <label key={t} className={`mapping__class${team === t ? ' is-on' : ''}`}>
                    <input type="radio" name="mapping-team" checked={team === t} onChange={() => setTeam(t)} /> Équipe {t} ({annotation.spawns[t].length}/{MAX_SPAWNS_PER_TEAM})
                  </label>
                ))}
              </div>
              <ul className="mapping__list">
                {(['A', 'B'] as const).flatMap((t) =>
                  annotation.spawns[t].map((_, i) => (
                    <li key={`${t}${i}`}>
                      Équipe {t}, zone {i + 1}
                      <button onClick={() => update((a) => ({ ...a, spawns: { ...a.spawns, [t]: a.spawns[t].filter((_r, j) => j !== i) } }))}>Retirer</button>
                    </li>
                  )),
                )}
              </ul>
            </div>
          )}
          {tool === 'align' &&
            (plan ? (
              <>
                <MappingPlan planUrl={plan} medianUrl={reading.medianUrl} pairs={annotation.pairs} inset={inset ?? annotation.inset} error={error} waiting={pending !== null} overlay onClick={onPlanClick} />
                <ul className="mapping__list">
                  {annotation.pairs.map((_, i) => (
                    <li key={i}>
                      Repère {i + 1}
                      <button onClick={() => removePair(i)}>Retirer</button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="games__empty">Pas de plan stratégique pour {map} dans l'application.</p>
            ))}
        </div>
      </div>

      <div className="mapping__actions">
        <button onClick={() => void save()} disabled={busy || !dirty}>
          Enregistrer
        </button>
        <button onClick={() => void apply()} disabled={busy}>
          Appliquer au programme
        </button>
        {dirty && <span className="mapping__dirty">Modifications non enregistrées</span>}
      </div>
      {note && <p className="mapping__message mapping__message--error">{note}</p>}
      {message && <p className={`mapping__message${message.error ? ' mapping__message--error' : ''}`}>{message.text}</p>}
      <p className="corridor__note">
        Atlantis et The Cliff ont un étage et un dessous où l'on peut se trouver : mets en « Sol » les couleurs des deux niveaux, le masque est l'union des deux. « Appliquer » remplace le
        masque, les tyroliennes, les départs et le cadre de cette carte par ce que tu as saisi, pour ce qui est renseigné (les détections automatiques sont écrasées). Les positions déjà
        enregistrées d'une game ne changent qu'au prochain recalcul.
      </p>
    </div>
  );
}
