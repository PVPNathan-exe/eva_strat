// Plugin Vite : branche l'API d'analyse sur le serveur de dev (aucun serveur en plus).
//   GET  /api/videos/:id/stream   vidéo locale, avec Range
//   POST /api/ingest              lance analyze.py, renvoie { jobId }
//   POST /api/pick-file           ouvre le sélecteur de fichier Windows, renvoie { path } (null si annulé)
//   GET  /api/jobs/:id/events     progression en SSE
//   GET  /api/weapons             catalogue des icônes d'armes ; PUT /api/weapons/:id nomme une arme ; GET /api/weapons/:id/icon l'image
//   le reste                      handleApi (games, calibrations, vidéos)

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream';
import type { Plugin } from 'vite';
import { handleApi, type ApiContext, type Zones } from './api.ts';
import { openDb } from './db.ts';
import { pickVideoFile } from './filePicker.ts';
import { isAllowedRequest } from './guard.ts';
import { JobManager } from './jobs.ts';
import { parseRange } from './range.ts';
import { effectiveNames, iconFile, listWeapons, setWeaponName } from './weapons.ts';

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString('utf-8')));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        reject(new Error('JSON invalide'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, json: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Données vivantes (le script Python les modifie en dehors de la page) : jamais de cache navigateur.
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(json));
}

function streamVideo(req: IncomingMessage, res: ServerResponse, path: string) {
  let size: number;
  try {
    size = statSync(path).size;
  } catch {
    return sendJson(res, 404, { error: 'Fichier vidéo introuvable sur le disque' });
  }
  const range = parseRange(req.headers.range, size);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', 'video/mp4');
  if (range === 'invalid') {
    res.statusCode = 416;
    res.setHeader('Content-Range', `bytes */${size}`);
    return res.end();
  }
  if (range === null) {
    res.statusCode = 200;
    res.setHeader('Content-Length', size);
    return pipeline(createReadStream(path), res, () => {});
  }
  res.statusCode = 206;
  res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  res.setHeader('Content-Length', range.end - range.start + 1);
  pipeline(createReadStream(path, { start: range.start, end: range.end }), res, () => {});
}

export function analysisPlugin(): Plugin {
  return {
    name: 'eva-analysis',
    configureServer(server) {
      const root = server.config.root;
      const dbPath = join(root, 'data', 'eva.db');
      const cacheDir = join(root, 'data', 'cache');
      const script = join(root, 'analysis', 'analyze.py');
      const python = process.env.EVA_PYTHON ?? 'python';
      const weaponsDir = join(root, 'analysis', 'weapon_icons');

      const ctx: ApiContext = {
        db: openDb(dbPath, join(root, 'analysis', 'schema.sql')),
        defaultZones: JSON.parse(readFileSync(join(root, 'analysis', 'default_zones.json'), 'utf-8')) as Zones,
        weaponNames: () => effectiveNames(ctx.db, weaponsDir),
      };
      const jobs = new JobManager();

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        const method = req.method ?? 'GET';
        if (!isAllowedRequest(method, req.headers)) return sendJson(res, 403, { error: 'Requête refusée' });

        try {
          const stream = /^\/api\/videos\/(\d+)\/stream$/.exec(url.pathname);
          if (stream && method === 'GET') {
            const row = ctx.db.prepare('SELECT path FROM videos WHERE id = ?').get(Number(stream[1])) as { path: string } | undefined;
            if (!row) return sendJson(res, 404, { error: 'Vidéo inconnue' });
            return streamVideo(req, res, row.path);
          }

          if (url.pathname === '/api/ingest' && method === 'POST') {
            const body = (await readJson(req)) as { source?: unknown; detect?: unknown; preRoll?: unknown; postRoll?: unknown; skipIfOk?: unknown; positions?: unknown; posEvery?: unknown } | undefined;
            const source = typeof body?.source === 'string' ? body.source.trim() : '';
            if (!source) return sendJson(res, 400, { error: 'Indique un chemin de fichier ou une URL' });
            try {
              const extra: string[] = [];
              if (body?.detect === false) extra.push('--no-detect');
              if (typeof body?.preRoll === 'number' && Number.isFinite(body.preRoll) && body.preRoll >= 0 && body.preRoll <= 60) {
                extra.push(`--pre-roll=${body.preRoll}`);
              }
              if (typeof body?.postRoll === 'number' && Number.isFinite(body.postRoll) && body.postRoll >= 0 && body.postRoll <= 120) {
                extra.push(`--post-roll=${body.postRoll}`);
              }
              if (body?.skipIfOk === true) extra.push('--skip-if-ok');
              if (body?.positions === true) extra.push('--positions');
              if (Number.isInteger(body?.posEvery) && (body?.posEvery as number) >= 1 && (body?.posEvery as number) <= 60) extra.push(`--pos-every=${body?.posEvery}`);
              const controlPath = join(root, 'data', 'job.control');
              const job = jobs.start(python, [script, `--source=${source}`, '--db', dbPath, '--cache', cacheDir, `--control=${controlPath}`, ...extra], controlPath);
              return sendJson(res, 202, { jobId: job.id });
            } catch (err) {
              return sendJson(res, 409, { error: (err as Error).message });
            }
          }

          if (url.pathname === '/api/weapons' && method === 'GET') return sendJson(res, 200, listWeapons(ctx.db, weaponsDir));
          const weapon = /^\/api\/weapons\/([A-Z]\d+)(\/icon)?$/.exec(url.pathname);
          if (weapon && weapon[2] && method === 'GET') {
            const png = iconFile(weaponsDir, weapon[1]);
            if (!png) return sendJson(res, 404, { error: 'Icône inconnue' });
            res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' });
            return res.end(png);
          }
          if (weapon && !weapon[2] && method === 'PUT') {
            const body = (await readJson(req)) as { name?: unknown } | undefined;
            if (typeof body?.name !== 'string') return sendJson(res, 400, { error: 'Nom manquant' });
            try {
              setWeaponName(weaponsDir, weapon[1], body.name);
            } catch (err) {
              return sendJson(res, 400, { error: (err as Error).message });
            }
            return sendJson(res, 200, { ok: true });
          }

          const control = /^\/api\/jobs\/([\w-]+)\/(pause|resume|stop)$/.exec(url.pathname);
          if (control && method === 'POST') {
            const job = jobs.get(control[1]);
            if (!job || job.finished) return sendJson(res, 404, { error: 'Aucune analyse en cours' });
            job[control[2] as 'pause' | 'resume' | 'stop']();
            return sendJson(res, 200, { ok: true });
          }

          const events = /^\/api\/jobs\/([\w-]+)\/events$/.exec(url.pathname);
          if (events && method === 'GET') {
            const job = jobs.get(events[1]);
            if (!job) return sendJson(res, 404, { error: 'Job inconnu' });
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });
            const unsubscribe = job.subscribe((event) => {
              res.write(`data: ${JSON.stringify(event)}\n\n`);
              if (event.event === 'done' || event.event === 'error') res.end();
            });
            req.on('close', unsubscribe);
            return;
          }

          if (url.pathname === '/api/pick-file' && method === 'POST') {
            try {
              return sendJson(res, 200, { path: await pickVideoFile() });
            } catch (err) {
              return sendJson(res, 500, { error: (err as Error).message });
            }
          }

          const body = method === 'GET' || method === 'DELETE' ? undefined : await readJson(req);
          const result = handleApi(ctx, method, url.pathname, url.searchParams, body);
          return sendJson(res, result.status, result.json);
        } catch (err) {
          return sendJson(res, 500, { error: (err as Error).message });
        }
      });
    },
  };
}
