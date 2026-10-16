// Colonnes des tableaux Équipes : global (une ligne par équipe, toutes ses games) et détail (une ligne par game de l'équipe choisie).
// Le score de capture final n'est pas un résultat de match (games.winner n'est pas renseigné) : aucune colonne victoire ou défaite.

import { NA } from '../../../lib/recapFormat.ts';
import { captureCell, captureSort, gamesCell, mapsCell, pointChangesCell, sideLabel } from '../../../lib/summaryFormat.ts';
import type { TeamGameRow, TeamSummaryRow } from '../../../types/statsSummary.ts';
import { statColumns, textCell, type Column } from './columns.ts';

const CHANGES_TITLE = 'Changements de point actif pendant la game (aucun sur Engine et Helios Station).';
const SIDE_TITLE = 'Gauche (orange, joueurs 1 à 4) ou droite (bleue, joueurs 5 à 8)';

/** Colonnes du tableau global : `min` est le seuil de games sous lequel la part de duels n'est pas montrée. */
export function teamSummaryColumns(min: number): Column<TeamSummaryRow>[] {
  const has = (r: TeamSummaryRow) => r.games_with_stats > 0;
  const c = statColumns<TeamSummaryRow>(has, (r) => r.games_with_stats, min);
  return [
    { id: 'name', label: 'Équipe', numeric: false, value: (r) => r.name, cell: (r) => ({ text: r.name }) },
    {
      id: 'games',
      label: 'Games',
      title: "Games avec un bilan calculé (sur le total de games de l'équipe). Chaque chiffre de la ligne ne porte que sur elles.",
      numeric: true,
      value: (r) => r.games_with_stats,
      cell: (r) => gamesCell(r.games_with_stats, r.games),
    },
    { id: 'maps', label: 'Cartes', numeric: false, value: (r) => r.maps.length, cell: (r) => mapsCell(r.maps) },
    c.kills,
    c.deaths,
    c.kd,
    c.duelsWon,
    c.duelsLost,
    c.duelsOther,
    c.duelShare,
    c.gadget,
    { id: 'changes', label: 'Changements de point', title: CHANGES_TITLE, numeric: true, value: (r) => (has(r) ? r.point_changes : null), cell: (r) => (has(r) ? pointChangesCell(r.point_changes) : { text: NA }) },
    {
      id: 'capture',
      label: 'Capture finale moyenne',
      title: 'Moyenne des derniers scores de capture lus (équipe puis adversaire). Pas un résultat de match.',
      numeric: true,
      value: (r) => captureSort(r.final_capture_avg),
      cell: (r) => captureCell(r.final_capture_avg, true),
    },
  ];
}

/** Colonnes du détail game par game d'une équipe. */
export function teamGameColumns(): Column<TeamGameRow>[] {
  const has = (r: TeamGameRow) => r.has_stats;
  const c = statColumns<TeamGameRow>(has, () => 1, 0);
  return [
    { id: 'game', label: 'Game', numeric: false, value: (r) => r.game_id, cell: (r) => ({ text: `Game ${r.game_id}` }), inTotal: false },
    { id: 'map', label: 'Carte', numeric: false, value: (r) => r.map, cell: (r) => textCell(r.map), inTotal: false },
    { id: 'opponent', label: 'Adversaire', numeric: false, value: (r) => r.opponent, cell: (r) => textCell(r.opponent), inTotal: false },
    { id: 'side', label: 'Côté', title: SIDE_TITLE, numeric: false, value: (r) => r.side, cell: (r) => ({ text: sideLabel(r.side) }), inTotal: false },
    {
      id: 'capture',
      label: 'Capture finale',
      title: "Dernier score de capture lu (équipe puis adversaire). Pas un résultat de match : le vainqueur n'est pas renseigné.",
      numeric: true,
      value: (r) => captureSort(r.final_capture),
      cell: (r) => captureCell(r.final_capture),
    },
    c.kills,
    c.deaths,
    c.kd,
    c.duelsWon,
    c.duelsLost,
    c.duelsOther,
    c.duelShare,
    c.gadget,
    { id: 'changes', label: 'Changements de point', title: CHANGES_TITLE, numeric: true, value: (r) => (has(r) ? r.point_changes : null), cell: (r) => (has(r) ? pointChangesCell(r.point_changes) : { text: NA }) },
  ];
}
