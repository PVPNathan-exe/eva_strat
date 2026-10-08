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

test('une base créée avant les zones de pourcentage est migrée sans perdre les calibrations', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'eva-db-'));
  const path = join(dir, 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`CREATE TABLE calibrations (
    map TEXT NOT NULL,
    zone TEXT NOT NULL CHECK (zone IN ('minimap', 'capture_points', 'team_a_bar', 'team_b_bar', 'timer')),
    x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
    PRIMARY KEY (map, zone));
    INSERT INTO calibrations VALUES ('Silva', 'minimap', 0.1, 0.2, 0.3, 0.4);`);
  old.close();
  const db = openDb(path, join(process.cwd(), 'analysis', 'schema.sql'));
  assert.equal((db.prepare("SELECT x FROM calibrations WHERE map = 'Silva' AND zone = 'minimap'").get() as { x: number }).x, 0.1);
  db.prepare("INSERT INTO calibrations VALUES ('Silva', 'capture_pct_b', 0.5, 0.06, 0.05, 0.03)").run();
  db.close();
});
