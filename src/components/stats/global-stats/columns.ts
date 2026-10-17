// Définition des colonnes des tableaux Joueurs et Équipes : texte, infobulle et valeur de tri de chaque cellule. Sans JSX (testable par node --test).
// Les colonnes de chiffres communes (kills, morts, secondaires, duels) sont fabriquées une fois ici pour les quatre tableaux (global et détail, joueurs et équipes).

import { fmtCount, gadgetCell, killsOnDeaths, NA, unusedCell, type Cell } from '../../../lib/recapFormat.ts';
import { duelShare, duelShareCell, kdSort, noStatsCell, sortRows, type SortDir, type SortValue } from '../../../lib/summaryFormat.ts';
import { meanRatingCell, ratingCell } from '../../../lib/ratingFormat.ts';
import type { Maybe, RatingMean, RatingTriple } from '../../../types/statsSummary.ts';

/** Une colonne d'un tableau triable. */
export interface Column<T> {
  id: string;
  label: string;
  title?: string;
  /** Colonne de nombres : alignée à droite, premier tri décroissant. */
  numeric: boolean;
  value: (row: T) => SortValue;
  cell: (row: T) => Cell;
  /** Faux : la case reste vide dans la ligne de total (carte, adversaire, côté). */
  inTotal?: boolean;
}

/** Champs de chiffres que partagent les lignes de joueur et d'équipe. */
export interface StatFields {
  kills: Maybe;
  deaths: Maybe;
  gadget_uses: Maybe;
  gadget_possible: Maybe;
  duels_won: Maybe;
  duels_lost: Maybe;
  duels_other: Maybe;
}

export const DUELS_TITLE = 'Duel : un joueur en pousse un ou deux sans aide proche. Gagné par celui qui tue, sinon par les points de vie restants (convention, sans vérité terrain).';

/** Colonne de chiffres d'un entier : « n/d » quand la ligne n'a pas de bilan. */
function countColumn<T>(id: string, label: string, title: string | undefined, has: (r: T) => boolean, get: (r: T) => Maybe | undefined): Column<T> {
  return { id, label, title, numeric: true, value: (r) => (has(r) ? get(r) : null), cell: (r) => (has(r) ? { text: fmtCount(get(r)), title } : noStatsCell) };
}

/**
 * Colonnes de chiffres communes. `has` dit si la ligne a un bilan ; `gamesOf` donne le nombre de games avec bilan derrière la ligne (pour masquer la
 * proportion de duels sous `minGames`) ; une ligne de détail passe 1 et `minGames` 0.
 */
export function statColumns<T extends StatFields>(has: (r: T) => boolean, gamesOf: (r: T) => number, minGames: number) {
  return {
    kills: countColumn<T>('kills', 'Kills', undefined, has, (r) => r.kills),
    deaths: countColumn<T>('deaths', 'Morts', undefined, has, (r) => r.deaths),
    kd: {
      id: 'kd',
      label: 'Kills sur morts',
      title: 'Kills divisés par morts',
      numeric: true,
      value: (r) => (has(r) ? kdSort(r.kills, r.deaths) : null),
      cell: (r) => (has(r) ? killsOnDeaths(r.kills, r.deaths) : noStatsCell),
    } as Column<T>,
    gadget: {
      id: 'gadget',
      label: 'Secondaires utilisés',
      title: 'Secondaires utilisés sur possibles. « Possible » est une borne haute calculée par délai de gadget, non établie sans assez de cycles.',
      numeric: true,
      value: (r) => (has(r) && typeof r.gadget_possible === 'number' && typeof r.gadget_uses === 'number' ? r.gadget_uses / Math.max(r.gadget_possible, 1e-9) : null),
      cell: (r) => (has(r) ? gadgetCell(r.gadget_uses, r.gadget_possible) : noStatsCell),
    } as Column<T>,
    duelsWon: countColumn<T>('duels_won', 'Duels gagnés', DUELS_TITLE, has, (r) => r.duels_won),
    duelsLost: countColumn<T>('duels_lost', 'Duels perdus', DUELS_TITLE, has, (r) => r.duels_lost),
    duelsOther: countColumn<T>('duels_other', 'Duels autres', 'Duels sans vainqueur net (sans kill et sans écart de points de vie suffisant, ou interrompus).', has, (r) => r.duels_other),
    duelShare: {
      id: 'duel_share',
      label: 'Duels gagnés (part)',
      title: 'Duels gagnés sur duels décidés (gagnés + perdus). Masquée sous le minimum de games avec bilan.',
      numeric: true,
      value: (r) => (has(r) && gamesOf(r) >= minGames ? duelShare(r.duels_won, r.duels_lost) : null),
      cell: (r) => (has(r) ? duelShareCell(r.duels_won, r.duels_lost, gamesOf(r), minGames) : noStatsCell),
    } as Column<T>,
  };
}

/** Colonne « morts avec secondaire disponible », pour les lignes qui la portent. */
export function unusedColumn<T extends { gadget_unused_at_death: Maybe }>(has: (r: T) => boolean): Column<T> {
  return {
    id: 'unused',
    label: 'Morts avec secondaire',
    title: 'Morts avec le secondaire encore disponible (mauvais : mourir avec). Non établi quand le calcul ne l\'a pas établi.',
    numeric: true,
    value: (r) => (has(r) ? r.gadget_unused_at_death : null),
    cell: (r) => (has(r) ? unusedCell(r.gadget_unused_at_death) : noStatsCell),
  };
}

/** Cellule texte simple (carte, adversaire). */
export const textCell = (text: string | null | undefined, title?: string): Cell => (text ? { text, title } : { text: NA });

/** Lignes triées d'après la colonne choisie (colonne inconnue : ordre d'origine). */
export function sortByColumn<T>(rows: T[], columns: Column<T>[], sort: { col: string; dir: SortDir }): T[] {
  const col = columns.find((c) => c.id === sort.col);
  return col ? sortRows(rows, col.value, sort.dir) : rows;
}

const RATING_TITLE = 'Note sur 20 (10 = médiane de la base), convention sans vérité terrain.';

/**
 * Colonnes de notes d'un tableau global (moyenne sur les games notées) : globale, individuelle, teamplay et nombre de games notées. Une note jamais calculée est « n/d » (jamais 0) ;
 * l'infobulle dit combien de games la portent, car la moyenne ne compte que celles où la note existe.
 */
export function ratingColumns<T>(get: (r: T) => RatingMean, totalGames: (r: T) => number): Column<T>[] {
  const mean = (id: string, label: string, pick: (m: RatingMean) => Maybe, games: (m: RatingMean) => number): Column<T> => ({
    id,
    label,
    title: `${label} : moyenne sur les games où la note existe. ${RATING_TITLE}`,
    numeric: true,
    value: (r) => pick(get(r)),
    cell: (r) => meanRatingCell(pick(get(r)), games(get(r)), totalGames(r), label),
  });
  return [
    mean('rating_overall', 'Note globale /20', (m) => m.overall, (m) => m.games_rated),
    mean('rating_individual', 'Individuelle /20', (m) => m.individual, (m) => m.individual_games),
    mean('rating_teamplay', 'Teamplay /20', (m) => m.teamplay, (m) => m.teamplay_games),
    {
      id: 'rating_games',
      label: 'Games notées',
      title: 'Games où la note globale existe (celles de la moyenne), sur le total de games de la ligne.',
      numeric: true,
      value: (r) => get(r).games_rated,
      cell: (r) => ({ text: get(r).games_rated === totalGames(r) ? String(get(r).games_rated) : `${get(r).games_rated} sur ${totalGames(r)}` }),
    },
  ];
}

/** Colonnes de notes d'un détail game par game : les trois notes de la game (« n/d » quand non établie ou absente ; la ligne de total donne la moyenne des games notées). */
export function ratingDetailColumns<T>(get: (r: T) => (RatingTriple & { games_rated?: number }) | null): Column<T>[] {
  const one = (id: string, label: string, pick: (m: RatingTriple) => Maybe): Column<T> => ({
    id,
    label,
    title: `${label}. ${RATING_TITLE}`,
    numeric: true,
    value: (r) => {
      const m = get(r);
      return m ? pick(m) : null;
    },
    cell: (r) => {
      const m = get(r);
      if (!m) return { text: NA, title: 'Note pas calculée pour cette game.' };
      const extra = typeof m.games_rated === 'number' ? `Moyenne de ${m.games_rated} game${m.games_rated > 1 ? 's' : ''} notée${m.games_rated > 1 ? 's' : ''}.` : undefined;
      return ratingCell(pick(m), null, extra);
    },
  });
  return [one('rating_overall', 'Note globale /20', (m) => m.overall), one('rating_individual', 'Individuelle /20', (m) => m.individual), one('rating_teamplay', 'Teamplay /20', (m) => m.teamplay)];
}
