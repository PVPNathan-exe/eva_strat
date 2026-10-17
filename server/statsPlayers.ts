// Routes /api/stats/players-summary et teams-summary : statistiques GLOBALES (toutes les cartes si `map` est absent), par joueur (pseudo normalisé) et par équipe (nom normalisé), avec le détail game par game. Lecture seule.
// Sources : player_game_stats (bilan), kill_scores (notes), capture_state (dernier pourcentage lu), point_active (via pointChanges). Aucune victoire n'est déduite (games.winner est presque toujours vide).

import type { ApiContext, ApiResult } from './api.ts';
import { fail, gamesParam, nameKey, playerIdentity, pointChanges, reply, TEAM_MIN_GAMES } from './statsGame.ts';
import type { Row } from './statsGame.ts';
import { loadRatings, meanRating, teamRatingOfGame, type RatingNotes } from './statsRatings.ts';

const NAME_MAX = 80;
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Petits outils de cumul

/** Somme des valeurs lues ; null si aucune (jamais un zéro inventé). */
function sumOf(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => v !== null);
  return real.length === 0 ? null : round3(real.reduce((a, b) => a + b, 0));
}

/** Total des possibles : null dès qu'une valeur manque (pas de somme partielle, elle ferait passer les utilisés au-dessus des possibles). */
function totalPossible(values: (number | null)[]): number | null {
  return values.length === 0 || values.some((v) => v === null) ? null : sumOf(values);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return round3(s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

/** Écriture la plus fréquente d'un nom (égalité : la première rencontrée) ; null si aucun nom. */
function commonName(names: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const n of names) if (n !== null && n.trim() !== '') counts.set(n, (counts.get(n) ?? 0) + 1);
  let best: string | null = null;
  for (const [n, c] of counts) if (best === null || c > (counts.get(best) ?? 0)) best = n;
  return best;
}

const kdOf = (kills: number | null, deaths: number | null): number | null => (kills === null || deaths === null || deaths === 0 ? null : round3(kills / deaths));
const uniqueMaps = (maps: (string | null)[]): string[] => [...new Set(maps.filter((m): m is string => m !== null && m !== ''))].sort();

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Parties communes aux deux routes : paramètres et games concernées

interface GameRow {
  id: number;
  map: string | null;
  start_s: number;
  team_a: string | null;
  team_b: string | null;
  winner: string | null;
}

interface Scope {
  map: string | null;
  team: string | null;
  player: string | null;
  only: number[] | null;
}

/** Lit un paramètre texte facultatif : null si absent ou vide, un message d'erreur si trop long. */
function textParam(query: URLSearchParams, name: string): string | null | { error: string } {
  const raw = (query.get(name) ?? '').trim();
  if (raw === '') return null;
  return raw.length > NAME_MAX ? { error: `Paramètre ${name} invalide : texte trop long` } : raw;
}

function readScope(query: URLSearchParams, withPlayer: boolean): Scope | { error: string } {
  const out: Scope = { map: null, team: null, player: null, only: null };
  for (const name of withPlayer ? (['map', 'team', 'player'] as const) : (['map', 'team'] as const)) {
    const v = textParam(query, name);
    if (v !== null && typeof v === 'object') return v;
    out[name] = v;
  }
  const only = gamesParam(query);
  if (typeof only === 'string') return { error: only };
  out.only = only;
  return out;
}

/** Les games de la carte (toutes si `map` est absent) et de la liste `games`, dans l'ordre des identifiants. */
function scopedGames(ctx: ApiContext, scope: Scope): GameRow[] {
  const rows = ctx.db.prepare('SELECT id, map, start_s, team_a, team_b, winner FROM games ORDER BY id').all() as unknown as GameRow[];
  const mapKey = scope.map === null ? null : nameKey(scope.map);
  return rows.filter((g) => (mapKey === null || nameKey(g.map) === mapKey) && (scope.only === null || scope.only.includes(g.id)));
}

const teamName = (g: GameRow, side: 'A' | 'B'): string | null => (side === 'A' ? g.team_a : g.team_b);
const sideOfSlot = (slot: number): 'A' | 'B' => (slot <= 4 ? 'A' : 'B');
const otherSide = (side: 'A' | 'B'): 'A' | 'B' => (side === 'A' ? 'B' : 'A');

/** Lignes player_game_stats des games données, indexées par « game|slot ». */
function loadStats(ctx: ApiContext, ids: Set<number>): Map<string, Row> {
  const out = new Map<string, Row>();
  const rows = ctx.db
    .prepare(
      'SELECT game_id, slot, kills, deaths, alive_s, v_mean, v_p98, gadget_uses, gadget_unused_at_death, gadget_possible, duels_won, duels_lost, duels_other FROM player_game_stats',
    )
    .all() as Row[];
  for (const r of rows) if (ids.has(Number(r.game_id))) out.set(`${r.game_id}|${r.slot}`, r);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Résumé par joueur

/** Une ligne (game, joueur) : identité, côté, bilan (null si la game n'a pas de ligne de bilan pour ce joueur) et sommes des notes. */
interface Appearance {
  game: GameRow;
  slot: number;
  side: 'A' | 'B';
  name: string;
  team: string | null;
  stats: Row | null;
  /** Sommes des notes de la game pour ce joueur ; null si la game n'a aucune note de kill. */
  killScore: number | null;
  deathScore: number | null;
  /** Notes sur 20 de la game (null : pas de note calculée pour ce joueur dans cette game). */
  rating: RatingNotes | null;
}

const col = (rows: Appearance[], key: string): (number | null)[] => rows.filter((a) => a.stats).map((a) => num(a.stats?.[key]));

/** Moyenne de la vitesse pondérée par le temps vivant : seulement les games qui ont les deux valeurs (temps vivant positif). */
function weightedSpeed(rows: Appearance[]): number | null {
  let weight = 0;
  let total = 0;
  for (const a of rows) {
    const v = num(a.stats?.v_mean);
    const w = num(a.stats?.alive_s);
    if (v !== null && w !== null && w > 0) {
      weight += w;
      total += v * w;
    }
  }
  return weight > 0 ? round3(total / weight) : null;
}

/** Cumul d'un ensemble de lignes (un joueur, ou une équipe vue par ses joueurs) : kills, morts, gadgets, duels. */
function tally(rows: Appearance[]) {
  const kills = sumOf(col(rows, 'kills'));
  const deaths = sumOf(col(rows, 'deaths'));
  return {
    kills,
    deaths,
    kd: kdOf(kills, deaths),
    duels_won: sumOf(col(rows, 'duels_won')),
    duels_lost: sumOf(col(rows, 'duels_lost')),
    duels_other: sumOf(col(rows, 'duels_other')),
    gadget_uses: sumOf(col(rows, 'gadget_uses')),
    gadget_unused_at_death: sumOf(col(rows, 'gadget_unused_at_death')),
    gadget_possible: totalPossible(col(rows, 'gadget_possible')),
  };
}

/** Notes de kill d'une game : somme des impact par tueur et des -impact par victime ; map vide si la game n'a aucune note. */
function loadScores(ctx: ApiContext, ids: Set<number>): { kill: Map<string, number>; death: Map<string, number>; games: Set<number> } {
  const out = { kill: new Map<string, number>(), death: new Map<string, number>(), games: new Set<number>() };
  const rows = ctx.db.prepare('SELECT game_id, killer_slot, victim_slot, impact, death_impact FROM kill_scores').all() as Row[];
  for (const r of rows) {
    const gid = Number(r.game_id);
    if (!ids.has(gid)) continue;
    out.games.add(gid);
    const impact = Number(r.impact);
    const killer = num(r.killer_slot);
    if (killer !== null) out.kill.set(`${gid}|${killer}`, (out.kill.get(`${gid}|${killer}`) ?? 0) + impact);
    const deathImpact = num(r.death_impact); // note de la mort (règle du 17/10/2026) ; ancien calcul sans elle : -impact
    out.death.set(`${gid}|${r.victim_slot}`, (out.death.get(`${gid}|${r.victim_slot}`) ?? 0) + (deathImpact ?? -impact));
  }
  return out;
}

/** Toutes les présences de joueurs nommés dans les games données (pseudo vide ignoré). */
function appearances(ctx: ApiContext, games: GameRow[]): Appearance[] {
  const byId = new Map(games.map((g) => [g.id, g]));
  const ids = new Set(byId.keys());
  const stats = loadStats(ctx, ids);
  const scores = loadScores(ctx, ids);
  const ratings = loadRatings(ctx, ids);
  const out: Appearance[] = [];
  const rows = ctx.db.prepare('SELECT game_id, slot, name FROM players ORDER BY game_id, slot').all() as { game_id: number; slot: number; name: string }[];
  for (const r of rows) {
    const game = byId.get(r.game_id);
    if (!game || nameKey(r.name) === '') continue;
    const k = `${r.game_id}|${r.slot}`;
    const hasScores = scores.games.has(r.game_id);
    out.push({
      game,
      slot: r.slot,
      side: sideOfSlot(r.slot),
      name: r.name.trim(),
      team: teamName(game, sideOfSlot(r.slot)),
      stats: stats.get(k) ?? null,
      killScore: hasScores ? round3(scores.kill.get(k) ?? 0) : null,
      deathScore: hasScores ? round3(scores.death.get(k) ?? 0) : null,
      rating: ratings.get(k) ?? null,
    });
  }
  return out;
}

const scoreSum = (kill: number | null, death: number | null): number | null => (kill === null || death === null ? null : round3(kill + death));

/** Détail d'un joueur dans une game. */
function perGameOfPlayer(a: Appearance) {
  const s = a.stats;
  const kills = num(s?.kills);
  const deaths = num(s?.deaths);
  return {
    game_id: a.game.id,
    map: a.game.map,
    start_s: a.game.start_s,
    team: a.team,
    opponent: teamName(a.game, otherSide(a.side)),
    side: a.side,
    slot: a.slot,
    kills,
    deaths,
    kd: kdOf(kills, deaths),
    alive_s: num(s?.alive_s),
    v_mean: num(s?.v_mean),
    v_p98: num(s?.v_p98),
    gadget_uses: num(s?.gadget_uses),
    gadget_unused_at_death: num(s?.gadget_unused_at_death),
    gadget_possible: num(s?.gadget_possible),
    duels_won: num(s?.duels_won),
    duels_lost: num(s?.duels_lost),
    duels_other: num(s?.duels_other),
    score_sum: scoreSum(a.killScore, a.deathScore),
    rating: a.rating,
    has_stats: s !== null,
  };
}

/** Résumé d'un joueur sur l'ensemble de ses présences. */
function playerRow(key: string, rows: Appearance[]) {
  const withStats = rows.filter((a) => a.stats);
  const killScore = sumOf(rows.map((a) => a.killScore));
  const deathScore = sumOf(rows.map((a) => a.deathScore));
  const name = commonName(rows.map((a) => a.name)) ?? key;
  return {
    key: nameKey(name), // clé lisible (l'écriture la plus fréquente) ; le regroupement se fait sur l'identité repliée, et le filtre `player` accepte n'importe quelle écriture
    name,
    team: commonName(rows.map((a) => a.team)),
    games: new Set(rows.map((a) => a.game.id)).size,
    games_with_stats: new Set(withStats.map((a) => a.game.id)).size,
    maps: uniqueMaps(rows.map((a) => a.game.map)),
    ...tally(rows),
    alive_s: sumOf(col(rows, 'alive_s')),
    v_mean: weightedSpeed(rows),
    v_p98_median: median(col(rows, 'v_p98').filter((v): v is number => v !== null)),
    kill_score_sum: killScore,
    death_score_sum: deathScore,
    score_sum: scoreSum(killScore, deathScore),
    rating: meanRating(rows.map((a) => a.rating)),
  };
}

/**
 * GET /api/stats/players-summary?map=&team=&player=&games= : un résumé par joueur (pseudo normalisé) sur toutes ses games, toutes cartes si `map` est absent.
 * `team` : seulement les games où le joueur joue pour cette équipe. `player` (clé normalisée) : un seul joueur et son détail game par game (`per_game`).
 * `games` de la réponse : games concernées par la carte, la liste et l'équipe (jouée sur un côté ou l'autre), quel que soit le joueur.
 */
export function playersSummary(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const scope = readScope(query, true);
  if ('error' in scope) return fail(scope.error);
  const teamKey = scope.team === null ? null : nameKey(scope.team);
  const playerKey = scope.player === null ? null : playerIdentity(scope.player);

  let games = scopedGames(ctx, scope);
  if (teamKey !== null) games = games.filter((g) => nameKey(g.team_a) === teamKey || nameKey(g.team_b) === teamKey);
  const seen = appearances(ctx, games).filter((a) => teamKey === null || nameKey(a.team) === teamKey);

  const groups = new Map<string, Appearance[]>();
  for (const a of seen) {
    const key = playerIdentity(a.name);
    if (playerKey !== null && key !== playerKey) continue;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const players = [...groups.entries()].map(([key, rows]) => playerRow(key, rows)).sort((a, b) => (b.kills ?? -1) - (a.kills ?? -1) || a.key.localeCompare(b.key));
  const body: Record<string, unknown> = { scope: { map: scope.map, team: scope.team }, games: games.length, min: TEAM_MIN_GAMES, players };
  if (playerKey !== null) body.per_game = (groups.get(playerKey) ?? []).map(perGameOfPlayer).sort((a, b) => a.game_id - b.game_id);
  return reply(200, body);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Résumé par équipe

type Pct = { own: number | null; opponent: number | null };

/** Dernier pourcentage de capture lu de chaque côté pour chaque game (temps de vidéo : le dernier `t` de la game). */
function lastCaptures(ctx: ApiContext, ids: Set<number>): Map<number, Record<'A' | 'B', number | null>> {
  const sql = `SELECT game_id, team, pct FROM (
    SELECT game_id, team, pct, ROW_NUMBER() OVER (PARTITION BY game_id, team ORDER BY t DESC) AS rn
    FROM capture_state WHERE point IN ('score_A', 'score_B') AND pct IS NOT NULL) WHERE rn = 1`;
  const out = new Map<number, Record<'A' | 'B', number | null>>();
  for (const r of ctx.db.prepare(sql).all() as { game_id: number; team: string; pct: number }[]) {
    if (!ids.has(r.game_id) || (r.team !== 'A' && r.team !== 'B')) continue;
    const entry = out.get(r.game_id) ?? { A: null, B: null };
    entry[r.team] = r.pct;
    out.set(r.game_id, entry);
  }
  return out;
}

const mean = (values: (number | null)[]): number | null => {
  const real = values.filter((v): v is number => v !== null);
  return real.length === 0 ? null : round3(real.reduce((a, b) => a + b, 0) / real.length);
};

/** Une équipe dans une game : son côté, ses joueurs (lignes de bilan), le dernier pourcentage de capture de chaque côté. */
interface TeamGame {
  game: GameRow;
  side: 'A' | 'B';
  name: string;
  rows: Appearance[];
  changes: number;
  capture: Pct | null;
  /** Note de l'équipe dans la game : moyenne de ses joueurs, seulement si les quatre ont la note. */
  rating: ReturnType<typeof teamRatingOfGame>;
}

function perGameOfTeam(t: TeamGame) {
  const sums = tally(t.rows);
  return {
    game_id: t.game.id,
    map: t.game.map,
    start_s: t.game.start_s,
    side: t.side,
    opponent: teamName(t.game, otherSide(t.side)),
    winner: t.game.winner,
    final_capture: t.capture,
    kills: sums.kills,
    deaths: sums.deaths,
    kd: sums.kd,
    duels_won: sums.duels_won,
    duels_lost: sums.duels_lost,
    duels_other: sums.duels_other,
    gadget_uses: sums.gadget_uses,
    gadget_possible: sums.gadget_possible,
    point_changes: t.changes,
    rating: t.rating,
    has_stats: t.rows.some((r) => r.stats),
  };
}

function teamRow(key: string, parts: TeamGame[]) {
  const rows = parts.flatMap((p) => p.rows);
  const captured = parts.filter((p) => p.capture !== null);
  return {
    key,
    name: commonName(parts.map((p) => p.name)) ?? key,
    games: new Set(parts.map((p) => p.game.id)).size,
    maps: uniqueMaps(parts.map((p) => p.game.map)),
    ...tally(rows),
    games_with_stats: parts.filter((p) => p.rows.some((r) => r.stats)).length,
    point_changes: parts.reduce((s, p) => s + p.changes, 0),
    rating: meanRating(parts.map((p) => p.rating)),
    final_capture_avg: { own: mean(captured.map((p) => p.capture?.own ?? null)), opponent: mean(captured.map((p) => p.capture?.opponent ?? null)) },
  };
}

/**
 * GET /api/stats/teams-summary?map=&team=&games= : un résumé par équipe (nom normalisé de games.team_a et team_b), sur toutes ses games, toutes cartes si `map` est absent.
 * Kills et morts = somme des joueurs du côté. `team` : une seule équipe et son détail game par game (`per_game`). `winner` est repris tel quel (vide le plus souvent) : aucune victoire n'est déduite.
 */
export function teamsSummary(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const scope = readScope(query, false);
  if ('error' in scope) return fail(scope.error);
  const teamKey = scope.team === null ? null : nameKey(scope.team);

  const inScope = scopedGames(ctx, scope);
  const ids = new Set(inScope.map((g) => g.id));
  const people = appearances(ctx, inScope);
  const stats = loadStats(ctx, ids);
  const captures = lastCaptures(ctx, ids);
  const ratings = loadRatings(ctx, ids);

  const byTeam = new Map<string, TeamGame[]>();
  for (const game of inScope) {
    for (const side of ['A', 'B'] as const) {
      const name = teamName(game, side);
      const key = nameKey(name);
      if (key === '' || (teamKey !== null && key !== teamKey)) continue;
      // Les joueurs du côté : ceux qui ont un pseudo, plus ceux qui n'ont qu'une ligne de bilan (le bilan ne dépend pas du pseudo).
      const named = people.filter((a) => a.game.id === game.id && a.side === side);
      const bare = [1, 2, 3, 4].map((i) => (side === 'A' ? i : i + 4)).filter((slot) => stats.has(`${game.id}|${slot}`) && !named.some((a) => a.slot === slot));
      const rows = [...named, ...bare.map((slot): Appearance => ({ game, slot, side, name: '', team: name, stats: stats.get(`${game.id}|${slot}`) ?? null, killScore: null, deathScore: null, rating: null }))];
      const cap = captures.get(game.id);
      const capture: Pct | null = cap && (cap[side] !== null || cap[otherSide(side)] !== null) ? { own: cap[side], opponent: cap[otherSide(side)] } : null;
      const part: TeamGame = { game, side, name: name ?? '', rows, changes: pointChanges(ctx, game.id, game.map), capture,
        rating: teamRatingOfGame([1, 2, 3, 4].map((i) => ratings.get(`${game.id}|${side === 'A' ? i : i + 4}`) ?? null)) };
      byTeam.set(key, [...(byTeam.get(key) ?? []), part]);
    }
  }
  const teams = [...byTeam.entries()].map(([key, parts]) => teamRow(key, parts)).sort((a, b) => (b.kills ?? -1) - (a.kills ?? -1) || a.key.localeCompare(b.key));
  const body: Record<string, unknown> = { scope: { map: scope.map }, games: teamKey === null ? inScope.length : new Set((byTeam.get(teamKey) ?? []).map((p) => p.game.id)).size, min: TEAM_MIN_GAMES, teams };
  if (teamKey !== null) body.per_game = (byTeam.get(teamKey) ?? []).map(perGameOfTeam).sort((a, b) => a.game_id - b.game_id);
  return reply(200, body);
}
