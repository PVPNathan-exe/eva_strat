import { test } from 'node:test';
import assert from 'node:assert/strict';
import { doubtTarget, isEndDoubt, nextToCheck } from '../src/lib/gameDoubts.ts';

const d = (label: string, start_s: number) => ({ label, start_s, end_s: start_s + 5 });

test('isEndDoubt : les deux warnings de fin de game', () => {
  assert.equal(isEndDoubt(d('Fin à vérifier : chrono arrêté à 4:26', 0)), true);
  assert.equal(isEndDoubt(d("La vidéo s'arrête avant la fin de la game (chrono à 3:00)", 0)), true);
  assert.equal(isEndDoubt(d('Chrono figé à 5:00 (pause ?)', 0)), false);
  assert.equal(isEndDoubt(d('Début estimé : le chrono était déjà à 9:00 quand la game est apparue', 0)), false);
});

test('doubtTarget : la fin de game en priorité, même si un autre warning est plus tôt', () => {
  assert.equal(doubtTarget([d('Chrono figé à 5:00 (pause ?)', 100), d('Fin à vérifier : chrono arrêté à 4:26', 897)]), 897);
});

test('doubtTarget : sans fin de game, le premier warning dans le temps ; sans warning, null', () => {
  assert.equal(doubtTarget([d('Chrono figé à 5:00 (pause ?)', 300), d('Début estimé : x', 50)]), 50);
  assert.equal(doubtTarget([]), null);
});

test('nextToCheck : la game suivante à vérifier, en sautant celles qui sont confirmées et sans warning', () => {
  const games = [
    { id: 1, status: 'detected' as const, doubts: [d('Fin à vérifier : x', 10)] },
    { id: 2, status: 'confirmed' as const, doubts: [] },
    { id: 3, status: 'detected' as const, doubts: [] },
    { id: 4, status: 'confirmed' as const, doubts: [d('Chrono figé', 5)] },
  ];
  assert.equal(nextToCheck(games, 1)?.id, 3);
  assert.equal(nextToCheck(games, 3)?.id, 4);
  assert.equal(nextToCheck(games, 4), null);
});
