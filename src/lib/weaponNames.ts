// Noms d'armes : correspondance entre une saisie libre et les noms de l'onglet Stratégie.

const squash = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Nom tel qu'écrit dans `known` si la saisie y correspond (sans tenir compte des majuscules, espaces ou tirets), sinon la saisie nettoyée. */
export function canonicalName(name: string, known: string[]): string {
  const key = squash(name);
  return (key && known.find((n) => squash(n) === key)) || name.trim();
}
