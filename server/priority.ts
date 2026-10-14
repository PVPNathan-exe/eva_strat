// Priorité Windows de l'analyse demandée par l'interface (menu Options de la barre d'analyse) : transmise à analyze.py par --priority (voir analysis/priority.py).

export const PRIORITIES = ['low', 'normal', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Argument de ligne de commande pour un niveau valide, rien sinon (jamais de texte libre dans la ligne de commande). */
export function priorityArg(value: unknown): string[] {
  return typeof value === 'string' && (PRIORITIES as readonly string[]).includes(value) ? [`--priority=${value}`] : [];
}
