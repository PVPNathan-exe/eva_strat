import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handlePatchNotes } from '../../server/patchNotes.ts';

const entry = (slug: string, reviewed: boolean) => ({ slug, title: slug, date: '2026-10-20', url: `https://blog.eva.gg/en/${slug}`, excerpts: ['STICKY cooldown 20'], reviewed });

function context(patches?: unknown[]) {
  const dataDir = mkdtempSync(join(tmpdir(), 'eva-patchroute-'));
  if (patches) {
    mkdirSync(join(dataDir, 'patch_notes'));
    writeFileSync(join(dataDir, 'patch_notes', 'index.json'), JSON.stringify({ patches }));
  }
  return { dataDir };
}

test('hors /api/patch-notes : null', () => {
  assert.equal(handlePatchNotes(context(), 'GET', '/api/stats/lives'), null);
  assert.equal(handlePatchNotes(context(), 'GET', '/api/patch-notes/a/b'), null);
});

test('GET : liste vide sans fichier, sinon seulement les patchs non relus', () => {
  assert.deepEqual(handlePatchNotes(context(), 'GET', '/api/patch-notes')?.json, { patches: [] });
  const res = handlePatchNotes(context([entry('a', false), entry('b', true)]), 'GET', '/api/patch-notes');
  assert.equal(res?.status, 200);
  assert.deepEqual((res?.json as { patches: { slug: string }[] }).patches.map((p) => p.slug), ['a']);
});

test('GET : index illisible, liste vide', () => {
  const ctx = context();
  mkdirSync(join(ctx.dataDir, 'patch_notes'));
  writeFileSync(join(ctx.dataDir, 'patch_notes', 'index.json'), '{ pas du json');
  assert.deepEqual(handlePatchNotes(ctx, 'GET', '/api/patch-notes')?.json, { patches: [] });
});

test('PUT : marque relu et l\'écrit ; patch inconnu 404 ; corps invalide 400 ; mauvaise méthode 405', () => {
  const ctx = context([entry('a', false), entry('b', false)]);
  assert.equal(handlePatchNotes(ctx, 'PUT', '/api/patch-notes/zzz', undefined, { reviewed: true })?.status, 404);
  assert.equal(handlePatchNotes(ctx, 'PUT', '/api/patch-notes/a', undefined, { reviewed: false })?.status, 400);
  assert.equal(handlePatchNotes(ctx, 'PUT', '/api/patch-notes/a', undefined, undefined)?.status, 400);
  assert.equal(handlePatchNotes(ctx, 'POST', '/api/patch-notes/a', undefined, { reviewed: true })?.status, 405);
  assert.equal(handlePatchNotes(ctx, 'POST', '/api/patch-notes')?.status, 405);

  assert.equal(handlePatchNotes(ctx, 'PUT', '/api/patch-notes/a', undefined, { reviewed: true })?.status, 200);
  const file = JSON.parse(readFileSync(join(ctx.dataDir, 'patch_notes', 'index.json'), 'utf-8')) as { patches: { slug: string; reviewed: boolean }[] };
  assert.deepEqual(file.patches.map((p) => [p.slug, p.reviewed]), [['a', true], ['b', false]]);
  assert.deepEqual((handlePatchNotes(ctx, 'GET', '/api/patch-notes')?.json as { patches: { slug: string }[] }).patches.map((p) => p.slug), ['b']);
});
