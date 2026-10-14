// Vue Retakes : chronologie de la game rejouée avec, pour chaque point, les bandes de propriétaire (équipe suivie par son nom, adversaires, neutre) et les VAGUES de l'équipe qui sort du spawn :
// une barre du départ à la résolution, un trait au premier kill, le symbole de l'issue (retake réussi ou raté, teamfight gagné sans capture, prise initiale, duel, indécis, sans contact)
// et la vitesse (barre rayée : progressive). Cliquer une vague place le curseur à son départ ; le plan montre les joueurs vivants au curseur (pions numérotés) avec le point visé entouré.
// Les boutons « Juste » et « Faux » jugent le classement de la vague (PUT /api/stats/episodes/:id). Une seule game à la fois (celle rejouée), temps en secondes de game.
// Définitions : docs/PLAN_STATS_AGENTS.md section 11 ; calcul : analysis/waves.py, kill_series.py, retakes.py.

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, SlidersHorizontal, TriangleAlert } from 'lucide-react';
import { buildLanes, episodesAt, episodeInScope, paletteOfSide, pointsOf, positionsAt, retakeMark, sideName, toneOfOwner, type EpisodeMark, type OwnerBand } from '../../lib/episodeClock';
import { causeLabel, keyInstant, playerLabel, retakeInfo } from '../../lib/episodeFormat';
import { pointRectsOf } from '../../lib/pointRects';
import { statsApi } from '../../lib/statsApi';
import { paletteOf, type FollowSpec } from '../../lib/teamFollow';
import { formatTime } from '../../lib/timeline';
import { waveInfo, waveSummary } from '../../lib/waveInfo';
import { ISSUE_GROUPS, SHAPE_LABELS, shapesOf, speedLabel, waveIssueInfo, type IssueGroup } from '../../lib/waveOutcome';
import { ALL_WAVES, filterWaves, isFiltered, MIN_DECIDED, rateSentence, retakeRate, teamTable, type WaveFilter } from '../../lib/waveStats';
import type { Episode } from '../../types/stats';
import { EpisodeMap, type DeathCross, type Ring } from './EpisodeMap';
import { EpisodePanel } from './EpisodePanel';
import { GameClock } from './GameClock';
import { PointTimeline } from './PointTimeline';
import { useReplayIndex, useStripData } from './useEpisodeData';
import { useGameClock } from './useGameClock';
import { durationOf, noticeOf, useLoad, type StatsGame } from './useStats';
import { WaveFilters } from './WaveFilters';
import { WaveTable } from './WaveTable';

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
  const [filter, setFilter] = useState<WaveFilter>(ALL_WAVES);
  const [verdicts, setVerdicts] = useState<Record<number, Verdict>>({});
  const load = useLoad(`retakes-game:${replay.id}`, () => statsApi.episodesOfGame(replay.id));
  const strip = useStripData(replay.id);
  const positions = useReplayIndex(replay);
  const clock = useGameClock(`retakes:${replay.id}`, durationOf(replay));
  const rects = useMemo(() => pointRectsOf(map), [map]);

  // Vagues de la game rejouée pour l'équipe et le joueur choisis (avant filtre), puis vagues montrées (après les filtres d'issue et de vitesse)
  const eps = useMemo(
    () => (load.data ?? []).filter((e) => e.kind === 'retake' && episodeInScope(e, replay, spec)).sort((a, b) => a.t0 - b.t0 || a.id - b.id),
    [load.data, replay, spec],
  );
  const shown = useMemo(() => filterWaves(eps, filter), [eps, filter]);
  const active = shown.find((e) => e.id === activeId) ?? null;
  const verdictOf = (e: Episode): Verdict => (e.id in verdicts ? verdicts[e.id] : e.verdict);

  const toneOf = useMemo(() => (owner: 'A' | 'B' | 'none') => toneOfOwner(replay, spec, owner), [replay, spec]);
  const lanes = useMemo(() => {
    const marks = shown.map((e) => retakeMark(e, clock.duration, e.team ? paletteOfSide(replay, spec, e.team) : null));
    return buildLanes(pointsOf(strip.owners, [], shown), strip.owners, [], marks, clock.duration, toneOf);
  }, [shown, strip.owners, clock.duration, replay, spec, toneOf]);

  // Bilan : taux de retake réussi et tableau par équipe sur toutes les vagues du choix (les filtres ne les changent pas)
  const rate = useMemo(() => retakeRate(eps, verdicts), [eps, verdicts]);
  const table = useMemo(() => teamTable(eps, (id) => (id === replay.id ? replay : undefined), verdicts), [eps, replay, verdicts]);
  const counts = useMemo(() => {
    const c = Object.fromEntries(ISSUE_GROUPS.map((g) => [g.id, 0])) as Record<IssueGroup, number>;
    for (const e of eps) c[waveIssueInfo(e).group] += 1;
    return c;
  }, [eps]);
  const shapes = useMemo(() => shapesOf(shown), [shown]);

  // Plan au curseur : joueurs vivants, point visé des vagues en cours (et de la vague choisie), morts de la vague choisie déjà survenues
  const pawns = useMemo(() => positionsAt(positions.index, clock.t), [positions.index, clock.t]);
  const rings = useMemo<Ring[]>(() => {
    const here = episodesAt(shown, clock.t);
    if (active && !here.includes(active)) here.push(active);
    const points = [...new Set(here.map((e) => e.point).filter((p): p is string => !!p))];
    return points.flatMap((point) => (rects[point] ? [{ point, rect: rects[point], role: 'point' as const }] : []));
  }, [shown, active, clock.t, rects]);
  const crosses = useMemo<DeathCross[]>(() => {
    if (!showDeaths || !active) return [];
    return retakeInfo(active).deaths.flatMap((d) =>
      d.pos && d.t <= clock.t ? [{ key: `${d.slot}:${d.t}`, x: d.pos[0], y: d.pos[1], palette: paletteOfSide(replay, spec, d.team), title: `${formatTime(d.t)} : mort de ${playerLabel(d.slot)} (${causeLabel(d.cause)})` }] : [],
    );
  }, [showDeaths, active, clock.t, replay, spec]);

  const pick = (e: Episode) => {
    setActiveId(e.id);
    clock.seek(e.t0); // le curseur se place au départ de la vague
  };
  const pickMark = (m: EpisodeMark) => {
    const e = shown.find((x) => String(x.id) === m.key);
    if (e) pick(e);
  };
  const ownerTitle = (b: OwnerBand) => (b.owner === 'none' ? 'Point neutre' : `Point à ${sideName(replay, b.owner)}`);
  const nameOf = (slot: number) => replay.players.find((p) => p.slot === slot)?.name;
  const notice = noticeOf(load);

  return (
    <div className="stats__view eps">
      <p className="eps__warn">
        <TriangleAlert className="ic" /> Aucune vérité terrain : les vagues, teamfights et retakes suivent des conventions de calcul (seuils de 8 s, 10 s et 10 m). Juger chaque vague (« Juste » ou « Faux ») avant de s'appuyer sur les résultats.
      </p>
      {notice && <p className="stats__empty">{notice}</p>}
      {!notice && rate.legacy > 0 && (
        <p className="eps__legacy">
          <TriangleAlert className="ic" /> {rate.legacy} ligne{rate.legacy > 1 ? 's' : ''} de l'ancien calcul dans cette game (ni vague ni définition actuelle), non comptée{rate.legacy > 1 ? 's' : ''} dans les taux. Recalculer la game : `python analysis/stats_run.py --game N`.
        </p>
      )}
      {!notice && eps.length === 0 && <p className="stats__empty">Aucune vague pour cette game et ce choix. Les vagues se calculent game par game : `python analysis/stats_run.py --game N`.</p>}
      {!notice && lanes.length > 0 && <PointTimeline lanes={lanes} duration={clock.duration} t={clock.t} activeKey={active ? String(active.id) : null} onSeek={clock.seek} onPick={pickMark} ownerTitle={ownerTitle} />}
      {!notice && (
        <>
          <GameClock clock={clock} />
          <div className="stats__bar">
            <WaveFilters filter={filter} onChange={setFilter} counts={counts} />
            <details className="menu">
              <summary>
                <SlidersHorizontal className="ic" /> Affichage
              </summary>
              <div className="menu__panel">
                <label><input type="checkbox" checked={showDeaths} onChange={(e) => setShowDeaths(e.target.checked)} /> Morts de la vague choisie</label>
                <label><input type="checkbox" checked={corridors} onChange={(e) => setCorridors(e.target.checked)} /> Couloirs</label>
              </div>
            </details>
            <span className="stats__count">{isFiltered(filter) ? `${shown.length} vague${shown.length > 1 ? 's' : ''} affichée${shown.length > 1 ? 's' : ''} sur ${eps.length}` : `${eps.length} vague${eps.length > 1 ? 's' : ''}`}</span>
            {positions.load.loading && <span className="stats__count">Chargement des positions…</span>}
          </div>
          {eps.length > 0 && <p className="eps__rate">{rateSentence(rate)}{rate.ko > 0 ? `. ${rate.ko} vague${rate.ko > 1 ? 's' : ''} jugée${rate.ko > 1 ? 's' : ''} fausse${rate.ko > 1 ? 's' : ''}, non comptée${rate.ko > 1 ? 's' : ''}` : ''}</p>}
          <WaveTable rows={table} />
          {shown.length > 0 && (
            <ul className="eps__legend">
              {shapes.map((s) => (
                <li key={s}><i className={`ptl__mark ptl__mark--${s} is-legend`} /> {SHAPE_LABELS[s]}</li>
              ))}
              <li><i className="ptl__wave is-legend pal pal--a" /> Vague de l'équipe {spec.team ? 'suivie' : 'de gauche'}</li>
              <li><i className="ptl__wave is-legend pal pal--b" /> Vague de {spec.team ? 'ses adversaires' : "l'équipe de droite"}</li>
              <li><i className="ptl__wave ptl__wave--progressif is-legend pal pal--a" /> Rayée : progressive</li>
              <li><i className="ptl__band ptl__band--a is-legend" /> Point à l'équipe {spec.team ? 'suivie' : 'de gauche'}</li>
              <li><i className="ptl__band ptl__band--b is-legend" /> Point à {spec.team ? 'ses adversaires' : "l'équipe de droite"}</li>
            </ul>
          )}
          <EpisodeMap map={map} corridors={corridors} pawns={pawns} paletteOfSlot={(s) => paletteOf(replay, spec, s)} nameOf={nameOf} rings={rings} crosses={crosses} />
          {active ? (
            <section className="eps__chosen" aria-label="Vague choisie">
              <h3 className="eps__h">
                Vague choisie : point {active.point ?? '?'}, {formatTime(keyInstant(active))}
              </h3>
              <EpisodePanel episode={active} game={replay} owners={strip.owners} spec={spec} verdict={verdictOf(active)} onVerdict={(id, v) => setVerdicts((old) => ({ ...old, [id]: v }))} />
            </section>
          ) : (
            shown.length > 0 && <p className="eps__hint">Cliquer une barre de la frise ou une ligne de la liste pour placer le curseur au départ de la vague et la juger.</p>
          )}
          {shown.length > 0 && (
            <ol className="eplist">
              {shown.map((e) => {
                const out = waveIssueInfo(e);
                const w = waveInfo(e);
                const open = e.id === active?.id;
                const v = verdictOf(e);
                return (
                  <li key={e.id} className={`eplist__item${open ? ' is-active' : ''}${v === 'ko' ? ' is-ko' : ''}`}>
                    <button type="button" className="eplist__head" aria-pressed={open} onClick={() => (open ? setActiveId(null) : pick(e))}>
                      {open ? <ChevronDown className="ic" /> : <ChevronRight className="ic" />}
                      <span className="eplist__when">{formatTime(keyInstant(e))}</span>
                      <span className={`eplist__team eplist__team--${e.team ? paletteOfSide(replay, spec, e.team) : 'none'}`}>{sideName(replay, e.team)}</span>
                      <span className={`eplist__tag eplist__tag--${out.tone}`} title={out.label}>{out.short}</span>
                      {w?.speed && <span className={`eplist__speed eplist__speed--${w.speed}`} title={`Vague ${speedLabel(w.speed).toLowerCase()}`}>{speedLabel(w.speed).toLowerCase()}</span>}
                      <span className="eplist__sum">Point {e.point ?? '?'} : {w ? waveSummary(w) : 'détail indisponible (ancien calcul)'}</span>
                      {v && <span className={`eplist__verdict eplist__verdict--${v}`}>{v === 'ok' ? 'jugé juste' : 'jugé faux'}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {eps.length > 0 && shown.length === 0 && <p className="stats__empty">Aucune vague ne passe les filtres d'issue et de vitesse.</p>}
        </>
      )}
      <details className="help">
        <summary>Comment lire les retakes</summary>
        <p className="help__body">
          Une <b>vague</b> est un départ du spawn : au moins 2 joueurs d'une équipe sortent de leur zone de départ en 8 s au plus. Elle est <b>rapide</b> (départ, contact et résolution en quelques secondes) ou <b>progressive</b> (le
          groupe s'arrête au moins 3 s, sous 0,5 m/s, avant le premier kill ; barre rayée sur la frise). Chaque ligne de la frise est un point ; les bandes montrent qui le tient (équipe suivie, adversaires, gris : neutre) ; la barre d'une
          vague va du départ à la résolution, de la couleur de son équipe, avec un trait au premier kill et le symbole de l'issue à la fin.
        </p>
        <p className="help__body">
          Un <b>teamfight</b> est une série de kills entre les deux équipes (10 s au plus entre deux kills) où chaque équipe a au moins 2 joueurs engagés (vivants à moins de 10 m du combat) ou bien une autre action a lieu ailleurs en même
          temps. Il est <b>gagné</b> par l'équipe qui perd le moins de joueurs, <b>perdu</b> pour l'autre. Un <b>duel</b> (1 contre 1, ou 1 contre 2 sans aide possible) n'est ni un teamfight ni un retake, jamais gagné ni perdu.
          Une <b>prise initiale</b> est la première prise d'un point neutre : ce n'est pas un retake. Un <b>retake</b> est un teamfight gagné suivi de la capture du point (dans les 15 s) par l'équipe qui ne le tenait pas ; un
          <b> retake raté</b> est un teamfight perdu de l'équipe attaquante (au moins 2 morts, sans prise). Un teamfight gagné sans capture est compté à part. Indécis : égalité avec moins de 2 morts. Sans contact : aucun kill de la vague.
        </p>
        <p className="help__body">
          Le taux de retake réussi est retakes réussis / (retakes réussis + retakes ratés + teamfights gagnés sans capture) ; les prises initiales, ouvertures perdues, duels, indécis et vagues sans contact sont exclus, ainsi que les vagues
          jugées fausses. Il reste masqué sous {MIN_DECIDED} vagues décidées. Les filtres d'issue et de vitesse changent la frise et la liste, pas le taux ni le tableau par équipe.
        </p>
        <p className="help__body">
          Limites : aucune vérité terrain, les seuils (8 s, 10 s, 10 m, 15 s, 3 s à l'arrêt) sont des conventions. Le propriétaire du point lu sur la minimap prime sur le décompte des morts : une prise malgré un teamfight non gagné est
          comptée réussie et signalée « à vérifier ». Ceres : le propriétaire des points n'est jamais lu, les vagues n'y sont pas classées. Outlaw : les 4 zones de départ sont neutres, les sorties de zone y sont sous-comptées et la position du combat
          n'est pas mesurée. Ne pas confondre avec l'ancien calcul (retakes sans vague, séries de 3 ou 4 kills) : ses lignes restent marquées « ancien calcul » tant que la game n'est pas recalculée et ne sont pas comptées.
        </p>
      </details>
    </div>
  );
}
