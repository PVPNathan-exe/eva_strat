// Routes /api/stats/team-summary (une équipe suivie par son NOM sur une carte) et /api/stats/global (toutes les équipes d'une carte) : grilles de morts, de kills, de présence et de duels,
// totaux de player_game_stats et issues des vagues. Agrégé en SQL par case (n sur n, 32 par défaut), lecture seule. Chaque réponse porte `games` (nombre de games) et `min` (5) : l'interface masque sous le seuil.
// Côté : « left » = équipe A (joueurs 1 à 4, orange), « right » = équipe B (joueurs 5 à 8, bleue). samples.t est en temps de VIDÉO : on retire games.start_s pour comparer aux tables Stats (secondes de game).

import type { ApiContext, ApiResult } from './api.ts';
import {
  type Cell,
  type Row,
  type WaveTally,
  cellExpr,
  countedWave,
  fail,
  frameStep,
  gamesParam,
  Grid,
  nameKey,
  playerIdentity,
  reply,
  TallyBuilder,
  TEAM_MIN_GAMES,
} from './statsGame.ts';

const N_DEFAULT = 32;
const N_MIN = 2;
const N_MAX = 256;
const MAP_MAX = 64;
const TEAM_MAX = 60;

type Side = 'A' | 'B';
type SideName = 'left' | 'right';
const SIDE_NAME: Record<Side, SideName> = { A: 'left', B: 'right' };
const slotRange = (side: Side): [number, number] => (side === 'A' ? [1, 4] : [5, 8]);

/** Lit ?n= (taille de la grille) : entier de 2 à 256, 32 par défaut ; message d'erreur si invalide. */
function gridSize(query: URLSearchParams): number | string {
  const raw = query.get('n');
  if (raw === null) return N_DEFAULT;
  const n = Number(raw);
  if (raw.trim() === '' || !Number.isInteger(n) || n < N_MIN || n > N_MAX) return `Paramètre n invalide : un entier de ${N_MIN} à ${N_MAX} est attendu`;
  return n;
}

/** Lit ?map= : nom non vide et pas trop long. */
function mapParam(query: URLSearchParams): string | { error: string } {
  const map = (query.get('map') ?? '').trim();
  if (map === '') return { error: 'Paramètre map manquant' };
  if (map.length > MAP_MAX) return { error: 'Paramètre map invalide : nom de carte trop long' };
  return map;
}

interface GameRow {
  id: number;
  start_s: number;
  team_a: string | null;
  team_b: string | null;
}

/** Les games d'une carte (restreintes à `only` si donné), dans l'ordre des identifiants. */
function gamesOfMap(ctx: ApiContext, map: string, only: number[] | null): GameRow[] {
  const rows = ctx.db.prepare('SELECT id, start_s, team_a, team_b FROM games WHERE map = ? ORDER BY id').all(map) as unknown as GameRow[];
  return only === null ? rows : rows.filter((g) => only.includes(g.id));
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Cumul d'un côté

interface PlayerAcc {
  name: string;
  side: SideName;
  games: Set<number>;
  presence: Grid;
  seconds: number;
  duels: { won: number; lost: number; other: number };
}

/** Tout ce qu'on cumule pour un camp (une équipe suivie, ou le côté gauche ou droit de toutes les games). */
class SideAcc {
  readonly deaths: Grid;
  readonly kills: Grid;
  readonly presence: Grid;
  /** Présence séparée selon le côté de la game où le camp jouait. */
  readonly presenceBySide: Record<SideName, Grid>;
  readonly duelWon: Grid;
  readonly duelLost: Grid;
  readonly tally: TallyBuilder;
  readonly bySpeed: Map<string, TallyBuilder>;
  readonly bySize: Map<string, TallyBuilder>;
  readonly players = new Map<string, PlayerAcc>();
  readonly duelCount = { won: 0, lost: 0, other: 0 };
  readonly totals = { kills: 0, deaths: 0, gadget_uses: 0, gadget_unused_at_death: 0, gadget_possible: 0 };
  private readonly seen = { stats: 0, gadget: 0, possible: 0 };
  private possibleIncomplete = false; // un joueur sans délai de gadget établi : le total des possibles n'est pas donné (pas de somme partielle)
  games = 0;
  /** `shared` : compteurs de vagues communs à plusieurs camps (global), sinon propres à ce camp. */
  constructor(n: number, shared?: { tally: TallyBuilder; bySpeed: Map<string, TallyBuilder>; bySize: Map<string, TallyBuilder> }) {
    this.tally = shared?.tally ?? new TallyBuilder();
    this.bySpeed = shared?.bySpeed ?? new Map();
    this.bySize = shared?.bySize ?? new Map();
    this.presenceBySide = { left: new Grid(n), right: new Grid(n) };
    this.deaths = new Grid(n);
    this.kills = new Grid(n);
    this.presence = new Grid(n);
    this.duelWon = new Grid(n);
    this.duelLost = new Grid(n);
  }
  /** Sommes de player_game_stats ; les colonnes de gadget restent null tant qu'aucune game n'en a une valeur. */
  addStats(r: Row): void {
    if (Number(r.players) === 0) return;
    this.seen.stats++;
    this.totals.kills += Number(r.kills ?? 0);
    this.totals.deaths += Number(r.deaths ?? 0);
    if (r.gadget_uses !== null) {
      this.seen.gadget++;
      this.totals.gadget_uses += Number(r.gadget_uses);
      this.totals.gadget_unused_at_death += Number(r.gadget_unused_at_death ?? 0);
    }
    if (Number(r.possible_players ?? 0) < Number(r.players)) this.possibleIncomplete = true;
    if (r.gadget_possible !== null) {
      this.seen.possible++;
      this.totals.gadget_possible += Number(r.gadget_possible);
    }
  }
  statsJson() {
    return {
      games_with_stats: this.seen.stats,
      kills: this.seen.stats > 0 ? this.totals.kills : null,
      deaths: this.seen.stats > 0 ? this.totals.deaths : null,
      gadget_uses: this.seen.gadget > 0 ? this.totals.gadget_uses : null,
      gadget_unused_at_death: this.seen.gadget > 0 ? this.totals.gadget_unused_at_death : null,
      gadget_possible: this.seen.possible > 0 && !this.possibleIncomplete ? Math.round(this.totals.gadget_possible * 1000) / 1000 : null,
    };
  }
}

function builder(map: Map<string, TallyBuilder>, key: string): TallyBuilder {
  let b = map.get(key);
  if (!b) map.set(key, (b = new TallyBuilder()));
  return b;
}

const tallies = (map: Map<string, TallyBuilder>): Record<string, WaveTally> => Object.fromEntries([...map.entries()].sort().map(([k, b]) => [k, b.build()]));

/** Position vivante d'un joueur dans une fenêtre de la game (le dernier échantillon), null si aucune. Le temps de la vidéo = start_s + temps de game. */
function positionIn(ctx: ApiContext, gameId: number, slot: number, from: number, to: number): [number, number] | null {
  const r = ctx.db
    .prepare('SELECT x, y FROM samples WHERE game_id = ? AND slot = ? AND alive = 1 AND x IS NOT NULL AND y IS NOT NULL AND t BETWEEN ? AND ? ORDER BY t DESC LIMIT 1')
    .get(gameId, slot, from, to) as { x: number; y: number } | undefined;
  return r ? [r.x, r.y] : null;
}

/** Cumule les cases (SQL) d'une requête qui rend ix, iy, v. */
function addCells(grid: Grid, rows: { ix: number; iy: number; v: number }[], n: number, scale = 1): void {
  for (const r of rows) grid.add(r.iy * n + r.ix, r.v * scale);
}

/** Cumule dans `acc` ce que fait un camp (A ou B) dans une game. `withPlayers` : détail par joueur (équipe suivie). */
function gatherSide(ctx: ApiContext, g: GameRow, side: Side, n: number, acc: SideAcc, withPlayers: boolean): void {
  const [lo, hi] = slotRange(side);
  const sideName = SIDE_NAME[side];
  acc.games++;

  const names = playerNames(ctx, g.id);

  // Totaux de player_game_stats
  acc.addStats(
    ctx.db
      .prepare(
        `SELECT COUNT(*) AS players, SUM(kills) AS kills, SUM(deaths) AS deaths, SUM(gadget_uses) AS gadget_uses, SUM(gadget_unused_at_death) AS gadget_unused_at_death, SUM(gadget_possible) AS gadget_possible, COUNT(gadget_possible) AS possible_players
         FROM player_game_stats WHERE game_id = ? AND slot BETWEEN ? AND ?`,
      )
      .get(g.id, lo, hi) as Row,
  );

  // Morts de l'équipe, et kills de l'équipe (= lieu de mort des victimes qu'elle a tuées), d'après les positions de mort de `lives`
  const cellOf = `${cellExpr('x1', n)} AS ix, ${cellExpr('y1', n)} AS iy, COUNT(*) AS v`;
  const deathRows = ctx.db
    .prepare(`SELECT ${cellOf} FROM lives WHERE game_id = ? AND ended = 'death' AND x1 IS NOT NULL AND y1 IS NOT NULL AND slot BETWEEN ? AND ? GROUP BY ix, iy`)
    .all(g.id, lo, hi) as { ix: number; iy: number; v: number }[];
  addCells(acc.deaths, deathRows, n);
  const killRows = ctx.db
    .prepare(`SELECT ${cellOf} FROM lives WHERE game_id = ? AND ended = 'death' AND x1 IS NOT NULL AND y1 IS NOT NULL AND killer_slot BETWEEN ? AND ? GROUP BY ix, iy`)
    .all(g.id, lo, hi) as { ix: number; iy: number; v: number }[];
  addCells(acc.kills, killRows, n);

  // Présence : temps vivant par case et par joueur
  const step = frameStep(ctx, g.id);
  if (step > 0) {
    const rows = ctx.db
      .prepare(`SELECT slot, ${cellExpr('x', n)} AS ix, ${cellExpr('y', n)} AS iy, COUNT(*) AS v FROM samples WHERE game_id = ? AND alive = 1 AND x IS NOT NULL AND y IS NOT NULL AND slot BETWEEN ? AND ? GROUP BY slot, ix, iy`)
      .all(g.id, lo, hi) as { slot: number; ix: number; iy: number; v: number }[];
    for (const r of rows) {
      acc.presence.add(r.iy * n + r.ix, r.v * step);
      acc.presenceBySide[sideName].add(r.iy * n + r.ix, r.v * step);
      if (!withPlayers) continue;
      const p = playerAcc(acc, names.get(r.slot) ?? `Joueur ${r.slot}`, sideName, n);
      p.games.add(g.id);
      p.presence.add(r.iy * n + r.ix, r.v * step);
      p.seconds += r.v * step;
    }
  }

  // Duels : lieu de la victoire et de la défaite, totaux par joueur
  const duels = ctx.db.prepare('SELECT t0, t1, slot_a, slot_b, winner_slot FROM duels WHERE game_id = ?').all(g.id) as Row[];
  for (const d of duels) {
    const a = Number(d.slot_a);
    const b = Number(d.slot_b);
    const winner = d.winner_slot === null ? null : Number(d.winner_slot);
    const mine = [a, b].filter((s) => s >= lo && s <= hi);
    if (mine.length === 0) continue;
    const window: [number, number] = [g.start_s + Number(d.t0), g.start_s + Number(d.t1) + 0.5];
    for (const slot of mine) {
      const outcome = winner === null ? 'other' : winner === slot ? 'won' : 'lost';
      acc.duelCount[outcome]++;
      if (withPlayers) {
        const p = playerAcc(acc, names.get(slot) ?? `Joueur ${slot}`, sideName, n);
        p.games.add(g.id);
        p.duels[outcome]++;
      }
      if (outcome === 'other') continue;
      const pos = positionIn(ctx, g.id, slot, window[0], window[1]);
      if (pos) (outcome === 'won' ? acc.duelWon : acc.duelLost).addPoint(pos[0], pos[1]);
    }
  }

  // Vagues de cette équipe (ancien calcul et vagues jugées fausses écartés)
  const eps = ctx.db.prepare(`SELECT outcome, data, verdict FROM episodes WHERE game_id = ? AND kind = 'retake' AND team = ?`).all(g.id, side) as Row[];
  for (const e of eps) {
    const wave = countedWave(e);
    if (!wave) continue;
    const outcome = typeof e.outcome === 'string' ? e.outcome : null;
    acc.tally.add(outcome);
    builder(acc.bySpeed, typeof wave.speed === 'string' ? wave.speed : 'none').add(outcome);
    builder(acc.bySize, wave.size === null || wave.size === undefined ? 'unknown' : String(wave.size)).add(outcome);
  }
}

/** Pseudos des joueurs d'une game, par numéro. */
function playerNames(ctx: ApiContext, gameId: number): Map<number, string> {
  const m = new Map<number, string>();
  for (const r of ctx.db.prepare('SELECT slot, name FROM players WHERE game_id = ?').all(gameId) as { slot: number; name: string }[]) m.set(r.slot, r.name);
  return m;
}

/** Le cumul d'un joueur (pseudo normalisé + côté) dans `acc`, créé au besoin. */
function playerAcc(acc: SideAcc, name: string, side: SideName, n: number): PlayerAcc {
  const key = `${side}|${playerIdentity(name)}`;
  let p = acc.players.get(key);
  if (!p) acc.players.set(key, (p = { name, side, games: new Set(), presence: new Grid(n), seconds: 0, duels: { won: 0, lost: 0, other: 0 } }));
  return p;
}

const playersJson = (acc: SideAcc) =>
  [...acc.players.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, p]) => ({
      key: key.split('|')[1],
      name: p.name,
      side: p.side,
      games: p.games.size,
      seconds: Math.round(p.seconds * 1000) / 1000,
      duels_won: p.duels.won,
      duels_lost: p.duels.lost,
      duels_other: p.duels.other,
      cells: p.presence.cells(),
    }));

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Routes

/**
 * GET /api/stats/team-summary?map=&team=&games=&side=&n= : l'équipe suivie par son NOM (games.team_a ou team_b, comparaison sans casse ni accents) sur une carte.
 * `side` (both, left, right) garde les games où elle joue de ce côté. Réponse : { team, map, side, n, games, game_ids, min, stats (sommes de player_game_stats), duels {won,lost,other},
 * death_grid, kill_grid, presence {left, right} (cases [colonne, ligne, valeur]), duel_won_grid, duel_lost_grid (lieu du perdant ou du gagnant), players (présence et duels par pseudo et par côté), outcomes (vagues) }.
 */
export function teamSummary(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const map = mapParam(query);
  if (typeof map !== 'string') return fail(map.error);
  const team = (query.get('team') ?? '').trim();
  if (team === '') return fail("Paramètre team manquant : le nom de l'équipe est attendu");
  if (team.length > TEAM_MAX) return fail("Paramètre team invalide : nom d'équipe trop long");
  const side = query.get('side') ?? 'both';
  if (side !== 'both' && side !== 'left' && side !== 'right') return fail('Paramètre side invalide : both, left ou right attendu');
  const n = gridSize(query);
  if (typeof n === 'string') return fail(n);
  const only = gamesParam(query);
  if (typeof only === 'string') return fail(only);

  const key = nameKey(team);
  const acc = new SideAcc(n);
  const ids: number[] = [];
  let label = team;
  for (const g of gamesOfMap(ctx, map, only)) {
    const mine: Side | null = nameKey(g.team_a) === key ? 'A' : nameKey(g.team_b) === key ? 'B' : null;
    if (mine === null || (side === 'left' && mine !== 'A') || (side === 'right' && mine !== 'B')) continue;
    if (ids.length === 0) label = (mine === 'A' ? g.team_a : g.team_b) ?? team;
    ids.push(g.id);
    gatherSide(ctx, g, mine, n, acc, true);
  }
  return reply(200, {
    team: label,
    map,
    side,
    n,
    games: ids.length,
    game_ids: ids,
    min: TEAM_MIN_GAMES,
    stats: acc.statsJson(),
    duels: acc.duelCount,
    death_grid: acc.deaths.cells(),
    kill_grid: acc.kills.cells(),
    presence: { left: acc.presenceBySide.left.cells(), right: acc.presenceBySide.right.cells() },
    duel_won_grid: acc.duelWon.cells(),
    duel_lost_grid: acc.duelLost.cells(),
    players: playersJson(acc),
    outcomes: { ...acc.tally.build(), by_speed: tallies(acc.bySpeed), by_size: tallies(acc.bySize) },
  });
}

/** Les grilles d'un côté pour la réponse de global. */
const sideJson = (acc: SideAcc) => ({
  stats: acc.statsJson(),
  duels: acc.duelCount,
  death_grid: acc.deaths.cells() as Cell[],
  kill_grid: acc.kills.cells() as Cell[],
  presence: acc.presence.cells() as Cell[],
  duel_won_grid: acc.duelWon.cells() as Cell[],
  duel_lost_grid: acc.duelLost.cells() as Cell[],
});

/**
 * GET /api/stats/global?map=&games=&n= : toutes les équipes d'une carte, côté gauche (A) et côté droit (B) séparés, ce qui montre quelles positions et quelles issues réussissent le mieux.
 * Réponse : { map, n, games, game_ids, min, left, right, outcomes } ; left et right ont les mêmes champs que team-summary (sans players) ;
 * outcomes cumule les deux côtés : { waves, counts, decided, rate, by_speed, by_size }, rate = success / (success + fail + won_no_capture).
 */
export function globalSummary(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const map = mapParam(query);
  if (typeof map !== 'string') return fail(map.error);
  const n = gridSize(query);
  if (typeof n === 'string') return fail(n);
  const only = gamesParam(query);
  if (typeof only === 'string') return fail(only);

  const shared = { tally: new TallyBuilder(), bySpeed: new Map<string, TallyBuilder>(), bySize: new Map<string, TallyBuilder>() };
  const a = new SideAcc(n, shared);
  const b = new SideAcc(n, shared);
  const ids: number[] = [];
  for (const g of gamesOfMap(ctx, map, only)) {
    ids.push(g.id);
    gatherSide(ctx, g, 'A', n, a, false);
    gatherSide(ctx, g, 'B', n, b, false);
  }
  return reply(200, {
    map,
    n,
    games: ids.length,
    game_ids: ids,
    min: TEAM_MIN_GAMES,
    left: sideJson(a),
    right: sideJson(b),
    outcomes: { ...shared.tally.build(), by_speed: tallies(shared.bySpeed), by_size: tallies(shared.bySize) },
  });
}
