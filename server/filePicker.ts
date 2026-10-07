// Ouvre la fenêtre « Ouvrir un fichier » de Windows côté serveur et renvoie le chemin choisi.
// Un navigateur ne donne pas le chemin d'un fichier sélectionné : c'est le serveur local qui le demande.

import { spawn } from 'node:child_process';

const SCRIPT = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Choisir une vidéo de partie'
$dialog.Filter = 'Vidéos (*.mp4;*.mkv;*.mov;*.webm)|*.mp4;*.mkv;*.mov;*.webm|Tous les fichiers (*.*)|*.*'
if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }
`;

/** Dernière ligne non vide de la sortie, ou null si le sélecteur a été annulé. */
export function parsePickerOutput(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

export function pickVideoFile(): Promise<string | null> {
  if (process.platform !== 'win32') {
    return Promise.reject(new Error('Le bouton Parcourir n’est disponible que sous Windows : colle le chemin du fichier'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-STA', '-NonInteractive', '-Command', SCRIPT], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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
