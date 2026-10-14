// Détail de l'épisode choisi (vue Retakes) : faits, attaquants et défenseurs au départ, morts et causes automatiques, frise du chrono de l'épisode, validation « Juste » ou « Faux ».
// Pour une série de 3 ou 4 kills : les kills, le repositionnement de l'équipe adverse et l'issue selon les deux lectures de l'attribution (question ouverte, sans trancher).

import { sideName } from '../../lib/episodeClock';
import {
  deathSentence,
  fateLabel,
  formatSeconds,
  isSeries,
  outcomeInfo,
  playerLabel,
  retakeInfo,
} from '../../lib/episodeFormat';
import { repositionSentence, seriesInfo, viewsSentence } from '../../lib/seriesFormat';
import type { FollowSpec } from '../../lib/teamFollow';
import { formatTime } from '../../lib/timeline';
import type { Episode, PointOwner } from '../../types/stats';
import { EpisodeTimeline } from './EpisodeTimeline';
import type { StatsGame } from './useStats';
import { ValidateEpisode } from './ValidateEpisode';

type Verdict = 'ok' | 'ko' | null;

interface Props {
  episode: Episode;
  game: StatsGame;
  owners: PointOwner[];
  spec: FollowSpec;
  verdict: Verdict;
  onVerdict: (id: number, v: Verdict) => void;
}

const nameIn = (g: StatsGame, slot: number) => g.players.find((p) => p.slot === slot)?.name;

export function EpisodePanel({ episode, game, owners, spec, verdict, onVerdict }: Props) {
  const info = retakeInfo(episode);
  const series = isSeries(episode);
  const who = (s: number) => playerLabel(s, nameIn(game, s));
  return (
    <div className="eplist__body">
      <dl className="eplist__facts">
        <dt>Résultat</dt>
        <dd>{outcomeInfo(episode.outcome).label}</dd>
        <dt>{series ? 'Équipe de l\'épisode' : 'Attaque'}</dt>
        <dd>{sideName(game, episode.team)}</dd>
        {!series && (
          <>
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
          </>
        )}
      </dl>
      {series ? <SeriesBody episode={episode} game={game} who={who} /> : <RetakeBody episode={episode} game={game} who={who} />}
      <EpisodeTimeline episode={episode} owners={owners} game={game} spec={spec} />
      <ValidateEpisode episodeId={episode.id} verdict={verdict} onChange={onVerdict} />
    </div>
  );
}

interface BodyProps {
  episode: Episode;
  game: StatsGame;
  who: (slot: number) => string;
}

/** Retake classique : attaquants et défenseurs au départ, morts avec leur cause automatique. */
function RetakeBody({ episode, game, who }: BodyProps) {
  const info = retakeInfo(episode);
  return (
    <>
      <div className="eplist__cols">
        <div>
          <h4>Attaquants au départ</h4>
          <ul>
            {info.attackers.map((p) => (
              <li key={p.slot}>
                {who(p.slot)}
                {p.distM !== null ? `, à ${p.distM.toFixed(1).replace('.', ',')} m du point` : ''}
              </li>
            ))}
            {info.attackers.length === 0 && <li>aucun lu</li>}
          </ul>
        </div>
        <div>
          <h4>Défenseurs</h4>
          <ul>
            {info.defenders.map((p) => (
              <li key={p.slot}>
                {who(p.slot)} : {fateLabel(p.fate)}
              </li>
            ))}
            {info.defenders.length === 0 && <li>aucun vivant au départ</li>}
          </ul>
        </div>
      </div>
      <h4>Morts et causes automatiques</h4>
      <ol className="eplist__deaths">
        {info.deaths.map((d) => (
          <li key={`${d.slot}:${d.t}`}>
            {formatTime(d.t)} : {deathSentence(d, (s) => nameIn(game, s))}
          </li>
        ))}
        {info.deaths.length === 0 && <li>aucune mort dans la fenêtre</li>}
      </ol>
    </>
  );
}

/** Série de 3 ou 4 kills : kills, issue selon les deux lectures de l'attribution, repositionnement de l'équipe adverse. */
function SeriesBody({ episode, game, who }: BodyProps) {
  const s = seriesInfo(episode);
  const views = viewsSentence(s);
  const repo = repositionSentence(s);
  return (
    <>
      <dl className="eplist__facts">
        <dt>Série</dt>
        <dd>
          {s.kills.length || s.victims} kill{(s.kills.length || s.victims) > 1 ? 's' : ''}, {s.victims} victime{s.victims > 1 ? 's' : ''} distincte{s.victims > 1 ? 's' : ''}
          {s.seriesT ? `, de ${formatTime(s.seriesT[0])} à ${formatTime(s.seriesT[1])}` : ''}
        </dd>
        <dt>Attribution</dt>
        <dd>
          tueurs : {s.killerTeam ? sideName(game, s.killerTeam) : 'inconnue'} ; victimes : {s.victimTeam ? sideName(game, s.victimTeam) : 'inconnue'} ; tenant du point : {s.holderTeam ? sideName(game, s.holderTeam) : 'inconnu'}
        </dd>
        <dt>Après la série</dt>
        <dd>{s.changedHands ? 'le point change de main dans les secondes qui suivent' : 'le point ne change pas de main'}</dd>
        {views && (
          <>
            <dt>Issue selon l'attribution</dt>
            <dd>
              {views}
              {s.view ? ` (affichée : lecture « ${s.view === 'killer' ? 'tueur' : 'victime'} »)` : ''}
            </dd>
          </>
        )}
        {repo && (
          <>
            <dt>Équipe adverse</dt>
            <dd>{repo}</dd>
          </>
        )}
      </dl>
      <h4>Kills de la série</h4>
      <ol className="eplist__deaths">
        {s.kills.map((k) => (
          <li key={`${k.t}:${k.victim}`}>
            {formatTime(k.t)} : {k.killer !== null ? who(k.killer) : 'tueur non lu'} tue {k.victim !== null ? who(k.victim) : 'un joueur inconnu'}
            {k.weapon ? ` (${k.weapon})` : ''}
          </li>
        ))}
        {s.kills.length === 0 && <li>kills non détaillés dans ce calcul</li>}
      </ol>
    </>
  );
}
