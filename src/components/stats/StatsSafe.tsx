// Vue Zones sûres : à un instant choisi au curseur, les zones couvertes par une seule équipe (sûres pour elle) et celles couvertes par les deux.
// Chaque joueur vivant a une zone de tir (balles) et une zone de vision (les vitres laissent voir), dans toutes les directions : le regard n'est pas utilisé (lib/safeZones.ts, weaponRange.ts).
// Les portes sont fermées sauf si un joueur est tout près. Le calcul se fait pour l'instant choisi seulement, avec un cache par instant. Plan et cadre : StatsMapBase.

import { useDeferredValue, useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { numberOfSlot } from '../../lib/killTimeline';
import { readingOf, rotorsOf } from '../../lib/mapReading';
import { computeInstant, createCache, indexSamples, positionsAt, shootersAt, withLevels, type CoverMode, type Instant, type ZoneColors, type ZoneShow } from '../../lib/safeZones';
import { formatTime } from '../../lib/timeline';
import { buildGrid, DOOR_OPEN_M, type GraySource, type Segment } from '../../lib/visibility';
import { keptSides, sideOfTeam, wantedSlot, type FollowSpec } from '../../lib/teamFollow';
import { analysisApi } from '../../lib/analysisApi';
import { statsApi } from '../../lib/statsApi';
import { TWO_LEVEL_MAPS } from '../../lib/twoLevelMaps';
import { noticeOf, tokenRgb, useLoad, useSamples, type StatsGame } from './useStats';
import { SafeZoneLayer } from './SafeZoneLayer';
import { StatsMapBase } from './StatsMapBase';

const GRID_SIZE = 200; // côté de la grille de calcul (le masque fait 400 sur 400)
const ALPHA = 150; // opacité de la couche, 0 à 255

const classUrls = import.meta.glob('../../../analysis/map_masks/*_classes.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const classesUrlOf = (map: string) => Object.entries(classUrls).find(([path]) => path.endsWith(`/${map}_classes.png`))?.[1] ?? null;

/** Image décodée en niveaux de gris (le canal rouge) : les masques sont en gris. */
function loadGray(url: string): Promise<GraySource> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return reject(new Error('Canevas indisponible'));
      ctx.drawImage(img, 0, 0);
      const rgba = ctx.getImageData(0, 0, img.width, img.height).data;
      const data = new Uint8Array(img.width * img.height);
      for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4];
      resolve({ w: img.width, h: img.height, data });
    };
    img.onerror = () => reject(new Error(`Image illisible : ${url}`));
    img.src = url;
  });
}

interface Sources {
  walk: GraySource;
  classes: GraySource | null;
  /** Cartes à deux étages : sol réservé au niveau du dessous (image `_dessous.png`), ou null. */
  under: GraySource | null;
}

/** Masque des couloirs, image des classes (tir par-dessus, fenêtres, portes vitrées) et image « dessous » d'une carte. */
async function loadSources(map: string): Promise<Sources> {
  const reading = readingOf(map);
  if (!reading.maskUrl) throw new Error(`Pas de masque des couloirs pour la carte ${map}`);
  const classesUrl = classesUrlOf(map);
  return {
    walk: await loadGray(reading.maskUrl),
    classes: classesUrl ? await loadGray(classesUrl).catch(() => null) : null,
    under: reading.underUrl ? await loadGray(reading.underUrl).catch(() => null) : null,
  };
}

const metres = (m: number) => `${m.toFixed(m % 1 ? 1 : 0).replace('.', ',')} m`;
const percent = (part: number, whole: number) => (whole > 0 ? `${((100 * part) / whole).toFixed(1).replace('.', ',')} %` : '0 %');

interface Props {
  map: string;
  /** Game dont on regarde un instant (choisie dans la barre de l'onglet). */
  replay: StatsGame;
  spec: FollowSpec;
}

export function StatsSafe({ map, replay, spec }: Props) {
  const [time, setTime] = useState(60);
  const [mode, setMode] = useState<CoverMode>('tous');
  const [show, setShow] = useState<ZoneShow>('safe');
  const [outlines, setOutlines] = useState(false);
  const [pins, setPins] = useState(true);
  const [doorsAlwaysOpen, setDoorsAlwaysOpen] = useState(false);
  const game = replay;
  const gameList = useMemo(() => [game], [game]);

  const sources = useLoad(`safe-sources:${map}`, () => loadSources(map));
  const samples = useSamples(gameList, true);
  const weapons = useLoad('safe-weapons', () => analysisApi.weapons()); // identifiants d'icônes vers noms d'armes
  const iconNames = useMemo(() => Object.fromEntries((weapons.data ?? []).filter((w) => w.name).map((w) => [w.id, w.name])), [weapons.data]);
  const levels = useLoad(TWO_LEVEL_MAPS.includes(map) ? `safe-levels:${game.id}` : null, () => statsApi.levels(game.id)); // niveau des joueurs (tyroliennes), cartes à deux étages seulement
  const levelRows = levels.data;
  const index = useMemo(() => indexSamples(samples.data?.get(game?.id ?? -1) ?? []), [samples.data, game]);
  const tMax = useMemo(() => Math.max(1, ...[...index.values()].map((list) => list[list.length - 1]?.t ?? 0)), [index]);
  const base = useMemo(() => (sources.data ? buildGrid(sources.data.walk, sources.data.classes, 'balles', GRID_SIZE, sources.data.under) : null), [sources.data]); // les deux couches (balles, vue) sont dans la grille
  const rotors = useMemo(() => rotorsOf(map), [map]);
  const doors = useMemo<Segment[]>(() => readingOf(map).openings.filter((o) => o.kind === 'porte' && !o.glass).map((o) => [o.from, o.to] as Segment), [map]);
  const glassDoors = useMemo<Segment[]>(() => readingOf(map).openings.filter((o) => o.kind === 'porte' && o.glass).map((o) => [o.from, o.to] as Segment), [map]);
  const hasDoors = doors.length + glassDoors.length > 0;
  const cache = useMemo(() => createCache<Instant>(), []);

  const deferredTime = useDeferredValue(time); // le curseur reste fluide, le calcul suit
  const t = Math.round(Math.min(deferredTime, tMax));
  const instant = useMemo(() => {
    if (!base || !game) return null;
    const key = `${map}|${game.id}|${mode}|${doorsAlwaysOpen}|${levelRows ? levelRows.length : -1}|${t}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const shooters = withLevels(shootersAt(positionsAt(index, t), game.players, iconNames), levelRows, t);
    const value = computeInstant({ base, mode, doors: doorsAlwaysOpen ? null : doors, glassDoors: doorsAlwaysOpen ? null : glassDoors, rotors, t, shooters });
    cache.set(key, value);
    return value;
  }, [base, game, map, mode, doorsAlwaysOpen, doors, glassDoors, rotors, index, t, cache, iconNames, levelRows]);

  const notice = noticeOf(sources, samples, weapons);
  const nameA = game.teamA ? `orange (${game.teamA})` : 'orange';
  const nameB = game.teamB ? `bleue (${game.teamB})` : 'bleue';
  // Zones montrées : les deux équipes, ou seulement celle que le réglage garde (équipe suivie seule, adversaires seuls, côté choisi)
  const sides = keptSides(game, spec);
  const only = sides.length === 1 ? sides[0] : 'all';
  const wanted = wantedSlot(game, spec);
  const mine = sideOfTeam(game, spec.team); // côté de l'équipe suivie dans cette game
  // Palette fixe de l'onglet : l'équipe suivie prend la couleur « a » (--c-owner-a), ses adversaires la « b », quel que soit leur côté
  const swap = mine === 'B';
  const colors = useMemo<ZoneColors>(() => {
    const a = tokenRgb('--c-owner-a', [255, 159, 28]);
    const b = tokenRgb('--c-owner-b', [61, 139, 255]);
    return { a: swap ? b : a, b: swap ? a : b, contested: tokenRgb('--c-owner-none', [91, 99, 120]), alpha: ALPHA };
  }, [swap]);
  const shooters = instant?.result.shooters ?? [];
  const estimated = shooters.filter((s) => s.estimated).length;
  const counts = instant?.counts;
  const nameOf = (s: number) => game.players.find((p) => p.slot === s)?.name;
  const keyClass = (side: 'A' | 'B') => `safe__key--${swap ? (side === 'A' ? 'B' : 'A') : side}`; // couleur de la pastille de légende d'un côté
  const unknownLevel = instant?.unknownLevel ?? 0;

  return (
    <div className="stats__view">
      <div className="stats__bar">
        <details className="menu">
          <summary>
            <SlidersHorizontal className="ic" /> Affichage
          </summary>
          <div className="menu__panel">
            <label className="stats__field">
              Une zone est couverte quand
              <select value={mode} onChange={(e) => setMode(e.target.value as CoverMode)}>
                <option value="tous">un joueur la voit ou peut la tirer (règle des zones sûres)</option>
                <option value="balles">une balle peut l'atteindre (vitres et fenêtres bloquent)</option>
                <option value="vue">on peut la voir (vitres et fenêtres laissent voir)</option>
              </select>
            </label>
            <label className="stats__field">
              Zone montrée
              <select value={show} onChange={(e) => setShow(e.target.value as ZoneShow)}>
                <option value="safe">zones sûres</option>
                <option value="shot">zone de tir seule</option>
                <option value="seen">zone de vision seule</option>
              </select>
            </label>
            <label><input type="checkbox" checked={pins} onChange={(e) => setPins(e.target.checked)} /> Joueurs</label>
            <label><input type="checkbox" checked={outlines} onChange={(e) => setOutlines(e.target.checked)} /> Contours de vue</label>
            {hasDoors && <label><input type="checkbox" checked={doorsAlwaysOpen} onChange={(e) => setDoorsAlwaysOpen(e.target.checked)} /> Portes toujours ouvertes</label>}
          </div>
        </details>
        <label className="stats__range safe__time">
          Instant de la game : {formatTime(t)}
          <input type="range" min={0} max={Math.floor(tMax)} step={1} value={Math.min(time, Math.floor(tMax))} onChange={(e) => setTime(Number(e.target.value))} />
        </label>
        <span className="safe__legend" aria-label="Légende des zones">
          <span className={`safe__key ${keyClass('A')}`}>Sûre pour l'orange{mine === 'A' ? ' (équipe suivie)' : ''}</span>
          <span className={`safe__key ${keyClass('B')}`}>Sûre pour la bleue{mine === 'B' ? ' (équipe suivie)' : ''}</span>
          <span className="safe__key safe__key--both">Couverte par les deux</span>
        </span>
      </div>
      {notice && <p className="stats__empty">{notice}</p>}
      {!notice && instant && shooters.length === 0 && <p className="stats__empty">Aucun joueur vivant lu à cet instant : déplacer le curseur.</p>}
      {!notice && counts && shooters.length > 0 && (
        <p className="stats__count">
          Sûre pour l'équipe {nameA}{mine === 'A' ? ' (équipe suivie)' : ''} : {percent(counts.safeA, counts.open)} ; pour l'équipe {nameB}{mine === 'B' ? ' (équipe suivie)' : ''} : {percent(counts.safeB, counts.open)} ; couverte par les deux :{' '}
          {percent(counts.contested, counts.open)} ; personne : {percent(counts.uncovered, counts.open)} (de la surface praticable)
          {mode === 'tous' && ` ; vue sans être à portée de tir : orange ${percent(counts.sightOnlyA, counts.open)}, bleue ${percent(counts.sightOnlyB, counts.open)}`}
          {estimated > 0 && ` ; portée estimée pour ${estimated} joueur${estimated > 1 ? 's' : ''} sur ${shooters.length}`}
          {` ; calcul ${instant?.ms.toFixed(0)} ms`}
        </p>
      )}
      {!notice && unknownLevel > 0 && <p className="stats__empty">Niveau des joueurs non calculé pour cette game (lancer npm run stats) : les deux étages sont mélangés.</p>}
      <StatsMapBase map={map} spawns>
        {({ boxStyle, warp }) =>
          instant && shooters.length > 0 ? (
            <SafeZoneLayer
              result={instant.result}
              colors={colors}
              boxStyle={boxStyle}
              warp={warp}
              only={only}
              outlines={wanted ? wanted : outlines}
              pins={pins}
              show={show}
              outlineKind={show === 'shot' ? 'tir' : 'vue'}
              doors={instant.doors}
              swapColors={swap}
            />
          ) : null
        }
      </StatsMapBase>
      {shooters.length > 0 && (
        <details className="help">
          <summary>Portées utilisées à cet instant</summary>
          <ul className="help__body safe__ranges">
            {shooters.map((s) => (
              <li key={s.slot}>
                N° {numberOfSlot(s.slot)}
                {nameOf(s.slot) ? ` (${nameOf(s.slot)})` : ''} : {s.estimated ? `portée estimée ${s.open ? 'sans limite' : metres(s.rangeM)} (équipement non lu, médiane des armes de la game)` : `${s.weapon} : ${s.open ? 'sans limite' : metres(s.rangeM)}`}
              </li>
            ))}
          </ul>
        </details>
      )}
      <details className="help">
        <summary>Comment lire les zones sûres</summary>
        <p className="help__body">
          À l'instant du curseur, chaque joueur vivant a deux zones. Sa zone de vision : les cases qu'il voit en ligne droite, dans toutes les directions (le regard n'est pas utilisé), jusqu'à la portée de son arme ;
          les vitres et les fenêtres laissent voir. Sa zone de tir : les cases qu'une balle peut atteindre, à moins de la portée utile de son arme (la distance jusqu'à laquelle les dégâts restent à 50 % ou plus du
          maximum, d'après les bandes de dégâts de l'onglet Stratégie ; sans limite si les dégâts ne tombent jamais sous ce seuil) ; les vitres, les fenêtres et les portes fermées bloquent les balles. Une case est
          couverte par une équipe quand un de ses joueurs la voit ou peut la tirer ; elle est sûre pour une équipe quand elle est couverte par elle seule. Une case vue par l'ennemi à travers une vitre n'est donc pas
          sûre : elle est repérée, même si aucune balle ne peut l'atteindre (le chiffre « vue sans être à portée de tir » les compte). Les murs bloquent tout ; le tir par-dessus laisse passer la vue et les balles. Les
          portes sont fermées (elles bloquent la vue et les balles) sauf quand un joueur, de n'importe quelle équipe, est à moins de {DOOR_OPEN_M} m : elles s'ouvrent alors (vert : ouverte, rouge : fermée, pointillé :
          vitrée). Sur Engine les anneaux sont placés à l'instant choisi. Sur Atlantis et The Cliff, un joueur à l'étage voit avec la grille de son étage, les autres avec la grille commune. Le niveau vient des tyroliennes : un joueur
          n'est à l'étage que s'il en a pris une vers le haut avant (une par game en moyenne sur les games mesurées, 1 à 2 % du temps à l'étage), les escaliers ne sont pas pris en compte. Limites : le regard et les gadgets ne sont pas utilisés, la distance d'ouverture des portes ({DOOR_OPEN_M} m) est une hypothèse, et les positions peu sûres du suivi décalent les
          zones. Avec un seul joueur sélectionné dans les filtres, seul son contour de vue est dessiné.
        </p>
      </details>
    </div>
  );
}
