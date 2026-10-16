// Barre de temps : games en vert, lobby en gris, début en attente en jaune, zones à vérifier hachurées en orange.
// Un clic déplace la lecture. Un clic sur une game la choisit et zoome la frise sur elle : la barre montre alors l'équipe qui
// capture, les kills orange au-dessus, les bleus en dessous et ceux sans équipe dans une rangée grise.

import { useEffect, useRef, useState } from 'react';
import { Maximize2, RefreshCw } from 'lucide-react';
import { KILL_LEAD_S, KILLS_STATUS_TEXT, killRow, killsStatus } from '../../lib/killTimeline';
import { hasNoPointChange } from '../../lib/pointChangeMarks';
import { formatTime, pctToSpan, spanToPct } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';
import { TimelineCapture } from './TimelineCapture';
import { TimelineKills } from './TimelineKills';
import { TimelinePointChanges } from './TimelinePointChanges';

/** Largeur réelle d'un élément en pixels, suivie quand la fenêtre change de taille. */
function useWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

export function SegmentTimeline({ duration }: { duration: number }) {
  const games = useAnalysisStore((s) => s.games);
  const selectedGameId = useAnalysisStore((s) => s.selectedGameId);
  const zoomGameId = useAnalysisStore((s) => s.zoomGameId);
  const currentTime = useAnalysisStore((s) => s.currentTime);
  const pendingStart = useAnalysisStore((s) => s.pendingStart);
  const requestSeek = useAnalysisStore((s) => s.requestSeek);
  const selectGame = useAnalysisStore((s) => s.selectGame);
  const zoomGame = useAnalysisStore((s) => s.zoomGame);
  const comments = useAnalysisStore((s) => s.comments);
  const jobRunning = useAnalysisStore((s) => s.job.running);
  const startAnalysis = useAnalysisStore((s) => s.startAnalysis);
  const bar = useRef<HTMLDivElement>(null);
  const width = useWidth(bar);

  // Axe : toute la vidéo, ou la game zoomée (une game supprimée entre-temps ramène à la vue complète).
  const zoomIndex = games.findIndex((g) => g.id === zoomGameId);
  const zoomed = zoomIndex >= 0 ? games[zoomIndex] : null;
  const from = zoomed ? zoomed.start_s : 0;
  const to = zoomed ? zoomed.end_s : duration;
  const pct = (t: number) => spanToPct(t, from, to);
  const inView = (t: number) => t >= from && t <= to;
  const doubts = zoomed ? zoomed.doubts.map((d, i) => ({ ...d, key: `${zoomed.id}-${i}` })) : games.flatMap((g) => g.doubts.map((d, i) => ({ ...d, key: `${g.id}-${i}` })));
  const noPointChange = !!zoomed && hasNoPointChange(zoomed.map);
  const status = zoomed ? killsStatus(zoomed) : null; // 'shown' : rangées de kills ; sinon un message dit pourquoi il n'y en a pas
  const hasNeutral = !!zoomed && zoomed.kills.some((k) => killRow(k) === 'neutral' && inView(k.t));

  const onBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    requestSeek(pctToSpan(((e.clientX - rect.left) / rect.width) * 100, from, to));
  };

  return (
    <div className={`timeline${zoomed ? ' is-zoomed' : ''}`}>
      {zoomed && (
        <div className="timeline__head">
          <strong>
            Game {zoomIndex + 1}
            {zoomed.map ? ` · ${zoomed.map}` : ''}
          </strong>
          <details className="help">
            <summary>Lire la frise</summary>
            <p className="help__body">
              Barre : équipe qui capture (orange ou bleue), d'après la hausse de son score ; quand aucun score ne monte, la dernière couleur reste ; gris : avant la
              première capture ou sans lecture. Au-dessus : kills de l'équipe orange ; en dessous : kills de l'équipe bleue ; rangée grise : suicides, morts du décor
              et tueurs non lus. Chaque tête de mort est un kill ; entourée d'un cercle en pointillé, plus petite et plus pâle : tueur déduit
              (pseudo non lu). Une pastille chiffrée : plusieurs kills trop proches regroupés (l'infobulle les liste tous). Un clic sur un kill place la vidéo
              {` ${KILL_LEAD_S} s avant.`}
            </p>
            <p className="help__body">
              Trait jaune : changement du point de capture actif, avec une bande de 10 s avant ; un clic place la vidéo au début de la bande.
              {noPointChange ? ' Aucun changement de point sur cette carte : pas de repères.' : ''}
            </p>
          </details>
          <button
            type="button"
            className="timeline__reread"
            disabled={jobRunning}
            onClick={() => void startAnalysis([zoomed.id])}
            title={
              jobRunning
                ? 'Une analyse est en cours : attends qu’elle se termine'
                : 'Analyse détaillée de cette seule game : seules les étapes manquantes ou d’une version dépassée sont relues ; la frise se met à jour à la fin'
            }
          >
            <RefreshCw className="ic" /> Relire cette game
          </button>
          <button type="button" className="timeline__full" onClick={() => zoomGame(null)} title="Revenir à toute la vidéo">
            <Maximize2 className="ic" /> Vue complète
          </button>
        </div>
      )}
      {zoomed && status === 'shown' && <TimelineKills game={zoomed} row="A" width={width} />}
      <div className="timeline__bar" ref={bar} onClick={onBarClick}>
        {zoomed ? (
          <>
            <TimelineCapture game={zoomed} />
            {!noPointChange && <TimelinePointChanges game={zoomed} />}
          </>
        ) : (
          games.map((g, i) => (
            <div
              key={g.id}
              className={`timeline__game${g.id === selectedGameId ? ' is-selected' : ''}`}
              style={{ left: `${pct(g.start_s)}%`, width: `${pct(g.end_s) - pct(g.start_s)}%` }}
              title={`${formatTime(g.start_s)} à ${formatTime(g.end_s)} : un clic zoome sur cette game`}
              onClick={(e) => {
                e.stopPropagation();
                selectGame(g.id);
                zoomGame(g.id);
                requestSeek(g.start_s);
              }}
            >
              <span className="timeline__game-label">{g.map ?? `Game ${i + 1}`}</span>
            </div>
          ))
        )}
        {doubts
          .filter((d) => d.end_s >= from && d.start_s <= to)
          .map((d) => (
            <div
              key={d.key}
              className="timeline__doubt"
              style={{ left: `${pct(d.start_s)}%`, width: `${Math.max(0.4, pct(d.end_s) - pct(d.start_s))}%` }}
              title={`À vérifier : ${d.label}`}
              onClick={(e) => {
                e.stopPropagation();
                requestSeek(d.start_s);
              }}
            />
          ))}
        {comments
          .filter((c) => !c.resolved && inView(c.t))
          .map((c) => (
            <button
              key={c.id}
              className={`timeline__comment timeline__comment--${c.tag}`}
              style={{ left: `${pct(c.t)}%` }}
              title={`${formatTime(c.t)} : ${c.text}`}
              onClick={(e) => {
                e.stopPropagation();
                requestSeek(Math.max(0, c.t - 2));
              }}
            />
          ))}
        {pendingStart !== null && inView(pendingStart) && <div className="timeline__pending" style={{ left: `${pct(pendingStart)}%` }} />}
        {inView(currentTime) && <div className="timeline__cursor" style={{ left: `${pct(currentTime)}%` }} />}
      </div>
      {zoomed && status === 'shown' && <TimelineKills game={zoomed} row="B" width={width} />}
      {zoomed && status === 'shown' && hasNeutral && <TimelineKills game={zoomed} row="neutral" width={width} />}
      {status && status !== 'shown' && <p className="timeline__status">{KILLS_STATUS_TEXT[status]}</p>}
      <div className="timeline__legend">
        {zoomed ? (
          <>
            <span>0:00</span>
            <span title="Temps dans la game">{inView(currentTime) ? formatTime(currentTime - from) : 'hors de la game'}</span>
            <span>{formatTime(to - from)}</span>
          </>
        ) : (
          <>
            <span>0:00</span>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </>
        )}
      </div>
    </div>
  );
}
