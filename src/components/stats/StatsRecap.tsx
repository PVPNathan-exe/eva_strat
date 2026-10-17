// Vue Récap : bilan d'UNE game (celle rejouée). Bandeau (carte, durée, changements de point, score de capture lu), tableau par joueur (kills, morts, secondaires utilisés sur possibles,
// vitesses, duels, somme des notes), liste des kills avec leur note (clic : ouvre la vidéo 5 s avant). Données : /api/stats/game-summary (tables player_game_stats, kill_scores, duels),
// score de capture : /api/capture (facultatif). Équipe suivie par son nom = palette « a » (teamFollow). Les notes, les seuils de duel et les teamfights sont des conventions sans vérité terrain.

import { useMemo } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import {
  captureScoreOf,
  durationLabel,
  keepKillRows,
  killRows,
  notesMissingNotice,
  orderPlayers,
  pctLabel,
  pointChangesLabel,
  statsMissingNotice,
} from '../../lib/recapFormat';
import { statsRecapApi } from '../../lib/statsRecapApi';
import { keepsSlot, paletteNames, paletteOf, type FollowSpec } from '../../lib/teamFollow';
import type { RecapTeam } from '../../types/statsRecap';
import { RecapKills } from './recap/RecapKills';
import { RecapPlayers } from './recap/RecapPlayers';
import { noticeOf, useLoad, type StatsGame } from './useStats';
import '../../styles/stats-recap.css';

interface Props {
  map: string;
  /** Game rejouée (une seule game à la fois). */
  replay: StatsGame;
  spec: FollowSpec;
}

export function StatsRecap({ map, replay, spec }: Props) {
  const load = useLoad(`recap:${replay.id}`, () => statsRecapApi.gameSummary(replay.id));
  // Le score de capture est facultatif : une erreur ou une route absente ne bloque pas le récap
  const capture = useLoad(`recap-capture:${replay.id}`, () => analysisApi.capture(replay.id).catch(() => null));
  const summary = load.data;

  const first: RecapTeam = paletteOf(replay, spec, 1) === 'a' ? 'A' : 'B'; // l'équipe suivie (ou celle de gauche) d'abord
  const keep = useMemo(() => (slot: number) => keepsSlot(replay, spec, slot), [replay, spec]);
  const players = useMemo(() => (summary ? orderPlayers(summary.players, first, keep) : []), [summary, first, keep]);
  const teamSizes = useMemo(() => {
    const sizes: Record<RecapTeam, number> = { A: 0, B: 0 };
    for (const p of summary?.players ?? []) sizes[p.team] += 1;
    return sizes;
  }, [summary]);
  const kills = useMemo(() => (summary ? keepKillRows(killRows(summary.players), keep) : []), [summary, keep]);
  const names = paletteNames(replay, spec);
  const nameOf = (slot: number) => summary?.players.find((p) => p.slot === slot)?.name ?? replay.players.find((p) => p.slot === slot)?.name;
  const score = captureScoreOf(capture.data);
  const notice = noticeOf(load);
  const missing = summary ? statsMissingNotice(summary) : null;
  const notesMissing = summary ? notesMissingNotice(summary) : null;

  return (
    <div className="stats__view recap">
      {notice && <p className="stats__empty">{notice}</p>}
      {summary && (
        <>
          <p className="recap__banner">
            <b>{summary.map ?? map}</b>
            <span>durée {durationLabel(summary.game.duration_s)}</span>
            <span>{pointChangesLabel(summary.map ?? map, summary.point_changes)}</span>
            {score && (
              <span title="Dernière lecture du pourcentage de capture de chaque équipe">
                capture :{' '}
                {([first, first === 'A' ? 'B' : 'A'] as RecapTeam[]).map((side, i) => {
                  const pal = paletteOf(replay, spec, side === 'A' ? 1 : 5);
                  return (
                    <span key={side}>
                      {i > 0 && ' contre '}
                      <span className={`pal pal--${pal} recap__team`}>{names[pal]}</span> {pctLabel(score[side])}
                    </span>
                  );
                })}
              </span>
            )}
          </p>
          <ul className="stats__legend" aria-label="Couleurs des équipes">
            {(['a', 'b'] as const).map((pal) => (
              <li key={pal} className={`pal pal--${pal}`}>
                <i className="recap__dot" aria-hidden /> {names[pal]}
                {spec.team ? (pal === 'a' ? ' (équipe suivie)' : ' (adversaires)') : pal === 'a' ? ' (gauche)' : ' (droite)'}
              </li>
            ))}
          </ul>
          {missing && <p className="stats__empty">{missing}</p>}
          {players.length > 0 ? (
            <RecapPlayers players={players} teamSizes={teamSizes} totals={summary.teams} replay={replay} spec={spec} />
          ) : (
            !missing && <p className="stats__empty">Aucun joueur ne passe les filtres d'équipe et de joueur.</p>
          )}
          <h3 className="recap__h">Kills et notes</h3>
          {notesMissing && <p className="stats__empty">{notesMissing}</p>}
          {kills.length > 0 && <RecapKills rows={kills} replay={replay} spec={spec} nameOf={nameOf} />}
          {!notesMissing && kills.length === 0 && <p className="stats__empty">Aucun kill noté pour ce choix.</p>}
        </>
      )}
      <details className="help">
        <summary>Comment lire le récap</summary>
        <p className="help__body">
          Le récap résume la game rejouée. Les <b>notes</b> des kills (de -2 à +3), les <b>seuils de duel</b> et les <b>teamfights</b> sont des <b>conventions</b> de calcul, sans vérité terrain : elles servent à comparer
          des kills entre eux, pas à juger un joueur. Un kill gagne des points s'il ouvre la vague, fait gagner le teamfight ou précède la prise ou la tenue du point ; il en perd si le tueur meurt aussitôt sans suite ou si son équipe
          perd le teamfight malgré lui. La note de la mort est l'opposée de celle du kill. Les raisons de chaque note se déplient sous la ligne.
        </p>
        <p className="help__body">
          Pour les secondaires, « possible » est une <b>borne haute</b> calculée par délai de gadget : elle n'est établie qu'avec assez de cycles de recharge observés, sinon la colonne dit « non établi » (jamais 0). Mourir avec le
          secondaire encore disponible est mauvais ; le garder sans mourir ne l'est pas en soi. La vitesse moyenne est mesurée sur les lignes vivantes, tyroliennes et sauts exclus. La vitesse maximale affichée est le 98e centile ;
          le <b>maximum brut</b> (en infobulle) peut contenir des erreurs de lecture. Un joueur sans bilan (« n/d ») n'a pas de ligne calculée. Un clic sur l'instant d'un kill ouvre la vidéo 5 s avant.
        </p>
        <p className="help__body">
          <b>Note sur 20</b> : la globale est la moyenne de deux sous-notes sur 20. L'<b>individuelle</b> vient des kills, morts et assistances du joueur (par minute) et de la qualité de ses kills et de ses morts. Le <b>teamplay</b>{' '}
          compare ses kills, morts et assistances au total de son équipe et ajoute la présence sur la map (vivant et hors de la zone de départ), le temps près du point actif, la <b>prise d'espace</b> (position moyenne sur l'axe entre les deux
          départs), la <b>prise de fight</b> (le plus avancé au contact, premier kill du combat), la <b>prise d'aggro</b> (1 ou 2 ennemis qui se rapprochent de lui pendant que ses coéquipiers sont ailleurs, crédit entier s'il survit ou est
          vengé, demi-crédit sinon ; le regard de l'ennemi n'est pas utilisé), les trades, la cohésion et l'usage du secondaire. Une <b>assistance</b> est celle du tableau de fin de game quand il est lu ; sinon un repli : un coéquipier
          du tueur à moins de 3 m de la victime dans les 4,6 s avant sa mort. L'échelle est tirée des games déjà calculées : 10 est la médiane, 0 le 5e centile et 20 le 95e (plafonné), donc une note se lit par rapport à ces games. Une composante
          sans donnée est ignorée de la moyenne (le détail, dépliable sous le nom du joueur, la liste avec sa raison) ; une sous-note sans assez de composantes est « n/d », jamais 0. Ce sont des <b>conventions sans vérité terrain</b>.
        </p>
      </details>
    </div>
  );
}
