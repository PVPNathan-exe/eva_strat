// Contribuer : quand ta version d'une partie est MESURÉE meilleure que celle de GitHub (masque qui refuse moins de tes positions, réglages du suivi mieux notés), prépare un dossier à proposer.
// Rien n'est envoyé nulle part : le programme écrit `data/contributions/<date>/` (les fichiers et un rapport avec les mesures) et te dit comment les proposer (une « pull request » sur GitHub, ou le dossier
// à envoyer à la personne qui tient le projet). Ces fichiers ne contiennent ni vidéo, ni pseudo, ni donnée de ta base : seulement des masques, des réglages et leurs chiffres.

import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readState } from './manifest.mjs';
import { PARTS } from './parts.mjs';
import { repoInfo } from './source.mjs';
import { compareGroup, describe, diffGroups } from './sensitive.mjs';

/** Groupes où ta version est mesurée meilleure : [{ group, part, items, result }]. `only` : groupes ou parties demandés (sinon tous ceux qui ont une mesure). */
export function betterGroups(root, upstream, { only = null, say = () => {} } = {}) {
  const state = readState(root);
  const found = [];
  for (const [group, { part, items: all }] of diffGroups(root, upstream, state)) {
    if (!PARTS[part].metric || (only && !only.includes(group) && !only.includes(part))) continue;
    const items = all.filter((i) => i.action === 'overwrite' && !i.untouched); // seulement ce que tu as modifié toi-même (ni les fichiers absents, ni ceux restés comme à la dernière synchronisation)
    if (!items.length) continue;
    let result;
    try {
      result = compareGroup(root, group, part, upstream);
    } catch (err) {
      say(`${group} : mesure impossible (${err.message.split('\n')[0]})`);
      continue;
    }
    if (result.verdict === 'local') found.push({ group, part, items, result });
  }
  return found;
}

/** Écrit le dossier de contribution. Renvoie { dir, groups }. */
export function writeContribution({ root, found, sha, now = new Date() }) {
  const dir = join(root, 'data', 'contributions', now.toISOString().replace(/[:.]/g, '-').slice(0, 19));
  const report = [`# Proposition de ma version (${now.toISOString().slice(0, 10)})`, '', `Mesures faites sur mes données, contre la version de GitHub ${sha.slice(0, 8)} :`, ''];
  for (const { group, part, items, result } of found) {
    report.push(`## ${PARTS[part].label} : ${group}`, '', ...describe(result).map((l) => l.trim()), '', 'Fichiers :', ...items.map((i) => `- ${i.path}`), '');
    for (const { path } of items) {
      mkdirSync(dirname(join(dir, 'fichiers', path)), { recursive: true });
      copyFileSync(join(root, path), join(dir, 'fichiers', path));
    }
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'RAPPORT.md'), report.join('\n'));
  return { dir, groups: found.map((f) => f.group) };
}

/** Mode d'emploi affiché après la préparation. */
export function howToPropose(root, dir) {
  const { repo } = repoInfo(root);
  return [
    `Dossier prêt : ${dir}`,
    'Pour le proposer :',
    `  1. Sur https://github.com/${repo} : « Fork » (une copie à ton nom), puis « Add file > Upload files » : glisse le contenu du dossier « fichiers » en gardant les mêmes chemins ;`,
    '  2. « Commit changes » sur une nouvelle branche, puis « Open pull request » en collant RAPPORT.md dans la description ;',
    `  3. ou envoie le dossier à la personne qui tient le projet (https://github.com/${repo}/issues/new permet aussi de poser la question).`,
    'Rien n\'a été envoyé.',
  ];
}
