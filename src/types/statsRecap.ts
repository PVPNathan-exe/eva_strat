// Types des réponses de GET /api/stats/game-summary (server/statsGame.ts) pour la vue Récap. Temps en secondes depuis le début de la game.
// Un joueur sans ligne dans player_game_stats (`has_stats` faux) n'a aucun des champs de bilan : ils sont absents ou null, jamais 0.

import type { PlayerRatingRow, RatingDetail } from './stats.ts';

export type RecapTeam = 'A' | 'B';

/** Note sur 20 d'un joueur dans la game (routes `game-summary`) : les trois notes, les assistances et le détail de chaque composante. */
export interface RecapRating extends Omit<PlayerRatingRow, 'game_id' | 'slot'> {
  detail: RatingDetail | null;
}

/** Les trois notes sur 20 d'une équipe (moyenne de ses quatre joueurs, null quand un joueur n'a pas la note). */
export interface RecapTeamRating {
  individual: number | null;
  teamplay: number | null;
  overall: number | null;
}

/** Une note de kill ou de mort. `impact` est déjà du point de vue du joueur (l'opposé de celui du kill pour la victime). */
export interface RecapNote {
  t: number;
  /** Autre joueur du kill : la victime pour une note de kill, le tueur pour une note de mort (null : mort sans tueur). */
  other_slot: number | null;
  /** De -2 à +3 (convention, sans vérité terrain). */
  impact: number;
  /** Raisons en clair ; null si non enregistrées. */
  reasons: string[] | null;
}

/** Bilan d'un joueur (colonnes de player_game_stats, null quand le calcul ne les a pas établies). */
export interface RecapStats {
  kills?: number | null;
  deaths?: number | null;
  alive_s?: number | null;
  dist_m?: number | null;
  v_mean?: number | null;
  /** 98e centile de la vitesse (m/s) : le maximum affiché par défaut. */
  v_p98?: number | null;
  /** Maximum brut : peut contenir des erreurs de lecture. */
  v_max?: number | null;
  /** Secondaires utilisés (null : non lu). */
  gadget_uses?: number | null;
  /** Morts avec le secondaire encore disponible (null : non établi). */
  gadget_unused_at_death?: number | null;
  /** Utilisations possibles (borne haute calculée par délai de gadget) ; null quand le délai n'est pas établi. */
  gadget_possible?: number | null;
  duels_won?: number | null;
  duels_lost?: number | null;
  duels_other?: number | null;
}

/** Kills, morts, assistances et score lus sur l'écran de fin de game (analysis/scoreboard.py). */
export interface RecapScoreboard {
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  score: number | null;
}

export interface RecapPlayer extends RecapStats {
  game_id: number;
  slot: number;
  team: RecapTeam;
  name: string | null;
  /** La game a une ligne player_game_stats pour ce joueur. */
  has_stats: boolean;
  kill_score_sum: number;
  death_score_sum: number;
  score_sum: number;
  /** Note sur 20 (null : aucune note calculée pour ce joueur dans cette game). */
  rating: RecapRating | null;
  /** Valeurs officielles du tableau de fin de game (null : pas de tableau lu pour cette game) ; chaque valeur null = n/d. */
  scoreboard: RecapScoreboard | null;
  kill_notes: RecapNote[];
  death_notes: RecapNote[];
}

/** Totaux d'une équipe (null quand aucun joueur n'a la valeur). */
export interface RecapTeamTotals {
  kills: number | null;
  deaths: number | null;
  gadget_uses: number | null;
  gadget_unused_at_death: number | null;
  gadget_possible: number | null;
  duels_won: number | null;
  duels_lost: number | null;
  duels_other: number | null;
  kill_score_sum: number;
  death_score_sum: number;
  rating: RecapTeamRating;
}

export interface GameSummary {
  game: { id: number; map: string | null; team_a: string | null; team_b: string | null; start_s: number; end_s: number; duration_s: number };
  map: string | null;
  point_changes: number;
  players: RecapPlayer[];
  teams: Record<RecapTeam, RecapTeamTotals>;
  games: number;
  min: number;
}

/** Une ligne de la liste des kills, reconstruite depuis les notes des joueurs. */
export interface KillRow {
  key: string;
  t: number;
  /** Tueur (null : mort sans tueur lu). */
  killer: number | null;
  victim: number;
  /** Note du kill (point de vue de l'équipe du tueur). La note de la mort est l'opposée. */
  impact: number;
  reasons: string[] | null;
}

/** Score de capture lu en fin de game (dernière lecture de chaque équipe, en pourcentage). */
export interface CaptureScore {
  A: number;
  B: number;
}
