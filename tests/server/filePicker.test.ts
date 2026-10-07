import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePickerOutput } from '../../server/filePicker.ts';

test('chemin choisi : retiré des espaces et retours à la ligne', () => {
  assert.equal(parsePickerOutput('D:\\rec\\match 1.mp4\r\n'), 'D:\\rec\\match 1.mp4');
});

test('sélecteur annulé : sortie vide → null', () => {
  assert.equal(parsePickerOutput(''), null);
  assert.equal(parsePickerOutput('  \r\n'), null);
});

test('garde la dernière ligne non vide (ignore le bruit de PowerShell)', () => {
  assert.equal(parsePickerOutput('bruit\r\nD:\\a.mp4\r\n'), 'D:\\a.mp4');
});
