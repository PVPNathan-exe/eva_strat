import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { openDb } from '../../server/db.ts';
import type { ApiContext, Zones } from '../../server/api.ts';

const schemaPath = fileURLToPath(new URL('../../analysis/schema.sql', import.meta.url));
const zonesPath = fileURLToPath(new URL('../../analysis/default_zones.json', import.meta.url));

export function testContext(): ApiContext {
  const db = openDb(':memory:', schemaPath);
  const defaultZones = JSON.parse(readFileSync(zonesPath, 'utf-8')) as Zones;
  return { db, defaultZones };
}

export function insertVideo(ctx: ApiContext, duration = 3000): number {
  const result = ctx.db
    .prepare('INSERT INTO videos (path, duration_s, fps, width, height) VALUES (?, ?, 60, 1920, 1080)')
    .run(`D:/rec/${Math.random()}.mp4`, duration);
  return Number(result.lastInsertRowid);
}
