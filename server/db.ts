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
  return db;
}
