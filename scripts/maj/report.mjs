// Messages des mises à jour (en français) et contrôle rapide fait à chaque `npm start`.

import { runUpdate } from './update.mjs';

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/** Affiche le résultat de runUpdate. */
export function printUpdate(result, say = console.log) {
  const { status, pending = [] } = result;
  if (status === 'hors-ligne') say(`[maj] GitHub n'est pas joignable (${result.reason}) : pas de contrôle cette fois.`);
  else if (status === 'nouveautes-git') say('[maj] GitHub a une version plus récente que ce dossier (installation Git : rien n\'est modifié automatiquement). Mets à jour avec « git pull ».');
  else if (status === 'a-faire') {
    say(`[maj] À faire (simulation) : ${plural(result.todo.length, 'fichier de code', 'fichiers de code')} à mettre à jour.`);
    result.todo.forEach((t) => say(`  ${t}`));
  } else if (status === 'mis-a-jour') {
    const a = result.applied;
    say(`[maj] Mise à jour faite : ${a.overwrite} remplacé(s), ${a.add} ajouté(s), ${a.delete} supprimé(s) (code seulement).${result.backupDir ? ` Anciennes versions : ${result.backupDir}` : ''}`);
    say('[maj] Si le site était ouvert, ferme-le et relance « npm start » pour prendre la nouvelle version.');
  } else if (status === 'a-jour' && !pending.length) say('[maj] Le programme est à jour.');
  if (pending.length) {
    const groups = [...new Set(pending.map((p) => p.group))];
    say(`[maj] ${plural(groups.length, 'partie sensible diffère', 'parties sensibles diffèrent')} de GitHub (${groups.join(', ')}) : rien n'a été modifié. « npm run maj -- sensibles » les compare et te laisse choisir.`);
  }
}

/** Contrôle au démarrage : jamais bloquant, jamais bavard hors ligne. */
export async function startupCheck(root, say = console.log) {
  if (process.env.EVA_NO_UPDATE) return;
  try {
    const result = await runUpdate({ root });
    if (result.status === 'hors-ligne') return;
    printUpdate(result, say);
  } catch (err) {
    say(`[maj] Contrôle impossible (${err.message.split('\n')[0]}) : le démarrage continue.`);
  }
}
