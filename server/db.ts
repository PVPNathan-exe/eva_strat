// Ouverture de la base SQLite (mode WAL) et application du schéma partagé avec Python.

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function openDb(path: string, schemaPath: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(readFileSync(schemaPath, 'utf-8'));
  // Bases créées avant l'ajout de la colonne doubts.
  const columns = db.prepare('PRAGMA table_info(games)').all() as { name: string }[];
  if (!columns.some((c) => c.name === 'doubts')) db.exec('ALTER TABLE games ADD COLUMN doubts TEXT');
  if (!columns.some((c) => c.name === 'checked')) db.exec('ALTER TABLE games ADD COLUMN checked INTEGER NOT NULL DEFAULT 0');
  if (!columns.some((c) => c.name === 'team_a')) db.exec('ALTER TABLE games ADD COLUMN team_a TEXT');
  if (!columns.some((c) => c.name === 'team_b')) db.exec('ALTER TABLE games ADD COLUMN team_b TEXT');
  const killCols = db.prepare('PRAGMA table_info(kills)').all() as { name: string }[];
  if (killCols.length && !killCols.some((c) => c.name === 'headshot')) db.exec('ALTER TABLE kills ADD COLUMN headshot INTEGER NOT NULL DEFAULT 0');
  if (killCols.length && !killCols.some((c) => c.name === 'kind')) db.exec('ALTER TABLE kills ADD COLUMN kind TEXT');
  const killMeta = db.prepare('PRAGMA table_info(kills_meta)').all() as { name: string }[];
  if (killMeta.length && !killMeta.some((c) => c.name === 'revision')) db.exec('ALTER TABLE kills_meta ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
  const meta = db.prepare('PRAGMA table_info(samples_meta)').all() as { name: string }[];
  if (meta.length && !meta.some((c) => c.name === 'with_kills')) db.exec('ALTER TABLE samples_meta ADD COLUMN with_kills INTEGER NOT NULL DEFAULT 0');
  // Une base créée avant l'ajout de zones du HUD a une contrainte CHECK trop stricte : on reconstruit la table (même logique que db.py).
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'calibrations'").get() as { sql: string } | undefined;
  if (row && !row.sql.includes('capture_pct_a')) {
    const schema = readFileSync(schemaPath, 'utf-8');
    const start = schema.indexOf('CREATE TABLE IF NOT EXISTS calibrations');
    const create = schema.slice(start, schema.indexOf(');', start) + 2).replace('IF NOT EXISTS calibrations', 'calibrations_new');
    db.exec('DROP TABLE IF EXISTS calibrations_new');
    db.exec(create);
    db.exec('INSERT INTO calibrations_new SELECT map, zone, x, y, w, h FROM calibrations');
    db.exec('DROP TABLE calibrations');
    db.exec('ALTER TABLE calibrations_new RENAME TO calibrations');
  }
  return db;
}
