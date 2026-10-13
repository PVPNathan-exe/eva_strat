// Cartographie à la main d'une carte (onglet Lecture, section pleine largeur) : pipette au pixel près pour ranger les couleurs de la minimap en classes (sol, mur, tir par-dessus,
// vue seulement, portes), stations de tyrolienne en cercles avec leur direction, portes et fenêtres tracées en traits (sens unique possible), carrés des points de capture
// (zones jouables), zones de départ (2 au plus par équipe) et alignement sur le plan. L'annotation est enregistrée en base, puis « Appliquer » la traduit en masque, murs,
// tyroliennes, portes, départs et cadre (analysis/map_annotations.py).

import { useMemo, useRef, useState } from 'react';
import { builtinMaps } from '../../lib/builtinMaps';
import {
  addSpawn,
  alignmentError,
  completePair,
  closesPolygon,
  findConflicts,
  separateTolerances,
  pixelColor,
  polygonFromRect,
  rectFrom,
  sideOf,
  solveAlignment,
  stationAngle,
  stationRadius,
  upsertColor,
  CLASS_INFO,
  MAX_CAPTURE_ZONES,
  MAX_OVERRIDES,
  MAX_POLYGON_POINTS,
  MIN_POLYGON_POINTS,
  MAX_SPAWNS_PER_TEAM,
  maxSpawns,
  type ClassName,
  type MapAnnotation,
  type Opening,
  type Point,
  type SpawnGroup,
} from '../../lib/mapAnnotation';
import { readingOf } from '../../lib/mapReading';
import { ColorPanel, Loupe } from './MappingColors';
import { MappingCanvas, type Pixel } from './MappingCanvas';
import { MappingPlan } from './MappingPlan';
import type { Draft } from './MappingShapes';
import { useMapAnnotation } from './useMapAnnotation';

type Tool = 'colors' | 'zones' | 'hors' | 'tps' | 'openings' | 'capture' | 'spawns' | 'align';
const TOOLS: { id: Tool; label: string }[] = [
  { id: 'colors', label: 'Couleurs' },
  { id: 'zones', label: 'Zones de classe' },
  { id: 'hors', label: 'Hors map' },
  { id: 'tps', label: 'Tyroliennes' },
  { id: 'openings', label: 'Portes et fenêtres' },
  { id: 'capture', label: 'Points de capture' },
  { id: 'spawns', label: 'Départs' },
  { id: 'align', label: 'Alignement' },
];
const OPENING_KINDS = [
  { id: 'porte', label: 'Porte (on la traverse)' },
  { id: 'porte_vitre', label: 'Porte vitrée (on la traverse et on voit à travers)' },
  { id: 'fenetre', label: 'Fenêtre (on voit seulement à travers)' },
  { id: 'mur', label: 'Trait de mur (infranchissable, par exemple dans un carré de capture)' },
  { id: 'tir', label: 'Trait de tir par-dessus (infranchissable, on tire par-dessus)' },
] as const;
type OpeningChoice = (typeof OPENING_KINDS)[number]['id'];
const ZOOMS = [0, 1, 2, 3, 4, 6]; // 0 : ajusté à la largeur
const NO_DRAFT: Draft = { pending: null, circle: null, awaitingDirection: false, first: null, segment: null, rect: null, anchor: null, poly: [], cursor: null };
const point = (p: Point) => p.map((v) => v.toFixed(3)).join(', ');
const direction = (angle: number | null) => (angle === null ? 'sans direction' : `direction ${Math.round(angle)} degrés`);

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
  const [draft, setDraftState] = useState<Draft>(NO_DRAFT);
  const draftRef = useRef<Draft>(NO_DRAFT); // lu par les gestes rapides (clic, glisser) avant que le rendu ne soit refait
  const setDraft = (d: Draft) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const [opening, setOpening] = useState<OpeningChoice>('porte');
  const [showConflicts, setShowConflicts] = useState(false);
  const [showPlan, setShowPlan] = useState(true);
  const [overrideFrom, setOverrideFrom] = useState<ClassName | 'any'>('tir');
  const [overrideTo, setOverrideTo] = useState<ClassName>('vue');
  const [oneWay, setOneWay] = useState(false);
  const [underNew, setUnderNew] = useState(false); // les prochains traits ou zones laissent passer par en dessous
  const [team, setTeam] = useState<SpawnGroup>('A');
  const [note, setNote] = useState<string | null>(null);

  const aspect = image ? image.width / image.height : 1;
  const canOneWay = opening === 'fenetre' || opening === 'porte_vitre'; // une porte sans vitre ou un mur ne laisse rien voir
  const inset = useMemo(() => solveAlignment(annotation.pairs), [annotation.pairs]);
  const error = inset ? alignmentError(annotation.pairs, inset) : null;
  const drawing = JSON.stringify(draft) !== JSON.stringify(NO_DRAFT);
  const conflicts = useMemo(() => (image ? findConflicts(image.data, annotation.colors) : null), [image, annotation.colors]);
  const polygonTool = tool === 'capture' || tool === 'zones' || tool === 'hors'; // outils où l'on trace un rectangle (glisser) ou une forme libre (clics)

  if (!reading.medianUrl) return <p className="games__empty">Pas de médiane de minimap pour {map} (analysis/map_mask.py).</p>;

  const reset = () => {
    setDraft(NO_DRAFT);
    setNote(null);
  };
  const chooseTool = (t: Tool) => {
    setTool(t);
    reset();
  };

  // Tyrolienne : cercle (glisser du centre au bord), puis un clic donne la direction d'entrée et de sortie (un clic dans le cercle : aucune direction) ; deux stations font une paire.
  const finishStation = (p: Point | 'opposite') => {
    const d = draftRef.current;
    const c = d.circle;
    if (!c) return;
    const station = { x: c.c[0], y: c.c[1], r: c.r, angle: p === 'opposite' ? null : stationAngle(c.c, p, c.r, aspect) };
    if (d.first) {
      // règle des 180 degrés : les deux stations d'une tyrolienne ont des directions opposées
      const pair = completePair(d.first, station);
      update((a) => ({ ...a, tps: [...a.tps, pair] }));
      setDraft(NO_DRAFT);
    } else {
      setDraft({ ...NO_DRAFT, first: station });
    }
  };

  const addOpening = (from: Point, to: Point, side: Opening['side']) =>
    update((a) => ({ ...a, doors: [...a.doors, { from, to, kind: opening === 'fenetre' || opening === 'mur' || opening === 'tir' ? opening : 'porte', glass: opening === 'porte_vitre', side, under: underNew && opening !== 'porte' && opening !== 'porte_vitre' }] }));

  const onDown = (p: Pixel) => {
    const d = draftRef.current;
    setNote(null);
    if (tool === 'colors' && image) {
      update((a) => ({ ...a, colors: upsertColor(a.colors, pixelColor(image, p.x, p.y), cls) }));
    } else if (tool === 'tps') {
      if (d.circle && d.awaitingDirection) return finishStation(p.frac);
      setDraft({ ...d, circle: { c: p.frac, r: stationRadius(p.frac, p.frac, aspect) }, awaitingDirection: false });
    } else if (tool === 'openings') {
      if (d.segment) {
        const side = sideOf(d.segment.from, d.segment.to, p.frac, aspect);
        if (side === 0) return;
        addOpening(d.segment.from, d.segment.to, side);
        return setDraft(NO_DRAFT);
      }
      if (!d.pending) return setDraft({ ...NO_DRAFT, pending: p.frac });
      if (oneWay && canOneWay) return setDraft({ ...NO_DRAFT, segment: { from: d.pending, to: p.frac } });
      addOpening(d.pending, p.frac, 0);
      setDraft(NO_DRAFT);
    } else if (polygonTool || tool === 'spawns') {
      // glisser trace un rectangle ; un simple clic (capture) pose un point de la forme libre
      setDraft({ ...d, rect: [p.frac[0], p.frac[1], p.frac[0], p.frac[1]], anchor: p.frac, cursor: p.frac });
    } else if (tool === 'align') {
      setDraft({ ...NO_DRAFT, pending: p.frac }); // le second clic se fait sur le plan
    }
  };

  const onMove = (p: Pixel) => {
    const d = draftRef.current;
    if (tool === 'tps' && d.circle && !d.awaitingDirection) {
      setDraft({ ...d, circle: { c: d.circle.c, r: stationRadius(d.circle.c, p.frac, aspect) } });
    } else if ((polygonTool || tool === 'spawns') && d.rect && d.anchor) {
      // le coin fixe est le point de départ du glisser (et non le coin haut gauche du rectangle) : on peut glisser vers la gauche et vers le haut
      const r = rectFrom(d.anchor, p.frac, 0);
      setDraft({ ...d, rect: r ?? d.rect, cursor: p.frac });
    } else if (d.pending || d.circle || d.segment) {
      setDraft({ ...d, cursor: p.frac });
    }
  };

  const onUp = (p: Pixel) => {
    const d = draftRef.current;
    if (tool === 'tps' && d.circle && !d.awaitingDirection) {
      // la première station a une direction : celle de la seconde est l'opposée, inutile de la cliquer
      if (d.first && d.first.angle !== null) return finishStation('opposite');
      return setDraft({ ...d, awaitingDirection: true, cursor: p.frac });
    }
    if ((polygonTool || tool === 'spawns') && d.rect && d.anchor) {
      const rect = rectFrom(d.anchor, p.frac);
      const keep = { ...d, rect: null, anchor: null };
      if (polygonTool) {
        if (tool === 'capture' ? annotation.capture.length >= MAX_CAPTURE_ZONES : annotation.overrides.length >= MAX_OVERRIDES) {
          setDraft(NO_DRAFT);
          return setNote(`Au plus ${tool === 'capture' ? MAX_CAPTURE_ZONES : MAX_OVERRIDES} zones.`);
        }
        // glisser sans forme en cours : un rectangle ; sinon (ou simple clic) : un point de la forme libre, et un clic sur le premier point la ferme
        if (rect && d.poly.length === 0) {
          setDraft(NO_DRAFT);
          return addPolygon(polygonFromRect(rect));
        }
        if (closesPolygon(d.poly, p.frac, aspect)) return closePolygon(d.poly);
        if (d.poly.length >= MAX_POLYGON_POINTS) return setDraft(keep);
        return setDraft({ ...keep, poly: [...d.poly, p.frac] });
      }
      setDraft(NO_DRAFT);
      if (!rect) return;
      const next = addSpawn(annotation.spawns, team, rect);
      if (!next) return setNote(`${team === 'any' ? 'Les zones neutres ont' : `L'équipe ${team} a`} déjà ${maxSpawns(team)} zones de départ : retire-en une d'abord.`);
      update((a) => ({ ...a, spawns: next }));
    }
  };

  // Forme terminée : zone de capture (jouable) ou zone de classe (remplace une classe par une autre).
  const addPolygon = (points: Point[]) => {
    if (tool === 'hors') update((a) => ({ ...a, overrides: [...a.overrides, { polygon: points, from: 'any', to: 'hors', under: false }] })); // hors de la carte : tout ce qui est dans la zone est retiré du masque
    else if (tool === 'zones') update((a) => ({ ...a, overrides: [...a.overrides, { polygon: points, from: overrideFrom, to: overrideTo, under: underNew }] }));
    else update((a) => ({ ...a, capture: [...a.capture, points] }));
    setDraft(NO_DRAFT);
  };
  const closePolygon = (points: Point[]) => {
    if (points.length >= MIN_POLYGON_POINTS) addPolygon(points);
  };

  const onPlanClick = (p: Point) => {
    const minimap = draftRef.current.pending;
    if (!minimap) return;
    update((a) => {
      const pairs = [...a.pairs, { minimap, plan: p }];
      return { ...a, pairs, inset: solveAlignment(pairs) ?? a.inset };
    });
    setDraft(NO_DRAFT);
  };

  const toggleUnder = (key: 'doors' | 'overrides', i: number) =>
    update((a) => ({ ...a, [key]: a[key].map((item, j) => (j === i ? { ...item, under: !item.under } : item)) }) as MapAnnotation);
  const without = <K extends 'tps' | 'doors' | 'capture' | 'overrides'>(key: K, i: number) => update((a) => ({ ...a, [key]: a[key].filter((_, j) => j !== i) }) as MapAnnotation);
  const removePair = (i: number) =>
    update((a) => {
      const pairs = a.pairs.filter((_, j) => j !== i);
      return { ...a, pairs, inset: solveAlignment(pairs) };
    });

  let hint = '';
  if (polygonTool) hint = draft.poly.length > 0 ? `Forme libre : ${draft.poly.length} point(s). Clique les autres coins ; un clic sur le premier point (ou « Fermer la forme ») la ferme.` : tool === 'zones' ? 'Glisse pour un rectangle, ou clique les coins de la zone (un clic sur le premier point la ferme).' : 'Glisse pour un rectangle, ou clique les coins d\'une forme libre (le point n\'est pas toujours un carré fermé).';
  if (tool === 'tps') {
    if (draft.awaitingDirection) hint = "Clique la direction dans laquelle on sort de la tyrolienne par cette station (on y entre en regardant à l'opposé ; un clic dans le cercle : aucune direction).";
    else if (draft.first) hint = "Station posée. Glisse du centre au bord de l'autre station pour tracer son cercle (sa direction se déduit de la première : 180 degrés).";
    else hint = "Glisse du centre au bord d'une station de tyrolienne pour tracer son cercle, puis clique la direction de sortie (le regard du joueur qui en sort : il y entre en regardant à l'opposé). Deux stations font une tyrolienne, valable dans les deux sens ; la direction de la seconde est toujours l'opposée de la première (180 degrés). Le programme s'en sert pour corriger le regard 0,3 s avant l'entrée et 0,3 s après la sortie.";
  } else if (tool === 'openings') {
    if (draft.segment) hint = "Clique le côté d'où l'on voit à travers (sens unique).";
    else if (draft.pending) hint = "Clique l'autre bout du trait.";
    else hint = "Clique les deux bouts du trait. Coche « sens unique » si l'on ne voit à travers que d'un côté : un troisième clic désigne ce côté.";
  }

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
          {loaded && <MappingCanvas url={reading.medianUrl} annotation={annotation} zoom={zoom} preview={preview} planDiff={showPlan && annotation.usePlan ? { added: reading.planAddedUrl, cut: reading.planCutUrl } : null} conflicts={showConflicts && conflicts ? conflicts.mask : null} draft={draft} onImage={setImage} onHover={setHover} onDown={onDown} onMove={onMove} onUp={onUp} />}
        </div>
        <div className="mapping__right">
          <Loupe image={image} pixel={hover} />
          <div className="mapping__draft-actions">
            <button onClick={() => closePolygon(draft.poly)} disabled={!(polygonTool && draft.poly.length >= MIN_POLYGON_POINTS)}>Fermer la forme</button>
            <button onClick={reset} disabled={!drawing}>Annuler le tracé</button>
          </div>
          {hint && <p className="mapping__hint">{hint}</p>}
          {tool === 'colors' && (
            <ColorPanel
              annotation={annotation}
              cls={cls}
              onClass={setCls}
              onChange={(i, patch) => update((a) => ({ ...a, colors: a.colors.map((c, j) => (j === i ? { ...c, ...patch } : c)) }))}
              onRemove={(i) => update((a) => ({ ...a, colors: a.colors.filter((_, j) => j !== i) }))}
              conflicts={conflicts?.pairs ?? []}
              showConflicts={showConflicts}
              onShowConflicts={setShowConflicts}
              onSeparate={() => update((a) => ({ ...a, colors: separateTolerances(a.colors) }))}
            />
          )}
          {tool === 'hors' && (
            <div>
              <p className="mapping__hint">
                Entoure ce qui est hors de la carte (rectangle au glisser, ou forme libre au clic) : tout ce qui est dans la zone est retiré du masque, quelle que soit sa couleur. Ni le plan ni les
                lectures ne le remplissent. C'est une classe de zone, pas une couleur de pixel : le fond de la minimap a parfois la couleur du sol.
              </p>
              <ul className="mapping__list">
                {annotation.overrides.flatMap((o, i) =>
                  o.to === 'hors'
                    ? [
                        <li key={i}>
                          Zone hors map {i + 1} ({o.polygon.length} points)
                          <button onClick={() => without('overrides', i)}>Retirer</button>
                        </li>,
                      ]
                    : [],
                )}
              </ul>
            </div>
          )}
          {tool === 'zones' && (
            <div>
              <p className="mapping__hint">
                Une même couleur peut désigner une fenêtre ici et une couverture basse ailleurs. Choisis la classe à remplacer et la nouvelle classe, puis entoure la zone (rectangle au glisser ou forme
                libre au clic) : dans cette zone, les pixels de la première classe prennent la seconde.
              </p>
              <label>
                <input type="checkbox" checked={underNew} onChange={(e) => setUnderNew(e.target.checked)} /> Passage possible en dessous (le sol de la zone reste praticable : bord d'étage où l'on tire par-dessus mais où l'on passe par le niveau du dessous)
              </label>
              <label>
                Remplacer{' '}
                <select value={overrideFrom} onChange={(e) => setOverrideFrom(e.target.value as ClassName | 'any')}>
                  <option value="any">tout pixel</option>
                  {CLASS_INFO.map((k) => (
                    <option key={k.name} value={k.name}>
                      {k.label}
                    </option>
                  ))}
                </select>{' '}
                par{' '}
                <select value={overrideTo} onChange={(e) => setOverrideTo(e.target.value as ClassName)}>
                  {CLASS_INFO.map((k) => (
                    <option key={k.name} value={k.name}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <ul className="mapping__list">
                {annotation.overrides.map((o, i) => (
                  <li key={i}>
                    Zone {i + 1} : {o.from === 'any' ? 'tout pixel' : CLASS_INFO.find((k) => k.name === o.from)?.label} devient {CLASS_INFO.find((k) => k.name === o.to)?.label} ({o.polygon.length} points)
                    <label>
                      <input type="checkbox" checked={o.under} onChange={() => toggleUnder('overrides', i)} /> passage en dessous
                    </label>
                    <button onClick={() => without('overrides', i)}>Retirer</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tool === 'tps' && (
            <div>
              <p className="mapping__hint">
                Le trait qui relie les deux centres sur la minimap a souvent la couleur des murs : sous ce trait, tant qu'il est fin et posé sur du sol, il ne compte plus comme un mur.
                Garde la couleur des murs dans la classe Mur.
              </p>
              <ul className="mapping__list">
                {annotation.tps.map((t, i) => (
                  <li key={i}>
                    Tyrolienne {i + 1} : ({point([t.a.x, t.a.y])}), {direction(t.a.angle)} de sortie et ({point([t.b.x, t.b.y])}), {direction(t.b.angle)} de sortie
                    <button onClick={() => without('tps', i)}>Retirer</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tool === 'openings' && (
            <div>
              <div className="mapping__classes">
                {OPENING_KINDS.map((k) => (
                  <label key={k.id} className={`mapping__class${opening === k.id ? ' is-on' : ''}`}>
                    <input type="radio" name="mapping-opening" checked={opening === k.id} onChange={() => setOpening(k.id)} /> {k.label}
                  </label>
                ))}
              </div>
              <label>
                <input type="checkbox" checked={underNew} disabled={opening === 'porte' || opening === 'porte_vitre'} onChange={(e) => setUnderNew(e.target.checked)} /> Passage possible en dessous (le trait bloque l'étage, pas le niveau du dessous)
              </label>
              <label>
                <input type="checkbox" checked={oneWay} disabled={!canOneWay} onChange={(e) => setOneWay(e.target.checked)} /> Sens unique (fenêtre ou porte vitrée visible d'un seul côté)
              </label>
              <ul className="mapping__list">
                {annotation.doors.map((d, i) => (
                  <li key={i}>
                    {d.kind === 'fenetre' ? 'Fenêtre' : d.kind === 'mur' ? 'Mur' : d.kind === 'tir' ? 'Tir par-dessus' : d.glass ? 'Porte vitrée' : 'Porte'} {i + 1}
                    {d.side !== 0 ? ' à sens unique' : ''}
                    {d.kind !== 'porte' && (
                      <label>
                        <input type="checkbox" checked={d.under} onChange={() => toggleUnder('doors', i)} /> passage en dessous
                      </label>
                    )}
                    <button onClick={() => without('doors', i)}>Retirer</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tool === 'capture' && (
            <div>
              <p className="mapping__hint">Entoure chaque point de capture, en rectangle (glisser) ou en forme libre (clics sur les coins, comme le point central de Polaris qui n'est pas fermé) : c'est une zone jouable, même si sa couleur (teintée par l'équipe qui le tient) n'est pas celle du sol. Les murs de l'intérieur restent des murs : classe leur couleur en Mur, ou trace-les dans « Portes et fenêtres » (trait de mur).</p>
              <ul className="mapping__list">
                {annotation.capture.map((_, i) => (
                  <li key={i}>
                    Zone {i + 1} ({annotation.capture[i].length} points)
                    <button onClick={() => without('capture', i)}>Retirer</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {tool === 'spawns' && (
            <div>
              <p className="mapping__hint">
                Glisse un rectangle sur la zone de départ de l'équipe choisie ({MAX_SPAWNS_PER_TEAM} zones au plus par équipe : le départ de la vidéo peut différer du plan stratégique). Zones neutres
                (Outlaw : 4 zones où n'importe quel joueur réapparaît, quelle que soit son équipe) : {maxSpawns('any')} au plus, elles comptent pour les deux équipes.
              </p>
              <div className="mapping__classes">
                {(['A', 'B', 'any'] as const).map((t) => (
                  <label key={t} className={`mapping__class${team === t ? ' is-on' : ''}`}>
                    <input type="radio" name="mapping-team" checked={team === t} onChange={() => setTeam(t)} /> {t === 'any' ? 'Neutres (toutes équipes)' : `Équipe ${t}`} ({annotation.spawns[t].length}/{maxSpawns(t)})
                  </label>
                ))}
              </div>
              <ul className="mapping__list">
                {(['A', 'B', 'any'] as const).flatMap((t) =>
                  annotation.spawns[t].map((_, i) => (
                    <li key={`${t}${i}`}>
                      {t === 'any' ? 'Zone neutre' : `Équipe ${t}, zone`} {i + 1}
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
                <MappingPlan planUrl={plan} medianUrl={reading.medianUrl} pairs={annotation.pairs} inset={inset ?? annotation.inset} error={error} waiting={draft.pending !== null} overlay onClick={onPlanClick} />
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
      <div className="mapping__plan-option">
        <label>
          <input type="checkbox" checked={annotation.usePlan} onChange={(e) => update((a) => ({ ...a, usePlan: e.target.checked }))} /> Corriger le masque avec le plan stratégique et les positions lues à l'application (le plan nécessite le cadre de l'outil Alignement)
        </label>
        <label>
          <input type="checkbox" checked={showPlan} disabled={!annotation.usePlan} onChange={(e) => setShowPlan(e.target.checked)} /> Montrer les corrections du dernier « Appliquer » (blanc : sol ajouté, magenta : mur du plan retiré)
        </label>
        <details className="help">
          <summary>Ce que fait la correction par le plan</summary>
          <p className="help__body">
          Le plan ajoute le sol que la saisie a oublié à l'intérieur de l'arène, retire les murs du plan sur lesquels la saisie dit « praticable » et tout ce qui est hors de l'arène. Les positions lues avec certitude (soutenues par une autre lecture voisine) rendent ensuite praticable l'endroit où un joueur a été lu, même sur un contour classé en mur (les joueurs peuvent passer en dessous d'un étage). Il n'est utilisé que si son sol ressemble à celui de la
          minimap (Atlantis : +9 % de sol) : sinon (Polaris, Artefact) le programme le refuse, comme il refuse toute correction qui ferait refuser plus de lectures sûres.
          </p>
        </details>
      </div>
      {note && <p className="mapping__message mapping__message--error">{note}</p>}
      {message && <p className={`mapping__message${message.error ? ' mapping__message--error' : ''}`}>{message.text}</p>}
      <details className="help">
        <summary>Ce que fait « Appliquer au programme »</summary>
        <p className="help__body">
        Atlantis et The Cliff ont un étage et un dessous où l'on peut se trouver : mets en « Sol » les couleurs des deux niveaux, le masque est l'union des deux. « Appliquer » remplace le
        masque, les tyroliennes, les départs et le cadre de cette carte par ce que tu as saisi, pour ce qui est renseigné (les détections automatiques sont écrasées) ; un masque qui
        refuserait plus de 1 % des positions sûres de la carte n'est pas écrit. Les positions déjà enregistrées d'une game ne changent qu'au prochain recalcul.
        </p>
      </details>
    </div>
  );
}
