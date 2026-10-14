// Vue Morts : frise des morts de la game rejouée (avec le curseur de temps) et, sur le plan, une croix numérotée à l'endroit de chaque mort visible, info-bulle (tueur, arme, durée de la vie, trade et revenge).
// Les morts visibles sont celles survenues jusqu'à l'instant du curseur, ou seulement dans une fenêtre réglable (10 à 60 s). Option « Cumuler » : toutes les morts des games retenues, sans chronologie.
// Les vies et les liens viennent de /api/stats/lives et /api/stats/links. Numéro : ordre chronologique des morts de la game. Couleur : équipe suivie ou adversaires (lib/teamFollow).

import { useMemo, useState, type CSSProperties } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { deathKey, deathsOf, visibleDeaths, WINDOWS_S, type Death } from '../../lib/deathWindow';
import { numberOfSlot } from '../../lib/killTimeline';
import { filterByScope, paletteOf, type FollowSpec } from '../../lib/teamFollow';
import { LINK_TOL_S } from '../../lib/statsApi';
import { formatTime } from '../../lib/timeline';
import type { KillLink } from '../../types/stats';
import { DeathStrip } from './DeathStrip';
import { GameClock } from './GameClock';
import { StatsMapBase } from './StatsMapBase';
import { durationOf, noticeOf, useLivesAndLinks, type StatsGame } from './useStats';
import { useGameClock } from './useGameClock';

interface Props {
  map: string;
  /** Games retenues. */
  games: StatsGame[];
  /** Game rejouée (une des games retenues). */
  replay: StatsGame;
  spec: FollowSpec;
}

const seconds = (s: number) => `${s.toFixed(1).replace('.', ',')} s`;

export function StatsDeaths({ map, games, replay, spec }: Props) {
  const [numbers, setNumbers] = useState(true);
  const [marks, setMarks] = useState(true);
  const [corridors, setCorridors] = useState(false);
  const [cumul, setCumul] = useState(false);
  const [windowS, setWindowS] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const shown = useMemo(() => (cumul ? games : [replay]), [cumul, games, replay]);
  const ids = useMemo(() => shown.map((g) => g.id), [shown]);
  const load = useLivesAndLinks(ids);
  const clock = useGameClock(`deaths:${replay.id}`, durationOf(replay));
  const all = useMemo(() => (load.data ? deathsOf(load.data.lives, load.data.links) : []), [load.data]);
  // Morts des joueurs retenus (équipe, côté, joueur), puis celles visibles à l'instant du curseur
  const kept = useMemo(() => {
    const keep = new Set(filterByScope(all.map((d) => d.life), shown, spec).map(deathKey));
    return all.filter((d) => keep.has(d.key));
  }, [all, shown, spec]);
  const visible = useMemo(() => (cumul ? kept : visibleDeaths(kept, clock.t, windowS)), [cumul, kept, clock.t, windowS]);
  const visibleKeys = useMemo(() => new Set(visible.map((d) => d.key)), [visible]);

  const notice = noticeOf(load);
  const gameOf = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const palette = (d: Death) => paletteOf(gameOf.get(d.life.game_id) ?? replay, spec, d.life.slot);
  const who = (gameId: number, s: number | null) => {
    if (s === null) return 'un tueur inconnu';
    const name = gameOf.get(gameId)?.players.find((p) => p.slot === s)?.name;
    return `N° ${numberOfSlot(s)}${name ? ` (${name})` : ''}`;
  };
  // Le coéquipier qui a vengé une mort : le tueur de la vie du tueur vengé qui finit au moment du kill vengeur
  const avengerOf = (link: KillLink) => load.data?.lives.find((l) => l.game_id === link.game_id && l.slot === link.victim_slot && Math.abs(l.t1 - link.t) <= LINK_TOL_S)?.killer_slot ?? null;

  const trades = visible.filter((d) => d.links.trade).length;
  const revenges = visible.filter((d) => d.links.avengedBy || d.links.revengeKill).length;
  const open = visible.find((d) => d.key === active) ?? null;

  return (
    <div className="stats__view">
      {!cumul && !notice && (
        <>
          <DeathStrip
            deaths={kept}
            duration={clock.duration}
            t={clock.t}
            windowS={windowS}
            shown={visibleKeys}
            active={active}
            paletteOf={palette}
            onActive={setActive}
            onSeek={clock.seek}
          />
          <GameClock clock={clock}>
            <label className="clock__speed">
              Fenêtre
              <select value={windowS} onChange={(e) => setWindowS(Number(e.target.value))}>
                {WINDOWS_S.map((w) => (
                  <option key={w} value={w}>
                    {w === 0 ? 'depuis le début' : `${w} dernières secondes`}
                  </option>
                ))}
              </select>
            </label>
          </GameClock>
        </>
      )}
      <div className="stats__bar">
        <details className="menu">
          <summary>
            <SlidersHorizontal className="ic" /> Affichage
          </summary>
          <div className="menu__panel">
            {games.length > 1 && <label><input type="checkbox" checked={cumul} onChange={(e) => setCumul(e.target.checked)} /> Cumuler les {games.length} games retenues (sans chronologie)</label>}
            <label><input type="checkbox" checked={numbers} onChange={(e) => setNumbers(e.target.checked)} /> Numéros des morts</label>
            <label><input type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} /> Marquer les trades et les revenges</label>
            <label><input type="checkbox" checked={corridors} onChange={(e) => setCorridors(e.target.checked)} /> Couloirs</label>
          </div>
        </details>
        {!notice && (
          <span className="stats__count">
            {cumul ? `${visible.length} morts` : `${visible.length} morts affichées sur ${kept.length} à ${formatTime(clock.t)}`}, dont {trades} trades et {revenges} revenges
          </span>
        )}
      </div>
      {notice && <p className="stats__empty">{notice}</p>}
      {!notice && kept.length === 0 && <p className="stats__empty">Aucune mort pour ce choix. Les vies se calculent game par game : `python analysis/stats_run.py --game N`.</p>}
      <StatsMapBase map={map} corridors={corridors}>
        {({ at }) => (
          <>
            {visible.map((d) => {
              const p = at(d.life.x1 as number, d.life.y1 as number);
              const kind = marks ? (d.links.trade ? ' is-trade' : d.links.avengedBy || d.links.revengeKill ? ' is-revenge' : '') : '';
              return (
                <button
                  key={d.key}
                  type="button"
                  className={`stats__death pal pal--${palette(d)}${kind}${active === d.key ? ' is-active' : ''}`}
                  style={{ left: `${p.x}%`, top: `${p.y}%` }}
                  aria-label={`Mort ${d.n} de la game ${d.life.game_id}, ${who(d.life.game_id, d.life.slot)}`}
                  onMouseEnter={() => setActive(d.key)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(d.key)}
                  onBlur={() => setActive(null)}
                  onClick={() => setActive(active === d.key ? null : d.key)}
                >
                  <X className="ic" />
                  {numbers && <span>{d.n}</span>}
                </button>
              );
            })}
            {open && (
              <DeathTip
                death={open}
                at={at(open.life.x1 as number, open.life.y1 as number)}
                who={who}
                avenger={open.links.avengedBy ? avengerOf(open.links.avengedBy) : null}
                games={shown.length}
              />
            )}
          </>
        )}
      </StatsMapBase>
      <details className="help">
        <summary>Comment lire les morts</summary>
        <p className="help__body">
          La frise montre toutes les morts de la game rejouée : couloir du haut pour l'équipe suivie (ou l'équipe de gauche, orange, sans équipe suivie), couloir du bas pour ses adversaires, avec le numéro du joueur
          dans la marque. Les marques pleines sont celles affichées sur le plan à l'instant du curseur ; cliquer une marque place le curseur sur la mort. Le menu Fenêtre limite l'affichage aux dernières secondes
          avant le curseur. Chaque croix du plan est la dernière position vivante d'un joueur, avec le numéro d'ordre de la mort dans sa game. Anneau plein : trade (le tueur est mort moins d'une seconde plus tard,
          kills croisés). Anneau pointillé : revenge (un coéquipier tue le tueur dans les cinq secondes, ou cette mort est elle-même la vengeance d'un coéquipier). Survoler ou toucher une croix donne le tueur, l'arme,
          la durée de la vie et les liens. Les vies finies par la fin de la game n'ont pas de croix.
        </p>
      </details>
    </div>
  );
}

interface TipProps {
  death: Death;
  at: { x: number; y: number };
  who: (gameId: number, slot: number | null) => string;
  avenger: number | null;
  games: number;
}

/** Info-bulle d'une mort : placée près de la croix, du côté où il reste de la place. */
function DeathTip({ death, at, who, avenger, games }: TipProps) {
  const { life, links } = death;
  const g = life.game_id;
  const flip = `${at.x > 50 ? ' is-left' : ''}${at.y < 45 ? ' is-below' : ''}`;
  return (
    <div className={`stats__tip${flip}`} style={{ '--tip-x': `${at.x}%`, '--tip-y': `${at.y}%` } as CSSProperties} role="tooltip">
      <b>
        Mort {death.n}
        {games > 1 ? ` (game ${g})` : ''} : {who(g, life.slot)}
      </b>
      <span>
        {formatTime(life.t1)}, vie de {seconds(life.t1 - life.t0)}
      </span>
      <span>
        Tué par {who(g, life.killer_slot)}
        {life.weapon ? `, arme : ${life.weapon}` : ''}
        {life.kill_kind && life.kill_kind !== 'kill' ? ` (${life.kill_kind})` : ''}
      </span>
      {links.trade && (
        <span>
          Trade : {who(g, links.trade.other_slot)} est mort {links.trade.dt !== null ? `à ${seconds(Math.abs(links.trade.dt))} d'écart` : 'presque en même temps'}
          {links.trade.dist_m !== null ? `, à ${links.trade.dist_m.toFixed(0)} m` : ''}
        </span>
      )}
      {links.avengedBy && (
        <span>
          Vengé{avenger !== null ? ` par ${who(g, avenger)}` : ''} : le tueur est tué {links.avengedBy.dt !== null ? `${seconds(links.avengedBy.dt)} après` : 'peu après'}
        </span>
      )}
      {links.revengeKill && (
        <span>
          Mort en revenge : ce joueur avait tué {who(g, links.revengeKill.other_slot)}{links.revengeKill.dt !== null ? ` ${seconds(links.revengeKill.dt)} plus tôt` : ' juste avant'}
        </span>
      )}
    </div>
  );
}
