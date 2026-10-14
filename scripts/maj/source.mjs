// Où est la version de GitHub : dépôt et branche (`eva-update.json`), numéro de la dernière version (une requête légère) et téléchargement de la branche (une archive de quelques Mo).
// Sans Git ni compte : le dépôt est public. Pour les essais, EVA_UPDATE_SOURCE désigne un dossier qui joue le rôle de GitHub.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { walk } from './manifest.mjs';

const DEFAULT_INFO = { repo: 'PVPNathan-exe/eva_strat', branch: 'main' };

/** Dépôt et branche suivis : `eva-update.json` à la racine, sinon les valeurs par défaut. */
export function repoInfo(root) {
  try {
    return { ...DEFAULT_INFO, ...JSON.parse(readFileSync(join(root, 'eva-update.json'), 'utf-8')) };
  } catch {
    return { ...DEFAULT_INFO };
  }
}

async function fetchWithTimeout(url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, headers: { 'User-Agent': 'eva-strat-maj', ...options.headers } });
  } finally {
    clearTimeout(timer);
  }
}

/** Numéro (sha) de la dernière version de la branche, ou une erreur si GitHub est injoignable (hors ligne). */
export async function remoteSha({ repo, branch }, timeoutMs = 4000) {
  const res = await fetchWithTimeout(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`, timeoutMs, { headers: { Accept: 'application/vnd.github.sha' } });
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
  return (await res.text()).trim();
}

/** Télécharge la branche et la décompresse (tar : présent dans Windows 10 et plus, macOS, Linux). Renvoie le dossier de l'arbre. */
async function downloadTree({ repo, branch }, work, timeoutMs) {
  const res = await fetchWithTimeout(`https://codeload.github.com/${repo}/tar.gz/refs/heads/${encodeURIComponent(branch)}`, timeoutMs);
  if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status})`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(join(work, 'up.tgz')));
  mkdirSync(join(work, 'x'));
  // chemins relatifs et cwd : un « C: » dans un chemin serait pris pour une machine distante par le tar de GNU
  const out = spawnSync('tar', ['-xzf', 'up.tgz', '-C', 'x'], { cwd: work, encoding: 'utf-8' });
  if (out.status !== 0) throw new Error(`Décompression impossible : ${(out.stderr || out.error?.message || '').trim().split('\n')[0]}`);
  const [top] = readdirSync(join(work, 'x')).filter((n) => statSync(join(work, 'x', n)).isDirectory());
  if (!top) throw new Error('Archive vide');
  return join(work, 'x', top);
}

/** Empreinte d'un dossier qui joue le rôle de GitHub (essais). */
function folderSha(dir) {
  const h = createHash('sha1');
  for (const [rel, abs] of [...walk(dir)].sort(([a], [b]) => a.localeCompare(b))) h.update(rel).update(readFileSync(abs));
  return `dossier-${h.digest('hex').slice(0, 12)}`;
}

/**
 * Version de GitHub : { sha, dir, cleanup }. `check` : ne demande que le numéro (dir est alors null).
 * `source` (ou EVA_UPDATE_SOURCE) : dossier local à la place de GitHub.
 */
export async function getUpstream(info, { source = process.env.EVA_UPDATE_SOURCE, check = false, timeoutMs = 180000 } = {}) {
  if (source) {
    if (!existsSync(source)) throw new Error(`Dossier source introuvable : ${source}`);
    return { sha: folderSha(source), dir: check ? null : source, cleanup: () => {} };
  }
  const sha = await remoteSha(info);
  if (check) return { sha, dir: null, cleanup: () => {} };
  const work = mkdtempSync(join(tmpdir(), 'eva-maj-'));
  try {
    const dir = await downloadTree(info, work, timeoutMs);
    return { sha, dir, cleanup: () => rmSync(work, { recursive: true, force: true }) };
  } catch (err) {
    rmSync(work, { recursive: true, force: true });
    throw err;
  }
}
