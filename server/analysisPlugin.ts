// Plugin Vite : branche l'API d'analyse sur le serveur de dev (aucun serveur en plus).
//   GET  /api/videos/:id/stream   vidéo locale, avec Range
//   POST /api/ingest              lance analyze.py, renvoie { jobId }
//   GET  /api/jobs/:id/events     progression en SSE
//   le reste                      handleApi (games, calibrations, vidéos)

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { handleApi, type ApiContext, type Zones } from './api.ts';
import { openDb } from './db.ts';
import { JobManager } from './jobs.ts';
import { parseRange } from './range.ts';

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
    return createReadStream(path).pipe(res);
  }
  res.statusCode = 206;
  res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
  res.setHeader('Content-Length', range.end - range.start + 1);
  createReadStream(path, { start: range.start, end: range.end }).pipe(res);
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

      const ctx: ApiContext = {
        db: openDb(dbPath, join(root, 'analysis', 'schema.sql')),
        defaultZones: JSON.parse(readFileSync(join(root, 'analysis', 'default_zones.json'), 'utf-8')) as Zones,
      };
      const jobs = new JobManager();

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://localhost');
        const method = req.method ?? 'GET';

        try {
          const stream = /^\/api\/videos\/(\d+)\/stream$/.exec(url.pathname);
          if (stream && method === 'GET') {
            const row = ctx.db.prepare('SELECT path FROM videos WHERE id = ?').get(Number(stream[1])) as { path: string } | undefined;
            if (!row) return sendJson(res, 404, { error: 'Vidéo inconnue' });
            return streamVideo(req, res, row.path);
          }

          if (url.pathname === '/api/ingest' && method === 'POST') {
            const body = (await readJson(req)) as { source?: unknown } | undefined;
            const source = typeof body?.source === 'string' ? body.source.trim() : '';
            if (!source) return sendJson(res, 400, { error: 'Indique un chemin de fichier ou une URL' });
            try {
              const job = jobs.start(python, [script, '--source', source, '--db', dbPath, '--cache', cacheDir]);
              return sendJson(res, 202, { jobId: job.id });
            } catch (err) {
              return sendJson(res, 409, { error: (err as Error).message });
            }
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
