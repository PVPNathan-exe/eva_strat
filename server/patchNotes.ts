// Routes des patch notes du jeu, remplies au démarrage par scripts/patches/watch.mjs (data/patch_notes/index.json).
//   GET /api/patch-notes         patchs nouveaux pas encore relus : { patches: [{ slug, title, date, url, excerpts, reviewed, detectedAt }] } (liste vide sans fichier)
//   PUT /api/patch-notes/:slug   { reviewed: true } marque le patch relu (seule écriture ; aucune valeur de jeu n'est jamais modifiée ici)

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PatchNotesContext {
  /** Dossier des données (EVA_DATA_DIR ou `data/` : le même que celui de la veille). */
  dataDir: string;
}

export interface PatchNote {
  slug: string;
  title: string;
  date: string | null;
  url: string;
  excerpts: string[];
  reviewed: boolean;
  detectedAt?: string;
}

export interface PatchNotesResult {
  status: number;
  json: unknown;
}

const indexPath = (ctx: PatchNotesContext) => join(ctx.dataDir, 'patch_notes', 'index.json');

/** Index des patchs ; vide si le fichier manque ou est illisible. */
function readIndex(ctx: PatchNotesContext): PatchNote[] {
  try {
    const parsed = JSON.parse(readFileSync(indexPath(ctx), 'utf-8')) as { patches?: unknown };
    return Array.isArray(parsed.patches) ? (parsed.patches as PatchNote[]).filter((p) => p && typeof p.slug === 'string') : [];
  } catch {
    return [];
  }
}

/** Écriture atomique : fichier temporaire puis renommage. */
function writeIndex(ctx: PatchNotesContext, patches: PatchNote[]): void {
  mkdirSync(join(ctx.dataDir, 'patch_notes'), { recursive: true });
  const tmp = `${indexPath(ctx)}.tmp`;
  writeFileSync(tmp, JSON.stringify({ patches }, null, 2));
  renameSync(tmp, indexPath(ctx));
}

/** Répond aux routes /api/patch-notes ; null si la route n'en est pas une. */
export function handlePatchNotes(ctx: PatchNotesContext, method: string, pathname: string, _query?: URLSearchParams, body?: unknown): PatchNotesResult | null {
  if (pathname === '/api/patch-notes') {
    if (method !== 'GET') return { status: 405, json: { error: `Méthode ${method} non permise sur ${pathname} : GET seulement` } };
    return { status: 200, json: { patches: readIndex(ctx).filter((p) => !p.reviewed) } };
  }
  const one = /^\/api\/patch-notes\/([A-Za-z0-9._-]{1,200})$/.exec(pathname);
  if (!one) return null;
  if (method !== 'PUT') return { status: 405, json: { error: `Méthode ${method} non permise sur ${pathname} : PUT seulement` } };
  if ((body as { reviewed?: unknown } | null)?.reviewed !== true) return { status: 400, json: { error: 'Corps attendu : { "reviewed": true }' } };
  const patches = readIndex(ctx);
  const target = patches.find((p) => p.slug === one[1]);
  if (!target) return { status: 404, json: { error: `Patch inconnu : ${one[1]}` } };
  target.reviewed = true;
  writeIndex(ctx, patches);
  return { status: 200, json: { ok: true } };
}
