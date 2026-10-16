import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COVER_A } from '../src/lib/safeZones.ts';
import type { BlockGrid, Segment } from '../src/lib/visibility.ts';
import { closedDoors, equipmentAt, playerShotZone, quantize, weaponRangeOf, type Equipment, type Living } from '../src/components/analysis/review/shotZone.ts';
import type { LifeLoadoutAt } from '../src/types/stats.ts';

const life = (slot: number, life_idx: number, t0: number, t1: number, weapon1: string | null, weapon2: string | null, held: string | null = null): LifeLoadoutAt => ({
  game_id: 1, slot, life_idx, weapon1, weapon2, gadget: null, held, source: null, t0, t1,
});
const players = [{ slot: 3, weapon1: 'AK77', weapon2: 'SPECTRE' }];
const fallback = { rangeM: 12, open: false };

test('équipement : la vie qui contient l instant, sinon la dernière commencée, sinon la première', () => {
  const rows = [life(3, 0, 0, 60, 'SPECTRE', 'T1 GAUSS'), life(3, 1, 70, 140, 'AK77', null), life(4, 0, 0, 140, 'STRIKER', null)];
  assert.equal(equipmentAt(rows, 3, 30, players)?.lifeIdx, 0);
  assert.equal(equipmentAt(rows, 3, 65, players)?.lifeIdx, 0, 'entre deux vies : la dernière commencée');
  assert.equal(equipmentAt(rows, 3, 100, players)?.weapon1, 'AK77');
  assert.equal(equipmentAt(rows, 3, -5, players)?.lifeIdx, 0, 'avant la première vie : la première');
  assert.equal(equipmentAt(rows, 3, 30, players)?.source, 'vie');
});

test('équipement : sans vie lue, celui de la game ; joueur inconnu : null', () => {
  const eq = equipmentAt([], 3, 30, players);
  assert.deepEqual(eq, { weapon1: 'AK77', weapon2: 'SPECTRE', held: null, source: 'game', lifeIdx: null });
  assert.equal(equipmentAt([], 7, 30, players), null);
});

test('portée selon l arme choisie : la plus longue, arme 1, arme 2, arme tenue', () => {
  const eq: Equipment = { weapon1: 'SPECTRE', weapon2: 'T1 GAUSS', held: null, source: 'vie', lifeIdx: 0 };
  assert.equal(weaponRangeOf(eq, 'longest', {}, fallback).rangeM, 20);
  assert.equal(weaponRangeOf(eq, 'longest', {}, fallback).weapon, 'SPECTRE');
  assert.equal(weaponRangeOf(eq, 'weapon1', {}, fallback).rangeM, 20);
  assert.equal(weaponRangeOf(eq, 'weapon2', {}, fallback).rangeM, 6);
  assert.equal(weaponRangeOf(eq, 'weapon2', {}, fallback).weapon, 'T1 GAUSS');
});

test('arme tenue non lue, équipement absent ou icône sans nom : portée estimée par la médiane', () => {
  const eq: Equipment = { weapon1: 'SPECTRE', weapon2: null, held: null, source: 'vie', lifeIdx: 0 };
  const held = weaponRangeOf(eq, 'held', {}, fallback);
  assert.deepEqual([held.estimated, held.rangeM, held.weapon], [true, 12, null]);
  assert.equal(weaponRangeOf({ ...eq, held: 'T1 GAUSS' }, 'held', {}, fallback).estimated, false, 'tenue lue à la mort');
  assert.equal(weaponRangeOf({ ...eq, held: 'T1 GAUSS' }, 'held', {}, fallback).rangeM, 6);
  assert.equal(weaponRangeOf(null, 'longest', {}, fallback).estimated, true);
  assert.equal(weaponRangeOf({ ...eq, weapon1: 'B25' }, 'weapon1', {}, fallback).estimated, true, 'identifiant d icône sans nom');
  assert.equal(weaponRangeOf({ ...eq, weapon1: 'B25' }, 'weapon1', { B25: 'T1 GAUSS' }, fallback).rangeM, 6, 'nom donné à l icône');
});

test('instant arrondi au quart de seconde', () => {
  assert.equal(quantize(10.1), 10);
  assert.equal(quantize(10.13), 10.25);
  assert.equal(quantize(10.37), 10.25);
  assert.equal(quantize(10.4), 10.5);
});

test('portes fermées : celles où aucun joueur vivant n est à portée', () => {
  const near: Segment = [[0.5, 0.4], [0.5, 0.6]];
  const far: Segment = [[0.1, 0.1], [0.1, 0.2]];
  assert.deepEqual(closedDoors([near, far], [{ x: 0.5, y: 0.4 - 0.5 / 16.5 }]), [far]);
  assert.deepEqual(closedDoors([near, far], []), [near, far]);
});

// Zone de tir du joueur choisi sur une carte libre de 100 x 100 cases
const empty: BlockGrid = { w: 100, h: 100, blocked: new Uint8Array(10000) };
const at = (r: { w: number; state: Uint8Array }, cx: number, cy: number) => r.state[cy * r.w + cx];
const me: Living = { slot: 3, team: 'A', x: 0.3, y: 0.5 };
const foe: Living = { slot: 6, team: 'B', x: 0.9, y: 0.1 };
const base = { base: empty, doors: [] as Segment[], glassDoors: [] as Segment[], rotors: null, t: 0, slot: 3 };

test('zone de tir : limitée par la portée, seul le joueur choisi couvre (pas son ennemi)', () => {
  const zone = playerShotZone({ ...base, living: [me, foe], range: { rangeM: 6, open: false, weapon: 'T1 GAUSS', estimated: false } });
  assert.ok(zone);
  assert.equal(at(zone.result, 40, 50), COVER_A, 'à 3 m : couvert');
  assert.equal(at(zone.result, 60, 50), 0, 'à 9 m : hors de portée');
  assert.ok([...zone.result.state].every((s) => s === 0 || s === COVER_A), 'aucune case couverte par l équipe B');
  assert.equal(zone.shooter.slot, 3);
  assert.equal(zone.shooter.weapon, 'T1 GAUSS');
  assert.equal(zone.shooter.estimated, false);
});

test('zone de tir : arme sans limite, toute la ligne de vue est couverte ; joueur mort ou absent : null', () => {
  const zone = playerShotZone({ ...base, living: [me], range: { rangeM: 60, open: true, weapon: 'AK77', estimated: false } });
  assert.equal(at(zone!.result, 95, 50), COVER_A);
  assert.equal(playerShotZone({ ...base, living: [foe], range: { rangeM: 60, open: true, weapon: null, estimated: true } }), null);
  assert.equal(playerShotZone({ ...base, slot: 8, living: [me, foe], range: { rangeM: 60, open: true, weapon: null, estimated: true } }), null);
});

test('zone de tir : une porte fermée bloque les balles, un joueur proche (même ennemi) l ouvre', () => {
  const door: Segment = [[0.5, 0.4], [0.5, 0.6]];
  const range = { rangeM: 60, open: true, weapon: 'AK77', estimated: false };
  const closed = playerShotZone({ ...base, doors: [door], living: [me, foe], range });
  assert.equal(at(closed!.result, 70, 50), 0, 'porte fermée : rien derrière');
  assert.equal(at(closed!.result, 40, 50), COVER_A);
  const nearFoe: Living = { slot: 6, team: 'B', x: 0.5, y: 0.6 + 1.5 / 16.5 };
  const opened = playerShotZone({ ...base, doors: [door], living: [me, nearFoe], range });
  assert.equal(at(opened!.result, 70, 50), COVER_A, 'porte ouverte par l ennemi proche : les balles passent');
});
