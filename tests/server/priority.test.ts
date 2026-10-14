import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priorityArg } from '../../server/priority.ts';

test('les trois niveaux donnent leur argument', () => {
  assert.deepEqual(priorityArg('low'), ['--priority=low']);
  assert.deepEqual(priorityArg('normal'), ['--priority=normal']);
  assert.deepEqual(priorityArg('high'), ['--priority=high']);
});

test('un niveau absent ou inconnu ne donne aucun argument', () => {
  assert.deepEqual(priorityArg(undefined), []);
  assert.deepEqual(priorityArg('realtime'), []);
  assert.deepEqual(priorityArg('high --games=1'), []);
  assert.deepEqual(priorityArg(3), []);
});
