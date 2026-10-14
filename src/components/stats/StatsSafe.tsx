// Vue Zones sûres : à un instant choisi au curseur, les zones couvertes par une seule équipe (sûres pour elle) et celles couvertes par les deux.
// Un joueur vivant couvre ce qu'il voit à moins de la portée utile de son arme (lib/weaponRange.ts), dans toutes les directions : le regard n'est pas utilisé.
// Le calcul se fait pour l'instant choisi seulement, avec un cache par instant (lib/safeZones.ts). Plan et cadre : StatsMapBase.

import { useDeferredValue, useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { numberOfSlot } from '../../lib/killTimeline';
import { readingOf, rotorsOf } from '../../lib/mapReading';
import { computeInstant, createCache, indexSamples, positionsAt, shootersAt, type Instant, type ZoneColors } from '../../lib/safeZones';
import { formatTime } from '../../lib/timeline';
import { buildGrid, type GraySource, type Segment, type SightMode } from '../../lib/visibility';
import type { TeamSide } from '../../types/stats';
import { analysisApi } from '../../lib/analysisApi';
import { noticeOf, tokenRgb, useLoad, useSamples, type StatsGame } from './useStats';
import { SafeZoneLayer } from './SafeZoneLayer';
import { StatsMapBase } from './StatsMapBase';

/** Cartes où une porte s'actionne avec un bouton (comme db.BUTTON_DOOR_MAPS) : l'état de la porte n'est pas lu, on propose de la fermer. */
const BUTTON_DOOR_MAPS = ['Reef Point'];
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
}

/** Masque des couloirs et image des classes d'une carte (tir par-dessus, fenêtres, portes vitrées). */
async function loadSources(map: string): Promise<Sources> {
  const url = readingOf(map).maskUrl;
  if (!url) throw new Error(`Pas de masque des couloirs pour la carte ${map}`);
  const classesUrl = classesUrlOf(map);
  return { walk: await loadGray(url), classes: classesUrl ? await loadGray(classesUrl).catch(() => null) : null };
}

const metres = (m: number) => `${m.toFixed(m % 1 ? 1 : 0).replace('.', ',')} m`;
const percent = (part: number, whole: number) => (whole > 0 ? `${((100 * part) / whole).toFixed(1).replace('.', ',')} %` : '0 %');

interface Props {
  map: string;
  games: StatsGame[];
  team: TeamSide | 'all';
  slot: number;
}

export function StatsSafe({ map, games, team, slot }: Props) {
  const [gameId, setGameId] = useState<number | null>(null);
  const [time, setTime] = useState(60);
  const [mode, setMode] = useState<SightMode>('balles');
  const [outlines, setOutlines] = useState(false);
  const [pins, setPins] = useState(true);
  const [doorsClosed, setDoorsClosed] = useState(false);
  const game = games.find((g) => g.id === gameId) ?? games[0] ?? null;
  const gameList = useMemo(() => (game ? [game] : []), [game]);

  const sources = useLoad(`safe-sources:${map}`, () => loadSources(map));
  const samples = useSamples(gameList, true);
  const weapons = useLoad('safe-weapons', () => analysisApi.weapons()); // identifiants d'icônes vers noms d'armes
  const iconNames = useMemo(() => Object.fromEntries((weapons.data ?? []).filter((w) => w.name).map((w) => [w.id, w.name])), [weapons.data]);
  const index = useMemo(() => indexSamples(samples.data?.get(game?.id ?? -1) ?? []), [samples.data, game]);
  const tMax = useMemo(() => Math.max(1, ...[...index.values()].map((list) => list[list.length - 1]?.t ?? 0)), [index]);
  const base = useMemo(() => (sources.data ? buildGrid(sources.data.walk, sources.data.classes, mode, GRID_SIZE) : null), [sources.data, mode]);
  const rotors = useMemo(() => rotorsOf(map), [map]);
  const doors = useMemo<Segment[]>(() => readingOf(map).openings.filter((o) => o.kind === 'porte' && !o.glass).map((o) => [o.from, o.to] as Segment), [map]);
  const hasDoors = BUTTON_DOOR_MAPS.includes(map) && doors.length > 0;
  const cache = useMemo(() => createCache<Instant>(), []);

  const deferredTime = useDeferredValue(time); // le curseur reste fluide, le calcul suit
  const t = Math.round(Math.min(deferredTime, tMax));
  const instant = useMemo(() => {
    if (!base || !game) return null;
    const closed = hasDoors && doorsClosed;
    const key = `${map}|${game.id}|${mode}|${closed}|${t}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const shooters = shootersAt(positionsAt(index, t), game.players, iconNames);
    const value = computeInstant({ base, mode, doors: closed ? doors : null, rotors, t, shooters });
    cache.set(key, value);
    return value;
  }, [base, game, map, mode, hasDoors, doorsClosed, doors, rotors, index, t, cache, iconNames]);

  const colors = useMemo<ZoneColors>(() => ({ a: tokenRgb('--c-owner-a', [255, 159, 28]), b: tokenRgb('--c-owner-b', [61, 139, 255]), contested: tokenRgb('--c-owner-none', [91, 99, 120]), alpha: ALPHA }), []);

  const notice = noticeOf(sources, samples, weapons);
  const nameA = game?.teamA ? `orange (${game.teamA})` : 'orange';
  const nameB = game?.teamB ? `bleue (${game.teamB})` : 'bleue';
  const shooters = instant?.result.shooters ?? [];
  const estimated = shooters.filter((s) => s.estimated).length;
  const counts = instant?.counts;
  const nameOf = (s: number) => game?.players.find((p) => p.slot === s)?.name;

  return (
    <div className="stats__view">
      <div className="stats__bar">
        {games.length > 1 && (
          <label className="stats__field">
            Game
            <select value={game?.id ?? ''} onChange={(e) => setGameId(Number(e.target.value))}>
              {games.map((g) => (
                <option key={g.id} value={g.id}>
                  Game {g.id}
                  {g.teamA || g.teamB ? ` : ${g.teamA ?? '?'} contre ${g.teamB ?? '?'}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <details className="menu">
          <summary>
            <SlidersHorizontal className="ic" /> Affichage
          </summary>
          <div className="menu__panel">
            <label className="stats__field">
              Une zone est couverte quand
              <select value={mode} onChange={(e) => setMode(e.target.value as SightMode)}>
                <option value="balles">une balle peut l'atteindre (vitres et fenêtres bloquent)</option>
                <option value="vue">on peut la voir (vitres et fenêtres laissent voir)</option>
              </select>
            </label>
            <label><input type="checkbox" checked={pins} onChange={(e) => setPins(e.target.checked)} /> Joueurs</label>
            <label><input type="checkbox" checked={outlines} onChange={(e) => setOutlines(e.target.checked)} /> Contours de vue</label>
            {hasDoors && <label><input type="checkbox" checked={doorsClosed} onChange={(e) => setDoorsClosed(e.target.checked)} /> Portes à bouton fermées</label>}
          </div>
        </details>
        <label className="stats__range safe__time">
          Instant de la game : {formatTime(t)}
          <input type="range" min={0} max={Math.floor(tMax)} step={1} value={Math.min(time, Math.floor(tMax))} onChange={(e) => setTime(Number(e.target.value))} />
        </label>
        <span className="safe__legend" aria-label="Légende des zones">
          <span className="safe__key safe__key--A">Sûre pour l'orange</span>
          <span className="safe__key safe__key--B">Sûre pour la bleue</span>
          <span className="safe__key safe__key--both">Couverte par les deux</span>
        </span>
      </div>
      {notice && <p className="stats__empty">{notice}</p>}
      {!notice && instant && shooters.length === 0 && <p className="stats__empty">Aucun joueur vivant lu à cet instant : déplacer le curseur.</p>}
      {!notice && counts && shooters.length > 0 && (
        <p className="stats__count">
          Sûre pour l'équipe {nameA} : {percent(counts.safeA, counts.open)} ; pour l'équipe {nameB} : {percent(counts.safeB, counts.open)} ; couverte par les deux : {percent(counts.contested, counts.open)} ; personne :{' '}
          {percent(counts.uncovered, counts.open)} (de la surface praticable)
          {estimated > 0 && ` ; portée estimée pour ${estimated} joueur${estimated > 1 ? 's' : ''} sur ${shooters.length}`}
          {` ; calcul ${instant?.ms.toFixed(0)} ms`}
        </p>
      )}
      <StatsMapBase map={map} spawns>
        {({ boxStyle }) =>
          instant && shooters.length > 0 ? <SafeZoneLayer result={instant.result} colors={colors} boxStyle={boxStyle} only={team === 'all' ? 'all' : team} outlines={slot ? slot : outlines} pins={pins} /> : null
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
          À l'instant du curseur, chaque joueur vivant couvre les cases de la minimap qu'il voit en ligne droite, dans toutes les directions, à moins de la portée utile de son arme (la distance jusqu'à laquelle les
          dégâts restent à 50 % ou plus du maximum, d'après les bandes de dégâts de l'onglet Stratégie ; une arme dont les dégâts ne tombent jamais sous ce seuil n'a pas de limite). Une zone couverte par une seule équipe
          est sûre pour elle. Les murs bloquent ; le tir par-dessus laisse passer ; une vitre, une fenêtre bloquent les balles mais laissent voir (choix du menu Affichage) ; une porte est considérée ouverte, sauf si on
          ferme les portes à bouton (Reef Point). Sur Engine les anneaux sont placés à l'instant choisi. Limites : le regard et les gadgets ne sont pas utilisés, les cartes à deux étages (Atlantis, The Cliff) mélangent
          les deux niveaux, et les positions peu sûres du suivi décalent les zones. Avec un seul joueur sélectionné dans les filtres, seul son contour de vue est dessiné.
        </p>
      </details>
    </div>
  );
}
