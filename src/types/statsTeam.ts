// Types des réponses de /api/stats/team-summary et /api/stats/global (server/statsTeam.ts). Les champs null restent null : « non établi », jamais zéro.

/** Case d'une grille : [colonne, ligne, valeur], les cases vides sont omises. */
export type TeamCell = [number, number, number];

/** Côté de la game où un camp jouait : « left » = équipe A (orange, joueurs 1 à 4), « right » = équipe B (bleue, joueurs 5 à 8). */
export type TeamSideName = 'left' | 'right';

/** Comptes de vagues par issue brute ; `decided` = success + fail + won_no_capture ; `rate` = success / decided (null sans vague décidée). */
export interface TeamWaveTally {
  waves: number;
  counts: Record<string, number>;
  decided: number;
  rate: number | null;
}

/** Issues des vagues, avec le détail par vitesse et par taille. */
export interface TeamOutcomes extends TeamWaveTally {
  by_speed: Record<string, TeamWaveTally>;
  by_size: Record<string, TeamWaveTally>;
}

/** Sommes de player_game_stats : null tant qu'aucune game n'a de valeur. */
export interface TeamStatsTotals {
  games_with_stats: number;
  kills: number | null;
  deaths: number | null;
  gadget_uses: number | null;
  gadget_unused_at_death: number | null;
  gadget_possible: number | null;
}

/** Duels d'un camp : gagnés, perdus, autres (sans vainqueur). */
export interface TeamDuels {
  won: number;
  lost: number;
  other: number;
}

/** Un joueur de l'équipe suivie, par pseudo (normalisé dans `key`) et par côté. */
export interface TeamPlayer {
  key: string;
  name: string;
  side: TeamSideName;
  games: number;
  seconds: number;
  duels_won: number;
  duels_lost: number;
  duels_other: number;
  /** Présence : secondes vivantes par case. */
  cells: TeamCell[];
}

/** Réponse de team-summary : une équipe suivie (par son nom) sur une carte. */
export interface TeamSummary {
  team: string;
  map: string;
  side: 'both' | TeamSideName;
  n: number;
  games: number;
  game_ids: number[];
  /** Nombre de games sous lequel l'interface masque les résultats. */
  min: number;
  stats: TeamStatsTotals;
  duels: TeamDuels;
  /** Morts de l'équipe, par case. */
  death_grid: TeamCell[];
  /** Kills de l'équipe : lieu de mort des victimes qu'elle a tuées. */
  kill_grid: TeamCell[];
  presence: Record<TeamSideName, TeamCell[]>;
  /** Lieu des duels gagnés et perdus par l'équipe. */
  duel_won_grid: TeamCell[];
  duel_lost_grid: TeamCell[];
  players: TeamPlayer[];
  outcomes: TeamOutcomes;
}

/** Les grilles d'un côté de la réponse de global (même forme que team-summary, présence non séparée, sans joueurs). */
export interface GlobalSide {
  stats: TeamStatsTotals;
  duels: TeamDuels;
  death_grid: TeamCell[];
  kill_grid: TeamCell[];
  presence: TeamCell[];
  duel_won_grid: TeamCell[];
  duel_lost_grid: TeamCell[];
}

/** Réponse de global : toutes les équipes d'une carte, côté gauche et côté droit séparés. */
export interface GlobalSummary {
  map: string;
  n: number;
  games: number;
  game_ids: number[];
  min: number;
  left: GlobalSide;
  right: GlobalSide;
  outcomes: TeamOutcomes;
}
