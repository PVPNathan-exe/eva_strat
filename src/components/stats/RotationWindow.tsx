// Panneau « 20 s avant, 20 s après » d'une équipe pour la rotation choisie : axe de la fenêtre avec le moment où l'équipe quitte l'ancien point (négatif : elle anticipe),
// celui où elle se concentre sur le nouveau, les arrivées et les morts, puis les phrases qui les décrivent. Même panneau pour l'équipe qui tourne et pour l'équipe adverse
// (champs data.flow et data.opponent de analysis/rotations.py). Les boutons « Juste » et « Faux » jugent l'épisode de cette équipe quand il existe.

import { outcomeInfo, playerLabel } from '../../lib/episodeFormat';
import type { Palette } from '../../lib/teamFollow';
import {
  approachSentence,
  arrivalSentence,
  concentrateSentence,
  leaveSentence,
  ROT_AFTER_S,
  ROT_BEFORE_S,
  signedSeconds,
  windowMarks,
  windowPct,
  type TeamFlow,
} from '../../lib/rotationWindow';
import type { Episode } from '../../types/stats';
import '../../styles/stats-chrono.css';
import { ValidateEpisode } from './ValidateEpisode';

type Verdict = 'ok' | 'ko' | null;

interface Props {
  name: string;
  palette: Palette;
  flow: TeamFlow | null;
  /** Épisode de cette équipe (absent quand l'équipe n'avait pas de rotation à elle : seule son équipe adverse en a une). */
  episode: Episode | null;
  verdict: Verdict;
  onVerdict: (id: number, v: Verdict) => void;
  nameOf: (slot: number) => string | undefined;
}

export function RotationWindow({ name, palette, flow, episode, verdict, onVerdict, nameOf }: Props) {
  const marks = flow ? windowMarks(flow) : [];
  const approach = flow ? approachSentence(flow) : null;
  return (
    <section className={`rwin pal pal--${palette}`} aria-label={`Équipe ${name}`}>
      <h4 className="rwin__title">
        {name}
        {episode && <span className={`eplist__tag eplist__tag--${outcomeInfo(episode.outcome).tone}`}>{outcomeInfo(episode.outcome).label}</span>}
      </h4>
      {flow ? (
        <>
          <div className="rwin__axis" role="img" aria-label={`De ${ROT_BEFORE_S} s avant à ${ROT_AFTER_S} s après le changement de point actif`}>
            <i className="rwin__zero" />
            {marks.map((m, i) => (
              <i key={`${m.kind}${i}`} className={`rwin__mark rwin__mark--${m.kind}`} style={{ left: `${windowPct(m.offset)}%` }} title={m.label} />
            ))}
          </div>
          <div className="rwin__scale">
            <span>-{ROT_BEFORE_S} s</span>
            <span>changement</span>
            <span>+{ROT_AFTER_S} s</span>
          </div>
          <ul className="rwin__list">
            <li>
              <b>Ancien point.</b> {leaveSentence(flow)}
            </li>
            <li>
              <b>Nouveau point.</b> {concentrateSentence(flow)} {arrivalSentence(flow)}
            </li>
            {approach && <li>{approach}</li>}
            <li>
              <b>Morts.</b>{' '}
              {flow.deaths.length === 0
                ? 'Aucune dans la fenêtre.'
                : flow.deaths.map((d) => `${playerLabel(d.slot, nameOf(d.slot))}${d.offset !== null ? ` ${signedSeconds(d.offset)}` : ''}${d.killer !== null ? `, tué par ${playerLabel(d.killer, nameOf(d.killer))}` : ''}`).join(' ; ') + '.'}
            </li>
          </ul>
        </>
      ) : (
        <p className="stats__empty">Comportement de l'équipe non calculé pour ce changement (calcul ancien) : relancer `python analysis/stats_run.py --game N`.</p>
      )}
      {episode && <ValidateEpisode episodeId={episode.id} verdict={verdict} onChange={onVerdict} />}
    </section>
  );
}
