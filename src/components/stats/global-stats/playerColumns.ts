// Colonnes des tableaux Joueurs : global (une ligne par joueur, toutes ses games) et détail (une ligne par game du joueur choisi).

import { fmtSpeed, NA, signed, type Cell } from '../../../lib/recapFormat.ts';
import { numberOfSlot } from '../../../lib/killTimeline.ts';
import { durationCell, gamesCell, mapsCell, sideLabel } from '../../../lib/summaryFormat.ts';
import type { PlayerGameRow, PlayerSummaryRow } from '../../../types/statsSummary.ts';
import { ratingColumns, ratingDetailColumns, statColumns, textCell, unusedColumn, type Column } from './columns.ts';

const SPEED_TITLE = 'Vitesse moyenne sur les lignes vivantes, tyroliennes et sauts exclus (m/s), pondérée par le temps vivant.';
const P98_TITLE = '98e centile de la vitesse (m/s), médiane par game quand plusieurs games : jamais le maximum brut, qui peut contenir des erreurs de lecture.';
const SCORE_TITLE = 'Somme des notes des kills et des morts (convention, de -2 à +3 par kill, sans vérité terrain).';

/** Somme des notes : signée ; « non établi » quand le calcul n'en a pas donné. */
const scoreCell = (v: number | null | undefined): Cell => (typeof v === 'number' && Number.isFinite(v) ? { text: signed(v), title: SCORE_TITLE } : { text: NA, title: 'Aucune note calculée.' });

/** Colonnes du tableau global : `min` est le seuil de games sous lequel la part de duels n'est pas montrée. */
export function playerSummaryColumns(min: number): Column<PlayerSummaryRow>[] {
  const has = (r: PlayerSummaryRow) => r.games_with_stats > 0;
  const c = statColumns<PlayerSummaryRow>(has, (r) => r.games_with_stats, min);
  return [
    { id: 'name', label: 'Joueur', numeric: false, value: (r) => r.name, cell: (r) => ({ text: r.name }) },
    { id: 'team', label: 'Équipe', numeric: false, value: (r) => r.team, cell: (r) => textCell(r.team) },
    {
      id: 'games',
      label: 'Games',
      title: 'Games avec un bilan calculé (sur le total de games du joueur). Chaque chiffre de la ligne ne porte que sur elles.',
      numeric: true,
      value: (r) => r.games_with_stats,
      cell: (r) => gamesCell(r.games_with_stats, r.games),
    },
    { id: 'maps', label: 'Cartes', numeric: false, value: (r) => r.maps.length, cell: (r) => mapsCell(r.maps) },
    ...ratingColumns<PlayerSummaryRow>((r) => r.rating, (r) => r.games),
    c.kills,
    c.deaths,
    c.kd,
    c.gadget,
    unusedColumn<PlayerSummaryRow>(has),
    { id: 'alive', label: 'Temps vivant', numeric: true, value: (r) => (has(r) ? r.alive_s : null), cell: (r) => (has(r) ? durationCell(r.alive_s) : { text: NA }) },
    { id: 'v_mean', label: 'Vitesse moyenne (m/s)', title: SPEED_TITLE, numeric: true, value: (r) => (has(r) ? r.v_mean : null), cell: (r) => ({ text: has(r) ? fmtSpeed(r.v_mean) : NA, title: SPEED_TITLE }) },
    { id: 'v_p98', label: 'Vitesse max, 98e centile (m/s)', title: P98_TITLE, numeric: true, value: (r) => (has(r) ? r.v_p98_median : null), cell: (r) => ({ text: has(r) ? fmtSpeed(r.v_p98_median) : NA, title: P98_TITLE }) },
    c.duelsWon,
    c.duelsLost,
    c.duelsOther,
    c.duelShare,
    { id: 'score', label: 'Somme des notes', title: SCORE_TITLE, numeric: true, value: (r) => (has(r) ? r.score_sum : null), cell: (r) => (has(r) ? scoreCell(r.score_sum) : { text: NA }) },
  ];
}

/** Colonnes du détail game par game d'un joueur. */
export function playerGameColumns(): Column<PlayerGameRow>[] {
  const has = (r: PlayerGameRow) => r.has_stats;
  const c = statColumns<PlayerGameRow>(has, () => 1, 0);
  return [
    { id: 'game', label: 'Game', numeric: false, value: (r) => r.game_id, cell: (r) => ({ text: `Game ${r.game_id}` }), inTotal: false },
    { id: 'map', label: 'Carte', numeric: false, value: (r) => r.map, cell: (r) => textCell(r.map), inTotal: false },
    { id: 'opponent', label: 'Adversaire', numeric: false, value: (r) => r.opponent, cell: (r) => textCell(r.opponent, r.team ? `${r.team} contre ${r.opponent ?? 'adversaire inconnu'}` : undefined), inTotal: false },
    {
      id: 'side',
      label: 'Côté',
      title: 'Gauche (orange, joueurs 1 à 4) ou droite (bleue, joueurs 5 à 8), et numéro du joueur dans la game',
      numeric: false,
      value: (r) => r.side,
      cell: (r) => ({ text: `${sideLabel(r.side)}, n° ${numberOfSlot(r.slot)}` }),
      inTotal: false,
    },
    ...ratingDetailColumns<PlayerGameRow>((r) => r.rating),
    c.kills,
    c.deaths,
    c.kd,
    c.gadget,
    unusedColumn<PlayerGameRow>(has),
    { id: 'alive', label: 'Temps vivant', numeric: true, value: (r) => (has(r) ? r.alive_s : null), cell: (r) => (has(r) ? durationCell(r.alive_s) : { text: NA }) },
    { id: 'v_mean', label: 'Vitesse moyenne (m/s)', title: SPEED_TITLE, numeric: true, value: (r) => (has(r) ? r.v_mean : null), cell: (r) => ({ text: has(r) ? fmtSpeed(r.v_mean) : NA, title: SPEED_TITLE }) },
    { id: 'v_p98', label: 'Vitesse max, 98e centile (m/s)', title: P98_TITLE, numeric: true, value: (r) => (has(r) ? r.v_p98 : null), cell: (r) => ({ text: has(r) ? fmtSpeed(r.v_p98) : NA, title: P98_TITLE }) },
    c.duelsWon,
    c.duelsLost,
    c.duelsOther,
    c.duelShare,
    { id: 'score', label: 'Somme des notes', title: SCORE_TITLE, numeric: true, value: (r) => (has(r) ? r.score_sum : null), cell: (r) => (has(r) ? scoreCell(r.score_sum) : { text: NA }) },
  ];
}
