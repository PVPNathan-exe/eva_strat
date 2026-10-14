// Vue Retakes : chronologie de la game rejouée avec, pour chaque point, les bandes de propriétaire (équipe suivie par son nom, adversaires, neutre) et les épisodes marqués
// (réussite, échec, sans départ, série de 3 ou 4 kills). Cliquer un épisode place le curseur au début de sa fenêtre ; le plan montre les joueurs vivants au curseur (pions numérotés)
// avec le point concerné entouré. Les boutons « Juste » et « Faux » jugent la détection (PUT /api/stats/episodes/:id). Une seule game à la fois (celle rejouée), temps en secondes de game.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import {
  buildLanes,
  episodesAt,
  episodeInScope,
  paletteOfSide,
  pointsOf,
  positionsAt,
  retakeMark,
  sideName,
  toneOfOwner,
  type EpisodeMark,
  type OwnerBand,
} from '../../lib/episodeClock';
import { isSeries, keyInstant, MIN_EPISODES, outcomeInfo, percent, playerLabel, causeLabel, rateOf, retakeInfo } from '../../lib/episodeFormat';
import { pointRectsOf } from '../../lib/pointRects';
import { seriesInfo } from '../../lib/seriesFormat';
import { statsApi } from '../../lib/statsApi';
import { paletteOf, type FollowSpec } from '../../lib/teamFollow';
import { formatTime } from '../../lib/timeline';
import type { Episode } from '../../types/stats';
import { EpisodeMap, type DeathCross, type Ring } from './EpisodeMap';
import { EpisodePanel } from './EpisodePanel';
import { GameClock } from './GameClock';
import { PointTimeline } from './PointTimeline';
import { useReplayIndex, useStripData } from './useEpisodeData';
import { useGameClock } from './useGameClock';
import { durationOf, noticeOf, useLoad, type StatsGame } from './useStats';

interface Props {
  map: string;
  /** Game rejouée (une seule game à la fois). */
  replay: StatsGame;
  spec: FollowSpec;
}

type Verdict = 'ok' | 'ko' | null;

export function StatsRetakes({ map, replay, spec }: Props) {
  const [corridors, setCorridors] = useState(false);
  const [showDeaths, setShowDeaths] = useState(true);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const load = useLoad(`retakes-game:${replay.id}`, () => statsApi.episodesOfGame(replay.id));
  const strip = useStripData(replay.id);
  const positions = useReplayIndex(replay);
  const clock = useGameClock(`retakes:${replay.id}`, durationOf(replay));
  const rects = useMemo(() => pointRectsOf(map), [map]);

  // Épisodes de la game rejouée (retakes et séries de kills) pour l'équipe et le joueur choisis
  const eps = useMemo(
    () => (load.data ?? []).filter((e) => e.kind === 'retake' && episodeInScope(e, replay, spec)).sort((a, b) => a.t0 - b.t0 || a.id - b.id),
    [load.data, replay, spec],
  );
  const active = eps.find((e) => e.id === activeId) ?? null;
  const verdictOf = (e: Episode): Verdict => (e.id in verdicts ? verdicts[e.id] : e.verdict);

  const toneOf = useMemo(() => (owner: 'A' | 'B' | 'none') => toneOfOwner(replay, spec, owner), [replay, spec]);
  const lanes = useMemo(() => {
    const marks = eps.map((e) => retakeMark(e, clock.duration, e.team ? paletteOfSide(replay, spec, e.team) : null));
    return buildLanes(pointsOf(strip.owners, [], eps), strip.owners, [], marks, clock.duration, toneOf);
  }, [eps, strip.owners, clock.duration, replay, spec, toneOf]);

  // Plan au curseur : joueurs vivants, point des épisodes en cours (et de l'épisode choisi), morts de l'épisode choisi déjà survenues
  const pawns = useMemo(() => positionsAt(positions.index, clock.t), [positions.index, clock.t]);
  const rings = useMemo<Ring[]>(() => {
    const here = episodesAt(eps, clock.t);
    if (active && !here.includes(active)) here.push(active);
    const points = [...new Set(here.map((e) => e.point).filter((p): p is string => !!p))];
    return points.flatMap((point) => (rects[point] ? [{ point, rect: rects[point], role: 'point' as const }] : []));
  }, [eps, active, clock.t, rects]);
  const crosses = useMemo<DeathCross[]>(() => {
    if (!showDeaths || !active || isSeries(active)) return [];
    return retakeInfo(active).deaths.flatMap((d) =>
      d.pos && d.t <= clock.t ? [{ key: `${d.slot}:${d.t}`, x: d.pos[0], y: d.pos[1], palette: paletteOfSide(replay, spec, d.team), title: `${formatTime(d.t)} : mort de ${playerLabel(d.slot)} (${causeLabel(d.cause)})` }] : [],
    );
  }, [showDeaths, active, clock.t, replay, spec]);

  const pick = (e: Episode) => {
    setActiveId(e.id);
    clock.seek(e.t0); // le curseur se place au début de la fenêtre (20 s avant le changement)
  };
  const pickMark = (m: EpisodeMark) => {
    const e = eps.find((x) => String(x.id) === m.key);
    if (e) pick(e);
  };
  const ownerTitle = (b: OwnerBand) => (b.owner === 'none' ? 'Point neutre' : `Point à ${sideName(replay, b.owner)}`);
  const nameOf = (slot: number) => replay.players.find((p) => p.slot === slot)?.name;
  const notice = noticeOf(load);
  const rate = rateOf(eps, verdicts);

  return (
    <div className="stats__view eps">
      <p className="eps__warn">
        <TriangleAlert className="ic" /> Détection non validée : seuils étalonnés sur 10 games. Juger chaque épisode (juste ou faux) avant de s'appuyer sur les résultats.
      </p>
      {notice && <p className="stats__empty">{notice}</p>}
      {!notice && eps.length === 0 && <p className="stats__empty">Aucun retake pour cette game et ce choix. Les épisodes se calculent game par game : `python analysis/stats_run.py --game N`.</p>}
      {!notice && lanes.length > 0 && <PointTimeline lanes={lanes} duration={clock.duration} t={clock.t} activeKey={active ? String(active.id) : null} onSeek={clock.seek} onPick={pickMark} ownerTitle={ownerTitle} />}
      {!notice && (
        <>
          <GameClock clock={clock} />
          <div className="stats__bar">
            <details className="menu">
              <summary>
                <SlidersHorizontal className="ic" /> Affichage
              </summary>
              <div className="menu__panel">
                <label><input type="checkbox" checked={showDeaths} onChange={(e) => setShowDeaths(e.target.checked)} /> Morts de l'épisode choisi</label>
                <label><input type="checkbox" checked={corridors} onChange={(e) => setCorridors(e.target.checked)} /> Couloirs</label>
              </div>
            </details>
            <span className="stats__count">
              {rate.total} retake{rate.total > 1 ? 's' : ''} ({rate.good} réussi{rate.good > 1 ? 's' : ''}, {rate.bad} échec{rate.bad > 1 ? 's' : ''}, {rate.doubt} à vérifier), {rate.series} série{rate.series > 1 ? 's' : ''} de kills
              {rate.rate !== null ? `, ${percent(rate.rate)} de réussite` : `, taux masqué (${rate.decided} décidé${rate.decided > 1 ? 's' : ''}, minimum ${MIN_EPISODES})`}
            </span>
            {positions.load.loading && <span className="stats__count">Chargement des positions…</span>}
          </div>
          <ul className="eps__legend">
            <li><i className="ptl__mark ptl__mark--success ptl__mark--good is-legend" /> Réussi</li>
            <li><i className="ptl__mark ptl__mark--fail ptl__mark--bad is-legend" /> Échec</li>
            <li><i className="ptl__mark ptl__mark--nopush ptl__mark--doubt is-legend" /> Sans départ, à vérifier</li>
            <li><i className="ptl__mark ptl__mark--series ptl__mark--doubt is-legend" /> Série de kills</li>
            <li><i className="ptl__band ptl__band--a is-legend" /> Point à l'équipe {spec.team ? 'suivie' : 'de gauche'}</li>
            <li><i className="ptl__band ptl__band--b is-legend" /> Point à {spec.team ? 'ses adversaires' : "l'équipe de droite"}</li>
          </ul>
          <EpisodeMap map={map} corridors={corridors} pawns={pawns} paletteOfSlot={(s) => paletteOf(replay, spec, s)} nameOf={nameOf} rings={rings} crosses={crosses} />
          {active ? (
            <section className="eps__chosen" aria-label="Épisode choisi">
              <h3 className="eps__h">
                Épisode choisi : point {active.point ?? '?'}, {formatTime(keyInstant(active))}
              </h3>
              <EpisodePanel episode={active} game={replay} owners={strip.owners} spec={spec} verdict={verdictOf(active)} onVerdict={(id, v) => setVerdicts((old) => ({ ...old, [id]: v }))} />
            </section>
          ) : (
            eps.length > 0 && <p className="eps__hint">Cliquer un repère de la frise ou une ligne de la liste pour placer le curseur au début de l'épisode et le juger.</p>
          )}
          {eps.length > 0 && (
            <ol className="eplist">
              {eps.map((e) => {
                const out = outcomeInfo(e.outcome);
                const open = e.id === active?.id;
                const v = verdictOf(e);
                return (
                  <li key={e.id} className={`eplist__item${open ? ' is-active' : ''}${v === 'ko' ? ' is-ko' : ''}`}>
                    <button type="button" className="eplist__head" aria-pressed={open} onClick={() => (open ? setActiveId(null) : pick(e))}>
                      {open ? <ChevronDown className="ic" /> : <ChevronRight className="ic" />}
                      <span className="eplist__when">{formatTime(keyInstant(e))}</span>
                      <span className={`eplist__team eplist__team--${e.team ? paletteOfSide(replay, spec, e.team) : 'none'}`}>{sideName(replay, e.team)}</span>
                      <span className={`eplist__tag eplist__tag--${out.tone}`}>{out.label}</span>
                      <span className="eplist__sum">Point {e.point ?? '?'} : {summaryOf(e)}</span>
                      {v && <span className={`eplist__verdict eplist__verdict--${v}`}>{v === 'ok' ? 'jugé juste' : 'jugé faux'}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}
      <details className="help">
        <summary>Comment lire les retakes</summary>
        <p className="help__body">
          Chaque ligne de la frise est un point de la carte. Les bandes montrent qui le tient : couleur de l'équipe suivie (ou orange à gauche, bleue à droite sans équipe suivie), couleur de ses adversaires,
          gris quand il est neutre. Un retake est un point qui passe d'une équipe à l'autre. Réussi (rond plein) : au moins deux attaquants étaient à moins de 4 m du point avant la prise. Échec (carré) : deux à
          quatre attaquants morts en 10 s sans prise du point et sans survivant à plus de 7 m. Sans départ (rond vide) : le point a changé de main sans que deux attaquants soient lus au point, à vérifier.
          Série de kills (losange) : 3 ou 4 joueurs de la même équipe tués en 10 s au plus près du point, avec 20 s de déplacements avant et le repositionnement de l'équipe adverse 5 à 10 s après. Le contour
          du repère est la couleur de l'équipe de l'épisode. Cliquer un repère place le curseur 20 s avant l'événement ; le plan montre alors les joueurs vivants (pions numérotés) et entoure le point concerné.
          QUESTION OUVERTE pour les séries : qui est la tueuse ? Par défaut l'issue est classée selon l'équipe qui subit la série (lecture « victime ») ; le détail d'une série donne aussi l'issue de la lecture
          « tueur » sans choisir. Les séries n'entrent pas dans les taux (la même poussée est souvent déjà un échec classique). Les taux ignorent les épisodes à vérifier et ceux jugés faux, et restent masqués
          sous {MIN_EPISODES} épisodes décidés. Seuils étalonnés sur 10 games, détection non validée.
        </p>
      </details>
    </div>
  );
}

/** Résumé d'une ligne de la liste : attaquants et défenseurs d'un retake, ou nombre de victimes d'une série. */
function summaryOf(e: Episode): string {
  if (isSeries(e)) {
    const s = seriesInfo(e);
    return `${s.victims} victime${s.victims > 1 ? 's' : ''} en ${s.seriesT ? `${(s.seriesT[1] - s.seriesT[0]).toFixed(1).replace('.', ',')} s` : 'quelques secondes'}`;
  }
  const info = retakeInfo(e);
  return `${info.attackers.length} au départ, ${info.defenders.length} en face${info.firstDeath ? `, premier mort ${playerLabel(info.firstDeath.slot)}` : ''}`;
}
