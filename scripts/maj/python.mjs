// Interpréteur Python utilisable : EVA_PYTHON, sinon le premier qui répond en version 3.10 ou plus (le raccourci du Microsoft Store est écarté).

import { execFileSync } from 'node:child_process';

const win = process.platform === 'win32';

const tryRun = (cmd, args) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
  } catch {
    return null;
  }
};

export function findPython() {
  if (process.env.EVA_PYTHON) return process.env.EVA_PYTHON;
  for (const name of win ? ['python', 'python3', 'py'] : ['python3', 'python']) {
    const found = tryRun(win ? 'where' : 'which', [name]);
    for (const path of (found ?? '').split(/\r?\n/).map((p) => p.trim()).filter(Boolean)) {
      if (tryRun(path, ['-c', 'import sys; assert sys.version_info >= (3, 10)']) !== null) return path;
    }
  }
  return null;
}

/** Lance un programme d'analysis/ et renvoie sa sortie JSON (dernière ligne) ; lève une erreur lisible sinon. */
export function runAnalysisJson(root, script, args) {
  const python = findPython();
  if (!python) throw new Error('Python 3.10 ou plus introuvable');
  let out;
  try {
    out = execFileSync(python, [`${root}/analysis/${script}`, ...args], { encoding: 'utf-8', cwd: root, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, maxBuffer: 50 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    const last = String(err.stderr ?? '').trim().split('\n').filter(Boolean).pop()?.trim();
    throw new Error(last || err.message);
  }
  const line = out.trim().split(/\r?\n/).filter(Boolean).pop();
  return JSON.parse(line ?? '');
}
