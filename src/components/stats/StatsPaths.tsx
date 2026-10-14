// Vue Parcours : rejeu d'une game sur le plan. Pour chaque joueur, seul le trajet de sa vie en cours est tracé, jusqu'à l'instant du curseur, avec un pion à sa position ;
// à la mort le trajet disparaît (une croix reste un court instant) et un nouveau trajet commence à la réapparition. Option « Cumuler » : toutes les vies des games retenues en même temps.
// Les trajets sont coupés aux tyroliennes (paires de map_teleports.json), aux trous de lecture et aux sauts. Vies : /api/stats/lives ; positions : /api/samples.

import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { numberOfSlot } from '../../lib/killTimeline';
import { readingOf } from '../../lib/mapReading';
import { pathsOfLives, type LifePath, type StationPair } from '../../lib/pathCut';
import { frameAt } from '../../lib/replayPaths';
import { filterByScope, palClass, paletteNames, paletteOf, type FollowSpec } from '../../lib/teamFollow';
import { formatTime } from '../../lib/timeline';
import { GameClock } from './GameClock';
import { StatsMapBase } from './StatsMapBase';
import { durationOf, noticeOf, useLivesAndLinks, useSamples, type StatsGame } from './useStats';
import { useGameClock } from './useGameClock';

interface Props {
  map: string;
  /** Games retenues. */
  games: StatsGame[];
  /** Game rejouée (une des games retenues). */
  replay: StatsGame;
  spec: FollowSpec;
}

/** Demi-taille de la croix de mort, en pourcentage du plan (plus haute que large : le plan est environ deux fois plus large que haut). */
const CROSS_HALF = { x: 0.8, y: 1.5 };

export function StatsPaths({ map, games, replay, spec }: Props) {
  const [cumul, setCumul] = useState(false);
  const [corridors, setCorridors] = useState(false);
  const [stations, setStations] = useState(true);
  const [spawns, setSpawns] = useState(false);
  const [ends, setEnds] = useState(true);
  const shown = useMemo(() => (cumul ? games : [replay]), [cumul, games, replay]);
  const ids = useMemo(() => shown.map((g) => g.id), [shown]);
  const livesLoad = useLivesAndLinks(ids);
  const samplesLoad = useSamples(shown, true);
  const pairs = useMemo(() => readingOf(map).stations as StationPair[], [map]);
  const clock = useGameClock(`paths:${replay.id}`, durationOf(replay));

  // Vies retenues (équipe, côté, joueur), puis un trajet par vie, game par game
  const lives = useMemo(() => (livesLoad.data ? filterByScope(livesLoad.data.lives, shown, spec) : []), [livesLoad.data, shown, spec]);
  const paths = useMemo<LifePath[]>(() => {
    if (!samplesLoad.data) return [];
    return ids.flatMap((id) =>
      pathsOfLives(
        samplesLoad.data?.get(id) ?? [],
        lives.filter((l) => l.game_id === id),
        pairs,
      ),
    );
  }, [samplesLoad.data, ids, lives, pairs]);

  const notice = noticeOf(livesLoad, samplesLoad);
  const frame = useMemo(() => (cumul ? null : frameAt(paths, lives, clock.t)), [cumul, paths, lives, clock.t]);
  const gameOf = (gameId: number) => shown.find((g) => g.id === gameId) ?? replay;
  const drawn = paths.filter((p) => p.segments.length > 0);
  const empty = !notice && lives.length === 0;
  const names = paletteNames(replay, spec);
  const nameIn = (slot: number) => replay.players.find((p) => p.slot === slot)?.name;
  const slotsShown = [...new Set(lives.filter((l) => l.game_id === replay.id).map((l) => l.slot))].sort((a, b) => a - b);

  return (
    <div className="stats__view">
      {!cumul && <GameClock clock={clock} />}
      <div className="stats__bar">
        <details className="menu">
          <summary>
            <SlidersHorizontal className="ic" /> Affichage
          </summary>
          <div className="menu__panel">
            {games.length > 1 && <label><input type="checkbox" checked={cumul} onChange={(e) => setCumul(e.target.checked)} /> Cumuler les {games.length} games retenues (sans chronologie)</label>}
            {cumul && <label><input type="checkbox" checked={ends} onChange={(e) => setEnds(e.target.checked)} /> Apparition et mort (points)</label>}
            <label><input type="checkbox" checked={stations} onChange={(e) => setStations(e.target.checked)} /> Tyroliennes</label>
            <label><input type="checkbox" checked={spawns} onChange={(e) => setSpawns(e.target.checked)} /> Zones de départ</label>
            <label><input type="checkbox" checked={corridors} onChange={(e) => setCorridors(e.target.checked)} /> Couloirs</label>
          </div>
        </details>
        {!notice && frame && (
          <span className="stats__count">
            {frame.players.length} joueur{frame.players.length > 1 ? 's' : ''} en vie à {formatTime(clock.t)}
          </span>
        )}
        {!notice && cumul && <span className="stats__count">{drawn.length} vies tracées sur {games.length} games</span>}
        <ul className="stats__legend">
          {cumul
            ? (['a', 'b'] as const).map((pal) => (
                <li key={pal} className={`pal pal--${pal}`}>
                  <svg className="stats__swatch" viewBox="0 0 20 4" aria-hidden>
                    <line x1={0} y1={2} x2={20} y2={2} className="stats__trace" />
                  </svg>
                  {spec.team ? (pal === 'a' ? (games.length ? paletteNames(games[0], spec).a : 'Équipe suivie') : 'Adversaires') : pal === 'a' ? 'Équipe de gauche (orange)' : 'Équipe de droite (bleue)'}
                </li>
              ))
            : slotsShown.map((s) => (
                <li key={s} className={palClass(paletteOf(replay, spec, s), s)} title={names[paletteOf(replay, spec, s)]}>
                  <svg className="stats__swatch" viewBox="0 0 20 4" aria-hidden>
                    <line x1={0} y1={2} x2={20} y2={2} className="stats__trace" />
                  </svg>
                  N° {numberOfSlot(s)}
                  {nameIn(s) ? ` (${nameIn(s)})` : ''}
                </li>
              ))}
        </ul>
      </div>
      {notice && <p className="stats__empty">{notice}</p>}
      {empty && <p className="stats__empty">Aucune vie à tracer pour ce choix. Les vies se calculent game par game : `python analysis/stats_run.py --game N`.</p>}
      <StatsMapBase map={map} corridors={corridors} stations={stations} spawns={spawns}>
        {({ at }) => (
          <>
            <svg className="statsmap__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Parcours des joueurs">
              {frame
                ? frame.players.map((p) => (
                    <g key={`trail-${p.slot}-${p.idx}`} className={palClass(paletteOf(replay, spec, p.slot), p.slot)}>
                      {p.trail.map((seg, i) => (
                        <polyline key={i} points={seg.map((pt) => `${at(pt.x, pt.y).x},${at(pt.x, pt.y).y}`).join(' ')} className="stats__trace" fill="none" vectorEffect="non-scaling-stroke" />
                      ))}
                    </g>
                  ))
                : drawn.map((p) =>
                    p.segments.map((seg, i) => (
                      <polyline
                        key={`${p.game_id}-${p.slot}-${p.idx}-${i}`}
                        points={seg.map((pt) => `${at(pt.x, pt.y).x},${at(pt.x, pt.y).y}`).join(' ')}
                        className={`stats__trace ${palClass(paletteOf(gameOf(p.game_id as number), spec, p.slot), p.slot)}`}
                        fill="none"
                        vectorEffect="non-scaling-stroke"
                      />
                    )),
                  )}
              {frame?.crosses.map((c) => {
                const o = at(c.x, c.y);
                return (
                  <g key={`cross-${c.slot}-${c.idx}`} className={palClass(paletteOf(replay, spec, c.slot), c.slot)} opacity={1 - c.age}>
                    {[0, 1].map((back) => (
                      <g key={back} className={back === 0 ? 'stats__cross-back' : 'stats__cross'}>
                        <line x1={o.x - CROSS_HALF.x} y1={o.y - CROSS_HALF.y} x2={o.x + CROSS_HALF.x} y2={o.y + CROSS_HALF.y} vectorEffect="non-scaling-stroke" />
                        <line x1={o.x - CROSS_HALF.x} y1={o.y + CROSS_HALF.y} x2={o.x + CROSS_HALF.x} y2={o.y - CROSS_HALF.y} vectorEffect="non-scaling-stroke" />
                      </g>
                    ))}
                  </g>
                );
              })}
              {cumul &&
                ends &&
                drawn.map((p) => {
                  const first = p.segments[0][0];
                  const lastSeg = p.segments[p.segments.length - 1];
                  const last = lastSeg[lastSeg.length - 1];
                  const a = at(first.x, first.y);
                  const b = at(last.x, last.y);
                  return (
                    <g key={`end-${p.game_id}-${p.slot}-${p.idx}`}>
                      <ellipse cx={a.x} cy={a.y} rx={0.45} ry={0.85} className="stats__spawnpoint" />
                      <ellipse cx={b.x} cy={b.y} rx={0.45} ry={0.85} className="stats__deathpoint" />
                    </g>
                  );
                })}
            </svg>
            {frame?.players.map((p) => {
              if (!p.head) return null;
              const o = at(p.head.x, p.head.y);
              return (
                <span key={`pawn-${p.slot}-${p.idx}`} className={`stats__pawn ${palClass(paletteOf(replay, spec, p.slot), p.slot)}`} style={{ left: `${o.x}%`, top: `${o.y}%` }}>
                  {numberOfSlot(p.slot)}
                </span>
              );
            })}
          </>
        )}
      </StatsMapBase>
      <details className="help">
        <summary>Comment lire les parcours</summary>
        <p className="help__body">
          Le curseur rejoue la game : chaque joueur vivant a un pion à sa position (son numéro dedans) et le trajet de sa vie en cours derrière lui. À sa mort le trajet disparaît, une croix reste
          deux secondes et demie à l'endroit où il est tombé, puis un nouveau trajet commence quand il réapparaît. La vitesse va de réel à seize fois. La couleur est celle de l'équipe suivie (premier
          choix de couleur du thème) ou de ses adversaires ; sans équipe suivie, l'équipe de gauche est orange et celle de droite bleue. Les quatre joueurs d'une équipe ont des nuances et des formes de trait
          différentes. Le trait est coupé quand le joueur prend une tyrolienne, quand la lecture a un trou de plus d'une seconde et demie, ou quand le déplacement serait plus rapide que 14 m/s ; le pion reste
          alors à la dernière position connue. Avec plusieurs games retenues, « Cumuler » dessine toutes les vies ensemble, sans chronologie. Le regard n'est pas dessiné.
        </p>
      </details>
    </div>
  );
}
