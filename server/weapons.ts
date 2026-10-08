// Catalogue des icônes d'armes (killfeed, bandeaux) et de leurs noms, rangés dans analysis/weapon_icons/.
// Les images sont créées par l'analyse Python ; les noms que l'utilisateur leur donne sont écrits dans names.json (versionné).

import type { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type WeaponKind = 'killfeed' | 'arme' | 'gadget';
export interface WeaponEntry {
  id: string;
  kind: WeaponKind;
  name: string;
  uses: number;
}

const ID = /^[A-Z]\d{1,4}$/;
const KIND: Record<string, WeaponKind> = { W: 'killfeed', B: 'arme', G: 'gadget' };

export const isWeaponId = (id: string) => ID.test(id) && id[0] in KIND;

export function readNames(dir: string): Record<string, string> {
  try {
    const data = JSON.parse(readFileSync(join(dir, 'names.json'), 'utf-8')) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v)]));
  } catch {
    return {};
  }
}

export function listWeapons(db: DatabaseSync, dir: string): WeaponEntry[] {
  if (!existsSync(dir)) return [];
  const names = readNames(dir);
  const uses = new Map<string, number>();
  const add = (rows: unknown) => {
    for (const r of rows as { id: string | null; n: number }[]) if (r.id) uses.set(r.id, (uses.get(r.id) ?? 0) + r.n);
  };
  add(db.prepare('SELECT weapon AS id, COUNT(*) AS n FROM kills GROUP BY weapon').all());
  add(db.prepare('SELECT weapon1 AS id, COUNT(*) AS n FROM loadouts GROUP BY weapon1').all());
  add(db.prepare('SELECT weapon2 AS id, COUNT(*) AS n FROM loadouts GROUP BY weapon2').all());
  add(db.prepare('SELECT gadget AS id, COUNT(*) AS n FROM loadouts GROUP BY gadget').all());
  return readdirSync(dir)
    .filter((f) => f.endsWith('.png') && isWeaponId(f.slice(0, -4)))
    .map((f) => f.slice(0, -4))
    .map((id) => ({ id, kind: KIND[id[0]], name: names[id] ?? '', uses: uses.get(id) ?? 0 }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

export function setWeaponName(dir: string, id: string, name: string): void {
  if (!isWeaponId(id)) throw new Error('Identifiant d\'arme invalide');
  const names = readNames(dir);
  const clean = name.trim().slice(0, 60);
  if (clean) names[id] = clean;
  else delete names[id];
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'names.json'), JSON.stringify(names, null, 2) + '\n', 'utf-8');
}

/** Aperçu agrandi si l'analyse en a créé un, sinon l'icône de comparaison. */
export function iconFile(dir: string, id: string): Buffer | null {
  if (!isWeaponId(id)) return null;
  for (const path of [join(dir, 'previews', `${id}.png`), join(dir, `${id}.png`)]) {
    if (existsSync(path)) return readFileSync(path);
  }
  return null;
}
