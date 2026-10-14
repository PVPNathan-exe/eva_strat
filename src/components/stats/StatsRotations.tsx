// Vue Rotations : une équipe quitte un point pour en rejoindre un autre (Outlaw : le point actif change toutes les 1 min 30). Schéma des rotations de chaque équipe
// (RotationFlow), puis liste des rotations avec le départ, les arrivées décalées et le résultat. Seul Outlaw est lu (analysis/rotations.py) ; les autres cartes
// affichent un message. Épisodes de /api/stats/episodes, temps en secondes depuis le début de la game.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, TriangleAlert } from 'lucide-react';
import {
  arrivalGap,
  deathSentence,
  filterEpisodes,
  flowSignature,
  formatSeconds,
  keyInstant,
  MIN_EPISODES,
  offsetLabel,
  outcomeInfo,
  percent,
  playerLabel,
  rateOf,
  rotationFlow,
  rotationInfo,
} from '../../lib/episodeFormat';
import { statsApi } from '../../lib/statsApi';
import { formatTime } from '../../lib/timeline';
import type { Episode, PointOwner, TeamSide } from '../../types/stats';
import { EpisodeTimeline } from './EpisodeTimeline';
import { RotationFlow } from './RotationFlow';
import { noticeOf, useLoad, type StatsGame } from './useStats';
import { ValidateEpisode } from './ValidateEpisode';

interface Props {
  map: string;
  games: StatsGame[];
  team: TeamSide | 'all';
  slot: number;
}

type Verdict = 'ok' | 'ko' | null;

const nameIn = (g: StatsGame, slot: number) => g.players.find((p) => p.slot === slot)?.name;
const TEAM_TITLE: Record<TeamSide, string> = { A: 'Équipe orange (A)', B: 'Équipe bleue (B)' };

export function StatsRotations({ map, games, team, slot }: Props) {
  // Atlantis et Engine : trois points mais pas de propriétaire lisible (CLAUDE.md, « Stats : propriétaire des points »)
  if (map !== 'Outlaw') {
    const hard = map === 'Atlantis' || map === 'Engine';
    return (
      <div className="stats__view eps">
        <p className="stats__empty">
          {hard
            ? `Rotations de ${map} : pas encore lisible, voir CLAUDE.md (le propriétaire des points n'y est pas lu).`
            : `Les rotations ne sont lues que sur Outlaw pour l'instant (le point actif y change toutes les 1 min 30). ${map} n'a pas de rotation calculée.`}
        </p>
      </div>
    );
  }
  return <OutlawRotations map={map} games={games} team={team} slot={slot} />;
}

function OutlawRotations({ map, games, team, slot }: Props) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const ids = useMemo(() => games.map((g) => g.id), [games]);
  const load = useLoad(`rotations:${map}`, () => statsApi.episodesOfMap(map, 'rotation'));
  const ownersLoad = useLoad(ids.length ? `owners:${ids.join(',')}` : null, () => Promise.all(ids.map((id) => statsApi.owners(id))).then((l) => l.flat()));
  const owners: PointOwner[] = ownersLoad.data ?? [];

  const eps = useMemo(() => (load.data ? filterEpisodes(load.data, ids, team, slot) : []), [load.data, ids, team, slot]);
  const flows = useMemo(() => {
    const sides: TeamSide[] = team === 'all' ? ['A', 'B'] : [team];
    return sides.map((s) => {
      const episodes = eps.filter((e) => e.team === s);
      return { side: s, episodes, flow: rotationFlow(episodes) };
    });
  }, [eps, team]);
  const gameOf = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const verdictOf = (e: Episode): Verdict => (e.id in verdicts ? verdicts[e.id] : e.verdict);
  const notice = noticeOf(load);
  const all = rateOf(eps, verdicts);

  return (
    <div className="stats__view eps">
      <p className="eps__warn">
        <TriangleAlert className="ic" /> Détection non validée : seuils étalonnés sur une seule game d'Outlaw (la game 32). Juger chaque rotation (juste ou faux).
      </p>
      {!notice && (
        <p className="stats__count">
          {games.length} game{games.length > 1 ? 's' : ''} retenue{games.length > 1 ? 's' : ''}, {eps.length} rotation{eps.length > 1 ? 's' : ''}
          {all.rate !== null ? `, ${percent(all.rate)} arrivées à deux ou plus` : `, pourcentage masqué (${all.decided} décidée${all.decided > 1 ? 's' : ''}, minimum ${MIN_EPISODES})`}
        </p>
      )}
      {notice && <p className="stats__empty">{notice}</p>}
      {!notice && eps.length === 0 && <p className="stats__empty">Aucune rotation pour ce choix. Les épisodes se calculent game par game : `python analysis/stats_run.py --game N`.</p>}

      {!notice && eps.length > 0 && (
        <>
          <div className="eps__flows">
            {flows.map((f) => (
              <RotationFlow key={f.side} team={f.side} title={`${TEAM_TITLE[f.side]} : ${f.episodes.length} rotation${f.episodes.length > 1 ? 's' : ''}`} nodes={f.flow.nodes} arrows={f.flow.arrows} measured={f.flow.measured} />
            ))}
          </div>
          <ol className="eplist">
            {eps.map((e) => {
              const g = gameOf.get(e.game_id);
              const info = rotationInfo(e);
              const out = outcomeInfo(e.outcome);
              const open = e.id === activeId;
              const v = verdictOf(e);
              const gap = arrivalGap(info);
              return (
                <li key={e.id} className={`eplist__item${open ? ' is-active' : ''}${v === 'ko' ? ' is-ko' : ''}`}>
                  <button type="button" className="eplist__head" aria-expanded={open} onClick={() => setActiveId(open ? null : e.id)}>
                    {open ? <ChevronDown className="ic" /> : <ChevronRight className="ic" />}
                    <span className="eplist__when">Game {e.game_id}, {formatTime(keyInstant(e))}</span>
                    <span className={`eplist__team eplist__team--${e.team ?? 'A'}`}>{e.team === 'B' ? 'Bleue' : 'Orange'}</span>
                    <span className="eplist__route">{flowSignature(e).replace('>', ' vers ')}</span>
                    <span className={`eplist__tag eplist__tag--${out.tone}`}>{out.label}</span>
                    <span className="eplist__sum">
                      {info.start.length} au départ, {info.arrivals.length} arrivé{info.arrivals.length > 1 ? 's' : ''}
                      {gap !== null ? `, arrivées décalées de ${formatSeconds(gap)}` : ''}
                    </span>
                    {v && <span className={`eplist__verdict eplist__verdict--${v}`}>{v === 'ok' ? 'jugé juste' : 'jugé faux'}</span>}
                  </button>
                  {open && g && <RotationDetail episode={e} game={g} owners={owners} verdict={v} onVerdict={(id, nv) => setVerdicts((old) => ({ ...old, [id]: nv }))} />}
                </li>
              );
            })}
          </ol>
        </>
      )}
      <details className="help">
        <summary>Comment lire les rotations</summary>
        <p className="help__body">
          À chaque changement de point actif d'Outlaw (toutes les 1 min 30), chaque équipe qui avait au moins deux joueurs sur l'ancien point, ou qui en amène deux sur le nouveau, écrit une
          rotation. Départ : les joueurs à moins de 4 m de l'ancien point 4 s avant l'apparition de la nouvelle boîte, avec l'instant où chacun le quitte. Arrivée : le premier instant,
          dans les 30 s, où un joueur est à moins de 4 m du nouveau point. Arrivées décalées : écart entre la première et la deuxième arrivée. Sur le schéma, un cercle par point (taille =
          temps estimé sur le point, de la deuxième arrivée au départ lu à la rotation suivante), une flèche par trajet (épaisseur = nombre, étiquette = nombre et durée moyenne de la
          deuxième arrivée). Les pourcentages sont masqués sous {MIN_EPISODES} rotations décidées. Seul Outlaw est couvert, étalonné sur la game 32 : détection non validée.
        </p>
      </details>
    </div>
  );
}

interface DetailProps {
  episode: Episode;
  game: StatsGame;
  owners: PointOwner[];
  verdict: Verdict;
  onVerdict: (id: number, v: Verdict) => void;
}

/** Détail d'une rotation ouverte : départ, arrivées, morts en route, frise et validation. */
function RotationDetail({ episode, game, owners, verdict, onVerdict }: DetailProps) {
  const info = rotationInfo(episode);
  const who = (s: number) => playerLabel(s, nameIn(game, s));
  return (
    <div className="eplist__body">
      <dl className="eplist__facts">
        <dt>Trajet</dt>
        <dd>
          point {episode.point} vers point {episode.point_to}
          {info.distanceM !== null ? `, ${info.distanceM.toFixed(1).replace('.', ',')} m entre les deux` : ''}
        </dd>
        <dt>Nouveau point actif</dt>
        <dd>{info.switchT !== null ? formatTime(info.switchT) : 'inconnu'}</dd>
        <dt>Deuxième arrivée</dt>
        <dd>{info.secondArrivalS !== null ? formatSeconds(info.secondArrivalS) : 'moins de deux arrivés'}</dd>
      </dl>
      <div className="eplist__cols">
        <div>
          <h4>Départ de l'ancien point</h4>
          <ul>
            {info.start.map((p) => (
              <li key={p.slot}>{who(p.slot)} : {p.leaveOffset !== null ? `part ${offsetLabel(p.leaveOffset)} le nouveau point` : 'départ non lu'}</li>
            ))}
            {info.start.length === 0 && <li>personne lu sur l'ancien point</li>}
          </ul>
        </div>
        <div>
          <h4>Arrivées au nouveau point</h4>
          <ul>
            {info.arrivals.map((p) => (
              <li key={p.slot}>{who(p.slot)} : {formatSeconds(p.travelS)} après l'apparition ({formatTime(p.t)})</li>
            ))}
            {info.arrivals.length === 0 && <li>personne n'arrive</li>}
          </ul>
        </div>
      </div>
      {info.deaths.length > 0 && (
        <>
          <h4>Morts en route</h4>
          <ol className="eplist__deaths">
            {info.deaths.map((d) => (
              <li key={`${d.slot}:${d.t}`}>{formatTime(d.t)} : {deathSentence(d, (s) => nameIn(game, s))}</li>
            ))}
          </ol>
        </>
      )}
      <EpisodeTimeline episode={episode} owners={owners} game={game} />
      <ValidateEpisode episodeId={episode.id} verdict={verdict} onChange={onVerdict} />
    </div>
  );
}
