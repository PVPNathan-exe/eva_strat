// Choix d'étendue des vues Joueurs et Équipes : toutes les cartes (par défaut) ou la carte du filtre.

export type SummaryScopeChoice = 'all' | 'map';

/** Carte à demander au serveur pour ce choix (null : toutes les cartes). */
export const mapOfScope = (scope: SummaryScopeChoice, map: string): string | null => (scope === 'map' ? map : null);
