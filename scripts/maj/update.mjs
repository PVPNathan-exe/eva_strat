// Mise à jour du projet depuis GitHub (branche main) : `npm run maj`, et un contrôle rapide à chaque `npm start`.
//
// Ce qui se fait sans rien demander : remplacer le CODE (interface, serveur, programmes Python, docs) par la version de GitHub, après sauvegarde dans `.eva/backup/`.
// Ce qui ne se fait JAMAIS sans accord : toute partie sensible (masques et cartes, réglages du suivi, icônes d'armes, modèles) : elle est seulement signalée, puis `npm run maj -- sensibles`
// compare ta version à celle de GitHub et te laisse choisir. `data/` (base, cache) n'est jamais touché.
// Installation clonée avec Git (dossier .git) : rien n'est écrit, Git reste maître (le programme dit s'il y a du nouveau).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { applyItems, backupRoot } from './apply.mjs';
import { hashManaged, readState, writeState } from './manifest.mjs';
import { isSensitive, groupOf } from './parts.mjs';
import { planUpdate, summarize } from './plan.mjs';
import { getUpstream, repoInfo } from './source.mjs';

/** Éléments sensibles à décider (hors ceux déjà gardés tels quels pour cette version de GitHub). */
export function pendingFrom(items, state, sha) {
  return items
    .filter((i) => isSensitive(i.part) && (i.action === 'diverge' || i.action === 'add'))
    .map((i) => ({ path: i.path, part: i.part, action: i.action, untouched: i.untouched, group: groupOf(i.path) }))
    .filter((i) => state.kept?.[i.group] !== sha);
}

/** Mode Git : la version `sha` de GitHub est-elle déjà dans l'historique du dossier ? (sans télécharger quoi que ce soit) */
function gitHasCommit(root, sha) {
  const run = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf-8' }).status === 0;
  return run('cat-file', '-e', `${sha}^{commit}`) && run('merge-base', '--is-ancestor', sha, 'HEAD');
}

/**
 * Contrôle et mise à jour. Renvoie { status, sha, applied, pending, gitMode, summary } avec status :
 * 'hors-ligne' | 'a-jour' | 'mis-a-jour' | 'nouveautes-git' (mode Git : rien d'écrit).
 */
export async function runUpdate({ root, source, force = false, dryRun = false, timeoutMs } = {}) {
  const info = repoInfo(root);
  const state = readState(root);
  state.files ??= {};
  state.kept ??= {};
  const gitMode = existsSync(join(root, '.git')) && !process.env.EVA_FORCE_UPDATE;

  let remote;
  try {
    remote = await getUpstream(info, { source, check: true });
  } catch (err) {
    return { status: 'hors-ligne', reason: err.message, pending: state.pending ?? [], gitMode };
  }
  if (gitMode) return { status: gitHasCommit(root, remote.sha) ? 'a-jour' : 'nouveautes-git', sha: remote.sha, pending: [], gitMode };
  if (remote.sha === state.sha && !force) return { status: 'a-jour', sha: remote.sha, pending: state.pending ?? [], gitMode };

  const up = await getUpstream(info, { source, timeoutMs });
  try {
    const upstreamHashes = hashManaged(up.dir);
    const paths = new Set([...upstreamHashes.keys(), ...Object.keys(state.files)]);
    const local = hashManaged(root, paths);
    const items = planUpdate(new Map(Object.entries(state.files)), local, upstreamHashes);
    const summary = summarize(items);
    const todo = items.filter((i) => !isSensitive(i.part) && ['overwrite', 'add', 'delete'].includes(i.action));
    const pending = pendingFrom(items, state, up.sha);

    if (dryRun) return { status: 'a-faire', sha: up.sha, summary, todo: todo.map((i) => `${i.action} ${i.path}`), pending, gitMode };

    const backupDir = backupRoot(root);
    const sync = items.filter((i) => i.action === 'same' || todo.includes(i));
    const applied = applyItems({ root, upstreamDir: up.dir, items: sync, state, upstreamHashes, backupDir });
    state.sha = up.sha;
    state.checkedAt = new Date().toISOString();
    state.pending = pending;
    writeState(root, state);
    return { status: applied.overwrite + applied.add + applied.delete > 0 ? 'mis-a-jour' : 'a-jour', sha: up.sha, applied, summary, pending, gitMode, backupDir: applied.backedUp ? backupDir : null, changed: todo.map((i) => `${i.action} ${i.path}`) };
  } finally {
    up.cleanup();
  }
}
