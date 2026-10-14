import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, type ApiContext } from '../../server/api.ts';
import { insertVideo, testContext } from './helpers.ts';

const q = (s = '') => new URLSearchParams(s);
const get = (ctx: ApiContext, path: string, query = '') => handleApi(ctx, 'GET', path, q(query), undefined);

function insertGame(ctx: ApiContext, map: string): number {
  const videoId = insertVideo(ctx);
  const r = ctx.db.prepare('INSERT INTO games (video_id, start_s, end_s, map) VALUES (?, 0, 600, ?)').run(videoId, map);
  return Number(r.lastInsertRowid);
}

/** Une ligne de suivi synthétique : image `frame` à l'instant `t`. */
function sample(ctx: ApiContext, game: number, frame: number, t: number, slot: number, x: number | null, y: number | null, alive = 1): void {
  ctx.db
    .prepare('INSERT INTO samples (game_id, frame, t, slot, team, x, y, alive) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(game, frame, t, slot, slot <= 4 ? 'A' : 'B', x, y, alive);
}

type Cells = [number, number, number][];
const body = (res: { json: unknown }) => res.json as { n: number; games: number; cells: Cells };

// Game 1 (Polaris), pas de 0,5 s, grille n = 4 : case = partie entière de position x 4.
// Joueur 1 vivant : (0,1 ; 0,1) aux images 0 et 1, puis (0,6 ; 0,1) à l'image 2. Joueur 5 vivant en (0,9 ; 0,9) aux images 0 à 2.
// Image 3 : joueur 1 mort (ignoré), joueur 5 sans position (ignoré). Image 4 : joueur 5 en (1,0 ; 1,0), pile sur le bord.
function sampleGame(ctx: ApiContext): number {
  const g = insertGame(ctx, 'Polaris');
  sample(ctx, g, 0, 0, 1, 0.1, 0.1);
  sample(ctx, g, 0, 0, 5, 0.9, 0.9);
  sample(ctx, g, 1, 0.5, 1, 0.1, 0.1);
  sample(ctx, g, 1, 0.5, 5, 0.9, 0.9);
  sample(ctx, g, 2, 1.0, 1, 0.6, 0.1);
  sample(ctx, g, 2, 1.0, 5, 0.9, 0.9);
  sample(ctx, g, 3, 1.5, 1, 0.6, 0.1, 0);
  sample(ctx, g, 3, 1.5, 5, null, null);
  sample(ctx, g, 4, 2.0, 1, 0.6, 0.1, 0);
  sample(ctx, g, 4, 2.0, 5, 1.0, 1.0);
  return g;
}

test('presence : agrégat exact à la main (lignes vivantes x pas réel)', () => {
  const ctx = testContext();
  const g = sampleGame(ctx);
  const res = get(ctx, '/api/stats/presence', `map=Polaris&games=${g}&n=4`);
  assert.equal(res.status, 200);
  // Case (0,0) : 2 lignes x 0,5 = 1 s ; case (2,0) : 1 x 0,5 ; case (3,3) : 3 lignes (0,9) + 1 (1,0 borné) = 4 x 0,5 = 2 s.
  assert.deepEqual(body(res), { n: 4, games: 1, cells: [[0, 0, 1], [2, 0, 0.5], [3, 3, 2]] });
});

test('presence : filtre par équipe et par joueur', () => {
  const ctx = testContext();
  const g = sampleGame(ctx);
  const a = body(get(ctx, '/api/stats/presence', `map=Polaris&games=${g}&n=4&team=A`));
  assert.deepEqual(a.cells, [[0, 0, 1], [2, 0, 0.5]]);
  const b = body(get(ctx, '/api/stats/presence', `map=Polaris&games=${g}&n=4&team=B`));
  assert.deepEqual(b.cells, [[3, 3, 2]]);
  const s5 = body(get(ctx, '/api/stats/presence', `map=Polaris&games=${g}&n=4&slot=5`));
  assert.deepEqual(s5.cells, [[3, 3, 2]]);
  const s1 = body(get(ctx, '/api/stats/presence', `map=Polaris&games=${g}&n=4&slot=1&team=A`));
  assert.deepEqual(s1.cells, [[0, 0, 1], [2, 0, 0.5]]);
});

test('presence : plusieurs games, chacune avec son propre pas, et les games d\'une autre carte sont ignorées', () => {
  const ctx = testContext();
  const g1 = sampleGame(ctx);
  // Game 2 : pas de 0,25 s, joueur 2 vivant 4 images en (0,1 ; 0,1) : 4 x 0,25 = 1 s de plus dans la case (0,0).
  const g2 = insertGame(ctx, 'Polaris');
  for (let i = 0; i < 4; i++) sample(ctx, g2, i, i * 0.25, 2, 0.1, 0.1);
  // Game 3 : autre carte, même contenu : ne doit pas compter.
  const g3 = insertGame(ctx, 'Reef Point');
  for (let i = 0; i < 4; i++) sample(ctx, g3, i, i * 0.25, 2, 0.1, 0.1);
  const res = body(get(ctx, '/api/stats/presence', `map=Polaris&games=${g1},${g2},${g3},${g1}&n=4`));
  assert.equal(res.games, 2);
  assert.deepEqual(res.cells, [[0, 0, 2], [2, 0, 0.5], [3, 3, 2]]);
});

test('presence : le pas est la médiane des écarts, un trou dans la vidéo ne le change pas', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  // Instants 0, 0,5, 1, 1,5 puis un trou jusqu'à 9 : écarts 0,5 ; 0,5 ; 0,5 ; 7,5 : médiane 0,5.
  [0, 0.5, 1, 1.5, 9].forEach((t, i) => sample(ctx, g, i, t, 3, 0.4, 0.4));
  const res = body(get(ctx, '/api/stats/presence', `map=Polaris&games=${g}&n=2`));
  assert.deepEqual(res.cells, [[0, 0, 2.5]]);
});

test('presence : une game sans suivi donne une grille vide, n par défaut 64', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  const res = body(get(ctx, '/api/stats/presence', `map=Polaris&games=${g}`));
  assert.deepEqual(res, { n: 64, games: 0, cells: [] });
});

test('presence : paramètres invalides, 400 clair', () => {
  const ctx = testContext();
  const g = sampleGame(ctx);
  const bad = (query: string, motif: RegExp) => {
    const res = get(ctx, '/api/stats/presence', query);
    assert.equal(res.status, 400, query);
    assert.match((res.json as { error: string }).error, motif, query);
  };
  bad(`games=${g}`, /map/);
  bad('map=Polaris', /games/);
  bad('map=Polaris&games=', /games/);
  bad('map=Polaris&games=1,abc', /games/);
  bad('map=Polaris&games=1,,2', /games/);
  bad('map=Polaris&games=0', /games/);
  bad('map=Polaris&games=1.5', /games/);
  bad(`map=Polaris&games=${Array.from({ length: 51 }, (_, i) => i + 1).join(',')}`, /games/);
  bad(`map=Polaris&games=${g}&n=1`, /n invalide/);
  bad(`map=Polaris&games=${g}&n=257`, /n invalide/);
  bad(`map=Polaris&games=${g}&n=abc`, /n invalide/);
  bad(`map=Polaris&games=${g}&n=`, /n invalide/);
  bad(`map=Polaris&games=${g}&team=C`, /team/);
  bad(`map=Polaris&games=${g}&slot=9`, /slot/);
  bad(`map=Polaris&games=${g}&slot=0`, /slot/);
  bad(`map=Polaris&games=${g}&slot=x`, /slot/);
  bad(`map=Polaris&games=${g}&slot=5&team=A`, /incohérents/);
  bad(`map=${'x'.repeat(65)}&games=${g}`, /map/);
});

test('lives : vies d\'une game dans l\'ordre joueur puis apparition', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  const other = insertGame(ctx, 'Polaris');
  const ins = ctx.db.prepare(
    'INSERT INTO lives (game_id, slot, idx, t0, t1, x0, y0, x1, y1, ended, killer_slot, weapon, kill_kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  ins.run(g, 6, 0, 0, 40, 0.8, 0.5, 0.6, 0.4, 'death', 2, 'AR', 'weapon');
  ins.run(g, 2, 1, 60, 100, 0.2, 0.5, null, null, 'end', null, null, null);
  ins.run(g, 2, 0, 0, 50, 0.2, 0.5, 0.3, 0.3, 'death', 6, null, null);
  ins.run(other, 1, 0, 0, 10, 0.1, 0.1, 0.1, 0.1, 'end', null, null, null);
  const res = get(ctx, '/api/stats/lives', `game=${g}`);
  assert.equal(res.status, 200);
  const rows = res.json as { slot: number; idx: number; ended: string; killer_slot: number | null; x1: number | null }[];
  assert.deepEqual(rows.map((r) => [r.slot, r.idx, r.ended]), [[2, 0, 'death'], [2, 1, 'end'], [6, 0, 'death']]);
  assert.equal(rows[0].killer_slot, 6);
  assert.equal(rows[1].x1, null);
  assert.deepEqual(get(ctx, '/api/stats/lives', 'game=99999').json, []);
});

test('links : liens d\'une game dans l\'ordre du temps', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  const ins = ctx.db.prepare('INSERT INTO kill_links (game_id, t, victim_slot, kind, other_slot, dt, dist_m) VALUES (?, ?, ?, ?, ?, ?, ?)');
  ins.run(g, 80, 3, 'revenge', 4, 2.5, 6.1);
  ins.run(g, 30, 7, 'trade', 1, 0.4, 3.2);
  ins.run(g, 30, 1, 'trade', 7, 0.4, 3.2);
  const res = get(ctx, '/api/stats/links', `game=${g}`);
  assert.equal(res.status, 200);
  const rows = res.json as { t: number; victim_slot: number; kind: string }[];
  assert.deepEqual(rows.map((r) => [r.t, r.victim_slot, r.kind]), [[30, 1, 'trade'], [30, 7, 'trade'], [80, 3, 'revenge']]);
});

test('lives et links : paramètre game manquant ou invalide, 400 clair', () => {
  const ctx = testContext();
  for (const path of ['/api/stats/lives', '/api/stats/links']) {
    for (const query of ['', 'game=', 'game=abc', 'game=1.5', 'game=0', 'game=-3']) {
      const res = get(ctx, path, query);
      assert.equal(res.status, 400, `${path}?${query}`);
      assert.match((res.json as { error: string }).error, /game/);
    }
  }
});

test('routes Stats : méthode autre que GET refusée, route pas encore branchée en 501', () => {
  const ctx = testContext();
  assert.equal(handleApi(ctx, 'POST', '/api/stats/lives', q('game=1'), {}).status, 405);
  assert.equal(handleApi(ctx, 'PUT', '/api/stats/presence', q(), {}).status, 405);
  assert.equal(get(ctx, '/api/stats/owners', 'game=1').status, 501);
});
