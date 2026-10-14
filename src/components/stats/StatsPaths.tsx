// Vue Parcours : une trace par vie sur le plan, couleur par joueur, coupée aux tyroliennes (paires de map_teleports.json), aux trous de lecture et aux sauts.
// Les vies viennent de /api/stats/lives, les positions des lignes de suivi de l'onglet Lecture (/api/samples).

import { useMemo, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { numberOfSlot } from '../../lib/killTimeline';
import { readingOf } from '../../lib/mapReading';
import { pathsOfLives, type LifePath, type StationPair } from '../../lib/pathCut';
import { filterBySlot, noticeOf, useLivesAndLinks, useSamples, type StatsGame } from './useStats';
import { StatsMapBase } from './StatsMapBase';
import type { TeamSide } from '../../types/stats';

interface Props {
  map: string;
  games: StatsGame[];
  team: TeamSide | 'all';
  slot: number;
}

export function StatsPaths({ map, games, team, slot }: Props) {
  const [corridors, setCorridors] = useState(false);
  const [stations, setStations] = useState(true);
  const [spawns, setSpawns] = useState(false);
  const [ends, setEnds] = useState(true);
  const ids = useMemo(() => games.map((g) => g.id), [games]);
  const livesLoad = useLivesAndLinks(ids);
  const samplesLoad = useSamples(games, true);
  const pairs = useMemo(() => readingOf(map).stations as StationPair[], [map]);

  // Un trajet par vie retenue (équipe et joueur), game par game
  const paths = useMemo<LifePath[]>(() => {
    if (!livesLoad.data || !samplesLoad.data) return [];
    const lives = filterBySlot(livesLoad.data.lives, team, slot);
    return ids.flatMap((id) =>
      pathsOfLives(
        samplesLoad.data?.get(id) ?? [],
        lives.filter((l) => l.game_id === id),
        pairs,
      ),
    );
  }, [livesLoad.data, samplesLoad.data, ids, team, slot, pairs]);

  const notice = noticeOf(livesLoad, samplesLoad);
  const drawn = paths.filter((p) => p.segments.length > 0);
  const slotsShown = [...new Set(drawn.map((p) => p.slot))].sort((a, b) => a - b);
  const empty = !notice && drawn.length === 0;

  return (
    <div className="stats__view">
      <div className="stats__bar">
        <details className="menu">
          <summary>
            <SlidersHorizontal className="ic" /> Affichage
          </summary>
          <div className="menu__panel">
            <label><input type="checkbox" checked={ends} onChange={(e) => setEnds(e.target.checked)} /> Apparition et mort (points)</label>
            <label><input type="checkbox" checked={stations} onChange={(e) => setStations(e.target.checked)} /> Tyroliennes</label>
            <label><input type="checkbox" checked={spawns} onChange={(e) => setSpawns(e.target.checked)} /> Zones de départ</label>
            <label><input type="checkbox" checked={corridors} onChange={(e) => setCorridors(e.target.checked)} /> Couloirs</label>
          </div>
        </details>
        {!notice && <span className="stats__count">{drawn.length} vies tracées</span>}
        <ul className="stats__legend">
          {slotsShown.map((s) => (
            <li key={s}>
              <svg className="stats__swatch" viewBox="0 0 20 4" aria-hidden>
                <line x1={0} y1={2} x2={20} y2={2} className={`stats__trace stats__trace--s${s}`} />
              </svg>
              N° {numberOfSlot(s)}
            </li>
          ))}
        </ul>
      </div>
      {notice && <p className="stats__empty">{notice}</p>}
      {empty && <p className="stats__empty">Aucune vie à tracer pour ce choix. Les vies se calculent game par game : `python analysis/stats_run.py --game N`.</p>}
      <StatsMapBase map={map} corridors={corridors} stations={stations} spawns={spawns}>
        {({ at }) => (
          <svg className="statsmap__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Parcours des joueurs">
            {drawn.map((p) =>
              p.segments.map((seg, i) => (
                <polyline
                  key={`${p.game_id}-${p.slot}-${p.idx}-${i}`}
                  points={seg.map((pt) => `${at(pt.x, pt.y).x},${at(pt.x, pt.y).y}`).join(' ')}
                  className={`stats__trace stats__trace--s${p.slot}`}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                />
              )),
            )}
            {ends &&
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
        )}
      </StatsMapBase>
      <details className="help">
        <summary>Comment lire les parcours</summary>
        <p className="help__body">
          Une trace par vie, de l'apparition à la mort ou à la fin de la game, avec une couleur par joueur (les orange et les bleus ont chacun quatre nuances, la forme du trait
          aide à les distinguer). Le trait est coupé quand le joueur prend une tyrolienne, quand la lecture a un trou de plus d'une seconde et demie, ou quand le déplacement serait
          plus rapide que 14 m/s. Le point plein vert marque l'apparition, le point rouge la fin de la dernière partie tracée. Le regard n'est pas dessiné.
        </p>
      </details>
    </div>
  );
}
