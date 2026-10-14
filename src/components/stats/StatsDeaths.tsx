// Vue Morts : une croix numérotée à l'endroit de chaque mort, info-bulle (tueur, arme, durée de la vie, trade et revenge).
// Les vies et les liens viennent de /api/stats/lives et /api/stats/links. Numéro : ordre chronologique des morts de la game.

import { useMemo, useState, type CSSProperties } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { numberOfSlot } from '../../lib/killTimeline';
import { linksOfDeath, type DeathLinks, LINK_TOL_S } from '../../lib/statsApi';
import { formatTime } from '../../lib/timeline';
import type { KillLink, Life, TeamSide } from '../../types/stats';
import { filterBySlot, noticeOf, useLivesAndLinks, type StatsGame } from './useStats';
import { StatsMapBase } from './StatsMapBase';

interface Props {
  map: string;
  games: StatsGame[];
  team: TeamSide | 'all';
  slot: number;
}

interface Death {
  key: string;
  life: Life;
  /** Numéro d'ordre de la mort dans sa game (1 pour la première). */
  n: number;
  links: DeathLinks;
}

const keyOf = (l: Life) => `${l.game_id}:${l.slot}:${l.idx}`;
const seconds = (s: number) => `${s.toFixed(1).replace('.', ',')} s`;

/** Morts de toutes les vies (position de mort connue), numérotées par game dans l'ordre du temps, avec leurs liens. */
function deathsOf(lives: Life[], links: KillLink[]): Death[] {
  const out: Death[] = [];
  const byGame = new Map<number, Life[]>();
  for (const l of lives) if (l.ended === 'death' && l.x1 !== null && l.y1 !== null) byGame.set(l.game_id, [...(byGame.get(l.game_id) ?? []), l]);
  for (const list of byGame.values()) {
    list.sort((a, b) => a.t1 - b.t1);
    list.forEach((life, i) => out.push({ key: keyOf(life), life, n: i + 1, links: linksOfDeath(life, links) }));
  }
  return out;
}

export function StatsDeaths({ map, games, team, slot }: Props) {
  const [numbers, setNumbers] = useState(true);
  const [marks, setMarks] = useState(true);
  const [corridors, setCorridors] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const ids = useMemo(() => games.map((g) => g.id), [games]);
  const load = useLivesAndLinks(ids);
  const all = useMemo(() => (load.data ? deathsOf(load.data.lives, load.data.links) : []), [load.data]);
  const shown = useMemo(() => {
    const keep = new Set(filterBySlot(all.map((d) => d.life), team, slot).map(keyOf));
    return all.filter((d) => keep.has(d.key));
  }, [all, team, slot]);

  const notice = noticeOf(load);
  const gameOf = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const who = (gameId: number, s: number | null) => {
    if (s === null) return 'un tueur inconnu';
    const name = gameOf.get(gameId)?.players.find((p) => p.slot === s)?.name;
    return `N° ${numberOfSlot(s)}${name ? ` (${name})` : ''}`;
  };
  // Le coéquipier qui a vengé une mort : le tueur de la vie du tueur vengé qui finit au moment du kill vengeur
  const avengerOf = (link: KillLink) => load.data?.lives.find((l) => l.game_id === link.game_id && l.slot === link.victim_slot && Math.abs(l.t1 - link.t) <= LINK_TOL_S)?.killer_slot ?? null;

  const trades = shown.filter((d) => d.links.trade).length;
  const revenges = shown.filter((d) => d.links.avengedBy || d.links.revengeKill).length;
  const open = shown.find((d) => d.key === active) ?? null;

  return (
    <div className="stats__view">
      <div className="stats__bar">
        <details className="menu">
          <summary>
            <SlidersHorizontal className="ic" /> Affichage
          </summary>
          <div className="menu__panel">
            <label><input type="checkbox" checked={numbers} onChange={(e) => setNumbers(e.target.checked)} /> Numéros des morts</label>
            <label><input type="checkbox" checked={marks} onChange={(e) => setMarks(e.target.checked)} /> Marquer les trades et les revenges</label>
            <label><input type="checkbox" checked={corridors} onChange={(e) => setCorridors(e.target.checked)} /> Couloirs</label>
          </div>
        </details>
        {!notice && (
          <span className="stats__count">
            {shown.length} morts, dont {trades} trades et {revenges} revenges
          </span>
        )}
      </div>
      {notice && <p className="stats__empty">{notice}</p>}
      {!notice && shown.length === 0 && <p className="stats__empty">Aucune mort pour ce choix. Les vies se calculent game par game : `python analysis/stats_run.py --game N`.</p>}
      <StatsMapBase map={map} corridors={corridors}>
        {({ at }) => (
          <>
            {shown.map((d) => {
              const p = at(d.life.x1 as number, d.life.y1 as number);
              const side = d.life.slot <= 4 ? 'A' : 'B';
              const kind = marks ? (d.links.trade ? ' is-trade' : d.links.avengedBy || d.links.revengeKill ? ' is-revenge' : '') : '';
              return (
                <button
                  key={d.key}
                  type="button"
                  className={`stats__death stats__death--${side}${kind}${active === d.key ? ' is-active' : ''}`}
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
                games={games.length}
              />
            )}
          </>
        )}
      </StatsMapBase>
      <details className="help">
        <summary>Comment lire les morts</summary>
        <p className="help__body">
          Chaque croix est la dernière position vivante d'un joueur, avec le numéro d'ordre de la mort dans sa game. Orange : joueur de l'équipe A, bleu : équipe B. Anneau plein : trade
          (le tueur est mort moins d'une seconde plus tard, kills croisés). Anneau pointillé : revenge (un coéquipier tue le tueur dans les cinq secondes, ou cette mort est elle-même la
          vengeance d'un coéquipier). Survoler ou toucher une croix donne le tueur, l'arme, la durée de la vie et les liens. Les vies finies par la fin de la game n'ont pas de croix.
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
