// Types des réponses de GET /api/stats/players-summary et GET /api/stats/teams-summary (vues Joueurs et Équipes de l'onglet Stats).
// Un champ sans donnée vaut null : l'interface écrit « non établi » ou « n/d », jamais 0. `games.winner` est presque toujours null : jamais de victoire déduite.

/** Nombre qui peut ne pas être établi (null). */
export type Maybe = number | null;

/** Notes sur 20 moyennées sur plusieurs games : chaque moyenne ne porte que sur les games où la note existe, jamais de moyenne partielle sans le nombre de games. */
export interface RatingMean {
  individual: Maybe;
  teamplay: Maybe;
  overall: Maybe;
  /** Games où la note GLOBALE existe (celles de la moyenne globale). */
  games_rated: number;
  individual_games: number;
  teamplay_games: number;
}

/** Les trois notes d'une game (joueur ou équipe). */
export interface RatingTriple {
  individual: Maybe;
  teamplay: Maybe;
  overall: Maybe;
}

/** Étendue demandée : toutes les cartes (map vide) ou une seule. */
export interface SummaryScope {
  map: string | null;
  team?: string | null;
}

/** Notes d'un joueur dans une game, avec ses assistances et leur source (`tableau` de fin de game ou `repli`) ; `games_rated` n'existe que sur une ligne de total (nombre de games dont vient la moyenne). */
export type PlayerGameRating = RatingTriple & { assists: Maybe; assist_source: string | null; games_rated?: number };

/** Notes d'une équipe dans une game (moyenne de ses quatre joueurs) ; `games_rated` seulement sur une ligne de total. */
export type TeamGameRating = RatingTriple & { games_rated?: number };

/** Une ligne de la table globale des joueurs : toutes les games du joueur dans l'étendue. */
export interface PlayerSummaryRow {
  /** Clé stable du joueur (pseudo normalisé). */
  key: string;
  name: string;
  team: string | null;
  games: number;
  /** Games où le joueur a un bilan calculé (les chiffres ne portent que sur celles-ci). */
  games_with_stats: number;
  maps: string[];
  kills: Maybe;
  deaths: Maybe;
  kd: Maybe;
  /** Temps vivant cumulé (s). */
  alive_s: Maybe;
  /** Vitesse moyenne pondérée par le temps vivant (m/s). */
  v_mean: Maybe;
  /** Médiane par game du 98e centile de la vitesse (m/s), jamais le maximum brut. */
  v_p98_median: Maybe;
  gadget_uses: Maybe;
  gadget_unused_at_death: Maybe;
  /** Borne haute (délai de gadget) ; null : non établie, jamais de somme partielle. */
  gadget_possible: Maybe;
  duels_won: Maybe;
  duels_lost: Maybe;
  duels_other: Maybe;
  kill_score_sum: Maybe;
  death_score_sum: Maybe;
  score_sum: Maybe;
  rating: RatingMean;
}

/** Une ligne du détail d'un joueur : une game. */
export interface PlayerGameRow {
  game_id: number;
  map: string;
  /** Début de la game dans la vidéo (s). */
  start_s: number;
  team: string | null;
  opponent: string | null;
  side: 'A' | 'B';
  slot: number;
  kills: Maybe;
  deaths: Maybe;
  kd: Maybe;
  alive_s: Maybe;
  v_mean: Maybe;
  v_p98: Maybe;
  gadget_uses: Maybe;
  gadget_unused_at_death: Maybe;
  gadget_possible: Maybe;
  duels_won: Maybe;
  duels_lost: Maybe;
  duels_other: Maybe;
  score_sum: Maybe;
  /** Notes de la game (null : aucune note calculée) et assistances avec leur source. */
  rating: PlayerGameRating | null;
  has_stats: boolean;
}

export interface PlayersSummary {
  scope: SummaryScope;
  games: number;
  /** Nombre de games sous lequel une proportion n'est pas montrée. */
  min: number;
  players: PlayerSummaryRow[];
  /** Seulement quand un joueur est demandé. */
  per_game?: PlayerGameRow[];
}

/** Score de capture lu en fin de game (pourcentages), du point de vue de l'équipe de la ligne. Ce n'est pas un résultat de match. */
export interface FinalCapture {
  own: number;
  opponent: number;
}

/** Une ligne de la table globale des équipes. */
export interface TeamSummaryRow {
  key: string;
  name: string;
  games: number;
  games_with_stats: number;
  maps: string[];
  kills: Maybe;
  deaths: Maybe;
  kd: Maybe;
  duels_won: Maybe;
  duels_lost: Maybe;
  duels_other: Maybe;
  gadget_uses: Maybe;
  gadget_unused_at_death: Maybe;
  gadget_possible: Maybe;
  point_changes: Maybe;
  final_capture_avg: FinalCapture | null;
  rating: RatingMean;
}

/** Une ligne du détail d'une équipe : une game. */
export interface TeamGameRow {
  game_id: number;
  map: string;
  start_s: number;
  side: 'A' | 'B';
  opponent: string | null;
  /** Presque toujours null : jamais affiché ni déduit. */
  winner: string | null;
  final_capture: FinalCapture | null;
  kills: Maybe;
  deaths: Maybe;
  kd: Maybe;
  duels_won: Maybe;
  duels_lost: Maybe;
  duels_other: Maybe;
  gadget_uses: Maybe;
  gadget_possible: Maybe;
  point_changes: Maybe;
  /** Moyenne des quatre joueurs de l'équipe dans la game, null quand un des quatre n'a pas la note. */
  rating: TeamGameRating;
  has_stats: boolean;
}

export interface TeamsSummary {
  scope: SummaryScope;
  games: number;
  min: number;
  teams: TeamSummaryRow[];
  /** Seulement quand une équipe est demandée. */
  per_game?: TeamGameRow[];
}
