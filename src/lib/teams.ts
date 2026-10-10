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
