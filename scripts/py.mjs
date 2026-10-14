// Lance un programme Python du dossier analysis/ avec l'interpréteur trouvé par le projet (voir maj/python.mjs), en lui passant les arguments :
//   npm run stats -- --all        calcule les tables Stats de toutes les games qui ont des positions (analysis/stats_run.py)
//   node scripts/py.mjs analysis/recap.py --video 2

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findPython } from './maj/python.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error('Indique le programme : node scripts/py.mjs analysis/stats_run.py --all');
  process.exit(1);
}
const python = findPython();
if (!python) {
  console.error('Python 3.10 ou plus introuvable : lance « npm run setup » pour voir ce qui manque.');
  process.exit(1);
}
const result = spawnSync(python, [join(root, script), ...args], { cwd: root, stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
process.exit(result.status ?? 1);
