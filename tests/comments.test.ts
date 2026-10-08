import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentsToMarkdown, gameIndexAt } from '../src/lib/comments.ts';

const games = [
  { start_s: 100, end_s: 400, map: 'Ceres' },
  { start_s: 500, end_s: 800, map: null },
];
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

test('la game d’un instant, ou null dans le lobby', () => {
  assert.equal(gameIndexAt(games, 150), 1);
  assert.equal(gameIndexAt(games, 650), 2);
  assert.equal(gameIndexAt(games, 450), null);
});

test('l’export en texte décrit chaque commentaire en attente, avec game, temps dans la game et joueurs', () => {
  const md = commentsToMarkdown(
    'Ceres.mp4',
    [
      { t: 130, tag: 'suivi', text: 'Direction\nfausse', slots: [2, 6], resolved: false },
      { t: 450, tag: 'equipe', text: 'Rotation lente', slots: [], resolved: false },
      { t: 160, tag: 'note', text: 'Déjà réglé', slots: [], resolved: true },
    ],
    games,
    fmt,
  );
  assert.equal(
    md,
    [
      'Vidéo : Ceres.mp4',
      '- 2:10 (game 1, Ceres, 0:30 dans la game) [suivi, joueurs 2 et 7] : Direction fausse',
      '- 7:30 (hors game) [équipe] : Rotation lente',
    ].join('\n'),
  );
});

test('sans commentaire en attente, l’export le dit', () => {
  assert.equal(commentsToMarkdown('V.mp4', [], games, fmt), 'Vidéo : V.mp4\nAucun commentaire en attente.');
});
