// Routes /api/stats/gadgets, duels, kill-scores, player-stats et game-summary : les tables Stats 2 d'UNE game (gadget_state, duels, kill_scores, player_game_stats) et leur récap. Lecture seule.
// Temps en secondes depuis le début de la game. Ce fichier porte aussi les petits outils partagés avec statsTeam.ts (réponses, nom d'équipe, pas d'image, cases, décompte des vagues).

import type { ApiContext, ApiResult } from './api.ts';
import { TEAM_MIN_GAMES } from './statsEpisodes.ts';
import { gameParam } from './statsOwners.ts';

export const reply = (status: number, json: unknown): ApiResult => ({ status, json });
export const fail = (error: string, status = 400): ApiResult => reply(status, { error });

export type Row = Record<string, unknown>;
export type Cell = [number, number, number];

/** Cartes sans changement de point (plan Stats 2, section 2) : aucune rotation, aucun calendrier. */
const NO_CHANGE_MAPS = ['engine', 'helios station'];
export { TEAM_MIN_GAMES };

/** Nom comparé sans majuscules, accents ni espaces en trop : reprend `nameKey` de src/lib/teamFollow.ts. */
export function nameKey(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Clé d'identité d'un joueur : le pseudo normalisé, avec les caractères que la lecture du texte confond ramenés à un seul (5 et S, 0 et O, 1 I et L, 8 et B, 2 et Z) : « SNVXGLEN5 » et « SNVXGLENS » sont le même joueur. */
export function playerIdentity(name: string | null | undefined): string {
  return nameKey(name).replace(/s/g, '5').replace(/o/g, '0').replace(/[il]/g, '1').replace(/b/g, '8').replace(/z/g, '2');
}

/** Équipe d'un numéro de joueur : 1 à 4 = A (gauche, orange), 5 à 8 = B (droite, bleue). */
export const teamOfSlot = (slot: number): 'A' | 'B' => (slot <= 4 ? 'A' : 'B');

/** Vrai si la carte n'a aucun changement de point (Engine, Helios Station). */
export const hasNoPointChange = (map: string | null): boolean => NO_CHANGE_MAPS.includes(nameKey(map));

/** Décode une colonne JSON ; null si vide ou illisible. */
export function decodeJson(raw: unknown): unknown {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const objectOrNull = (v: unknown): Record<string, unknown> | null => (isObj(v) ? v : null);

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Pas réel entre deux images d'une game (médiane des écarts de `samples.t`), 0 si moins de deux instants (même calcul que statsPresence.ts). */
export function frameStep(ctx: ApiContext, gameId: number): number {
  const diffs = `SELECT t - LAG(t) OVER (ORDER BY t) AS d FROM (SELECT DISTINCT t FROM samples WHERE game_id = ?)`;
  const count = ctx.db.prepare(`SELECT COUNT(*) AS c FROM (${diffs}) WHERE d > 0`).get(gameId) as { c: number };
  if (count.c === 0) return 0;
  const mid = ctx.db.prepare(`SELECT d FROM (${diffs}) WHERE d > 0 ORDER BY d LIMIT 1 OFFSET ?`).get(gameId, Math.floor(count.c / 2)) as { d: number };
  return mid.d;
}

/** Expression SQL de la case (0 .. n-1) d'une coordonnée normalisée ; une position pile sur le bord 1 tombe dans la dernière case. */
export const cellExpr = (col: string, n: number): string => `MAX(0, MIN(${n - 1}, CAST(${col} * ${n} AS INTEGER)))`;

/** Case d'une position normalisée en JavaScript (même règle que cellExpr). */
export const cellKey = (x: number, y: number, n: number): number => {
  const c = (v: number) => Math.max(0, Math.min(n - 1, Math.trunc(v * n)));
  return c(y) * n + c(x);
};

/** Cumul de valeurs par case (clé = ligne * n + colonne). */
export class Grid {
  private readonly map = new Map<number, number>();
  private readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
  add(key: number, value: number): void {
    this.map.set(key, (this.map.get(key) ?? 0) + value);
  }
  addPoint(x: number, y: number, value = 1): void {
    this.add(cellKey(x, y, this.n), value);
  }
  /** [colonne, ligne, valeur], cases vides omises, dans l'ordre ligne puis colonne. */
  cells(): Cell[] {
    return [...this.map.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]): Cell => [k % this.n, Math.floor(k / this.n), round3(v)]);
  }
  total(): number {
    let s = 0;
    for (const v of this.map.values()) s += v;
    return round3(s);
  }
}

/** Lit ?games= (identifiants séparés par des virgules, facultatif) : null si absent, un message d'erreur si invalide. */
export function gamesParam(query: URLSearchParams, max = 200): number[] | null | string {
  const raw = query.get('games');
  if (raw === null || raw.trim() === '') return null;
  const parts = raw.split(',').map((s) => s.trim());
  if (parts.length > max) return `Paramètre games invalide : ${max} games au plus`;
  const ids: number[] = [];
  for (const p of parts) {
    const id = Number(p);
    if (p === '' || !Number.isInteger(id) || id < 1) return 'Paramètre games invalide : des identifiants entiers positifs séparés par des virgules sont attendus';
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Décompte des vagues (issues des épisodes de retake), partagé par team-summary et global.

/** Issues qui entrent dans le taux de retake réussi (comme src/lib/waveOutcome.ts : success sur success + fail + won_no_capture). */
const RATE_ISSUES = ['success', 'fail', 'won_no_capture'];

export interface WaveTally {
  /** Vagues comptées (ligne avec `data.wave`, verdict différent de « faux »). */
  waves: number;
  /** Nombre de vagues par issue brute. */
  counts: Record<string, number>;
  /** Vagues décidées = success + fail + won_no_capture. */
  decided: number;
  /** success / decided, null si aucune vague décidée. */
  rate: number | null;
}

/** Compteur d'issues de vagues. */
export class TallyBuilder {
  private waves = 0;
  private readonly counts: Record<string, number> = {};
  add(outcome: string | null): void {
    const key = outcome ?? 'unknown';
    this.waves++;
    this.counts[key] = (this.counts[key] ?? 0) + 1;
  }
  build(): WaveTally {
    const decided = RATE_ISSUES.reduce((s, k) => s + (this.counts[k] ?? 0), 0);
    return { waves: this.waves, counts: { ...this.counts }, decided, rate: decided > 0 ? round3((this.counts.success ?? 0) / decided) : null };
  }
}

/** Vague d'un épisode de retake, ou null si la ligne vient de l'ancien calcul (sans `data.wave`) ou si l'utilisateur l'a jugée fausse : jamais comptée. */
export function countedWave(row: Row): Record<string, unknown> | null {
  if (row.verdict === 'ko') return null;
  const data = objectOrNull(decodeJson(row.data));
  return data ? objectOrNull(data.wave) : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Lignes brutes d'une game

/** Les périodes d'état du gadget d'une game : [{ game_id, slot, t0, t1, gadget, state }], dans l'ordre joueur puis temps. */
export function listGadgets(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = gameParam(query);
  if (typeof gameId === 'string') return fail(gameId);
  const rows = ctx.db.prepare('SELECT game_id, slot, t0, t1, gadget, state FROM gadget_state WHERE game_id = ? ORDER BY slot, t0').all(gameId);
  return reply(200, rows);
}

/** Les duels d'une game, dans l'ordre du temps : [{ id, game_id, t0, t1, slot_a, slot_b, winner_slot, outcome, data }] (data décodé, null si absent). */
export function listDuels(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = gameParam(query);
  if (typeof gameId === 'string') return fail(gameId);
  const rows = ctx.db
    .prepare('SELECT id, game_id, t0, t1, slot_a, slot_b, winner_slot, outcome, data FROM duels WHERE game_id = ? ORDER BY t0, id')
    .all(gameId) as Row[];
  return reply(200, rows.map((r) => ({ ...r, data: objectOrNull(decodeJson(r.data)) })));
}

/** Raisons d'une note : tableau de textes, null si absent ou illisible. */
function decodeReasons(raw: unknown): string[] | null {
  const v = decodeJson(raw);
  return Array.isArray(v) ? v.map((x) => String(x)) : null;
}

/** Les notes de kill d'une game, dans l'ordre du temps : [{ game_id, t, killer_slot, victim_slot, impact, reasons, death_impact }] (impact du point de vue de l'équipe du tueur, death_impact : note de la mort du point de vue de la victime, null pour l'ancien calcul où elle valait -impact ; reasons décodé). */
export function listKillScores(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = gameParam(query);
  if (typeof gameId === 'string') return fail(gameId);
  const rows = ctx.db
    .prepare('SELECT game_id, t, killer_slot, victim_slot, impact, reasons, death_impact FROM kill_scores WHERE game_id = ? ORDER BY t, victim_slot')
    .all(gameId) as Row[];
  return reply(200, rows.map((r) => ({ ...r, reasons: decodeReasons(r.reasons) })));
}

const STATS_COLUMNS =
  'game_id, slot, kills, deaths, alive_s, dist_m, v_mean, v_p98, v_max, gadget_uses, gadget_unused_at_death, gadget_possible, duels_won, duels_lost, duels_other';

/** Le bilan de chaque joueur d'une game (table player_game_stats), dans l'ordre des numéros de joueur. */
export function listPlayerStats(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = gameParam(query);
  if (typeof gameId === 'string') return fail(gameId);
  const rows = ctx.db.prepare(`SELECT ${STATS_COLUMNS} FROM player_game_stats WHERE game_id = ? ORDER BY slot`).all(gameId);
  return reply(200, rows);
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Récap d'une game

interface Note {
  t: number;
  /** Autre joueur du kill : la victime pour une note de kill, le tueur pour une note de mort (null : mort sans tueur). */
  other_slot: number | null;
  /** Du point de vue du joueur : celui de la table pour le tueur, l'opposé pour la victime (convention). */
  impact: number;
  reasons: string[] | null;
}

const sum = (values: (number | null)[]): number | null => {
  const real = values.filter((v): v is number => v !== null);
  return real.length === 0 ? null : round3(real.reduce((a, b) => a + b, 0));
};
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);

/** Nombre de changements de point : le point actif change entre deux périodes qui se suivent (une période du même point que la précédente, par exemple le point resté allumé sur le HUD d'Outlaw, n'est pas un changement). 0 pour Engine et Helios Station. */
export function pointChanges(ctx: ApiContext, gameId: number, map: string | null): number {
  if (hasNoPointChange(map)) return 0;
  const rows = ctx.db.prepare('SELECT point FROM point_active WHERE game_id = ? ORDER BY t0, point').all(gameId) as { point: string }[];
  let changes = 0;
  rows.forEach((row, i) => {
    if (i > 0 && row.point !== rows[i - 1].point) changes += 1;
  });
  return changes;
}

/**
 * GET /api/stats/game-summary?game= : le récap d'une game. Par joueur : les colonnes de player_game_stats, le pseudo, la somme et la liste des notes (kill_notes, death_notes).
 * Par équipe (A, B) : les totaux. Plus le nom de la carte et le nombre de changements de point. `games` vaut 1 et `min` 5 (seuil d'affichage des vues multi-games).
 * Game inconnue : 404.
 */
export function gameSummary(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const gameId = gameParam(query);
  if (typeof gameId === 'string') return fail(gameId);
  const game = ctx.db.prepare('SELECT id, map, team_a, team_b, start_s, end_s FROM games WHERE id = ?').get(gameId) as Row | undefined;
  if (!game) return fail(`Game ${gameId} introuvable`, 404);

  const stats = new Map<number, Row>();
  for (const r of ctx.db.prepare(`SELECT ${STATS_COLUMNS} FROM player_game_stats WHERE game_id = ?`).all(gameId) as Row[]) stats.set(Number(r.slot), r);
  const names = new Map<number, string>();
  for (const r of ctx.db.prepare('SELECT slot, name FROM players WHERE game_id = ?').all(gameId) as { slot: number; name: string }[]) names.set(r.slot, r.name);

  const killNotes = new Map<number, Note[]>();
  const deathNotes = new Map<number, Note[]>();
  const push = (m: Map<number, Note[]>, slot: number, note: Note) => m.set(slot, [...(m.get(slot) ?? []), note]);
  const scores = ctx.db
    .prepare('SELECT t, killer_slot, victim_slot, impact, reasons, death_impact FROM kill_scores WHERE game_id = ? ORDER BY t, victim_slot')
    .all(gameId) as Row[];
  for (const s of scores) {
    const reasons = decodeReasons(s.reasons);
    const impact = Number(s.impact);
    const killer = num(s.killer_slot);
    const victim = Number(s.victim_slot);
    if (killer !== null) push(killNotes, killer, { t: Number(s.t), other_slot: victim, impact, reasons });
    // Note de la mort : celle de la colonne death_impact (règle du 17/10/2026, indépendante de celle du kill) ; ancien calcul sans elle : l'opposé de la note du kill
    const deathImpact = num(s.death_impact);
    push(deathNotes, victim, { t: Number(s.t), other_slot: killer, impact: deathImpact ?? -impact, reasons });
  }

  const slots = [...new Set([...stats.keys(), ...names.keys(), ...killNotes.keys(), ...deathNotes.keys()])].sort((a, b) => a - b);
  const players = slots.map((slot) => {
    const kn = killNotes.get(slot) ?? [];
    const dn = deathNotes.get(slot) ?? [];
    const killSum = round3(kn.reduce((a, n) => a + n.impact, 0));
    const deathSum = round3(dn.reduce((a, n) => a + n.impact, 0));
    return {
      ...(stats.get(slot) ?? { game_id: gameId, slot }),
      team: teamOfSlot(slot),
      name: names.get(slot) ?? null,
      has_stats: stats.has(slot),
      kill_score_sum: killSum,
      death_score_sum: deathSum,
      score_sum: round3(killSum + deathSum),
      kill_notes: kn,
      death_notes: dn,
    };
  });

  const total = (team: 'A' | 'B') => {
    const mine = players.filter((p) => p.team === team);
    const col = (k: string) => mine.map((p) => num((p as Row)[k]));
    return {
      kills: sum(col('kills')),
      deaths: sum(col('deaths')),
      gadget_uses: sum(col('gadget_uses')),
      gadget_unused_at_death: sum(col('gadget_unused_at_death')),
      // Total des possibles : seulement si TOUS les joueurs de l'équipe ont une valeur (jamais de somme partielle, elle ferait passer les utilisés au-dessus des possibles)
      gadget_possible: col('gadget_possible').every((v) => v !== null) ? sum(col('gadget_possible')) : null,
      duels_won: sum(col('duels_won')),
      duels_lost: sum(col('duels_lost')),
      duels_other: sum(col('duels_other')),
      kill_score_sum: round3(mine.reduce((a, p) => a + p.kill_score_sum, 0)),
      death_score_sum: round3(mine.reduce((a, p) => a + p.death_score_sum, 0)),
    };
  };

  return reply(200, {
    game: { id: gameId, map: game.map, team_a: game.team_a, team_b: game.team_b, start_s: game.start_s, end_s: game.end_s, duration_s: round3(Number(game.end_s) - Number(game.start_s)) },
    map: game.map,
    point_changes: pointChanges(ctx, gameId, game.map as string | null),
    players,
    teams: { A: total('A'), B: total('B') },
    games: 1,
    min: TEAM_MIN_GAMES,
  });
}
