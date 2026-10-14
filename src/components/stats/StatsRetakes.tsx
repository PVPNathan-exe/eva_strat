// Vue Retakes : épisodes où un point change de main (ou poussée ratée), regroupés par point. Tableau par point (taux masqué sous 5 épisodes décidés),
// plan avec la position de départ des attaquants (couleur = résultat), liste des épisodes avec détail (défenseurs, causes des morts, frise du chrono)
// et boutons de validation. Les épisodes viennent de /api/stats/episodes (module analysis/retakes.py), temps en secondes depuis le début de la game.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, SlidersHorizontal, TriangleAlert, X } from 'lucide-react';
import {
  causeLabel,
  deathSentence,
  fateLabel,
  filterEpisodes,
  formatSeconds,
  groupByPoint,
  keyInstant,
  MIN_EPISODES,
  outcomeInfo,
  percent,
  playerLabel,
  rateOf,
  retakeInfo,
  type RateStats,
} from '../../lib/episodeFormat';
import { numberOfSlot } from '../../lib/killTimeline';
import { statsApi } from '../../lib/statsApi';
import { formatTime } from '../../lib/timeline';
import type { Episode, PointOwner, TeamSide } from '../../types/stats';
import { EpisodeTimeline } from './EpisodeTimeline';
import { StatsMapBase } from './StatsMapBase';
import { noticeOf, useLoad, type StatsGame } from './useStats';
import { ValidateEpisode } from './ValidateEpisode';

interface Props {
  map: string;
  games: StatsGame[];
  team: TeamSide | 'all';
  slot: number;
}

type Verdict = 'ok' | 'ko' | null;

const rateText = (s: RateStats) => (s.rate !== null ? percent(s.rate) : `masqué (${s.decided} décidé${s.decided > 1 ? 's' : ''}, minimum ${MIN_EPISODES})`);
const teamName = (g: StatsGame, side: TeamSide | null) => (side === 'B' ? (g.teamB ?? 'équipe bleue') : (g.teamA ?? 'équipe orange'));
const nameIn = (g: StatsGame, slot: number) => g.players.find((p) => p.slot === slot)?.name;
const sideOf = (slot: number): TeamSide => (slot <= 4 ? 'A' : 'B');

export function StatsRetakes({ map, games, team, slot }: Props) {
  const [corridors, setCorridors] = useState(false);
  const [showDefenders, setShowDefenders] = useState(true);
  const [showDeaths, setShowDeaths] = useState(true);
  const [pointChoice, setPointChoice] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const ids = useMemo(() => games.map((g) => g.id), [games]);
  const load = useLoad(`retakes:${map}`, () => statsApi.episodesOfMap(map, 'retake'));
  // Propriétaires des points : sans eux (route absente), la frise s'affiche sans bandes
  const ownersLoad = useLoad(ids.length ? `owners:${ids.join(',')}` : null, () => Promise.all(ids.map((id) => statsApi.owners(id))).then((l) => l.flat()));
  const owners: PointOwner[] = ownersLoad.data ?? [];

  const eps = useMemo(() => (load.data ? filterEpisodes(load.data, ids, team, slot) : []), [load.data, ids, team, slot]);
  const groups = useMemo(() => groupByPoint(eps), [eps]);
  const current = groups.find((g) => g.point === pointChoice) ?? groups[0] ?? null;
  const active = current?.episodes.find((e) => e.id === activeId) ?? null;
  const gameOf = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);
  const verdictOf = (e: Episode): Verdict => (e.id in verdicts ? verdicts[e.id] : e.verdict);
  const setVerdict = (id: number, v: Verdict) => setVerdicts((old) => ({ ...old, [id]: v }));
  const notice = noticeOf(load);

  return (
    <div className="stats__view eps">
      <p className="eps__warn">
        <TriangleAlert className="ic" /> Détection non validée : seuils étalonnés sur 10 games. Juger chaque épisode (juste ou faux) avant de s'appuyer sur les résultats.
      </p>
      <div className="stats__bar">
        <details className="menu">
          <summary>
            <SlidersHorizontal className="ic" /> Affichage
          </summary>
          <div className="menu__panel">
            <label><input type="checkbox" checked={showDefenders} onChange={(e) => setShowDefenders(e.target.checked)} /> Défenseurs de l'épisode ouvert</label>
            <label><input type="checkbox" checked={showDeaths} onChange={(e) => setShowDeaths(e.target.checked)} /> Morts de l'épisode ouvert</label>
            <label><input type="checkbox" checked={corridors} onChange={(e) => setCorridors(e.target.checked)} /> Couloirs</label>
          </div>
        </details>
        {!notice && (
          <span className="stats__count">
            {games.length} game{games.length > 1 ? 's' : ''} retenue{games.length > 1 ? 's' : ''}, {eps.length} épisode{eps.length > 1 ? 's' : ''}
          </span>
        )}
      </div>
      {notice && <p className="stats__empty">{notice}</p>}
      {!notice && eps.length === 0 && <p className="stats__empty">Aucun retake pour ce choix. Les épisodes se calculent game par game : `python analysis/stats_run.py --game N`.</p>}

      {!notice && groups.length > 0 && (
        <div className="eps__scroll">
          <table className="eps__table">
            <thead>
              <tr>
                <th>Point</th>
                <th>Épisodes</th>
                <th>Réussis</th>
                <th>Échecs</th>
                <th>À vérifier</th>
                <th>Taux de réussite</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => {
                const r = rateOf(g.episodes, verdicts);
                return (
                  <tr key={g.point} className={g.point === current?.point ? 'is-active' : ''}>
                    <th scope="row">
                      <button type="button" onClick={() => { setPointChoice(g.point); setActiveId(null); }} aria-pressed={g.point === current?.point}>{g.label}</button>
                    </th>
                    <td>{r.total}</td>
                    <td>{r.good}</td>
                    <td>{r.bad}</td>
                    <td>{r.doubt}</td>
                    <td>{rateText(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!notice && current && (
        <>
          <StatsMapBase map={map} corridors={corridors}>
            {({ at }) => (
              <>
                {current.episodes
                  .filter((e) => e.id !== active?.id)
                  .flatMap((e) => {
                    const tone = outcomeInfo(e.outcome).tone;
                    return retakeInfo(e).attackers.flatMap((p) => {
                      if (!p.pos) return [];
                      const pt = at(p.pos[0], p.pos[1]);
                      return [
                        <button key={`${e.id}:${p.slot}`} type="button" className={`epmap__dot epmap__dot--${tone}${active ? ' is-dim' : ''}`} style={{ left: `${pt.x}%`, top: `${pt.y}%` }} aria-label={`Départ de ${playerLabel(p.slot)}, game ${e.game_id}, ${formatTime(keyInstant(e))}`} title={`Game ${e.game_id}, ${formatTime(keyInstant(e))} : ${outcomeInfo(e.outcome).label}`} onClick={() => setActiveId(e.id)} />,
                      ];
                    });
                  })}
                {active && <ActiveMarks episode={active} game={gameOf.get(active.game_id)} at={at} defenders={showDefenders} deaths={showDeaths} />}
              </>
            )}
          </StatsMapBase>
          <ul className="eps__legend">
            <li><span className="epmap__dot epmap__dot--good" /> Réussi</li>
            <li><span className="epmap__dot epmap__dot--bad" /> Échec</li>
            <li><span className="epmap__dot epmap__dot--doubt" /> Sans départ, à vérifier</li>
          </ul>
          <ol className="eplist">
            {current.episodes.map((e) => {
              const g = gameOf.get(e.game_id);
              const info = retakeInfo(e);
              const out = outcomeInfo(e.outcome);
              const open = e.id === active?.id;
              const v = verdictOf(e);
              return (
                <li key={e.id} className={`eplist__item${open ? ' is-active' : ''}${v === 'ko' ? ' is-ko' : ''}`}>
                  <button type="button" className="eplist__head" aria-expanded={open} onClick={() => setActiveId(open ? null : e.id)}>
                    {open ? <ChevronDown className="ic" /> : <ChevronRight className="ic" />}
                    <span className="eplist__when">Game {e.game_id}, {formatTime(keyInstant(e))}</span>
                    <span className={`eplist__tag eplist__tag--${out.tone}`}>{out.label}</span>
                    <span className="eplist__sum">
                      {g ? teamName(g, e.team) : 'Attaquants'} : {info.attackers.length} au départ, {info.defenders.length} en face
                      {info.firstDeath ? `, premier mort ${playerLabel(info.firstDeath.slot)} (${causeLabel(info.firstDeath.cause)})` : ''}
                    </span>
                    {v && <span className={`eplist__verdict eplist__verdict--${v}`}>{v === 'ok' ? 'jugé juste' : 'jugé faux'}</span>}
                  </button>
                  {open && g && <RetakeDetail episode={e} game={g} owners={owners} verdict={v} onVerdict={setVerdict} />}
                </li>
              );
            })}
          </ol>
        </>
      )}
      <details className="help">
        <summary>Comment lire les retakes</summary>
        <p className="help__body">
          Un retake est un point qui passe d'une équipe à l'autre. Réussi : au moins deux attaquants étaient à moins de 4 m du point avant la prise. Échec : deux à quatre attaquants
          morts en 10 s sans prise du point et sans survivant à plus de 7 m. Sans départ : le point a changé de main sans que deux attaquants soient lus au point (à vérifier, pas un retake
          sûr). Les points sont sur le plan : chaque rond est la position de départ d'un attaquant, de la couleur du résultat. Ouvrir un épisode affiche ses joueurs (orange et bleu,
          pointillé pour les défenseurs), ses morts, les causes automatiques et la frise du chrono, avec un lien vers la vidéo 5 s avant. Les taux ignorent les épisodes à vérifier et ceux
          jugés faux, et restent masqués sous {MIN_EPISODES} épisodes décidés. Seuils étalonnés sur 10 games, détection non validée.
        </p>
      </details>
    </div>
  );
}

interface MarksProps {
  episode: Episode;
  game: StatsGame | undefined;
  at: (x: number, y: number) => { x: number; y: number };
  defenders: boolean;
  deaths: boolean;
}

/** Joueurs et morts de l'épisode ouvert sur le plan : attaquants pleins, défenseurs en pointillé, morts en croix. */
function ActiveMarks({ episode, game, at, defenders, deaths }: MarksProps) {
  const info = retakeInfo(episode);
  const label = (s: number) => playerLabel(s, game ? nameIn(game, s) : undefined);
  const player = (p: (typeof info.attackers)[number], defender: boolean) => {
    if (!p.pos) return null;
    const pt = at(p.pos[0], p.pos[1]);
    return (
      <span key={`${defender ? 'd' : 'a'}${p.slot}`} className={`epmap__player epmap__player--${sideOf(p.slot)}${defender ? ' is-defender' : ''}`} style={{ left: `${pt.x}%`, top: `${pt.y}%` }} title={`${label(p.slot)}${defender ? `, ${fateLabel(p.fate)}` : ''}`}>
        {numberOfSlot(p.slot)}
      </span>
    );
  };
  return (
    <>
      {info.attackers.map((p) => player(p, false))}
      {defenders && info.defenders.map((p) => player(p, true))}
      {deaths &&
        info.deaths.map((d, i) => {
          if (!d.pos) return null;
          const pt = at(d.pos[0], d.pos[1]);
          return (
            <span key={`x${d.slot}:${d.t}`} className="epmap__death" style={{ left: `${pt.x}%`, top: `${pt.y}%` }} title={`Mort ${i + 1} : ${game ? deathSentence(d, (s) => nameIn(game, s)) : label(d.slot)}`}>
              <X className="ic" />
            </span>
          );
        })}
    </>
  );
}

interface DetailProps {
  episode: Episode;
  game: StatsGame;
  owners: PointOwner[];
  verdict: Verdict;
  onVerdict: (id: number, v: Verdict) => void;
}

/** Détail d'un retake ouvert : faits, joueurs, causes des morts, frise et validation. */
function RetakeDetail({ episode, game, owners, verdict, onVerdict }: DetailProps) {
  const info = retakeInfo(episode);
  const who = (s: number) => playerLabel(s, nameIn(game, s));
  return (
    <div className="eplist__body">
      <dl className="eplist__facts">
        <dt>Attaque</dt>
        <dd>{teamName(game, episode.team)}</dd>
        <dt>Départ de la poussée</dt>
        <dd>{info.pushT !== null ? formatTime(info.pushT) : 'non trouvé (moins de deux attaquants au point)'}</dd>
        <dt>Prise du point</dt>
        <dd>{info.changeT !== null ? formatTime(info.changeT) : 'le point ne change pas de main'}</dd>
        <dt>Arrivée décalée</dt>
        <dd>{info.staggerS !== null ? `${formatSeconds(info.staggerS)} entre les deux premiers attaquants` : 'inconnue'}</dd>
        {episode.outcome === 'fail' && (
          <>
            <dt>Survivants</dt>
            <dd>{info.survivors.length ? info.survivors.map(who).join(', ') : 'aucun'}</dd>
          </>
        )}
      </dl>
      <div className="eplist__cols">
        <div>
          <h4>Attaquants au départ</h4>
          <ul>
            {info.attackers.map((p) => (
              <li key={p.slot}>{who(p.slot)}{p.distM !== null ? `, à ${p.distM.toFixed(1).replace('.', ',')} m du point` : ''}</li>
            ))}
            {info.attackers.length === 0 && <li>aucun lu</li>}
          </ul>
        </div>
        <div>
          <h4>Défenseurs</h4>
          <ul>
            {info.defenders.map((p) => (
              <li key={p.slot}>{who(p.slot)} : {fateLabel(p.fate)}</li>
            ))}
            {info.defenders.length === 0 && <li>aucun vivant au départ</li>}
          </ul>
        </div>
      </div>
      <h4>Morts et causes automatiques</h4>
      <ol className="eplist__deaths">
        {info.deaths.map((d) => (
          <li key={`${d.slot}:${d.t}`}>{formatTime(d.t)} : {deathSentence(d, (s) => nameIn(game, s))}</li>
        ))}
        {info.deaths.length === 0 && <li>aucune mort dans la fenêtre</li>}
      </ol>
      <EpisodeTimeline episode={episode} owners={owners} game={game} />
      <ValidateEpisode episodeId={episode.id} verdict={verdict} onChange={onVerdict} />
    </div>
  );
}
