// Commentaires liés à un instant de la vidéo : catégories et export en texte (à coller dans une conversation).

import type { CommentTag } from '../types/analysis';

export const TAG_LABEL: Record<CommentTag, string> = { suivi: 'Suivi', equipe: 'Équipe', note: 'Note' };

export interface CommentLike {
  t: number;
  tag: CommentTag;
  text: string;
  slots: number[];
  resolved: boolean;
}

export interface GameLike {
  start_s: number;
  end_s: number;
  map: string | null;
}

/** Numéro de la game (à partir de 1) qui contient l'instant t, ou null (lobby). */
export function gameIndexAt(games: GameLike[], t: number): number | null {
  const i = games.findIndex((g) => t >= g.start_s && t <= g.end_s);
  return i < 0 ? null : i + 1;
}

const numberOfSlot = (slot: number) => (slot <= 4 ? slot : slot + 1);

/**
 * Texte prêt à coller : une ligne par commentaire avec l'instant dans la vidéo, la game, le temps dans la game, la catégorie et les
 * joueurs concernés. Les commentaires déjà résolus ne sont pas exportés.
 */
export function commentsToMarkdown(
  videoName: string,
  comments: CommentLike[],
  games: GameLike[],
  format: (seconds: number) => string,
): string {
  const open = [...comments].filter((c) => !c.resolved).sort((a, b) => a.t - b.t);
  if (open.length === 0) return `Vidéo : ${videoName}\nAucun commentaire en attente.`;
  const lines = open.map((c) => {
    const n = gameIndexAt(games, c.t);
    const game = n === null ? 'hors game' : `game ${n}${games[n - 1].map ? `, ${games[n - 1].map}` : ''}, ${format(c.t - games[n - 1].start_s)} dans la game`;
    const players = c.slots.length ? `, joueur${c.slots.length > 1 ? 's' : ''} ${c.slots.map(numberOfSlot).join(' et ')}` : '';
    return `- ${format(c.t)} (${game}) [${TAG_LABEL[c.tag].toLowerCase()}${players}] : ${c.text.replace(/\s*\n\s*/g, ' ')}`;
  });
  return `Vidéo : ${videoName}\n${lines.join('\n')}`;
}
