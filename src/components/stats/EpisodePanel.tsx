// Détail de la vague choisie (vue Retakes) : équipe, taille, vitesse, point visé, tenant avant et après, durées, teamfight, prise du point, survivants repliés, position du combat,
// joueurs de la vague et ennemis vivants au premier kill, morts avec leurs causes, frise du chrono de la vague, validation « Juste » ou « Faux ».
// Une ligne de l'ancien calcul (sans détail de vague) garde un détail réduit, avec l'avertissement « ancien calcul ».

import { TriangleAlert } from 'lucide-react';
import { sideName } from '../../lib/episodeClock';
import { causeSummary, deathSentence, fateLabel, formatSeconds, playerLabel, retakeInfo } from '../../lib/episodeFormat';
import type { FollowSpec } from '../../lib/teamFollow';
import { formatTime } from '../../lib/timeline';
import { axisSentence, doubtfulCapture, holderLabel, retreatSentence, speedSentence, tfResultLabel, type WaveInfo, waveInfo } from '../../lib/waveInfo';
import { waveIssueInfo } from '../../lib/waveOutcome';
import type { Episode, PointOwner, TeamSide } from '../../types/stats';
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
  const issue = waveIssueInfo(episode);
  const wave = waveInfo(episode);
  const info = retakeInfo(episode);
  const who = (s: number) => playerLabel(s, nameIn(game, s));
  return (
    <div className="eplist__body">
      {issue.legacy && (
        <p className="eps__legacy">
          <TriangleAlert className="ic" /> Ligne de l'ancien calcul (sans détail de vague) : le classement ne suit pas les définitions actuelles et la ligne n'entre pas dans les taux. Recalculer la game : `python analysis/stats_run.py --game N`.
        </p>
      )}
      <dl className="eplist__facts">
        <dt>Issue</dt>
        <dd>{issue.label}</dd>
        {wave ? <WaveFacts wave={wave} game={game} survivors={info.survivors.length} /> : <LegacyFacts episode={episode} game={game} />}
      </dl>
      <div className="eplist__cols">
        <div>
          <h4>{wave ? 'Joueurs de la vague au premier kill' : 'Attaquants au départ'}</h4>
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
          <h4>Ennemis vivants au premier kill</h4>
          <ul>
            {info.defenders.map((p) => (
              <li key={p.slot}>
                {who(p.slot)} : {fateLabel(p.fate)}
              </li>
            ))}
            {info.defenders.length === 0 && <li>aucun vivant</li>}
          </ul>
        </div>
      </div>
      <h4>Morts et causes automatiques{info.deaths.length > 0 ? ` (${causeSummary(info.deaths)})` : ''}</h4>
      <ol className="eplist__deaths">
        {info.deaths.map((d) => (
          <li key={`${d.slot}:${d.t}`}>
            {formatTime(d.t)} : {deathSentence(d, (s) => nameIn(game, s))}
          </li>
        ))}
        {info.deaths.length === 0 && <li>aucune mort dans la vague</li>}
      </ol>
      <EpisodeTimeline episode={episode} owners={owners} game={game} spec={spec} />
      <ValidateEpisode episodeId={episode.id} verdict={verdict} onChange={onVerdict} />
    </div>
  );
}

interface FactsProps {
  game: StatsGame;
}

/** Faits d'une vague (révision 3 du calcul). */
function WaveFacts({ wave, game, survivors }: FactsProps & { wave: WaveInfo; survivors: number }) {
  const name = (s: TeamSide) => sideName(game, s);
  const fight = wave.fight;
  const losses = fight?.losses ? `morts : ${name('A')} ${fight.losses.A}, ${name('B')} ${fight.losses.B}` : null;
  return (
    <>
      <dt>Équipe de la vague</dt>
      <dd>
        {wave.team ? name(wave.team) : 'inconnue'}
        {wave.size !== null ? `, ${wave.size} joueur${wave.size > 1 ? 's' : ''}` : ''}
      </dd>
      <dt>Vitesse</dt>
      <dd>{speedSentence(wave)}</dd>
      <dt>Point visé</dt>
      <dd>
        {wave.point ? `Point ${wave.point}` : 'inconnu'}, tenu avant par {holderLabel(wave.holderBefore, name)}, après par {holderLabel(wave.holderAfter, name)}
        {wave.opening ? ' (première prise de la game)' : ''}
      </dd>
      <dt>Départ du spawn</dt>
      <dd>{formatTime(wave.tStart)}</dd>
      <dt>Premier kill</dt>
      <dd>{wave.tContact !== null ? `${formatTime(wave.tContact)}, ${wave.toContactS !== null ? formatSeconds(wave.toContactS) : '?'} après le départ` : 'aucun kill de la vague avant sa limite'}</dd>
      <dt>Résolution</dt>
      <dd>
        {formatTime(wave.tEnd)}
        {wave.durationS !== null ? ` (${formatSeconds(wave.durationS)} depuis le départ)` : ''}
      </dd>
      <dt>Teamfight</dt>
      <dd>
        {tfResultLabel(wave.tfResult)}
        {fight && fight.nKills !== null ? `, ${fight.nKills} kill${fight.nKills > 1 ? 's' : ''}` : ''}
        {losses ? `, ${losses}` : ''}
        {fight && fight.nearPoint !== null ? `, ${Math.round(fight.nearPoint * 100)} % des victimes à moins de 7 m du point` : ''}
      </dd>
      <dt>Prise du point</dt>
      <dd>
        {wave.capturedT !== null ? `${formatTime(wave.capturedT)}, de ${holderLabel(wave.captureFrom, name)} vers ${wave.team ? name(wave.team) : 'la vague'}` : 'aucune dans la fenêtre'}
        {doubtfulCapture(wave) ? ' : prise malgré un teamfight non gagné, à vérifier' : ''}
      </dd>
      <dt>Survivants</dt>
      <dd>{retreatSentence(wave.survivorsRetreated, survivors)}</dd>
      <dt>Position du combat</dt>
      <dd>{axisSentence(wave.axisFrac, !!fight)}</dd>
    </>
  );
}

/** Faits d'une ancienne ligne : ce que l'ancien calcul écrivait (départ de la poussée, prise du point). */
function LegacyFacts({ episode, game }: FactsProps & { episode: Episode }) {
  const info = retakeInfo(episode);
  return (
    <>
      <dt>Attaque</dt>
      <dd>{sideName(game, episode.team)}</dd>
      <dt>Départ de la poussée</dt>
      <dd>{info.pushT !== null ? formatTime(info.pushT) : 'non trouvé'}</dd>
      <dt>Prise du point</dt>
      <dd>{info.changeT !== null ? formatTime(info.changeT) : 'le point ne change pas de main'}</dd>
    </>
  );
}
