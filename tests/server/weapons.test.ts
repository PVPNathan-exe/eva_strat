import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { iconFile, isWeaponId, listWeapons, setWeaponName } from '../../server/weapons.ts';
import { testContext } from './helpers.ts';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function dir() {
  const d = mkdtempSync(join(tmpdir(), 'eva-weapons-'));
  mkdirSync(join(d, 'previews'));
  for (const id of ['W1', 'W2', 'B1', 'G1']) writeFileSync(join(d, `${id}.png`), PNG);
  writeFileSync(join(d, 'previews', 'W1.png'), Buffer.concat([PNG, Buffer.from('preview')]));
  return d;
}

test('identifiants d’armes acceptés : lettre connue + chiffres, rien d’autre', () => {
  assert.equal(isWeaponId('W12'), true);
  assert.equal(isWeaponId('B3'), true);
  assert.equal(isWeaponId('X1'), false);
  assert.equal(isWeaponId('../W1'), false);
  assert.equal(isWeaponId('W1.png'), false);
});

test('le catalogue range les icônes par type et compte leurs usages', () => {
  const ctx = testContext();
  const d = dir();
  ctx.db.prepare("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, '/v.mp4', 600, 30, 1920, 1080)").run();
  ctx.db.prepare("INSERT INTO games (id, video_id, start_s, end_s) VALUES (1, 1, 10, 200)").run();
  ctx.db.prepare("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon) VALUES (1, 20, 1, 5, 'W1'), (1, 30, 2, 6, 'W1'), (1, 40, 3, 7, 'W2')").run();
  ctx.db.prepare("INSERT INTO loadouts (game_id, slot, weapon1, weapon2, gadget) VALUES (1, 1, 'B1', 'B1', 'G1'), (1, 2, 'B1', NULL, 'G1')").run();
  const list = listWeapons(ctx.db, d);
  assert.deepEqual(list.map((w) => [w.id, w.kind, w.uses]), [
    ['B1', 'arme', 3],
    ['G1', 'gadget', 2],
    ['W1', 'killfeed', 2],
    ['W2', 'killfeed', 1],
  ]);
});

test('une icône de killfeed que plus aucun kill n’utilise n’est plus à nommer (l’arme vient du bandeau)', () => {
  const ctx = testContext();
  const d = dir();
  const ids = listWeapons(ctx.db, d).map((w) => w.id);
  assert.deepEqual(ids, ['B1', 'G1']);
});

test('nommer une arme écrit names.json, vider le nom le retire', () => {
  const ctx = testContext();
  const d = dir();
  ctx.db.prepare("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, '/v.mp4', 600, 30, 1920, 1080)").run();
  ctx.db.prepare("INSERT INTO games (id, video_id, start_s, end_s) VALUES (1, 1, 10, 200)").run();
  ctx.db.prepare("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon) VALUES (1, 20, 1, 5, 'W1')").run();
  setWeaponName(d, 'W1', '  Blaster ');
  assert.deepEqual(JSON.parse(readFileSync(join(d, 'names.json'), 'utf-8')), { W1: 'Blaster' });
  assert.equal(listWeapons(ctx.db, d).find((w) => w.id === 'W1')?.name, 'Blaster');
  setWeaponName(d, 'W1', '');
  assert.deepEqual(JSON.parse(readFileSync(join(d, 'names.json'), 'utf-8')), {});
  assert.throws(() => setWeaponName(d, '../x', 'Nom'), /invalide/);
});

test('l’aperçu agrandi est servi s’il existe, sinon l’icône de comparaison', () => {
  const d = dir();
  assert.ok(iconFile(d, 'W1')!.toString().endsWith('preview'));
  assert.deepEqual(iconFile(d, 'W2'), PNG);
  assert.equal(iconFile(d, 'W9'), null);
  assert.equal(iconFile(d, '../W1'), null);
});

import { GRENADE_NAMES, resolveStuff } from '../../server/weapons.ts';
import { stuffs } from '../../src/lib/stuffs.ts';

test('un kill à la grenade prend la grenade équipée par le tueur', () => {
  assert.equal(resolveStuff('GRENADE', 'STICKY'), 'STICKY');
  assert.equal(resolveStuff('GRENADE', 'dx3'), 'DX3');
  assert.equal(resolveStuff('GRENADE', 'SONAR'), 'GRENADE'); // son gadget n'est pas une grenade : on garde le nom du logo
  assert.equal(resolveStuff('GRENADE', null), 'GRENADE');
  assert.equal(resolveStuff('SPECTRE', 'STICKY'), 'SPECTRE'); // une arme à feu n'est jamais remplacée par le gadget
  assert.equal(resolveStuff(null, 'STICKY'), null);
});

test('la liste des grenades du serveur est celle de l’onglet Stratégie', () => {
  const fromStrategy = stuffs.filter((s) => s.kind === 'grenade').map((s) => s.name).sort();
  assert.deepEqual([...GRENADE_NAMES].sort(), fromStrategy);
});

import { effectiveNames, inferKillfeedNames } from '../../server/weapons.ts';

function seed() {
  const ctx = testContext();
  ctx.db.prepare("INSERT INTO videos (id, path, duration_s, fps, width, height) VALUES (1, '/v.mp4', 600, 30, 1920, 1080)").run();
  ctx.db.prepare('INSERT INTO games (id, video_id, start_s, end_s) VALUES (1, 1, 10, 500)').run();
  // joueur 1 : SPECTRE + WESTFIRE, grenade STICKY ; joueur 2 : WESTFIRE + ATLAS, grenade DX3 ; joueur 3 : ATLAS + SPECTRE, SONAR
  ctx.db
    .prepare("INSERT INTO loadouts (game_id, slot, weapon1, weapon2, gadget) VALUES (1, 1, 'B1', 'B2', 'G1'), (1, 2, 'B2', 'B3', 'G2'), (1, 3, 'B3', 'B1', 'G3')")
    .run();
  const kill = ctx.db.prepare('INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon) VALUES (1, ?, ?, 5, ?)');
  return { ctx, kill };
}
const NAMES = { B1: 'SPECTRE', B2: 'WESTFIRE', B3: 'ATLAS', G1: 'STICKY', G2: 'DX3', G3: 'SONAR' };

test('une icône du killfeed prend l\u2019unique arme que ses tueurs ont en commun', () => {
  const { ctx, kill } = seed();
  kill.run(20, 1, 'W1'); // SPECTRE/WESTFIRE
  kill.run(30, 3, 'W1'); // ATLAS/SPECTRE -> commun : SPECTRE
  assert.deepEqual(inferKillfeedNames(ctx.db, NAMES), { W1: 'SPECTRE' });
});

test('plusieurs armes en commun, ou un seul kill : rien n\u2019est déduit', () => {
  const { ctx, kill } = seed();
  kill.run(20, 1, 'W1');
  kill.run(30, 1, 'W1'); // même tueur deux fois : SPECTRE et WESTFIRE restent possibles
  kill.run(40, 2, 'W2'); // un seul kill
  assert.deepEqual(inferKillfeedNames(ctx.db, NAMES), {});
});

test('aucune arme en commun et des grenades partout : c\u2019est le logo générique GRENADE', () => {
  const { ctx } = seed();
  ctx.db.prepare("INSERT INTO loadouts (game_id, slot, weapon1, weapon2, gadget) VALUES (1, 4, 'B4', 'B5', 'G1')").run();
  const names = { ...NAMES, B4: 'FURY', B5: 'NEEDLE' };
  ctx.db.prepare("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon) VALUES (1, 20, 1, 5, 'W2'), (1, 30, 4, 5, 'W2')").run(); // SPECTRE/WESTFIRE vs FURY/NEEDLE
  assert.deepEqual(inferKillfeedNames(ctx.db, names), { W2: 'GRENADE' });
  ctx.db.prepare("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon) VALUES (1, 40, 3, 5, 'W2')").run(); // joueur 3 : gadget SONAR, pas une grenade
  assert.deepEqual(inferKillfeedNames(ctx.db, names), {});
});

test('un nom saisi par l\u2019utilisateur passe avant le nom déduit, et le logo grenade est masqué du catalogue', () => {
  const { ctx, kill } = seed();
  kill.run(20, 1, 'W1');
  kill.run(30, 3, 'W1');
  const d = dir();
  writeFileSync(join(d, 'names.json'), JSON.stringify({ ...NAMES, W1: 'WARDEN' }));
  assert.equal(effectiveNames(ctx.db, d).W1, 'WARDEN');
  writeFileSync(join(d, 'names.json'), JSON.stringify(NAMES));
  const w1 = listWeapons(ctx.db, d).find((w) => w.id === 'W1');
  assert.deepEqual([w1?.name, w1?.inferred], ['SPECTRE', true]);
  // W2 devient « GRENADE » (déduit) : il disparaît de la liste
  ctx.db.prepare("INSERT INTO loadouts (game_id, slot, weapon1, weapon2, gadget) VALUES (1, 4, 'B4', 'B5', 'G1')").run();
  writeFileSync(join(d, 'names.json'), JSON.stringify({ ...NAMES, B4: 'FURY', B5: 'NEEDLE' }));
  ctx.db.prepare("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon) VALUES (1, 50, 1, 5, 'W2'), (1, 60, 4, 5, 'W2')").run();
  writeFileSync(join(d, 'W2.png'), PNG);
  assert.equal(listWeapons(ctx.db, d).some((w) => w.id === 'W2'), false);
});

function pngOfSize(w: number, h: number) {
  const b = Buffer.alloc(33);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(b);
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

test('un logo compact du killfeed est une grenade, même si deux tueurs ont une arme en commun par coïncidence', () => {
  const { ctx, kill } = seed();
  const d = dir();
  writeFileSync(join(d, 'previews', 'W2.png'), pngOfSize(64, 60)); // presque carré
  writeFileSync(join(d, 'previews', 'W3.png'), pngOfSize(180, 32)); // long et fin
  writeFileSync(join(d, 'W3.png'), PNG);
  writeFileSync(join(d, 'W2.png'), PNG);
  kill.run(20, 1, 'W2'); // SPECTRE/WESTFIRE
  kill.run(30, 3, 'W2'); // ATLAS/SPECTRE -> SPECTRE en commun par hasard
  kill.run(40, 1, 'W3');
  kill.run(50, 3, 'W3');
  const names = inferKillfeedNames(ctx.db, NAMES, d);
  assert.equal(names.W2, 'GRENADE');
  assert.equal(names.W3, 'SPECTRE'); // une arme longue reste déduite de l'équipement
  assert.equal(listWeapons(ctx.db, d).some((w) => w.id === 'W2'), false); // le logo de grenade n'est pas proposé
  writeFileSync(join(d, 'names.json'), JSON.stringify({ ...NAMES, W2: 'DX3' }));
  assert.equal(effectiveNames(ctx.db, d).W2, 'DX3'); // un nom saisi passe toujours avant
});

import { readReviews, setReview } from '../../server/weapons.ts';

test('les avis sur une icône sont rangés dans reviews.json, un nom refusé n’est plus proposé', () => {
  const d = dir();
  setReview(d, 'B1', { reported: true, reason: '  superposée ' });
  assert.deepEqual(readReviews(d), { B1: { reported: true, reason: 'superposée' } });
  setReview(d, 'B1', { verdict: 'bad', rejectName: 'spectre' });
  setReview(d, 'B1', { rejectName: 'SPECTRE' });
  assert.deepEqual(readReviews(d).B1?.rejected, ['SPECTRE']); // pas de doublon, toujours en majuscules
  setReview(d, 'B1', { reported: false, verdict: null });
  assert.deepEqual(readReviews(d).B1, { rejected: ['SPECTRE'] });
  assert.throws(() => setReview(d, '../x', { reported: true }), /invalide/);
});

test('une icône signalée ou jugée est indiquée dans le catalogue', () => {
  const ctx = testContext();
  const d = dir();
  setReview(d, 'B1', { reported: true });
  setReview(d, 'G1', { verdict: 'ok' });
  const list = listWeapons(ctx.db, d);
  assert.equal(list.find((w) => w.id === 'B1')?.reported, true);
  assert.equal(list.find((w) => w.id === 'G1')?.verdict, 'ok');
  assert.equal(list.find((w) => w.id === 'B1')?.verdict, null);
});
