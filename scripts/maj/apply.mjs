// Application d'un plan : copie les fichiers de GitHub, jamais sans avoir sauvegardé ce qu'ils remplacent dans `.eva/backup/<date>/`.
// Pour les parties sensibles, une copie de la version GitHub est gardée dans `.eva/baseline/` : elle sert de point de départ à « reset » quand GitHub n'est pas joignable.

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isSensitive } from './parts.mjs';
import { stateDir } from './manifest.mjs';

export const backupRoot = (root, label = '') => join(stateDir(root), 'backup', `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}${label ? `-${label}` : ''}`);
export const baselinePath = (root, rel) => join(stateDir(root), 'baseline', rel);

function copyInto(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

/**
 * Applique des éléments de plan. `upstreamHashes` : empreintes de GitHub. Met à jour `state.files` (la base) et renvoie ce qui a été fait.
 * Les actions keep et diverge ne font rien ici (l'appelant décide).
 */
export function applyItems({ root, upstreamDir, items, state, upstreamHashes, backupDir }) {
  const done = { overwrite: 0, add: 0, delete: 0, same: 0, backedUp: 0 };
  for (const { path, part, action } of items) {
    const local = join(root, path);
    const upstream = upstreamDir ? join(upstreamDir, path) : null;
    if (action === 'overwrite' || action === 'add') {
      if (existsSync(local)) {
        copyInto(local, join(backupDir, path));
        done.backedUp += 1;
      }
      copyInto(upstream, local);
    } else if (action === 'delete') {
      copyInto(local, join(backupDir, path));
      done.backedUp += 1;
      rmSync(local);
      delete state.files[path];
      done.delete += 1;
      continue;
    } else if (action !== 'same') continue;
    state.files[path] = upstreamHashes.get(path);
    done[action] += 1;
    if (isSensitive(part) && upstream && !existsSync(baselinePath(root, path))) copyInto(upstream, baselinePath(root, path));
    else if (isSensitive(part) && upstream && action !== 'same') copyInto(upstream, baselinePath(root, path));
  }
  return done;
}
