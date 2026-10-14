// Question posée dans le terminal. Sans terminal (ou avec --yes), la réponse est la valeur proposée : aucune réponse n'est inventée au-delà de la recommandation affichée.

import { createInterface } from 'node:readline/promises';

/** Renvoie la clé choisie parmi `choices` (1 lettre), ou `fallback` si pas de terminal, --yes ou réponse vide. */
export function makeAsk({ yes = false } = {}) {
  return async (question, choices, fallback) => {
    if (yes || !process.stdin.isTTY) return fallback;
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (;;) {
        const answer = (await rl.question(`${question} > `)).trim().toLowerCase();
        if (!answer) return fallback;
        if (choices.includes(answer)) return answer;
      }
    } finally {
      rl.close();
    }
  };
}

/** Confirmation oui ou non (non par défaut). */
export function makeConfirm({ yes = false } = {}) {
  const ask = makeAsk({ yes });
  return async (question) => (await ask(`${question} [o/N]`, ['o', 'n'], yes ? 'o' : 'n')) === 'o';
}
