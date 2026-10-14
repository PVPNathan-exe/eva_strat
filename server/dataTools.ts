// Données de l'utilisateur côté serveur : place prise, export et import en fichiers JSON, nettoyage du cache, choix d'un dossier.
// Le travail est fait par analysis/data_usage.py et analysis/data_export.py (même base que le site) ; ici : validation, lancement, réponse.
//   GET  /api/data/usage         place prise (base, sauvegardes, cache, vidéos téléchargées, icônes)
//   POST /api/data/export        { folder }              exporte toutes les games vers le dossier
//   POST /api/data/import        { folder, dryRun? }     importe un export (refusé pendant une analyse)
//   POST /api/data/purge-cache   efface les lectures gardées (elles se refont)
//   POST /api/pick-folder        sélecteur de dossier Windows, renvoie { path } (null si annulé)

import { execFile, spawn } from 'node:child_process';
import { join } from 'node:path';
import { parsePickerOutput } from './filePicker.ts';

export interface DataContext {
  python: string;
  root: string;
  dbPath: string;
  /** Une analyse est en cours : l'import (qui écrit dans la base) est refusé. */
  analysisRunning: () => boolean;
}

export interface DataResult {
  status: number;
  json: unknown;
}

/** Dossier valide pour la ligne de commande : texte non vide, sans retour à la ligne ni caractère nul. null sinon. */
export function safeFolder(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const folder = value.trim();
  return folder.length > 0 && folder.length <= 500 && !/[\0\r\n]/.test(folder) ? folder : null;
}

function runPython(ctx: DataContext, script: string, args: string[], timeoutMs: number): Promise<DataResult> {
  return new Promise((resolve) => {
    execFile(
      ctx.python,
      [join(ctx.root, 'analysis', script), ...args, '--db', ctx.dbPath, '--json'],
      { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, PYTHONIOENCODING: 'utf-8' }, cwd: ctx.root },
      (err, stdout, stderr) => {
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
        try {
          const json = JSON.parse(line ?? '');
          resolve({ status: json?.error ? 500 : 200, json });
        } catch {
          resolve({ status: 500, json: { error: (stderr.trim().split('\n').pop() || err?.message || 'Réponse illisible').slice(0, 300) } });
        }
      },
    );
  });
}

const FOLDER_SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Choisir un dossier (clé, disque externe ou dossier de sauvegarde)'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }
`;

export function pickFolder(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Le sélecteur de dossier n’est disponible que sous Windows : colle le chemin du dossier'));
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-STA', '-NonInteractive', '-Command', FOLDER_SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf-8');
    child.stdout.on('data', (c: string) => (out += c));
    child.stderr.setEncoding('utf-8');
    child.stderr.on('data', (c: string) => (err += c));
    child.on('error', (e) => reject(new Error(`Impossible d’ouvrir le sélecteur : ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(err.trim().split('\n')[0] || `Le sélecteur s’est arrêté (code ${code})`));
      else resolve(parsePickerOutput(out));
    });
  });
}

/** Répond aux routes de données ; null si la route n'en est pas une. */
export async function handleData(ctx: DataContext, method: string, pathname: string, body: unknown): Promise<DataResult | null> {
  if (pathname === '/api/pick-folder' && method === 'POST') {
    try {
      return { status: 200, json: { path: await pickFolder() } };
    } catch (err) {
      return { status: 500, json: { error: (err as Error).message } };
    }
  }
  if (!pathname.startsWith('/api/data/')) return null;
  if (pathname === '/api/data/usage' && method === 'GET') return runPython(ctx, 'data_usage.py', [], 60_000);
  if (pathname === '/api/data/purge-cache' && method === 'POST') return runPython(ctx, 'data_usage.py', ['--purge-eval-cache'], 60_000);
  if ((pathname === '/api/data/export' || pathname === '/api/data/import') && method === 'POST') {
    const payload = (body ?? {}) as { folder?: unknown; dryRun?: unknown };
    const folder = safeFolder(payload.folder);
    if (!folder) return { status: 400, json: { error: 'Indique un dossier' } };
    if (pathname === '/api/data/export') return runPython(ctx, 'data_export.py', ['export', folder], 900_000);
    if (payload.dryRun !== true && ctx.analysisRunning()) return { status: 409, json: { error: 'Une analyse est en cours : attends sa fin avant d’importer' } };
    return runPython(ctx, 'data_export.py', ['import', folder, ...(payload.dryRun === true ? ['--dry-run'] : [])], 900_000);
  }
  return null;
}
