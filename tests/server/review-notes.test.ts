import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApiContext } from '../../server/api.ts';
import { handleReviewNotes } from '../../server/reviewNotes.ts';
import { insertVideo, testContext } from './helpers.ts';

const q = (s = '') => new URLSearchParams(s);
const call = (ctx: ApiContext, method: string, path: string, body?: unknown, query = '') => {
  const res = handleReviewNotes(ctx, method, path, q(query), body);
  assert.ok(res, `route non reconnue : ${method} ${path}`);
  return res;
};
const errorOf = (res: { json: unknown }) => (res.json as { error: string }).error;

type Note = {
  id: number;
  game_id: number;
  t: number;
  slot: number | null;
  kind: string;
  x: number | null;
  y: number | null;
  angle: number | null;
  gadget: string | null;
  text: string;
  created_at: string;
};

function insertGame(ctx: ApiContext): number {
  const videoId = insertVideo(ctx);
  const r = ctx.db.prepare("INSERT INTO games (video_id, start_s, end_s, map) VALUES (?, 0, 600, 'Polaris')").run(videoId);
  return Number(r.lastInsertRowid);
}

const position = (g: number, extra: Record<string, unknown> = {}) => ({ game_id: g, kind: 'position', t: 30, slot: 2, x: 0.4, y: 0.5, angle: 90, text: 'trop avancé', ...extra });

test('un chemin qui n\'est pas /api/review-notes renvoie null', () => {
  const ctx = testContext();
  assert.equal(handleReviewNotes(ctx, 'GET', '/api/comments', q()), null);
  assert.equal(handleReviewNotes(ctx, 'GET', '/api/review-notesX', q()), null);
});

test('création de chaque kind : la note créée revient avec id et created_at', () => {
  const ctx = testContext();
  const g = insertGame(ctx);
  const p = call(ctx, 'POST', '/api/review-notes', position(g));
  assert.equal(p.status, 201);
  const pn = p.json as Note;
  assert.equal(pn.kind, 'position');
  assert.equal(pn.slot, 2);
  assert.equal(pn.angle, 90);
  assert.equal(pn.gadget, null);
  assert.ok(pn.id > 0 && pn.created_at);
  const a = call(ctx, 'POST', '/api/review-notes', { game_id: g, kind: 'action', t: 41.5, slot: 3, x: 0.3, y: 0.7, gadget: 'DX3', text: '' });
  assert.equal(a.status, 201);
  assert.equal((a.json as Note).gadget, 'DX3');
  const n = call(ctx, 'POST', '/api/review-notes', { game_id: g, kind: 'note', t: 5, text: '  rotation trop tardive  ' });
  assert.equal(n.status, 201);
  const nn = n.json as Note;
  assert.equal(nn.text, 'rotation trop tardive');
  assert.equal(nn.slot, null);
  assert.equal(nn.x, null);
});

test('refus des cas invalides, rien n\'est écrit', () => {
  const ctx = testContext();
  const g = insertGame(ctx);
  const bad = (body: unknown, status: number, part: string) => {
    const res = call(ctx, 'POST', '/api/review-notes', body);
    assert.equal(res.status, status, part);
    assert.match(errorOf(res), new RegExp(part));
  };
  bad(position(g, { game_id: 9999 }), 404, 'Game inconnue');
  bad(position(g, { game_id: 'a' }), 400, 'Game invalide');
  bad(position(g, { kind: 'autre' }), 400, 'Type de note inconnu');
  bad(position(g, { t: -1 }), 400, 'instant');
  bad(position(g, { t: Infinity }), 400, 'instant');
  bad(position(g, { t: '3' }), 400, 'instant');
  bad(position(g, { x: 1.3 }), 400, 'x doit être');
  bad(position(g, { y: -0.3 }), 400, 'y doit être');
  bad(position(g, { x: 'a' }), 400, 'x doit être');
  bad(position(g, { angle: 'est' }), 400, 'angle');
  bad(position(g, { slot: 0 }), 400, 'slot');
  bad(position(g, { slot: 9 }), 400, 'slot');
  bad(position(g, { slot: 1.5 }), 400, 'slot');
  bad(position(g, { text: 'a'.repeat(2001) }), 400, '2000');
  bad(position(g, { slot: null }), 400, 'exige le joueur');
  bad(position(g, { x: null }), 400, 'exige le joueur');
  bad({ game_id: g, kind: 'action', t: 1, slot: 1, x: 0.5, y: 0.5 }, 400, 'gadget');
  bad({ game_id: g, kind: 'note', t: 1, text: '   ' }, 400, 'exige un texte');
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM review_notes').get()!.n, 0);
  // limites acceptées
  assert.equal(call(ctx, 'POST', '/api/review-notes', position(g, { x: -0.2, y: 1.2, text: 'a'.repeat(2000) })).status, 201);
});

test('liste d\'une game triée par t puis id, autre game ignorée, paramètre obligatoire', () => {
  const ctx = testContext();
  const g = insertGame(ctx);
  const other = insertGame(ctx);
  const add = (game: number, t: number, text: string) =>
    (call(ctx, 'POST', '/api/review-notes', { game_id: game, kind: 'note', t, text }).json as Note).id;
  const late = add(g, 50, 'tard');
  const first = add(g, 10, 'tôt a');
  const second = add(g, 10, 'tôt b');
  add(other, 1, 'ailleurs');
  const res = call(ctx, 'GET', '/api/review-notes', undefined, `game=${g}`);
  assert.equal(res.status, 200);
  assert.deepEqual((res.json as Note[]).map((r) => r.id), [first, second, late]);
  assert.equal(call(ctx, 'GET', '/api/review-notes').status, 400);
  assert.deepEqual(call(ctx, 'GET', '/api/review-notes', undefined, `game=${g + 100}`).json, []);
});

test('PUT modifie les champs, garde le kind, valide comme à la création', () => {
  const ctx = testContext();
  const g = insertGame(ctx);
  const id = (call(ctx, 'POST', '/api/review-notes', position(g)).json as Note).id;
  const res = call(ctx, 'PUT', `/api/review-notes/${id}`, { t: 31, slot: 5, x: 0.6, text: 'plutôt ici', angle: null });
  assert.equal(res.status, 200);
  const n = res.json as Note;
  assert.deepEqual([n.t, n.slot, n.x, n.y, n.angle, n.text, n.kind], [31, 5, 0.6, 0.5, null, 'plutôt ici', 'position']);
  assert.equal(call(ctx, 'PUT', `/api/review-notes/${id}`, { kind: 'note' }).status, 400);
  assert.equal(call(ctx, 'PUT', `/api/review-notes/${id}`, { kind: 'position', t: 32 }).status, 200);
  assert.equal(call(ctx, 'PUT', `/api/review-notes/${id}`, { x: 5 }).status, 400);
  assert.equal(call(ctx, 'PUT', `/api/review-notes/${id}`, { slot: null }).status, 400);
  assert.equal(call(ctx, 'PUT', `/api/review-notes/${id}`, { t: -2 }).status, 400);
  const stored = ctx.db.prepare('SELECT t, slot, x FROM review_notes WHERE id = ?').get(id) as { t: number; slot: number; x: number };
  assert.deepEqual({ ...stored }, { t: 32, slot: 5, x: 0.6 });
  assert.equal(call(ctx, 'PUT', '/api/review-notes/999', { t: 1 }).status, 404);
});

test('DELETE supprime la note, 404 si l\'id est inconnu', () => {
  const ctx = testContext();
  const g = insertGame(ctx);
  const id = (call(ctx, 'POST', '/api/review-notes', position(g)).json as Note).id;
  assert.equal(call(ctx, 'DELETE', `/api/review-notes/${id}`).status, 200);
  assert.equal(call(ctx, 'DELETE', `/api/review-notes/${id}`).status, 404);
  assert.deepEqual(call(ctx, 'GET', '/api/review-notes', undefined, `game=${g}`).json, []);
});

test('méthode non permise : 405 ; route inconnue sous le préfixe : 404', () => {
  const ctx = testContext();
  const g = insertGame(ctx);
  const id = (call(ctx, 'POST', '/api/review-notes', position(g)).json as Note).id;
  assert.equal(call(ctx, 'DELETE', '/api/review-notes').status, 405);
  assert.equal(call(ctx, 'PATCH', '/api/review-notes').status, 405);
  assert.equal(call(ctx, 'GET', `/api/review-notes/${id}`).status, 405);
  assert.equal(call(ctx, 'POST', `/api/review-notes/${id}`, {}).status, 405);
  assert.match(errorOf(call(ctx, 'PATCH', `/api/review-notes/${id}`)), /non permise/);
  assert.equal(call(ctx, 'GET', '/api/review-notes/abc').status, 404);
});

test('les notes ne touchent à aucune autre table', () => {
  const ctx = testContext();
  const g = insertGame(ctx);
  const count = (t: string) => (ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  const before = ['user_marks', 'comments', 'samples', 'episodes'].map(count);
  call(ctx, 'POST', '/api/review-notes', position(g));
  assert.deepEqual(['user_marks', 'comments', 'samples', 'episodes'].map(count), before);
});

test('une action SHIELD ou CLONE exige un deuxième point (trait du shield, direction et distance du clone), les autres gadgets non', () => {
  const ctx = testContext();
  const game = insertGame(ctx);
  const post = (body: Record<string, unknown>) => handleReviewNotes(ctx, 'POST', '/api/review-notes', new URLSearchParams(), { game_id: game, t: 10, kind: 'action', slot: 3, x: 0.4, y: 0.5, text: '', ...body })!;
  assert.equal(post({ gadget: 'SHIELD' }).status, 400);
  assert.match(String((post({ gadget: 'shield' }).json as { error: string }).error), /deuxième point/);
  assert.equal(post({ gadget: 'CLONE', x2: 0.5 }).status, 400, 'x2 sans y2 refusé');
  const ok = post({ gadget: 'SHIELD', x2: 0.45, y2: 0.52 });
  assert.equal(ok.status, 201);
  assert.deepEqual([(ok.json as { x2: number }).x2, (ok.json as { y2: number }).y2], [0.45, 0.52]);
  assert.equal(post({ gadget: 'CLONE', x2: 0.6, y2: 0.5 }).status, 201);
  assert.equal(post({ gadget: 'STICKY' }).status, 201, 'le STICKY se pose avec un seul point');
  assert.equal(post({ gadget: 'SHIELD', x2: 2, y2: 0.5 }).status, 400, 'hors de la minimap');
});
