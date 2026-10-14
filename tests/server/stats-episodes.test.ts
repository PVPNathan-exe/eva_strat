import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, type ApiContext } from '../../server/api.ts';
import { insertVideo, testContext } from './helpers.ts';

const q = (s = '') => new URLSearchParams(s);
const get = (ctx: ApiContext, path: string, query = '') => handleApi(ctx, 'GET', path, q(query), undefined);
const put = (ctx: ApiContext, path: string, body: unknown) => handleApi(ctx, 'PUT', path, q(), body);
const errorOf = (res: { json: unknown }) => (res.json as { error: string }).error;

function insertGame(ctx: ApiContext, map: string, teamA: string | null = null, teamB: string | null = null): number {
  const videoId = insertVideo(ctx);
  const r = ctx.db
    .prepare('INSERT INTO games (video_id, start_s, end_s, map, team_a, team_b) VALUES (?, 0, 600, ?, ?, ?)')
    .run(videoId, map, teamA, teamB);
  return Number(r.lastInsertRowid);
}

type EpisodeRow = {
  id: number;
  game_id: number;
  kind: string;
  point: string | null;
  point_to: string | null;
  team: string | null;
  t0: number;
  t1: number;
  outcome: string | null;
  data: Record<string, unknown> | null;
  verdict: string | null;
};

/** Insère un épisode synthétique et renvoie son id. */
function episode(
  ctx: ApiContext,
  game: number,
  kind: string,
  t0: number,
  team: string | null,
  data: string | null = null,
  extra: { point?: string | null; point_to?: string | null; outcome?: string | null; verdict?: string | null } = {},
): number {
  const r = ctx.db
    .prepare('INSERT INTO episodes (game_id, kind, point, point_to, team, t0, t1, outcome, data, verdict) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(game, kind, extra.point ?? 'A', extra.point_to ?? null, team, t0, t0 + 30, extra.outcome ?? null, data, extra.verdict ?? null);
  return Number(r.lastInsertRowid);
}

test('owners : périodes d\'une game dans l\'ordre point puis temps, une autre game ignorée', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  const other = insertGame(ctx, 'Polaris');
  const ins = ctx.db.prepare('INSERT INTO point_owner (game_id, point, t0, t1, owner, source) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run(g, 'B', 0, 40, 'none', null);
  ins.run(g, 'A', 50, 120, 'B', 'box');
  ins.run(g, 'A', 0, 50, 'A', 'score');
  ins.run(other, 'A', 0, 10, 'A', 'box');
  const res = get(ctx, '/api/stats/owners', `game=${g}`);
  assert.equal(res.status, 200);
  const rows = res.json as { point: string; t0: number; t1: number; owner: string; source: string | null }[];
  assert.deepEqual(rows.map((r) => [r.point, r.t0, r.t1, r.owner, r.source]), [['A', 0, 50, 'A', 'score'], ['A', 50, 120, 'B', 'box'], ['B', 0, 40, 'none', null]]);
  assert.deepEqual(get(ctx, '/api/stats/owners', 'game=99999').json, []);
});

test('owners : game manquante ou invalide, 400 clair', () => {
  const ctx = testContext();
  for (const query of ['', 'game=', 'game=abc', 'game=1.5', 'game=0', 'game=-3']) {
    const res = get(ctx, '/api/stats/owners', query);
    assert.equal(res.status, 400, query);
    assert.match(errorOf(res), /game/);
  }
});

test('episodes : liste d\'une game, data décodé, ordre du temps, champs conformes au type Episode', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  const other = insertGame(ctx, 'Polaris');
  episode(ctx, g, 'rotation', 90, 'B', '{"from":"A","to":"B"}', { point: 'A', point_to: 'B', outcome: 'success' });
  episode(ctx, g, 'retake', 30, 'A', '{"players":[1,2],"first_death":{"slot":2,"t":41.5}}', { outcome: 'fail', verdict: 'ko' });
  episode(ctx, other, 'retake', 10, 'A');
  const res = get(ctx, '/api/stats/episodes', `game=${g}`);
  assert.equal(res.status, 200);
  const rows = res.json as EpisodeRow[];
  assert.deepEqual(rows.map((r) => [r.kind, r.t0, r.t1, r.team]), [['retake', 30, 60, 'A'], ['rotation', 90, 120, 'B']]);
  assert.deepEqual(rows[0].data, { players: [1, 2], first_death: { slot: 2, t: 41.5 } });
  assert.equal(rows[0].verdict, 'ko');
  assert.equal(rows[0].outcome, 'fail');
  assert.equal(rows[0].point_to, null);
  assert.deepEqual(rows[1].data, { from: 'A', to: 'B' });
  assert.equal(rows[1].point_to, 'B');
  assert.deepEqual(Object.keys(rows[0]).sort(), ['data', 'game_id', 'id', 'kind', 'outcome', 'point', 'point_to', 't0', 't1', 'team', 'verdict']);
});

test('episodes : data vide, illisible ou pas un objet donne null sans faire échouer la liste', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  episode(ctx, g, 'retake', 1, 'A', null);
  episode(ctx, g, 'retake', 2, 'A', '{pas du json');
  episode(ctx, g, 'retake', 3, 'A', '[1,2]');
  episode(ctx, g, 'retake', 4, 'A', '"texte"');
  const rows = get(ctx, '/api/stats/episodes', `game=${g}`).json as EpisodeRow[];
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.data), [null, null, null, null]);
});

test('episodes : filtres kind et team sur une game', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  episode(ctx, g, 'retake', 10, 'A');
  episode(ctx, g, 'retake', 20, 'B');
  episode(ctx, g, 'rotation', 30, 'A');
  const ids = (query: string) => (get(ctx, '/api/stats/episodes', query).json as EpisodeRow[]).map((r) => [r.kind, r.team]);
  assert.deepEqual(ids(`game=${g}&kind=retake`), [['retake', 'A'], ['retake', 'B']]);
  assert.deepEqual(ids(`game=${g}&team=A`), [['retake', 'A'], ['rotation', 'A']]);
  assert.deepEqual(ids(`game=${g}&kind=rotation&team=B`), []);
});

test('episodes : par carte et type, sur plusieurs games, games des autres cartes ignorées', () => {
  const ctx = testContext();
  const p1 = insertGame(ctx, 'Polaris');
  const p2 = insertGame(ctx, 'Polaris');
  const r1 = insertGame(ctx, 'Reef Point');
  episode(ctx, p2, 'retake', 5, 'B');
  episode(ctx, p1, 'retake', 50, 'A');
  episode(ctx, p1, 'retake', 20, 'B');
  episode(ctx, p1, 'rotation', 10, 'A');
  episode(ctx, r1, 'retake', 1, 'A');
  const res = get(ctx, '/api/stats/episodes', 'map=Polaris&kind=retake');
  assert.equal(res.status, 200);
  assert.deepEqual((res.json as EpisodeRow[]).map((r) => [r.game_id, r.t0]), [[p1, 20], [p1, 50], [p2, 5]]);
  const teamA = get(ctx, '/api/stats/episodes', 'map=Polaris&kind=retake&team=A').json as EpisodeRow[];
  assert.deepEqual(teamA.map((r) => [r.game_id, r.t0]), [[p1, 50]]);
  assert.deepEqual(get(ctx, '/api/stats/episodes', 'map=Inconnue&kind=retake').json, []);
});

test('episodes : paramètres invalides, 400 clair', () => {
  const ctx = testContext();
  const bad = (query: string, motif: RegExp) => {
    const res = get(ctx, '/api/stats/episodes', query);
    assert.equal(res.status, 400, query);
    assert.match(errorOf(res), motif, query);
  };
  bad('', /game ou map/);
  bad('game=', /game/);
  bad('game=abc', /game/);
  bad('game=0', /game/);
  bad('game=1.5', /game/);
  bad('game=1&map=Polaris', /incompatibles/);
  bad('map=Polaris', /kind/);
  bad('map=', /map/);
  bad('map=Polaris&kind=autre', /kind/);
  bad('game=1&kind=', /kind/);
  bad('game=1&team=C', /team/);
  bad('game=1&team=', /team/);
  bad(`map=${'x'.repeat(65)}&kind=retake`, /map/);
});

test('verdict : ok, ko puis retour à null, l\'épisode à jour est renvoyé avec data décodé', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  const id = episode(ctx, g, 'retake', 30, 'A', '{"a":1}');
  episode(ctx, g, 'retake', 60, 'B');
  const ok = put(ctx, `/api/stats/episodes/${id}`, { verdict: 'ok' });
  assert.equal(ok.status, 200);
  assert.equal((ok.json as EpisodeRow).verdict, 'ok');
  assert.deepEqual((ok.json as EpisodeRow).data, { a: 1 });
  assert.equal((put(ctx, `/api/stats/episodes/${id}`, { verdict: 'ko' }).json as EpisodeRow).verdict, 'ko');
  const rows = get(ctx, '/api/stats/episodes', `game=${g}`).json as EpisodeRow[];
  assert.deepEqual(rows.map((r) => r.verdict), ['ko', null]);
  assert.equal((put(ctx, `/api/stats/episodes/${id}`, { verdict: null }).json as EpisodeRow).verdict, null);
  const after = ctx.db.prepare('SELECT verdict FROM episodes WHERE id = ?').get(id) as { verdict: string | null };
  assert.equal(after.verdict, null);
});

test('verdict : le PUT ne change aucune autre colonne ni les autres épisodes', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  const id = episode(ctx, g, 'rotation', 30, 'A', '{"x":2}', { point: 'A', point_to: 'B', outcome: 'success' });
  const other = episode(ctx, g, 'retake', 90, 'B', null, { verdict: 'ok' });
  const before = ctx.db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as Record<string, unknown>;
  put(ctx, `/api/stats/episodes/${id}`, { verdict: 'ko' });
  const after = ctx.db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as Record<string, unknown>;
  assert.deepEqual({ ...after, verdict: null }, { ...before, verdict: null });
  assert.equal((ctx.db.prepare('SELECT verdict FROM episodes WHERE id = ?').get(other) as { verdict: string }).verdict, 'ok');
});

test('verdict : épisode inconnu, 404 ; identifiant invalide, 400', () => {
  const ctx = testContext();
  const res = put(ctx, '/api/stats/episodes/777', { verdict: 'ok' });
  assert.equal(res.status, 404);
  assert.match(errorOf(res), /777/);
  for (const id of ['abc', '0', '-1', '1.5', '01', '1e3', '99999999999999999999']) {
    const bad = put(ctx, `/api/stats/episodes/${id}`, { verdict: 'ok' });
    assert.equal(bad.status, 400, id);
    assert.match(errorOf(bad), /Identifiant/, id);
  }
});

test('verdict : corps invalide, 400 clair, rien n\'est écrit', () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Polaris');
  const id = episode(ctx, g, 'retake', 30, 'A', null, { verdict: 'ok' });
  const bad = (body: unknown, motif: RegExp) => {
    const res = put(ctx, `/api/stats/episodes/${id}`, body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(errorOf(res), motif, JSON.stringify(body));
  };
  bad(undefined, /Corps/);
  bad(null, /Corps/);
  bad('ok', /Corps/);
  bad([], /Corps/);
  bad({}, /verdict/);
  bad({ verdict: 'ok', t0: 5 }, /seul/);
  bad({ verdict: 'ok', id: 3 }, /seul/);
  bad({ t0: 5 }, /seul/);
  bad({ verdict: 'oui' }, /verdict invalide/);
  bad({ verdict: 'OK' }, /verdict invalide/);
  bad({ verdict: '' }, /verdict invalide/);
  bad({ verdict: 1 }, /verdict invalide/);
  bad({ verdict: true }, /verdict invalide/);
  bad({ verdict: undefined }, /verdict invalide/);
  const row = ctx.db.prepare('SELECT verdict FROM episodes WHERE id = ?').get(id) as { verdict: string };
  assert.equal(row.verdict, 'ok');
});

test('routes épisodes : méthodes refusées en 405', () => {
  const ctx = testContext();
  assert.equal(handleApi(ctx, 'POST', '/api/stats/episodes', q('game=1'), {}).status, 405);
  assert.equal(handleApi(ctx, 'PUT', '/api/stats/episodes', q('game=1'), { verdict: 'ok' }).status, 405);
  assert.equal(handleApi(ctx, 'PUT', '/api/stats/owners', q('game=1'), {}).status, 405);
  assert.equal(handleApi(ctx, 'PUT', '/api/stats/teams', q('map=Polaris&team=X'), {}).status, 405);
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal(handleApi(ctx, method, '/api/stats/episodes/1', q(), { verdict: 'ok' }).status, 405, method);
  }
  assert.equal(handleApi(ctx, 'PUT', '/api/stats/episodes/1/extra', q(), { verdict: 'ok' }).status, 501);
});

test('teams : nombre de games de l\'équipe sur la carte (côté A ou B), seuil min 5, conforme à TeamAggregate', () => {
  const ctx = testContext();
  insertGame(ctx, 'Polaris', 'NCT', 'SNV');
  insertGame(ctx, 'Polaris', 'SNV', 'NCT');
  insertGame(ctx, 'Polaris', 'SNV', 'ABC');
  insertGame(ctx, 'Reef Point', 'NCT', 'SNV');
  insertGame(ctx, 'Polaris', null, null);
  const res = get(ctx, '/api/stats/teams', 'map=Polaris&team=NCT');
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { team: 'NCT', map: 'Polaris', games: 2, min: 5 });
  assert.deepEqual(get(ctx, '/api/stats/teams', 'map=Polaris&team=SNV').json, { team: 'SNV', map: 'Polaris', games: 3, min: 5 });
  assert.deepEqual(get(ctx, '/api/stats/teams', 'map=Polaris&team=Inconnue').json, { team: 'Inconnue', map: 'Polaris', games: 0, min: 5 });
});

test('teams : paramètres manquants ou trop longs, 400 clair', () => {
  const ctx = testContext();
  const bad = (query: string, motif: RegExp) => {
    const res = get(ctx, '/api/stats/teams', query);
    assert.equal(res.status, 400, query);
    assert.match(errorOf(res), motif, query);
  };
  bad('', /map/);
  bad('team=NCT', /map/);
  bad('map=Polaris', /team/);
  bad('map=Polaris&team=', /team/);
  bad(`map=${'x'.repeat(65)}&team=NCT`, /map/);
  bad(`map=Polaris&team=${'x'.repeat(61)}`, /team/);
});

test("active : périodes du point actif d'une game, une autre game ignorée", () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Outlaw');
  const other = insertGame(ctx, 'Outlaw');
  const ins = ctx.db.prepare('INSERT INTO point_active (game_id, point, t0, t1, source) VALUES (?, ?, ?, ?, ?)');
  ins.run(g, 'A', 90, 150, 'hud');
  ins.run(g, 'C', 0, 90, 'hud');
  ins.run(other, 'B', 0, 10, 'box');
  const res = get(ctx, '/api/stats/active', `game=${g}`);
  assert.equal(res.status, 200);
  assert.deepEqual((res.json as { point: string }[]).map((x) => x.point), ['C', 'A']);
  assert.equal(get(ctx, '/api/stats/active', '').status, 400);
});

test("levels : niveau des joueurs d'une game, une autre game ignorée", () => {
  const ctx = testContext();
  const g = insertGame(ctx, 'Atlantis');
  const other = insertGame(ctx, 'Atlantis');
  const ins = ctx.db.prepare('INSERT INTO player_levels (game_id, slot, t0, t1, level, source) VALUES (?, ?, ?, ?, ?, ?)');
  ins.run(g, 5, 180, 240, 'etage', 'tp');
  ins.run(g, 5, 0, 180, 'dessous', 'default');
  ins.run(other, 1, 0, 10, 'dessous', 'default');
  const res = get(ctx, '/api/stats/levels', `game=${g}`);
  assert.equal(res.status, 200);
  assert.deepEqual((res.json as { level: string }[]).map((x) => x.level), ['dessous', 'etage']);
  assert.equal(get(ctx, '/api/stats/levels', '').status, 400);
});
