// Prépare le projet après un clone ou un pull, puis (avec --run) lance le site.
//   npm run setup   installe ce qui manque (npm, Python, ffmpeg), sans rien lancer
//   npm start       idem, puis lance le serveur (http://localhost:5173)
// Relançable à volonté : ce qui est déjà en place est simplement vérifié.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const run = process.argv.includes('--run');
const log = (msg) => console.log(`[setup] ${msg}`);
const fail = (msg) => {
  console.error(`[setup] ERREUR : ${msg}`);
  process.exit(1);
};

const tryRun = (cmd, args, opts = {}) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000, ...opts });
  } catch {
    return null;
  }
};

// Node 22 ou plus (node:sqlite, tests en TypeScript natif).
if (Number(process.versions.node.split('.')[0]) < 22) fail(`Node 22 ou plus requis (version actuelle : ${process.versions.node}).`);

// 1. Dépendances du site : à refaire si node_modules est absent ou plus ancien que le verrou.
const lock = join(root, 'package-lock.json');
const modules = join(root, 'node_modules');
if (!existsSync(modules) || (existsSync(lock) && statSync(modules).mtimeMs < statSync(lock).mtimeMs)) {
  log('npm install…');
  execFileSync(win ? 'npm.cmd' : 'npm', ['install'], { cwd: root, stdio: 'inherit', shell: win });
} else log('dépendances npm : ok');

// 2. Python : le premier interpréteur qui répond (le raccourci du Microsoft Store est écarté).
function findPython() {
  if (process.env.EVA_PYTHON) return process.env.EVA_PYTHON;
  for (const name of win ? ['python', 'python3', 'py'] : ['python3', 'python']) {
    const found = tryRun(win ? 'where' : 'which', [name]);
    for (const path of (found ?? '').split(/\r?\n/).map((p) => p.trim()).filter(Boolean)) {
      if (tryRun(path, ['-c', 'import sys; assert sys.version_info >= (3, 10)']) !== null) return path;
    }
  }
  return null;
}
const python = findPython();
if (!python) fail('Python 3.10 ou plus introuvable. Installez-le (https://www.python.org/downloads/ ou « winget install Python.Python.3.13 »), puis relancez.');
log(`Python : ${python}`);

const modulesOk = tryRun(python, ['-c', 'import cv2, numpy, yt_dlp']) !== null;
if (!modulesOk) {
  log('installation des bibliothèques Python…');
  execFileSync(python, ['-m', 'pip', 'install', '-r', join(root, 'analysis', 'requirements.txt')], { stdio: 'inherit' });
} else log('bibliothèques Python : ok');

// 3. ffmpeg et ffprobe dans le PATH (sous Windows, installés par winget si absents).
const hasFfmpeg = () => tryRun('ffmpeg', ['-version']) !== null && tryRun('ffprobe', ['-version']) !== null;
if (!hasFfmpeg() && win) {
  log('ffmpeg absent : installation par winget…');
  try {
    execFileSync('winget', ['install', '--id', 'Gyan.FFmpeg', '-e', '--accept-source-agreements', '--accept-package-agreements'], { stdio: 'inherit' });
  } catch {
    // vérifié juste après
  }
  // winget modifie le PATH du système, pas celui de ce processus : on le relit.
  const fresh = tryRun('powershell', ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"]);
  if (fresh) process.env.PATH = fresh.trim();
}
if (!hasFfmpeg()) fail('ffmpeg et ffprobe introuvables dans le PATH. Installez-les (https://ffmpeg.org/download.html), puis relancez.');
log('ffmpeg : ok');

// 4. Dossier des données (base SQLite, cache) : créé au besoin ; la base se crée au premier lancement.
mkdirSync(join(root, 'data'), { recursive: true });

if (!run) {
  log('prêt. Lancez « npm start » pour démarrer le site.');
  process.exit(0);
}

log('démarrage du serveur : http://localhost:5173');
const child = spawn(win ? 'npx.cmd' : 'npx', ['vite', '--open'], { cwd: root, stdio: 'inherit', shell: win, env: { ...process.env, EVA_PYTHON: python } });
child.on('exit', (code) => process.exit(code ?? 0));
