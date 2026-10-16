// Types de l'onglet Stats : miroirs des tables dérivées (analysis/schema.sql) et des réponses de /api/stats/* (voir docs/PLAN_STATS_AGENTS.md, section 2).
// Temps en secondes depuis le début de la game, positions en fractions de la minimap, slot 1 à 8, équipe A (orange, slots 1 à 4) ou B (bleue).

export type TeamSide = 'A' | 'B';

/** Une vie : de l'apparition à la mort ('death') ou à la fin de la game ('end'). */
export interface Life {
  game_id: number;
  slot: number;
  idx: number;
  t0: number;
  t1: number;
  x0: number | null;
  y0: number | null;
  x1: number | null;
  y1: number | null;
  ended: 'death' | 'end';
  killer_slot: number | null;
  weapon: string | null;
  kill_kind: string | null;
}

/** Lien entre deux kills : trade (mort croisée à moins de 1 s) ou revenge (un coéquipier venge la victime dans les 5 s). */
export interface KillLink {
  game_id: number;
  t: number;
  victim_slot: number;
  kind: 'trade' | 'revenge';
  other_slot: number | null;
  dt: number | null;
  dist_m: number | null;
}

/** Propriétaire d'un point de capture pendant une période. */
export interface PointOwner {
  game_id: number;
  point: string;
  t0: number;
  t1: number;
  owner: TeamSide | 'none';
  source: 'box' | 'score' | null;
}

/** Équipement d'un joueur pour une vie. */
export interface LifeLoadout {
  game_id: number;
  slot: number;
  life_idx: number;
  weapon1: string | null;
  weapon2: string | null;
  gadget: string | null;
  held: string | null;
  source: string | null;
}

/** Période où un point est actif (clignote sous le chrono ou boîte dessinée) ; réponse de /api/stats/active. */
export interface PointActive {
  game_id: number;
  point: string;
  t0: number;
  t1: number;
  source: 'hud' | 'box' | 'schedule' | null;
}

/** Niveau d'un joueur pendant une période (Atlantis et The Cliff) ; réponse de /api/stats/levels. */
export interface PlayerLevel {
  game_id: number;
  slot: number;
  t0: number;
  t1: number;
  level: 'etage' | 'dessous';
  source: 'default' | 'tp' | 'zone' | 'grey' | null;
}

/** Équipement d'une vie avec les bornes de la vie (réponse de /api/stats/life-loadouts). */
export interface LifeLoadoutAt extends LifeLoadout {
  t0: number;
  t1: number;
}

export type EpisodeKind = 'retake' | 'rotation';

/** Épisode de retake ou de rotation ; `data` est le JSON décodé (positions de départ, joueurs, morts, causes automatiques). */
export interface Episode {
  id: number;
  game_id: number;
  kind: EpisodeKind;
  point: string | null;
  point_to: string | null;
  team: TeamSide | null;
  t0: number;
  t1: number;
  outcome: string | null;
  data: Record<string, unknown> | null;
  /** Jugement de l'utilisateur sur la détection (null : pas encore regardé). */
  verdict: 'ok' | 'ko' | null;
}

/** Temps passé par case (grille n sur n de la minimap), agrégé sur plusieurs games d'une même carte. `cells` : [colonne, ligne, secondes]. */
export interface PresenceGrid {
  n: number;
  games: number;
  cells: [number, number, number][];
}

/** Agrégat par équipe sur une carte (vague 4, à préciser) : `games` est le nombre de games, `min` le seuil en dessous duquel l'interface masque les résultats. */
export interface TeamAggregate {
  team: string;
  map: string;
  games: number;
  min: number;
}

/** État du gadget d'un joueur pendant une période (docs/PLAN_STATS_2.md) : disponible, utilisé (icône grise) ou inconnu. */
export interface GadgetState {
  game_id: number;
  slot: number;
  t0: number;
  t1: number;
  gadget: string | null;
  state: 'ready' | 'used' | 'unknown';
}

/** Duel entre deux joueurs ; `winner_slot` null si personne ne meurt. */
export interface Duel {
  id: number;
  game_id: number;
  t0: number;
  t1: number;
  slot_a: number;
  slot_b: number;
  winner_slot: number | null;
  outcome: string | null;
  data: Record<string, unknown> | null;
}

/** Note d'un kill du point de vue de l'équipe du tueur (convention, aucune vérité terrain). */
export interface KillScore {
  game_id: number;
  t: number;
  killer_slot: number | null;
  victim_slot: number;
  impact: number;
  reasons: string[] | null;
}

/** Bilan d'un joueur sur une game ; vitesses en m/s. */
export interface PlayerGameStats {
  game_id: number;
  slot: number;
  kills: number;
  deaths: number;
  alive_s: number | null;
  dist_m: number | null;
  v_mean: number | null;
  v_p98: number | null;
  v_max: number | null;
  /** Utilisations du gadget, morts avec le gadget encore disponible, utilisations possibles (null tant que le délai de recharge du gadget n'est pas mesuré). */
  gadget_uses: number | null;
  gadget_unused_at_death: number | null;
  gadget_possible: number | null;
  duels_won: number;
  duels_lost: number;
  /** Duels sans vainqueur (trade, indécis). */
  duels_other: number;
}

export type ReviewNoteKind = 'position' | 'action' | 'note';

/** Note de review (docs/PLAN_STATS_2.md, vague 5) : annotation sans effet sur les données lues. (x, y) en fractions de la minimap, angle en degrés (0 = est), t en secondes depuis le début de la game. */
export interface ReviewNote {
  id: number;
  game_id: number;
  t: number;
  slot: number | null;
  kind: ReviewNoteKind;
  x: number | null;
  y: number | null;
  angle: number | null;
  gadget: string | null;
  text: string;
  created_at: string;
}
