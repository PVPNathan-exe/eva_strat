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
  /** true : le nom a été déduit par le programme (équipement des tueurs), pas saisi. */
  inferred: boolean;
  uses: number;
  /** Où l'icône a été vue (pour la reconnaître : vidéo, game, instant). Au plus MAX_SOURCES, les premières. */
  sources: WeaponSource[];
}

export interface WeaponSource {
  videoId: number;
  gameId: number;
  video: string;
  /** Rang de la game dans sa vidéo (1 = première). */
  game: number;
  map: string | null;
  /** Instant de la vidéo (secondes) du premier endroit où on la voit. */
  t: number;
  /** Joueur concerné (tueur ou porteur), si connu. */
  player: string | null;
}

const MAX_SOURCES = 4;

const ID = /^[A-Z]\d{1,4}$/;
const KIND: Record<string, WeaponKind> = { W: 'killfeed', B: 'arme', G: 'gadget' };

/** Grenades de l'onglet Stratégie (src/lib/stuffs.ts) : le killfeed les affiche toutes avec le même logo. */
export const GRENADE_NAMES = ['DX3', 'STICKY'];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Équipement réellement utilisé pour un kill. Le logo « GRENADE » du killfeed est le même pour toutes les grenades : on prend alors
 * la grenade que le tueur a équipée (son gadget sur le bandeau). Sans gadget connu, ou si ce n'est pas une grenade, on garde le nom du logo.
 */
export function resolveStuff(weaponName: string | null, killerGadgetName: string | null): string | null {
  if (weaponName && squash(weaponName) === 'grenade' && killerGadgetName) {
    const grenade = GRENADE_NAMES.find((g) => squash(g) === squash(killerGadgetName));
    if (grenade) return grenade;
  }
  return weaponName;
}

export const isWeaponId = (id: string) => ID.test(id) && id[0] in KIND;

export function readNames(dir: string): Record<string, string> {
  try {
    const data = JSON.parse(readFileSync(join(dir, 'names.json'), 'utf-8')) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v)]));
  } catch {
    return {};
  }
}

/**
 * Déduit le nom des icônes du killfeed qui n'en ont pas, à partir de l'équipement des tueurs.
 * L'arme d'un kill est forcément dans l'équipement du tueur : si une icône revient chez plusieurs tueurs et qu'une seule arme nommée leur est
 * commune, c'est elle. Si aucune arme n'est commune mais que tous les tueurs ont une grenade équipée, c'est le logo générique « GRENADE »
 * (identique pour toutes les grenades). Les noms saisis par l'utilisateur passent toujours avant.
 */
/** Rapport largeur / hauteur de l'icône d'origine (lu dans l'en-tête de son aperçu PNG), ou null. */
export function iconAspect(dir: string, id: string): number | null {
  const path = join(dir, 'previews', `${id}.png`);
  if (!isWeaponId(id) || !existsSync(path)) return null;
  const head = readFileSync(path).subarray(0, 24);
  if (head.length < 24) return null;
  const w = head.readUInt32BE(16);
  const h = head.readUInt32BE(20);
  return h > 0 ? w / h : null;
}

/** Le logo de grenade du killfeed est une forme compacte (presque carrée) ; une arme à feu est longue et fine (rapport d'au moins 1,8 sur les armes vues). */
const GRENADE_MAX_ASPECT = 1.4;

export function inferKillfeedNames(db: DatabaseSync, names: Record<string, string>, dir?: string): Record<string, string> {
  const rows = db
    .prepare(
      `SELECT k.weapon AS weapon, l.weapon1 AS w1, l.weapon2 AS w2, l.gadget AS gadget
       FROM kills k JOIN loadouts l ON l.game_id = k.game_id AND l.slot = k.killer_slot
       WHERE k.weapon IS NOT NULL AND k.killer_slot IS NOT NULL AND k.killer_slot <> k.victim_slot`,
    )
    .all() as { weapon: string; w1: string | null; w2: string | null; gadget: string | null }[];
  const byIcon = new Map<string, typeof rows>();
  for (const r of rows) byIcon.set(r.weapon, [...(byIcon.get(r.weapon) ?? []), r]);
  const out: Record<string, string> = {};
  // 1. Forme : un logo compact est une grenade, quels que soient les tueurs (une coïncidence d'équipement ne doit pas le faire passer pour une arme).
  if (dir) {
    for (const icon of new Set([...byIcon.keys(), ...(existsSync(dir) ? readdirSync(dir).filter((f) => /^W\d+\.png$/.test(f)).map((f) => f.slice(0, -4)) : [])])) {
      const aspect = iconAspect(dir, icon);
      if (!names[icon] && aspect !== null && aspect < GRENADE_MAX_ASPECT) out[icon] = 'GRENADE';
    }
  }
  // 2. Équipement des tueurs pour les autres icônes.
  for (const [icon, kills] of byIcon) {
    if (names[icon] || out[icon]) continue;
    const named = (id: string | null) => (id ? (names[id] ?? null) : null);
    const sets = kills
      .map((k) => new Set([named(k.w1), named(k.w2)].filter((n): n is string => !!n)))
      .filter((s) => s.size > 0);
    if (sets.length >= 2) {
      const common = [...sets[0]].filter((n) => sets.every((s) => s.has(n)));
      if (common.length === 1) {
        out[icon] = common[0];
        continue;
      }
      const gadgets = kills.map((k) => named(k.gadget));
      if (common.length === 0 && gadgets.every((g) => g !== null && GRENADE_NAMES.some((n) => squash(n) === squash(g)))) out[icon] = 'GRENADE';
    }
  }
  return out;
}

/** Noms effectifs : saisis par l'utilisateur, sinon déduits. */
export function effectiveNames(db: DatabaseSync, dir: string): Record<string, string> {
  const manual = readNames(dir);
  return { ...inferKillfeedNames(db, manual, dir), ...manual };
}

function sourcesOf(db: DatabaseSync): Map<string, WeaponSource[]> {
  const games = db
    .prepare(
      `SELECT g.id, g.video_id, g.start_s, g.map, v.path,
              (SELECT COUNT(*) FROM games o WHERE o.video_id = g.video_id AND o.start_s < g.start_s) + 1 AS rank
       FROM games g JOIN videos v ON v.id = g.video_id`,
    )
    .all() as { id: number; video_id: number; start_s: number; map: string | null; path: string; rank: number }[];
  const info = new Map(games.map((g) => [g.id, g]));
  const pseudo = (gameId: number, slot: number | null) =>
    slot === null ? null : ((db.prepare('SELECT name FROM players WHERE game_id = ? AND slot = ?').get(gameId, slot) as { name: string } | undefined)?.name ?? null);
  const out = new Map<string, WeaponSource[]>();
  const push = (icon: string | null, gameId: number, t: number, slot: number | null) => {
    const g = info.get(gameId);
    if (!icon || !g) return;
    const list = out.get(icon) ?? [];
    if (list.length >= MAX_SOURCES || list.some((s) => s.gameId === gameId)) return;
    out.set(icon, [...list, { videoId: g.video_id, gameId, video: g.path.split(/[\\/]/).pop() ?? g.path, game: g.rank, map: g.map, t, player: pseudo(gameId, slot) }]);
  };
  for (const k of db.prepare('SELECT game_id, t, weapon, killer_slot FROM kills WHERE weapon IS NOT NULL ORDER BY t').all() as { game_id: number; t: number; weapon: string; killer_slot: number | null }[])
    push(k.weapon, k.game_id, k.t, k.killer_slot);
  for (const l of db.prepare('SELECT game_id, slot, weapon1, weapon2, gadget FROM loadouts').all() as { game_id: number; slot: number; weapon1: string | null; weapon2: string | null; gadget: string | null }[]) {
    const start = info.get(l.game_id)?.start_s ?? 0;
    for (const icon of [l.weapon1, l.weapon2, l.gadget]) push(icon, l.game_id, start, l.slot);
  }
  return out;
}

export function listWeapons(db: DatabaseSync, dir: string): WeaponEntry[] {
  if (!existsSync(dir)) return [];
  const manual = readNames(dir);
  const auto = inferKillfeedNames(db, manual, dir);
  const names = { ...auto, ...manual };
  const uses = new Map<string, number>();
  const sources = sourcesOf(db);
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
    .map((id) => ({ id, kind: KIND[id[0]], name: names[id] ?? '', inferred: !manual[id] && !!auto[id], uses: uses.get(id) ?? 0, sources: sources.get(id) ?? [] }))
    // Le logo de grenade du killfeed est le même pour toutes les grenades : rien à nommer, on ne le montre pas.
    .filter((w) => !(w.kind === 'killfeed' && squash(w.name) === 'grenade'))
    // L'arme d'un kill se lit maintenant sur le bandeau du tueur : une icône de killfeed que plus aucun kill n'utilise n'est plus à nommer.
    .filter((w) => !(w.kind === 'killfeed' && w.uses === 0))
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
