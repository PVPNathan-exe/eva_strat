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

test('nommer une arme écrit names.json, vider le nom le retire', () => {
  const ctx = testContext();
  const d = dir();
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
