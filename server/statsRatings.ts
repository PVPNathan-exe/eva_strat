// Notes sur 20 des joueurs (table player_ratings, analysis/player_ratings.py) : lecture, et moyennes sans jamais de moyenne partielle trompeuse.
// Une note NULL (« n/d ») n'entre jamais dans une moyenne : le nombre de games notées est toujours donné avec la moyenne. Conventions sans vérité terrain.

import type { ApiContext } from './api.ts';

type Row = Record<string, unknown>;
const round2 = (v: number): number => Math.round(v * 100) / 100;
/** Décode la colonne JSON `data` : objet, ou null si vide ou illisible (pas d'import de statsGame.ts, qui importe ce fichier). */
function decodeObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Les trois notes d'un joueur dans une game (null : non établie) et ses assistances. */
export interface RatingNotes {
  individual: number | null;
  teamplay: number | null;
  overall: number | null;
  /** Assistances comptées (null : non lues) et leur source : `tableau` de fin de game ou `repli` mesuré. */
  assists: number | null;
  assist_source: string | null;
}

/** Les trois notes sur 20. */
export type NoteTriple = Pick<RatingNotes, 'individual' | 'teamplay' | 'overall'>;

/** Note d'une game avec le détail de chaque composante (valeur brute, note, poids, raison d'absence), décodé de la colonne `data`. */
export interface RatingWithDetail extends RatingNotes {
  detail: Record<string, unknown> | null;
}

/** Moyenne de notes sur plusieurs games : une moyenne par note, calculée sur les games où cette note existe, et le nombre de ces games. */
export interface RatingMean {
  individual: number | null;
  teamplay: number | null;
  overall: number | null;
  /** Games où la note GLOBALE existe (celles qui entrent dans la moyenne globale). */
  games_rated: number;
  individual_games: number;
  teamplay_games: number;
}

function notesOf(r: Row): RatingNotes {
  return { individual: num(r.individual), teamplay: num(r.teamplay), overall: num(r.overall), assists: num(r.assists), assist_source: typeof r.assist_source === 'string' ? r.assist_source : null };
}

/** Notes d'une game : { slot -> notes avec détail } ; vide si la game n'a pas de note calculée. */
export function loadGameRatings(ctx: ApiContext, gameId: number): Map<number, RatingWithDetail> {
  const out = new Map<number, RatingWithDetail>();
  const rows = ctx.db.prepare('SELECT slot, individual, teamplay, overall, assists, assist_source, data FROM player_ratings WHERE game_id = ?').all(gameId) as Row[];
  for (const r of rows) out.set(Number(r.slot), { ...notesOf(r), detail: decodeObject(r.data) });
  return out;
}

/** Notes de plusieurs games : { "game|slot" -> notes } (sans détail), seulement pour les games demandées. */
export function loadRatings(ctx: ApiContext, ids: Set<number>): Map<string, RatingNotes> {
  const out = new Map<string, RatingNotes>();
  const rows = ctx.db.prepare('SELECT game_id, slot, individual, teamplay, overall, assists, assist_source FROM player_ratings').all() as Row[];
  for (const r of rows) if (ids.has(Number(r.game_id))) out.set(`${r.game_id}|${r.slot}`, notesOf(r));
  return out;
}

function meanOf(values: (number | null)[]): { mean: number | null; n: number } {
  const real = values.filter((v): v is number => v !== null);
  return { mean: real.length === 0 ? null : round2(real.reduce((a, b) => a + b, 0) / real.length), n: real.length };
}

/** Moyenne des notes d'une liste de lignes (une par game) ; null et games_rated 0 quand aucune note n'existe. */
export function meanRating(rows: (NoteTriple | null | undefined)[]): RatingMean {
  const real = rows.filter((r): r is NoteTriple => r !== null && r !== undefined);
  const ind = meanOf(real.map((r) => r.individual));
  const team = meanOf(real.map((r) => r.teamplay));
  const all = meanOf(real.map((r) => r.overall));
  return { individual: ind.mean, teamplay: team.mean, overall: all.mean, games_rated: all.n, individual_games: ind.n, teamplay_games: team.n };
}

/**
 * Note d'une ÉQUIPE dans une game : moyenne de ses joueurs, seulement si TOUS ont la note (une moyenne sur trois joueurs sur quatre ferait croire à une note d'équipe complète). Sinon null.
 * `rows` : les notes des joueurs de l'équipe dans la game (null pour un joueur sans ligne).
 */
export function teamRatingOfGame(rows: (NoteTriple | null | undefined)[]): NoteTriple {
  const full = (get: (r: NoteTriple) => number | null): number | null => {
    if (rows.length === 0) return null;
    const values = rows.map((r) => (r ? get(r) : null));
    return values.some((v) => v === null) ? null : round2((values as number[]).reduce((a, b) => a + b, 0) / values.length);
  };
  return { individual: full((r) => r.individual), teamplay: full((r) => r.teamplay), overall: full((r) => r.overall) };
}
