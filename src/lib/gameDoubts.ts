// Où aller quand on clique sur l'alerte d'une game : le point à vérifier le plus utile, la fin de game en priorité (c'est ce qu'on valide d'un coup d'oeil), sinon le premier warning.

import type { Game } from '../types/analysis';

type Doubt = Game['doubts'][number];

/** Vrai pour un warning de fin de game (« Fin à vérifier », « La vidéo s'arrête avant la fin de la game »). */
export const isEndDoubt = (d: Pick<Doubt, 'label'>): boolean => /^(Fin à vérifier|La vidéo s'arrête)/.test(d.label);

/** Temps de vidéo où emmener l'utilisateur : début du warning de fin de game s'il y en a un, sinon du premier warning, sinon null (rien à vérifier). */
export function doubtTarget(doubts: Pick<Doubt, 'label' | 'start_s'>[]): number | null {
  if (doubts.length === 0) return null;
  const end = doubts.find(isEndDoubt);
  return (end ?? [...doubts].sort((a, b) => a.start_s - b.start_s)[0]).start_s;
}

/** Game suivante (dans l'ordre de la liste) qui a encore quelque chose à vérifier, ou null. */
export function nextToCheck(games: Pick<Game, 'id' | 'status' | 'doubts'>[], afterId: number): Pick<Game, 'id' | 'status' | 'doubts'> | null {
  const i = games.findIndex((g) => g.id === afterId);
  return games.slice(i + 1).find((g) => g.status === 'detected' || g.doubts.length > 0) ?? null;
}
