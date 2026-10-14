// Remise à zéro d'UNE partie du programme (`npm run reset -- <partie>`), jamais tout. Toujours : on montre ce qui sera touché, on demande (sauf --yes), on sauvegarde avant d'écrire.
//   Parties en fichiers, remises à la version de GitHub (ou à la copie gardée à la dernière synchronisation si GitHub est injoignable) :
//     masques [--map Carte]  masques, traits et réglages des cartes (avec --map : une seule carte)
//     suivi                  réglages du suivi (analysis/tracking_params.json)
//     armes                  avis et verrous des icônes (reviews.json) ; les noms et les images ne sont jamais remis à zéro (la base cite les icônes par numéro)
//     modeles                modèles de chiffres, noms de cartes, zones par défaut
//   Parties de la base (copie de la base avant, voir analysis/reset_parts.py) : calibrages [--map], cartographie --map, corrections --game, cache.

import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { backupRoot, baselinePath } from './apply.mjs';
import { hashManaged, readState, sha1File, stateDir, walk, writeState } from './manifest.mjs';
import { groupOf, mapOfPath, PARTS, partOf } from './parts.mjs';
import { runAnalysisJson } from './python.mjs';
import { getUpstream, repoInfo } from './source.mjs';

export const FILE_PARTS = ['masques', 'suivi', 'armes', 'modeles'];
export const DB_PARTS = ['calibrages', 'cartographie', 'corrections', 'cache'];

/** Fichiers d'une partie (chemins relatifs) parmi `candidates`, selon la carte demandée. */
export function filesOfPart(part, candidates, map = null) {
  return [...candidates].filter((p) => {
    if (partOf(p) !== part) return false;
    if (part === 'armes') return p === 'analysis/weapon_icons/reviews.json';
    if (part === 'suivi') return p === 'analysis/tracking_params.json';
    if (part === 'masques') return map ? mapOfPath(p) === map : true;
    return true;
  }).sort();
}

async function resetDb({ root, part, map, game, dryRun, confirm, say }) {
  if (part === 'cartographie' && !map) throw new Error('Indique la carte : --map Polaris (la cartographie se remet à zéro carte par carte)');
  if (part === 'corrections' && !Number.isInteger(game)) throw new Error('Indique la game : --game 26 (les corrections se remettent à zéro game par game)');
  const args = [part, ...(map ? ['--map', map] : []), ...(game !== undefined ? ['--game', String(game)] : [])];
  const preview = runAnalysisJson(root, 'reset_parts.py', [...args, '--dry-run']);
  say(`Partie « ${part} » : ${JSON.stringify(preview.rows ?? { fichiers: preview.files })} serait effacé.`);
  if (dryRun) return { done: false };
  if (part !== 'cache') say('Ferme le site avant (la base est modifiée) ; une copie de la base est faite juste avant.');
  if (!(await confirm('Remettre à zéro cette partie ?'))) return { done: false };
  const result = runAnalysisJson(root, 'reset_parts.py', args);
  if (result.error) throw new Error(result.error);
  say(`Fait.${result.backup ? ` Copie de la base : ${result.backup}` : ''}`);
  return { done: true, result };
}

async function resetFiles({ root, part, map, dryRun, confirm, say, source }) {
  const info = repoInfo(root);
  const state = readState(root);
  state.files ??= {};
  let dir;
  let from = 'GitHub';
  let cleanup = () => {};
  try {
    const up = await getUpstream(info, { source });
    ({ dir, cleanup } = up);
  } catch (err) {
    dir = join(stateDir(root), 'baseline');
    from = 'la copie gardée à la dernière synchronisation (GitHub injoignable)';
    if (!existsSync(dir)) throw new Error(`GitHub est injoignable (${err.message}) et aucune copie locale n'existe : réessaie en ligne`);
  }
  try {
    const available = new Set(walk(dir).keys());
    const targets = filesOfPart(part, available, map);
    const upstream = hashManaged(dir, new Set(targets));
    const local = hashManaged(root, new Set(targets));
    const changed = targets.filter((p) => local.get(p) !== upstream.get(p));
    say(`Partie « ${part} »${map ? `, carte ${map}` : ''} (${PARTS[part].label}), source : ${from}.`);
    if (!targets.length) {
      say(`Rien à restaurer : ${from.startsWith('GitHub') ? 'GitHub' : 'la copie'} n'a pas de fichier de cette partie${map ? ' pour cette carte' : ''} (les tiens sont gardés).`);
      return { done: false, changed: [] };
    }
    changed.forEach((p) => say(`  ${local.has(p) ? 'remplacé' : 'ajouté'} : ${p}`));
    const jsonPreview = part === 'masques' && map ? runAnalysisJson(root, 'reset_parts.py', ['mapjson', '--map', map, '--upstream', join(dir, 'analysis'), '--dry-run']).files.filter(([, s]) => s !== 'identique' && s !== 'absente') : [];
    jsonPreview.forEach(([f, s]) => say(`  entrée de ${map} ${s === 'retiree' ? 'retirée de' : 'remplacée dans'} ${f}`));
    if (!changed.length && !jsonPreview.length) {
      say('  déjà identique à la version de référence : rien à faire.');
      return { done: false, changed: [] };
    }
    if (dryRun || !(await confirm('Remettre cette partie à la version de référence ? Ta version est sauvegardée avant.'))) return { done: false, changed };
    const backupDir = backupRoot(root, `reset-${part}`);
    for (const p of changed) {
      if (existsSync(join(root, p))) {
        mkdirSync(dirname(join(backupDir, p)), { recursive: true });
        copyFileSync(join(root, p), join(backupDir, p));
      }
      mkdirSync(dirname(join(root, p)), { recursive: true });
      copyFileSync(join(dir, p), join(root, p));
      state.files[p] = sha1File(join(root, p));
      mkdirSync(dirname(baselinePath(root, p)), { recursive: true });
      copyFileSync(join(dir, p), baselinePath(root, p));
    }
    if (jsonPreview.length) {
      for (const [f] of jsonPreview) {
        mkdirSync(join(backupDir, 'analysis'), { recursive: true });
        copyFileSync(join(root, 'analysis', f), join(backupDir, 'analysis', f));
      }
      runAnalysisJson(root, 'reset_parts.py', ['mapjson', '--map', map, '--upstream', join(dir, 'analysis')]);
    }
    const group = part === 'masques' ? (map ? `masques:${map}` : null) : part;
    if (state.kept && group) delete state.kept[group];
    state.pending = (state.pending ?? []).filter((p) => (map ? p.group !== groupOf(`analysis/map_masks/${map}.png`) : p.part !== part));
    writeState(root, state);
    say(`Fait. Ta version est dans ${backupDir}. Les positions déjà lues ne changent qu'à la prochaine analyse.`);
    return { done: true, changed, backupDir };
  } finally {
    cleanup();
  }
}

/** Remise à zéro d'une partie. `confirm(question)` renvoie vrai ou faux. */
export async function runReset(options) {
  const { part } = options;
  if (DB_PARTS.includes(part)) return resetDb(options);
  if (FILE_PARTS.includes(part)) return resetFiles(options);
  throw new Error(`Partie inconnue : « ${part} ». Parties : ${[...FILE_PARTS, ...DB_PARTS].join(', ')}`);
}
