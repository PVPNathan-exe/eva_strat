import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KILL_LEAD_S, killLabel, killRow, killSeekTime, killsStatus, laneCount, stackKills } from '../src/lib/killTimeline.ts';
import type { Kill } from '../src/types/analysis.ts';

const kill = (t: number, killer: number | null, victim: number, kind: Kill['kind'] = 'kill', extra: Partial<Kill> = {}): Kill => ({
  t,
  killer,
  victim,
  weapon: null,
  weaponName: null,
  stuff: null,
  headshot: false,
  kind,
  ...extra,
});

test("rangée : équipe du tueur, neutre sans tueur sûr, un tueur déduit garde son équipe", () => {
  assert.equal(killRow(kill(10, 2, 6)), 'A');
  assert.equal(killRow(kill(10, 7, 1)), 'B');
  assert.equal(killRow(kill(10, 7, 1, 'inferred')), 'B');
  assert.equal(killRow(kill(10, null, 3, 'unknown')), 'neutral');
  assert.equal(killRow(kill(10, null, 3, 'environment')), 'neutral');
  assert.equal(killRow(kill(10, 3, 3, 'suicide')), 'neutral');
  assert.equal(killRow(kill(10, 3, 3, 'kill')), 'neutral');
});

test('saut vidéo : KILL_LEAD_S avant le kill, jamais avant le début de la game', () => {
  assert.equal(KILL_LEAD_S, 5);
  assert.equal(killSeekTime(kill(130, 1, 5), 100), 125);
  assert.equal(killSeekTime(kill(102, 1, 5), 100), 100);
});

test('sous-rangées : deux kills proches ne se chevauchent pas, un kill éloigné revient sur la première', () => {
  const markers = stackKills([kill(10, 1, 5), kill(11, 2, 6), kill(30, 3, 7)], 5);
  assert.deepEqual(markers.map((m) => [m.t, m.lane, m.kills.length]), [
    [10, 0, 1],
    [11, 1, 1],
    [30, 0, 1],
  ]);
  assert.equal(laneCount(markers), 2);
  assert.equal(laneCount([]), 1);
});

test('au-delà de KILL_MAX_LANES sous-rangées, le kill est regroupé avec le marqueur voisin', () => {
  const markers = stackKills([kill(13, 4, 8), kill(10, 1, 5), kill(11, 2, 6), kill(12, 3, 7)], 5, 3);
  assert.deepEqual(markers.map((m) => [m.t, m.lane, m.kills.map((k) => k.t)]), [
    [10, 0, [10]],
    [11, 1, [11]],
    [12, 2, [12, 13]],
  ]);
});

test("infobulle : instant dans la game, tueur, victime, arme", () => {
  const names = new Map([[1, 'Alpha'], [5, 'Bravo']]);
  const nameOf = (slot: number) => names.get(slot);
  assert.equal(killLabel(kill(165, 1, 5, 'kill', { weaponName: 'SPECTRE', headshot: true }), 100, nameOf), '1:05 : Alpha tue Bravo (SPECTRE, headshot)');
  assert.equal(killLabel(kill(165, 1, 7, 'inferred', { stuff: 'DX3' }), 100, nameOf), '1:05 : Alpha (tueur déduit, pseudo non lu) tue n° 8 (DX3)');
  assert.equal(killLabel(kill(165, null, 5, 'environment'), 100, nameOf), '1:05 : Bravo mort du décor');
  assert.equal(killLabel(kill(165, null, 5, 'unknown', { weapon: 'W12' }), 100, nameOf), '1:05 : Bravo tué, tueur non lu (arme non nommée)');
  assert.equal(killLabel(kill(165, 5, 5, 'suicide'), 100, nameOf), '1:05 : Bravo suicide (arme inconnue)');
});

test('état des kills : affichés, jamais analysée, kills non lus, aucun kill', () => {
  const base = { killsRead: false, captureRead: false, samples: 0, kills: [] as { t: number }[], start_s: 100, end_s: 400 };
  assert.equal(killsStatus(base), 'not-analysed');
  assert.equal(killsStatus({ ...base, captureRead: true }), 'not-read');
  assert.equal(killsStatus({ ...base, samples: 9000 }), 'not-read');
  assert.equal(killsStatus({ ...base, killsRead: true, captureRead: true }), 'none');
  assert.equal(killsStatus({ ...base, killsRead: true, kills: [{ t: 150 }] }), 'shown');
  assert.equal(killsStatus({ ...base, killsRead: true, kills: [{ t: 50 }] }), 'none'); // hors des bornes de la game
});