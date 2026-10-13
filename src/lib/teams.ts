// Diminutif d'équipe suggéré par les pseudos des joueurs d'une même couleur (ex. NCTXVEX, NCTXSPIRIT... -> NCT).
// Ce n'est qu'une suggestion : toutes les équipes ne préfixent pas leurs pseudos (équipes pro, exceptions), et un diminutif n'est pas le nom complet.

const MIN_TAG = 3;
const MIN_PLAYERS = 3; // joueurs (sur 4) qui partagent le préfixe pour qu'on le propose
const GENERIC = new Set(['PLAYER', 'JOUEUR', 'GUEST']); // pseudos par défaut du jeu : pas une équipe

const normalise = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]/g, '');

function commonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

/** Préfixe commun à au moins 3 pseudos sur 4 (le plus long), sans le X de liaison final (NCTX -> NCT), ou null. */
export function teamTag(names: string[]): string | null {
  const clean = names.map(normalise).filter((n) => n.length >= MIN_TAG);
  let best = '';
  for (let i = 0; i < clean.length; i++) {
    for (let j = i + 1; j < clean.length; j++) {
      const prefix = commonPrefix(clean[i], clean[j]);
      if (prefix.length < MIN_TAG || prefix.length < best.length) continue;
      if (clean.filter((n) => n.startsWith(prefix)).length >= MIN_PLAYERS) best = prefix;
    }
  }
  const tag = best.length > MIN_TAG && best.endsWith('X') ? best.slice(0, -1) : best;
  return tag.length >= MIN_TAG && !GENERIC.has(tag) ? tag.slice(0, 8) : null;
}

export interface TeamGuess {
  start_s: number;
  end_s: number;
  team_a: string | null;
  team_b: string | null;
}

interface GuessGame {
  start_s: number;
  end_s: number;
  players: { slot: number; name: string }[];
}

/** Diminutif de chaque côté d'une game d'après les pseudos déjà lus (slots 1 à 4 : orange, 5 à 8 : bleue). */
export function sideTags(game: GuessGame): { a: string | null; b: string | null } {
  const side = (slots: number[]) => teamTag(game.players.filter((p) => slots.includes(p.slot)).map((p) => p.name));
  return { a: side([1, 2, 3, 4]), b: side([5, 6, 7, 8]) };
}

/** Morceaux de vidéo proposés d'après les pseudos : les games qui se suivent avec les mêmes deux équipes ne font qu'un morceau (bootcamp : les équipes tournent). Une game sans pseudo
 *  lu ou sans diminutif sur les deux côtés coupe le morceau ; `names` donne le nom complet retenu d'un diminutif (sinon le diminutif sert de nom). */
export function teamRangesFromGames(games: GuessGame[], names: Record<string, string> = {}): TeamGuess[] {
  const full = (tag: string | null) => (tag ? (names[tag] ?? tag) : null);
  const out: (TeamGuess & { key: string })[] = [];
  for (const g of [...games].sort((x, y) => x.start_s - y.start_s)) {
    const { a, b } = sideTags(g);
    if (!a && !b) continue;
    const key = `${a ?? ''}|${b ?? ''}`;
    const last = out[out.length - 1];
    if (last && last.key === key) last.end_s = g.end_s;
    else out.push({ key, start_s: g.start_s, end_s: g.end_s, team_a: full(a), team_b: full(b) });
  }
  return out.map(({ start_s, end_s, team_a, team_b }) => ({ start_s, end_s, team_a, team_b }));
}
