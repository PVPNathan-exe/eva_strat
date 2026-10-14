// Empreintes des fichiers et état des mises à jour (`.eva/state.json`).
// L'état garde, pour chaque fichier, l'empreinte de la version GitHub avec laquelle il a été synchronisé pour la dernière fois (« base ») : un fichier qui diffère de sa base a été modifié
// par l'utilisateur. Sans base (première fois), tout fichier qui diffère de GitHub est considéré comme modifié (prudence).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { partOf } from './parts.mjs';

export const sha1File = (path) => createHash('sha1').update(readFileSync(path)).digest('hex');

const SKIP_ANYWHERE = new Set(['node_modules', '.git', '__pycache__', '.pytest_cache']);
const SKIP_TOP_LEVEL = new Set(['.eva', 'data', 'dist', 'dist-ssr']);

/** Tous les fichiers sous `dir` : Map « chemin relatif avec / » vers chemin absolu. */
export function walk(dir, rel = '', out = new Map()) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const r = rel ? `${rel}/${name}` : name;
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      if (!SKIP_ANYWHERE.has(name) && !(rel === '' && SKIP_TOP_LEVEL.has(name))) walk(abs, r, out);
    } else out.set(r, abs);
  }
  return out;
}

/** Empreintes (chemin relatif vers sha1) des fichiers gérés d'un dossier : tout sauf ce que partOf refuse. */
export function hashManaged(dir, only = null) {
  const out = new Map();
  for (const [rel, abs] of walk(dir)) {
    if (partOf(rel) === null || (only && !only.has(rel))) continue;
    out.set(rel, sha1File(abs));
  }
  return out;
}

export const stateDir = (root) => join(root, '.eva');
const stateFile = (root) => join(stateDir(root), 'state.json');

export function readState(root) {
  try {
    return JSON.parse(readFileSync(stateFile(root), 'utf-8'));
  } catch {
    return { sha: null, files: {}, kept: {}, pending: [] };
  }
}

export function writeState(root, state) {
  mkdirSync(stateDir(root), { recursive: true });
  writeFileSync(stateFile(root), JSON.stringify(state, null, 1));
}
