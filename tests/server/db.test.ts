import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../server/db.ts';

const schemaPath = fileURLToPath(new URL('../../analysis/schema.sql', import.meta.url));

test('openDb applique le schéma complet', () => {
  const db = openDb(':memory:', schemaPath);
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  const names = rows.map((r) => r.name);
  for (const table of ['videos', 'games', 'calibrations', 'samples', 'capture_state']) {
    assert.ok(names.includes(table), `table manquante : ${table}`);
  }
});

test('les clés étrangères sont actives', () => {
  const db = openDb(':memory:', schemaPath);
  assert.throws(() => db.prepare('INSERT INTO games (video_id, start_s, end_s) VALUES (999, 0, 10)').run());
});
