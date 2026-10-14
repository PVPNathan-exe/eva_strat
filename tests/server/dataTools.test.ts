import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleData, safeFolder, type DataContext } from '../../server/dataTools.ts';

// « Python » de ces tests : node lui-même, qui exécute un faux script écrit dans un dossier temporaire et renvoie la ligne de commande reçue.
function fakeContext(running = false): DataContext {
  const root = mkdtempSync(join(tmpdir(), 'eva-data-'));
  mkdirSync(join(root, 'analysis'));
  const echo = 'console.log(JSON.stringify({ args: process.argv.slice(2) }));';
  writeFileSync(join(root, 'analysis', 'data_usage.py'), echo);
  writeFileSync(join(root, 'analysis', 'data_export.py'), echo);
  return { python: process.execPath, root, dbPath: join(root, 'eva.db'), analysisRunning: () => running };
}

test('dossier : texte propre accepté, le reste refusé', () => {
  assert.equal(safeFolder('  E:\\Sauvegarde EVA '), 'E:\\Sauvegarde EVA');
  assert.equal(safeFolder(''), null);
  assert.equal(safeFolder('   '), null);
  assert.equal(safeFolder(12), null);
  assert.equal(safeFolder('a\nb'), null);
  assert.equal(safeFolder('a\0b'), null);
  assert.equal(safeFolder('x'.repeat(501)), null);
});

test('une route qui n’est pas une route de données renvoie null', async () => {
  assert.equal(await handleData(fakeContext(), 'GET', '/api/games', undefined), null);
  assert.equal(await handleData(fakeContext(), 'GET', '/api/data/inconnue', undefined), null);
});

test('export sans dossier : 400', async () => {
  const r = await handleData(fakeContext(), 'POST', '/api/data/export', {});
  assert.equal(r?.status, 400);
});

test('import refusé pendant une analyse, mais la simulation reste permise', async () => {
  const busy = fakeContext(true);
  assert.equal((await handleData(busy, 'POST', '/api/data/import', { folder: 'E:\\x' }))?.status, 409);
  assert.equal((await handleData(busy, 'POST', '/api/data/import', { folder: 'E:\\x', dryRun: true }))?.status, 200);
});

test('la ligne de commande transmise au programme Python', async () => {
  const ctx = fakeContext();
  const exported = await handleData(ctx, 'POST', '/api/data/export', { folder: 'E:\\Sauvegarde EVA' });
  assert.deepEqual((exported?.json as { args: string[] }).args, ['export', 'E:\\Sauvegarde EVA', '--db', ctx.dbPath, '--json']);
  const imported = await handleData(ctx, 'POST', '/api/data/import', { folder: 'E:\\Sauvegarde EVA', dryRun: true });
  assert.deepEqual((imported?.json as { args: string[] }).args, ['import', 'E:\\Sauvegarde EVA', '--dry-run', '--db', ctx.dbPath, '--json']);
  const usage = await handleData(ctx, 'GET', '/api/data/usage', undefined);
  assert.deepEqual((usage?.json as { args: string[] }).args, ['--db', ctx.dbPath, '--json']);
  const purge = await handleData(ctx, 'POST', '/api/data/purge-cache', {});
  assert.deepEqual((purge?.json as { args: string[] }).args, ['--purge-eval-cache', '--db', ctx.dbPath, '--json']);
});

test('une erreur annoncée par le programme Python devient une réponse 500', async () => {
  const ctx = fakeContext();
  writeFileSync(join(ctx.root, 'analysis', 'data_export.py'), "console.log(JSON.stringify({ error: 'disque plein' }));");
  const r = await handleData(ctx, 'POST', '/api/data/export', { folder: 'E:\\x' });
  assert.equal(r?.status, 500);
  assert.deepEqual(r?.json, { error: 'disque plein' });
});

test('un programme Python qui plante donne un message lisible', async () => {
  const ctx = fakeContext();
  writeFileSync(join(ctx.root, 'analysis', 'data_export.py'), 'console.error("Traceback ...\\nValueError: boum"); process.exit(1);');
  const r = await handleData(ctx, 'POST', '/api/data/export', { folder: 'E:\\x' });
  assert.equal(r?.status, 500);
  assert.equal((r?.json as { error: string }).error, 'ValueError: boum'); // dernière ligne de l'erreur Python
});
