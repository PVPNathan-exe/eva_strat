// Fonctions pures des vues Joueurs et Équipes : tri (valeurs absentes toujours en bas), formats et libellés, part de duels gagnés, totaux de pied de tableau (jamais de somme partielle
// d'une borne « possible »), couleur de palette d'une équipe par son nom, messages quand les statistiques ne sont pas calculées. Aucune dépendance au navigateur.
// Les notes et les duels sont des conventions sans vérité terrain ; le score de capture final n'est pas un résultat de match (games.winner n'est pas renseigné).

import type { FinalCapture, Maybe, PlayerGameRow, RatingTriple, TeamGameRow } from '../types/statsSummary.ts';
import { NA, NOT_ESTABLISHED, type Cell } from './recapFormat.ts';
import { nameKey, type Palette } from './teamFollow.ts';
import { formatTime } from './timeline.ts';

export type SortDir = 'asc' | 'desc';
export type SortValue = number | string | null | undefined;

const present = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Commande qui calcule les tables Stats de toutes les games. */
export const STATS_ALL_COMMAND = 'npm run stats -- --all';

// ---------------------------------------------------------------- tri

/** Compare deux valeurs de colonne : nombres par ordre numérique, textes selon l'alphabet français. */
export function compareValues(a: number | string, b: number | string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'fr', { numeric: true, sensitivity: 'base' });
}

/** Trie sans modifier la liste. Les valeurs absentes (null, NaN) restent en bas quel que soit le sens ; l'ordre d'origine départage les égalités. */
export function sortRows<T>(rows: T[], value: (row: T) => SortValue, dir: SortDir): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((a, b) => {
      const an = a.v === null || a.v === undefined || (typeof a.v === 'number' && !Number.isFinite(a.v));
      const bn = b.v === null || b.v === undefined || (typeof b.v === 'number' && !Number.isFinite(b.v));
      if (an || bn) return an === bn ? a.i - b.i : an ? 1 : -1;
      return sign * compareValues(a.v as number | string, b.v as number | string) || a.i - b.i;
    })
    .map((x) => x.row);
}

/** Sens du tri quand on clique une colonne : un clic sur la colonne déjà triée inverse, sinon décroissant pour un nombre (les plus grands d'abord) et croissant pour un texte. */
export function nextSort(current: { col: string; dir: SortDir }, col: string, numeric: boolean): { col: string; dir: SortDir } {
  if (current.col === col) return { col, dir: current.dir === 'desc' ? 'asc' : 'desc' };
  return { col, dir: numeric ? 'desc' : 'asc' };
}

// ---------------------------------------------------------------- formats

/** Games d'une ligne : celles avec bilan calculé, et le total si différent (« 8 sur 10 »). C'est le nombre de games derrière chaque chiffre de la ligne. */
export function gamesCell(withStats: number, games: number): Cell {
  if (withStats === games) return { text: String(games), title: `${games} game${games > 1 ? 's' : ''}, toutes avec un bilan calculé.` };
  return { text: `${withStats} sur ${games}`, title: `${withStats} game${withStats > 1 ? 's' : ''} avec un bilan calculé sur ${games} : les chiffres de la ligne ne portent que sur les premières.` };
}

/** Cartes jouées : la liste si elle est courte, sinon leur nombre (la liste complète en infobulle). */
export function mapsCell(maps: string[]): Cell {
  if (maps.length === 0) return { text: NA };
  const all = maps.join(', ');
  return { text: maps.length <= 2 ? all : `${maps.length} cartes`, title: all };
}

/** Durée vivante : « 12:05 » ou « 1:02:03 » ; absente : « n/d ». */
export const durationCell = (s: Maybe | undefined): Cell => (present(s) ? { text: formatTime(s), title: 'Temps vivant cumulé (lignes vivantes de la game).' } : { text: NA });

/** Part de duels gagnés sur les duels décidés (gagnés + perdus), entre 0 et 1 ; null sans duel décidé ou sans chiffre. Les duels « autres » (sans vainqueur net) sont à part. */
export function duelShare(won: Maybe | undefined, lost: Maybe | undefined): number | null {
  if (!present(won) || !present(lost) || won + lost === 0) return null;
  return won / (won + lost);
}

/**
 * Cellule de la part de duels gagnés. Sous `min` games avec bilan, une proportion n'est pas montrée (trop peu de games pour la lire) ;
 * sans duel décidé, « n/d ». Les duels sont une convention sans vérité terrain.
 */
export function duelShareCell(won: Maybe | undefined, lost: Maybe | undefined, gamesWithStats: number, min = 0): Cell {
  const share = duelShare(won, lost);
  const base = 'Duels gagnés sur duels décidés (gagnés + perdus), sans les duels sans vainqueur net. Convention, sans vérité terrain.';
  if (share === null) return { text: NA, title: `Aucun duel décidé. ${base}` };
  if (gamesWithStats < min) return { text: `sous ${min} games`, title: `Moins de ${min} games avec bilan : la proportion n'est pas montrée. ${base}` };
  return { text: `${Math.round(share * 100)} %`, title: `${won} gagné${(won as number) > 1 ? 's' : ''} sur ${(won as number) + (lost as number)} duels décidés. ${base}` };
}

/** Valeur de tri des kills sur morts : sans mort, 100 fois les kills (un joueur sans mort passe devant tout rapport réel) ; absente si les kills ou les morts manquent. */
export function kdSort(kills: Maybe | undefined, deaths: Maybe | undefined): number | null {
  if (!present(kills) || !present(deaths)) return null;
  return deaths === 0 ? kills * 100 : kills / deaths;
}

/** Score de capture final : « 99 % contre 27 % » (équipe de la ligne d'abord) ; null : « n/d » (score pas lu). Ce n'est PAS un résultat de match. */
export function captureCell(c: FinalCapture | null | undefined, average = false): Cell {
  if (!c || !present(c.own) || !present(c.opponent)) return { text: NA, title: 'Score de capture non lu pour cette game.' };
  const what = average ? 'Moyenne des derniers scores de capture lus' : 'Dernier score de capture lu';
  return { text: `${Math.round(c.own)} % contre ${Math.round(c.opponent)} %`, title: `${what} (équipe de la ligne puis adversaire). Ce n'est pas un résultat de match : le vainqueur n'est pas renseigné.` };
}

/** Valeur de tri de la capture : le score de l'équipe de la ligne. */
export const captureSort = (c: FinalCapture | null | undefined): number | null => (c && present(c.own) ? c.own : null);

/** Côté dans la game : A = gauche (orange), B = droite (bleue). */
export const sideLabel = (side: 'A' | 'B'): string => (side === 'A' ? 'gauche' : 'droite');

/** Changements de point d'une équipe (null : non établi, pas 0). */
export const pointChangesCell = (v: Maybe | undefined): Cell => (present(v) ? { text: String(v) } : { text: NOT_ESTABLISHED, title: 'Nombre de changements de point non établi.' });


// ---------------------------------------------------------------- totaux de pied de tableau

/** Somme stricte : null dès qu'une valeur manque (jamais de somme partielle, utile pour la borne « possible »), null aussi sans valeur. */
export function sumStrict(values: (number | null | undefined)[]): number | null {
  if (values.length === 0 || values.some((v) => !present(v))) return null;
  return (values as number[]).reduce((a, b) => a + b, 0);
}

/** Moyenne pondérée de `values` par `weights` ; les paires incomplètes sont ignorées, null s'il ne reste aucun poids. */
export function weightedMean(values: (number | null | undefined)[], weights: (number | null | undefined)[]): number | null {
  let sum = 0;
  let w = 0;
  values.forEach((v, i) => {
    const weight = weights[i];
    if (present(v) && present(weight) && weight > 0) {
      sum += v * weight;
      w += weight;
    }
  });
  return w > 0 ? sum / w : null;
}

/** Médiane des valeurs présentes ; null sans valeur. */
export function median(values: (number | null | undefined)[]): number | null {
  const v = values.filter(present).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Moyenne des scores de capture finaux lus (les games sans score sont ignorées) ; null s'il n'y en a aucun. */
export function captureAverage(rows: Pick<TeamGameRow, 'final_capture'>[]): FinalCapture | null {
  const read = rows.map((r) => r.final_capture).filter((c): c is FinalCapture => !!c && present(c.own) && present(c.opponent));
  if (read.length === 0) return null;
  const mean = (pick: (c: FinalCapture) => number) => read.reduce((a, c) => a + pick(c), 0) / read.length;
  return { own: mean((c) => c.own), opponent: mean((c) => c.opponent) };
}

/** Moyenne des notes d'une liste de games : une moyenne par note sur les games où elle existe (jamais de 0 inventé), `games_rated` = games où la note globale existe ; null partout sans aucune note. */
export function meanRatings(rows: (RatingTriple | null | undefined)[]): RatingTriple & { games_rated: number } {
  const real = rows.filter((r): r is RatingTriple => !!r);
  const mean = (pick: (r: RatingTriple) => Maybe): Maybe => {
    const v = real.map(pick).filter((x): x is number => present(x));
    return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
  };
  return { individual: mean((r) => r.individual), teamplay: mean((r) => r.teamplay), overall: mean((r) => r.overall), games_rated: real.filter((r) => present(r.overall)).length };
}

/** Ligne de total d'un joueur : somme des games AVEC bilan. Vitesse moyenne pondérée par le temps vivant, 98e centile = médiane des games, « possible » nul dès qu'une game ne l'établit pas. */
export function totalPlayerGames(rows: PlayerGameRow[]): PlayerGameRow {
  const r = rows.filter((x) => x.has_stats);
  return {
    game_id: 0,
    map: '',
    start_s: 0,
    team: null,
    opponent: null,
    side: 'A',
    slot: 0,
    kills: sumStrict(r.map((x) => x.kills)),
    deaths: sumStrict(r.map((x) => x.deaths)),
    kd: null,
    alive_s: sumStrict(r.map((x) => x.alive_s)),
    v_mean: weightedMean(r.map((x) => x.v_mean), r.map((x) => x.alive_s)),
    v_p98: median(r.map((x) => x.v_p98)),
    gadget_uses: sumStrict(r.map((x) => x.gadget_uses)),
    gadget_unused_at_death: sumStrict(r.map((x) => x.gadget_unused_at_death)),
    gadget_possible: sumStrict(r.map((x) => x.gadget_possible)),
    duels_won: sumStrict(r.map((x) => x.duels_won)),
    duels_lost: sumStrict(r.map((x) => x.duels_lost)),
    duels_other: sumStrict(r.map((x) => x.duels_other)),
    score_sum: sumStrict(r.map((x) => x.score_sum)),
    rating: { ...meanRatings(rows.map((x) => x.rating)), assists: sumStrict(rows.map((x) => x.rating?.assists)), assist_source: null },
    has_stats: r.length > 0,
  };
}

/** Ligne de total d'une équipe : somme des games AVEC bilan, capture finale moyennée sur les games où elle est lue. */
export function totalTeamGames(rows: TeamGameRow[]): TeamGameRow {
  const r = rows.filter((x) => x.has_stats);
  return {
    game_id: 0,
    map: '',
    start_s: 0,
    side: 'A',
    opponent: null,
    winner: null,
    final_capture: captureAverage(rows),
    kills: sumStrict(r.map((x) => x.kills)),
    deaths: sumStrict(r.map((x) => x.deaths)),
    kd: null,
    duels_won: sumStrict(r.map((x) => x.duels_won)),
    duels_lost: sumStrict(r.map((x) => x.duels_lost)),
    duels_other: sumStrict(r.map((x) => x.duels_other)),
    gadget_uses: sumStrict(r.map((x) => x.gadget_uses)),
    gadget_possible: sumStrict(r.map((x) => x.gadget_possible)),
    point_changes: sumStrict(r.map((x) => x.point_changes)),
    rating: meanRatings(rows.map((x) => x.rating)),
    has_stats: r.length > 0,
  };
}

// ---------------------------------------------------------------- palette, libellés, messages

/** Palette d'une équipe d'après son NOM : « a » si c'est l'équipe suivie, « b » sinon ; null quand aucune équipe n'est suivie ou que le nom est inconnu (pas de couleur inventée). */
export function palOfTeam(name: string | null | undefined, followed: string | null): Palette | null {
  if (!followed || !nameKey(name)) return null;
  return nameKey(name) === followed ? 'a' : 'b';
}

/** Classe CSS d'une ligne : palette de l'équipe, ou rien. */
export const palRowClass = (pal: Palette | null): string => (pal ? `pal pal--${pal}` : '');

/** Étendue en clair : « toutes les cartes » ou « la carte X ». */
export const scopeText = (map: string | null): string => (map ? `la carte ${map}` : 'toutes les cartes');

/** Message quand aucune statistique n'est calculée pour ce choix (aucune ligne, ou aucune game avec bilan) ; null sinon. */
export function emptyStatsNotice(rows: { games_with_stats: number }[], what: 'joueur' | 'équipe', map: string | null): string | null {
  if (rows.length === 0) return `Aucun ${what} pour ${scopeText(map)}. Si les statistiques ne sont pas calculées, lancer ${STATS_ALL_COMMAND}.`;
  if (rows.every((r) => r.games_with_stats === 0)) return `Statistiques pas calculées pour ${scopeText(map)}, lancer ${STATS_ALL_COMMAND}.`;
  return null;
}

/** Message quand certaines games du détail n'ont pas de bilan ; null sinon. */
export function partialStatsNotice(rows: { has_stats: boolean }[]): string | null {
  const missing = rows.filter((r) => !r.has_stats).length;
  if (missing === 0) return null;
  return `${missing} game${missing > 1 ? 's' : ''} sans bilan calculé (chiffres « n/d », hors totaux), lancer ${STATS_ALL_COMMAND}.`;
}

/** Texte d'une ligne dont le bilan manque : toutes les colonnes de chiffres sont « n/d ». */
export const noStatsCell: Cell = { text: NA, title: 'Bilan pas calculé pour cette game.' };
