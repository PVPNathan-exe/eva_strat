// Plan d'une mise à jour : pour chaque fichier, que faire d'après trois empreintes : la base (version GitHub de la dernière synchronisation), la version locale et la version GitHub actuelle.
// Fonction pure (aucun accès disque) : c'est là que se décide ce qui est sûr.
//
// Actions : same (déjà identique), overwrite (remplacer par GitHub), add (fichier absent ici), delete (supprimé de GitHub), keep (version locale gardée),
// diverge (fichier SENSIBLE qui diffère de GitHub : à comparer, jamais écrasé sans accord).
// Règles :
//  - code : GitHub l'emporte (l'ancienne version est sauvegardée avant d'être remplacée), sauf si seul l'utilisateur a changé le fichier (GitHub n'a pas bougé) : keep ;
//  - sensible : ne change que sur accord ; le plan dit seulement s'il y a quelque chose à décider (diverge) et si le fichier est resté tel que la dernière synchronisation (`untouched`) ;
//  - sans base (première fois) : un fichier sensible qui diffère de GitHub est tenu pour modifié par l'utilisateur.

import { isSensitive, partOf } from './parts.mjs';

/**
 * @param {Map<string,string>} baseline  empreintes de la dernière synchronisation
 * @param {Map<string,string>} local     empreintes locales (absent : fichier manquant)
 * @param {Map<string,string>} upstream  empreintes GitHub
 * @returns {{path:string, part:string, action:string, untouched:boolean}[]}
 */
export function planUpdate(baseline, local, upstream) {
  const items = [];
  const paths = new Set([...upstream.keys(), ...baseline.keys()]);
  for (const path of [...paths].sort()) {
    const part = partOf(path);
    if (part === null) continue;
    const B = baseline.get(path);
    const L = local.get(path);
    const U = upstream.get(path);
    const sensitive = isSensitive(part);
    const untouched = L !== undefined && B !== undefined && L === B;
    const push = (action) => items.push({ path, part, action, untouched });

    if (U === undefined) {
      // supprimé de GitHub
      if (L === undefined) continue;
      if (!sensitive && untouched) push('delete');
      else if (L !== B && B !== undefined) push('keep');
      continue;
    }
    if (L === U) {
      push('same');
      continue;
    }
    if (L === undefined) {
      // absent ici : le code est restauré, un fichier sensible neuf est ajouté, un fichier sensible que l'utilisateur a supprimé (base connue) n'est pas ramené
      if (sensitive && B !== undefined) push('keep');
      else push('add');
      continue;
    }
    if (sensitive) {
      push(U === B ? 'keep' : 'diverge'); // GitHub n'a pas bougé : rien à décider
      continue;
    }
    // code qui diffère de GitHub
    if (B !== undefined && L !== B && U === B) push('keep'); // seul l'utilisateur a modifié ce fichier
    else push('overwrite');
  }
  return items;
}

/** Résumé en nombres d'un plan : { overwrite, add, delete, keep, same, diverge }. */
export function summarize(items) {
  const out = { overwrite: 0, add: 0, delete: 0, keep: 0, same: 0, diverge: 0 };
  for (const i of items) out[i.action] += 1;
  return out;
}
