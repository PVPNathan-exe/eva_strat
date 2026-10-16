// Vue Rotations : une rotation est un changement du POINT ACTIF (Outlaw, Atlantis, Engine : lu sur le HUD sous le chrono ou sur les boîtes de la minimap). Deux présentations, une à la fois :
// « Game rejouée » (chronologie du point actif et des propriétaires, curseur, plan avec les pions des deux équipes, ancien et nouveau point entourés, panneau « 20 s avant, 20 s après »
// par équipe) et « Cumul » (schéma RotationFlow de chaque équipe sur les games retenues). Les cartes à un seul point n'ont pas de rotation. Temps en secondes depuis le début de la game.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import {
  buildLanes,
  episodeInScope,
  episodesByPalette,
  paletteOfSide,
  pointsOf,
  positionsAt,
  sideName,
  toneOfOwner,
  type EpisodeMark,
  type OwnerBand,
} from '../../lib/episodeClock';
import { MIN_EPISODES, percent, rateOf, rotationFlow, rotationInfo } from '../../lib/episodeFormat';
import { pointRectsOf } from '../../lib/pointRects';
import { flowOfTeam, resultOf, rotationEvents, rotationMark, rotationSeek, ROT_AFTER_S, ROT_BEFORE_S, winnerSentence, type RotationEvent } from '../../lib/rotationWindow';
import { statsApi } from '../../lib/statsApi';
import { paletteNames, paletteOf, type FollowSpec, type Palette } from '../../lib/teamFollow';
import { formatTime } from '../../lib/timeline';
import type { Episode, TeamSide } from '../../types/stats';
import { EpisodeMap, type Ring } from './EpisodeMap';
import { GameClock } from './GameClock';
import { PointTimeline } from './PointTimeline';
import { RotationFlow } from './RotationFlow';
import { RotationWindow } from './RotationWindow';
import { useReplayIndex, useStripData } from './useEpisodeData';
import { useGameClock } from './useGameClock';
import { durationOf, noticeOf, useLoad, type StatsGame } from './useStats';

interface Props {
  map: string;
  /** Games retenues (cumul). */
  games: StatsGame[];
  /** Game rejouée (chronologie et plan). */
  replay: StatsGame;
  spec: FollowSpec;
}

type Verdict = 'ok' | 'ko' | null;
type Mode = 'game' | 'cumul';

/** Cartes à plusieurs points dont le point actif est lu (HUD de analysis/hud_points.py, ou boîtes de la minimap sur Outlaw). */
const ROTATION_MAPS = ['Outlaw', 'Atlantis', 'Engine'];

export function StatsRotations(props: Props) {
  if (!ROTATION_MAPS.includes(props.map)) {
    return (
      <div className="stats__view eps">
        <p className="stats__empty">La carte {props.map} n'a qu'un seul point de capture : il n'y a pas de rotation à lire. Les rotations existent sur Outlaw, Atlantis et Engine (le point actif change).</p>
      </div>
    );
  }
  return <RotationsView {...props} />;
}

function RotationsView({ map, games, replay, spec }: Props) {
  const [mode, setMode] = useState<Mode>('game');
  const [corridors, setCorridors] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const load = useLoad(`rotations:${map}`, () => statsApi.episodesOfMap(map, 'rotation'));
  const strip = useStripData(replay.id);
  const positions = useReplayIndex(replay);
  const clock = useGameClock(`rotations:${replay.id}`, durationOf(replay));
  const rects = useMemo(() => pointRectsOf(map), [map]);
  const toneOf = useMemo(() => (owner: TeamSide | 'none') => toneOfOwner(replay, spec, owner), [replay, spec]);

  // Changements de point actif de la game rejouée (au moins un des deux épisodes dans le réglage d'équipe et de joueur)
  const replayEps = useMemo(() => (load.data ?? []).filter((e) => e.game_id === replay.id && episodeInScope(e, replay, spec)), [load.data, replay, spec]);
  const events = useMemo(() => rotationEvents(replayEps), [replayEps]);
  const knownPoints = useMemo(() => Object.keys(rects), [rects]); // tous les points de la carte, même ceux qui ne s'allument jamais dans cette game
  const lanes = useMemo(() => buildLanes(pointsOf(strip.owners, strip.active, replayEps, knownPoints), strip.owners, strip.active, events.map((ev) => rotationMark(ev, clock.duration)), clock.duration, toneOf), [strip, replayEps, events, clock.duration, toneOf, knownPoints]);
  // Changement mis en avant : celui dont la fenêtre (20 s avant, 20 s après) contient le curseur. La frise, la liste et le panneau avancent donc avec la lecture et quand on déplace le curseur.
  const shown = events.find((ev) => clock.t >= ev.switchT - ROT_BEFORE_S && clock.t <= ev.switchT + ROT_AFTER_S) ?? null;
  const pawns = useMemo(() => positionsAt(positions.index, clock.t), [positions.index, clock.t]);
  const rings = useMemo<Ring[]>(() => {
    if (!shown) return [];
    const list: Ring[] = [];
    if (rects[shown.point]) list.push({ point: shown.point, rect: rects[shown.point], role: 'old' });
    if (rects[shown.pointTo]) list.push({ point: shown.pointTo, rect: rects[shown.pointTo], role: 'new' });
    return list;
  }, [shown, rects]);

  const pick = (ev: RotationEvent) => clock.seek(rotationSeek(ev)); // le curseur se place 20 s avant le changement
  // Moments où un point devient actif : les périodes du point actif lues, à défaut les changements de point actif qui y mènent (rotations calculées sans période lue)
  const arrivalsAt = (point: string): number[] => {
    const lit = strip.active.filter((a) => a.point === point).map((a) => a.t0);
    return (lit.length > 0 ? lit : events.filter((e) => e.pointTo === point).map((e) => e.switchT)).sort((a, b) => a - b);
  };
  // Clic sur le nom d'un point : le curseur se place 20 s avant le prochain moment où il devient actif (le premier si le curseur est déjà après le dernier)
  const pickPoint = (point: string) => {
    const times = arrivalsAt(point);
    if (times.length === 0) return;
    const next = times.find((t) => t - ROT_BEFORE_S > clock.t + 0.5) ?? times[0];
    clock.seek(Math.max(0, next - ROT_BEFORE_S));
  };
  const pickMark = (m: EpisodeMark) => {
    const ev = events.find((x) => x.key === m.key);
    if (ev) pick(ev);
  };
  const verdictOf = (e: Episode): Verdict => (e.id in verdicts ? verdicts[e.id] : e.verdict);
  const setVerdict = (id: number, v: Verdict) => setVerdicts((old) => ({ ...old, [id]: v }));
  const nameOf = (slot: number) => replay.players.find((p) => p.slot === slot)?.name;
  const ownerTitle = (b: OwnerBand) => (b.owner === 'none' ? 'Point neutre' : `Point à ${sideName(replay, b.owner)}`);
  const notice = noticeOf(load);

  return (
    <div className="stats__view eps">
      <p className="eps__warn">
        <TriangleAlert className="ic" /> Détection non validée : seuils étalonnés sur une seule game d'Outlaw (la game 32) ; Atlantis et Engine suivent le point actif lu sur le HUD, sans contrôle à la main. Juger chaque rotation (juste ou faux).
      </p>
      <div className="subtabs" role="tablist" aria-label="Présentation des rotations">
        <button type="button" role="tab" aria-selected={mode === 'game'} className={mode === 'game' ? 'is-active' : ''} onClick={() => setMode('game')}>
          Game rejouée
        </button>
        <button type="button" role="tab" aria-selected={mode === 'cumul'} className={mode === 'cumul' ? 'is-active' : ''} onClick={() => setMode('cumul')}>
          Cumul des games retenues ({games.length})
        </button>
      </div>
      {notice && <p className="stats__empty">{notice}</p>}
      {!notice && mode === 'cumul' && <CumulFlows games={games} episodes={load.data ?? []} spec={spec} />}
      {!notice && mode === 'game' && (
        <>
          {events.length === 0 ? (
            <p className="stats__empty">
              Aucune rotation lue pour cette game et ce choix : le point actif n'a pas été lu (HUD sous le chrono) ou ne change pas. Les épisodes se calculent game par game : `python analysis/stats_run.py --game N`.
            </p>
          ) : (
            <>
              <PointTimeline lanes={lanes} duration={clock.duration} t={clock.t} activeKey={shown?.key ?? null} onSeek={clock.seek} onPick={pickMark} onPickPoint={pickPoint} canPickPoint={(p) => arrivalsAt(p).length > 0} ownerTitle={ownerTitle} />
              <GameClock clock={clock} />
            </>
          )}
          <div className="stats__bar">
            <details className="menu">
              <summary>
                <SlidersHorizontal className="ic" /> Affichage
              </summary>
              <div className="menu__panel">
                <label><input type="checkbox" checked={corridors} onChange={(e) => setCorridors(e.target.checked)} /> Couloirs</label>
              </div>
            </details>
            <span className="stats__count">
              {events.length} changement{events.length > 1 ? 's' : ''} de point actif
            </span>
            {positions.load.loading && <span className="stats__count">Chargement des positions…</span>}
          </div>
          <ul className="eps__legend">
            <li><i className="ptl__active is-legend" /> Point actif</li>
            <li><i className="ptl__mark ptl__mark--rotation ptl__mark--doubt is-legend" /> Changement de point actif</li>
            <li><i className="ptl__band ptl__band--a is-legend" /> Point à l'équipe {spec.team ? 'suivie' : 'de gauche'}</li>
            <li><i className="ptl__band ptl__band--b is-legend" /> Point à {spec.team ? 'ses adversaires' : "l'équipe de droite"}</li>
            <li><i className="epmap__swatch epmap__swatch--old" /> Ancien point</li>
            <li><i className="epmap__swatch epmap__swatch--new" /> Nouveau point</li>
          </ul>
          <EpisodeMap map={map} corridors={corridors} pawns={pawns} paletteOfSlot={(s) => paletteOf(replay, spec, s)} nameOf={nameOf} rings={rings} crosses={[]} />
          {shown ? (
            <ChosenRotation event={shown} game={replay} spec={spec} verdictOf={verdictOf} onVerdict={setVerdict} nameOf={nameOf} />
          ) : (
            events.length > 0 && <p className="eps__hint">Cliquer un changement de point sur la frise, le nom d'un point ou la liste : le curseur se place 20 s avant le changement. Pendant la lecture, le changement en cours est mis en avant.</p>
          )}
          {events.length > 0 && (
            <ol className="eplist">
              {events.map((ev) => {
                const open = ev.key === shown?.key;
                return (
                  <li key={ev.key} className={`eplist__item${open ? ' is-active' : ''}`}>
                    <button type="button" className="eplist__head" aria-pressed={open} onClick={() => pick(ev)}>
                      {open ? <ChevronDown className="ic" /> : <ChevronRight className="ic" />}
                      <span className="eplist__when">{formatTime(ev.switchT)}</span>
                      <span className="eplist__route">
                        Point {ev.point} vers point {ev.pointTo}
                      </span>
                      <span className="eplist__sum">{eventSummary(ev, replay, spec)}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
      <details className="help">
        <summary>Comment lire les rotations</summary>
        <p className="help__body">
          Une rotation est un changement du point actif : sur Outlaw il change toutes les 1 min 30, sur Atlantis et Engine il est lu sous le chrono (hexagones des points). La frise montre, pour chaque
          point, les périodes où il est actif (trait clair) et son propriétaire (couleur de l'équipe suivie, de ses adversaires, ou gris). Cliquer un changement place le curseur 20 s avant ; le plan
          montre les pions des deux équipes, l'ancien point en pointillé et le nouveau en plein. Le panneau de chaque équipe donne, relativement au changement : quand elle quitte l'ancien point (négatif :
          elle anticipe), quand elle se concentre à deux joueurs ou plus sur le nouveau, les arrivées, les morts, de quoi suivre le comportement de l'équipe adverse (son panneau) et l'équipe gagnante
          (propriétaire du nouveau point 20 s après). Départ : au moins deux joueurs à moins de 4 m de l'ancien point deux secondes de suite. Limite connue du HUD : sur Outlaw, le changement de point
          actif lu sur le HUD arrive environ 2 s trop tard (4 changements sur 6 à 2 s près du calendrier du chrono, mesure de la lecture du HUD) : un départ lu « 2 s avant » peut être un départ au
          changement réel. Le mode Cumul additionne les rotations des games retenues : un cercle par point, une flèche par trajet (épaisseur = nombre, étiquette = nombre et durée moyenne de la deuxième
          arrivée). Les pourcentages sont masqués sous {MIN_EPISODES} rotations décidées. Détection non validée.
        </p>
      </details>
    </div>
  );
}

/** Résumé d'une ligne de la liste : arrivées de chaque équipe qui tourne. */
function eventSummary(ev: RotationEvent, game: StatsGame, spec: FollowSpec): string {
  const sides = [...ev.episodes].sort((a, b) => (paletteOfSide(game, spec, a.team ?? 'A') === 'a' ? 0 : 1) - (paletteOfSide(game, spec, b.team ?? 'A') === 'a' ? 0 : 1));
  return sides.map((e) => `${sideName(game, e.team)} : ${rotationInfo(e).arrivals.length} arrivé${rotationInfo(e).arrivals.length > 1 ? 's' : ''}`).join(', ');
}

interface ChosenProps {
  event: RotationEvent;
  game: StatsGame;
  spec: FollowSpec;
  verdictOf: (e: Episode) => Verdict;
  onVerdict: (id: number, v: Verdict) => void;
  nameOf: (slot: number) => string | undefined;
}

/** Changement choisi : trajet, source du point actif, gagnant et un panneau « 20 s avant, 20 s après » par équipe (l'équipe suivie en premier). */
function ChosenRotation({ event, game, spec, verdictOf, onVerdict, nameOf }: ChosenProps) {
  const first = rotationInfo(event.episodes[0]);
  const source = event.episodes[0].data?.source;
  const sides = (['A', 'B'] as TeamSide[]).sort((a, b) => (paletteOfSide(game, spec, a) === 'a' ? 0 : 1) - (paletteOfSide(game, spec, b) === 'a' ? 0 : 1));
  return (
    <section className="eps__chosen" aria-label="Rotation choisie">
      <h3 className="eps__h">
        Point {event.point} vers point {event.pointTo}, changement à {formatTime(event.switchT)}
      </h3>
      <p className="eps__sub">
        {first.distanceM !== null ? `${first.distanceM.toFixed(1).replace('.', ',')} m entre les deux points. ` : ''}
        {source === 'point_active' ? 'Point actif lu sur le HUD. ' : source === 'box' ? 'Point actif déduit des boîtes de la minimap. ' : ''}
        {winnerSentence(resultOf(event), (s) => sideName(game, s))}
      </p>
      <div className="rwin__pair">
        {sides.map((side) => {
          const episode = event.episodes.find((e) => e.team === side) ?? null;
          return (
            <RotationWindow
              key={side}
              name={sideName(game, side)}
              palette={paletteOfSide(game, spec, side)}
              flow={flowOfTeam(event, side)}
              episode={episode}
              verdict={episode ? verdictOf(episode) : null}
              onVerdict={onVerdict}
              nameOf={nameOf}
            />
          );
        })}
      </div>
    </section>
  );
}

interface CumulProps {
  games: StatsGame[];
  episodes: Episode[];
  spec: FollowSpec;
}

/** Cumul des rotations des games retenues : un schéma par palette (équipe suivie par son nom, ou gauche et droite sans suivi). */
function CumulFlows({ games, episodes, spec }: CumulProps) {
  const gameOf = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const eps = useMemo(
    () =>
      episodes.filter((e) => {
        const g = gameOf.get(e.game_id);
        return !!g && e.kind === 'rotation' && episodeInScope(e, g, spec);
      }),
    [episodes, gameOf, spec],
  );
  const byPalette = useMemo(() => episodesByPalette(eps, (id) => gameOf.get(id), spec), [eps, gameOf, spec]);
  const flows = (['a', 'b'] as Palette[]).map((p) => ({ palette: p, episodes: byPalette[p], flow: rotationFlow(byPalette[p]) }));
  const label = (p: Palette) => (spec.team ? (p === 'a' ? (games.length ? paletteNames(games[0], spec).a : 'Équipe suivie') : 'Adversaires') : p === 'a' ? 'Équipe de gauche (orange)' : 'Équipe de droite (bleue)');
  const all = rateOf(eps);
  return (
    <>
      <p className="stats__count">
        {games.length} game{games.length > 1 ? 's' : ''} retenue{games.length > 1 ? 's' : ''}, {eps.length} rotation{eps.length > 1 ? 's' : ''}
        {all.rate !== null ? `, ${percent(all.rate)} arrivées à deux ou plus` : `, pourcentage masqué (${all.decided} décidée${all.decided > 1 ? 's' : ''}, minimum ${MIN_EPISODES})`}
      </p>
      {eps.length === 0 ? (
        <p className="stats__empty">Aucune rotation pour ce choix. Les épisodes se calculent game par game : `python analysis/stats_run.py --game N`.</p>
      ) : (
        <div className="eps__flows">
          {flows.map((f) => (
            <RotationFlow key={f.palette} palette={f.palette} title={`${label(f.palette)} : ${f.episodes.length} rotation${f.episodes.length > 1 ? 's' : ''}`} nodes={f.flow.nodes} arrows={f.flow.arrows} measured={f.flow.measured} />
          ))}
        </div>
      )}
    </>
  );
}
