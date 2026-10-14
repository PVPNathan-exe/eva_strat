import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes } from '../src/lib/formatBytes.ts';

test('petites tailles en octets, puis Ko, Mo, Go', () => {
  assert.equal(formatBytes(0), '0 o');
  assert.equal(formatBytes(999), '999 o');
  assert.equal(formatBytes(1500), '1,5 Ko');
  assert.equal(formatBytes(23_400_000), '23,4 Mo');
  assert.equal(formatBytes(2_635_869_585), '2,6 Go');
});

test('à partir de 100 unités, plus de décimale', () => {
  assert.equal(formatBytes(154_300_000), '154 Mo');
});

test('valeur absente ou négative : point d’interrogation', () => {
  assert.equal(formatBytes(-1), '?');
  assert.equal(formatBytes(Number.NaN), '?');
});
