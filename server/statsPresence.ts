// Route /api/stats/presence : temps passé par case de la minimap (grille n sur n), agrégé en SQL sur plusieurs games d'une même carte. Lecture seule.

import type { ApiContext, ApiResult } from './api.ts';

const reply = (status: number, json: unknown): ApiResult => ({ status, json });
const fail = (error: string, status = 400): ApiResult => reply(status, { error });

const N_DEFAULT = 64;
const N_MIN = 2;
const N_MAX = 256;
const GAMES_MAX = 50;

interface Filters {
  map: string;
  games: number[];
  team: 'A' | 'B' | null;
  slot: number | null;
  n: number;
}

/** Valide les paramètres ; renvoie les filtres ou un message d'erreur en français. */
function parseFilters(query: URLSearchParams): Filters | string {
  const map = (query.get('map') ?? '').trim();
  if (map === '') return 'Paramètre map manquant';
  if (map.length > 64) return 'Paramètre map invalide : nom de carte trop long';

  const rawGames = query.get('games');
  if (rawGames === null || rawGames.trim() === '') return 'Paramètre games manquant : des identifiants de games séparés par des virgules sont attendus';
  const parts = rawGames.split(',').map((s) => s.trim());
  if (parts.length > GAMES_MAX) return `Paramètre games invalide : ${GAMES_MAX} games au plus`;
  const games: number[] = [];
  for (const p of parts) {
    const id = Number(p);
    if (p === '' || !Number.isInteger(id) || id < 1) return 'Paramètre games invalide : des identifiants entiers positifs séparés par des virgules sont attendus';
    if (!games.includes(id)) games.push(id);
  }

  const rawTeam = query.get('team');
  if (rawTeam !== null && rawTeam !== 'A' && rawTeam !== 'B') return 'Paramètre team invalide : A ou B attendu';
  const team = rawTeam as 'A' | 'B' | null;

  let slot: number | null = null;
  const rawSlot = query.get('slot');
  if (rawSlot !== null) {
    slot = Number(rawSlot);
    if (rawSlot.trim() === '' || !Number.isInteger(slot) || slot < 1 || slot > 8) return 'Paramètre slot invalide : un entier de 1 à 8 est attendu';
    if (team !== null && (slot <= 4 ? 'A' : 'B') !== team) return `Paramètres team et slot incohérents : le joueur ${slot} est de l'équipe ${slot <= 4 ? 'A' : 'B'}`;
  }

  let n = N_DEFAULT;
  const rawN = query.get('n');
  if (rawN !== null) {
    n = Number(rawN);
    if (rawN.trim() === '' || !Number.isInteger(n) || n < N_MIN || n > N_MAX) return `Paramètre n invalide : un entier de ${N_MIN} à ${N_MAX} est attendu`;
  }
  return { map, games, team, slot, n };
}

/**
 * Pas réel entre deux images d'une game, déduit des données : médiane des écarts entre instants consécutifs distincts.
 * 0 si la game a moins de deux instants (rien à compter).
 */
function frameStep(ctx: ApiContext, gameId: number): number {
  const times = `SELECT DISTINCT t FROM samples WHERE game_id = ?`;
  const diffs = `SELECT t - LAG(t) OVER (ORDER BY t) AS d FROM (${times})`;
  const count = ctx.db.prepare(`SELECT COUNT(*) AS c FROM (${diffs}) WHERE d > 0`).get(gameId) as { c: number };
  if (count.c === 0) return 0;
  const mid = ctx.db.prepare(`SELECT d FROM (${diffs}) WHERE d > 0 ORDER BY d LIMIT 1 OFFSET ?`).get(gameId, Math.floor(count.c / 2)) as { d: number };
  return mid.d;
}

/** Temps vivant par case : [colonne, ligne, secondes], cases vides omises, dans l'ordre ligne puis colonne. */
export function presence(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const f = parseFilters(query);
  if (typeof f === 'string') return fail(f);

  // Les games demandées qui ne sont pas de cette carte sont ignorées (la grille n'a de sens que sur une seule carte).
  const marks = f.games.map(() => '?').join(',');
  const found = ctx.db.prepare(`SELECT id FROM games WHERE map = ? AND id IN (${marks}) ORDER BY id`).all(f.map, ...f.games) as { id: number }[];

  // Filtre équipe ou joueur : l'équipe A est faite des joueurs 1 à 4, la B des joueurs 5 à 8.
  const where: string[] = ['game_id = ?', 'alive = 1', 'x IS NOT NULL', 'y IS NOT NULL'];
  if (f.slot !== null) where.push(`slot = ${f.slot}`);
  else if (f.team === 'A') where.push('slot BETWEEN 1 AND 4');
  else if (f.team === 'B') where.push('slot BETWEEN 5 AND 8');
  // Case = partie entière de position x n, bornée à 0 .. n-1 (une position pile sur le bord 1 tombe dans la dernière case).
  const cell = (col: string) => `MAX(0, MIN(${f.n - 1}, CAST(${col} * ${f.n} AS INTEGER)))`;
  const sql = `SELECT ${cell('x')} AS ix, ${cell('y')} AS iy, COUNT(*) AS lines FROM samples WHERE ${where.join(' AND ')} GROUP BY ix, iy`;
  const stmt = ctx.db.prepare(sql);

  const seconds = new Map<number, number>(); // clé = iy * n + ix
  let used = 0;
  for (const g of found) {
    const step = frameStep(ctx, g.id);
    if (step <= 0) continue;
    used++;
    for (const r of stmt.all(g.id) as { ix: number; iy: number; lines: number }[]) {
      const key = r.iy * f.n + r.ix;
      seconds.set(key, (seconds.get(key) ?? 0) + r.lines * step);
    }
  }
  const cells = [...seconds.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, s]): [number, number, number] => [key % f.n, Math.floor(key / f.n), Math.round(s * 1000) / 1000]);
  return reply(200, { n: f.n, games: used, cells });
}
