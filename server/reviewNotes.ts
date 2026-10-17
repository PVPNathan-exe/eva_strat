// Routes /api/review-notes : notes de review posées sur la reconstruction sous la vidéo (table review_notes).
// Ces notes n'ont AUCUN effet sur les données lues (suivi, stats, corrections) : ce module n'écrit que dans review_notes (et lit games pour vérifier l'id).

import type { ApiContext, ApiResult } from './api.ts';

type Row = Record<string, unknown>;

const KINDS = ['position', 'action', 'note'];
const COLUMNS = 'id, game_id, t, slot, kind, x, y, angle, gadget, text, created_at, x2, y2';
/** Gadgets qui se posent avec un deuxième point : le SHIELD est un trait (début et fin), le CLONE une direction et une distance (le point visé ; le trajet s'arrête au premier obstacle). */
const TWO_POINT_GADGETS = ['SHIELD', 'CLONE'];
const COORD_MIN = -0.2; // minimap normalisée, avec un peu de marge hors du cadre
const COORD_MAX = 1.2;
const TEXT_MAX = 2000;
const GADGET_MAX = 60;

const reply = (status: number, json: unknown): ApiResult => ({ status, json });
const fail = (error: string, status = 400): ApiResult => reply(status, { error });
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNil = (v: unknown): boolean => v === undefined || v === null;

/** Champs d'une note, tels qu'ils seront écrits. */
interface Fields {
  t: number;
  slot: number | null;
  x: number | null;
  y: number | null;
  x2: number | null;
  y2: number | null;
  angle: number | null;
  gadget: string | null;
  text: string;
}

/** Une coordonnée facultative : null si absente, le nombre si valide, sinon un message d'erreur. */
function coord(name: string, v: unknown): number | null | string {
  if (isNil(v)) return null;
  if (!isNum(v) || v < COORD_MIN || v > COORD_MAX) return `${name} doit être un nombre entre -0,2 et 1,2 (fraction de la minimap)`;
  return v;
}

/** Champs exigés selon le kind ; renvoie le message d'erreur ou null. */
function requiredMissing(kind: string, f: Fields): string | null {
  if (kind === 'note') return f.text ? null : 'Une note libre exige un texte (text)';
  if (f.slot === null || f.x === null || f.y === null) return `Une note '${kind}' exige le joueur (slot), x et y`;
  if (kind === 'action' && !f.gadget) return "Une note 'action' exige aussi le gadget";
  if (kind === 'action' && f.gadget && TWO_POINT_GADGETS.includes(f.gadget.toUpperCase()) && (f.x2 === null || f.y2 === null)) {
    return `Une action ${f.gadget.toUpperCase()} exige un deuxième point (x2 et y2) : ${f.gadget.toUpperCase() === 'SHIELD' ? 'la fin du trait' : 'le point visé (direction et distance)'}`;
  }
  return null;
}

/** Valide et normalise les champs (valeurs brutes de la requête) ; renvoie un message d'erreur en français ou les champs propres. */
function checkFields(kind: string, raw: Row): Fields | string {
  if (!isNum(raw.t) || raw.t < 0) return "L'instant t doit être un nombre fini, positif ou nul (secondes depuis le début de la game)";
  let slot: number | null = null;
  if (!isNil(raw.slot)) {
    if (!isNum(raw.slot) || !Number.isInteger(raw.slot) || raw.slot < 1 || raw.slot > 8) return 'Le joueur (slot) doit être un entier de 1 à 8';
    slot = raw.slot;
  }
  const x = coord('x', raw.x);
  if (typeof x === 'string') return x;
  const y = coord('y', raw.y);
  if (typeof y === 'string') return y;
  const x2 = coord('x2', raw.x2);
  if (typeof x2 === 'string') return x2;
  const y2 = coord('y2', raw.y2);
  if (typeof y2 === 'string') return y2;
  if ((x2 === null) !== (y2 === null)) return 'x2 et y2 vont ensemble (les deux ou aucun)';
  let angle: number | null = null;
  if (!isNil(raw.angle)) {
    if (!isNum(raw.angle)) return "L'angle doit être un nombre fini (degrés)";
    angle = raw.angle;
  }
  let gadget: string | null = null;
  if (!isNil(raw.gadget)) {
    if (typeof raw.gadget !== 'string' || raw.gadget.trim().length > GADGET_MAX) return `Le gadget doit être un texte de ${GADGET_MAX} caractères au plus`;
    gadget = raw.gadget.trim() || null;
  }
  let text = '';
  if (!isNil(raw.text)) {
    if (typeof raw.text !== 'string') return 'Le texte doit être une chaîne de caractères';
    text = raw.text.trim();
    if (text.length > TEXT_MAX) return `Le texte doit faire ${TEXT_MAX} caractères au plus`;
  }
  const fields: Fields = { t: raw.t, slot, x, y, x2, y2, angle, gadget, text };
  return requiredMissing(kind, fields) ?? fields;
}

function listNotes(ctx: ApiContext, query: URLSearchParams): ApiResult {
  const raw = query.get('game');
  const gameId = raw === null || raw === '' ? NaN : Number(raw);
  if (!Number.isInteger(gameId)) return fail('Paramètre game manquant ou invalide');
  const rows = ctx.db.prepare(`SELECT ${COLUMNS} FROM review_notes WHERE game_id = ? ORDER BY t, id`).all(gameId) as Row[];
  return reply(200, rows.map((r) => ({ ...r })));
}

function createNote(ctx: ApiContext, body: Row): ApiResult {
  if (!isNum(body.game_id) || !Number.isInteger(body.game_id)) return fail('Game invalide (game_id doit être un entier)');
  if (typeof body.kind !== 'string' || !KINDS.includes(body.kind)) return fail("Type de note inconnu (kind : 'position', 'action' ou 'note')");
  const f = checkFields(body.kind, body);
  if (typeof f === 'string') return fail(f);
  if (!ctx.db.prepare('SELECT id FROM games WHERE id = ?').get(body.game_id)) return fail('Game inconnue', 404);
  const r = ctx.db
    .prepare('INSERT INTO review_notes (game_id, t, slot, kind, x, y, x2, y2, angle, gadget, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(body.game_id, f.t, f.slot, body.kind, f.x, f.y, f.x2, f.y2, f.angle, f.gadget, f.text);
  const row = ctx.db.prepare(`SELECT ${COLUMNS} FROM review_notes WHERE id = ?`).get(Number(r.lastInsertRowid)) as Row;
  return reply(201, { ...row });
}

function updateNote(ctx: ApiContext, id: number, body: Row): ApiResult {
  const current = ctx.db.prepare(`SELECT ${COLUMNS} FROM review_notes WHERE id = ?`).get(id) as Row | undefined;
  if (!current) return fail('Note introuvable', 404);
  if ('kind' in body && body.kind !== current.kind) return fail('Le type de la note (kind) ne se modifie pas');
  const merged: Row = { ...current };
  for (const key of ['t', 'slot', 'x', 'y', 'x2', 'y2', 'angle', 'gadget', 'text']) if (key in body) merged[key] = body[key];
  const f = checkFields(current.kind as string, merged);
  if (typeof f === 'string') return fail(f);
  ctx.db
    .prepare('UPDATE review_notes SET t = ?, slot = ?, x = ?, y = ?, x2 = ?, y2 = ?, angle = ?, gadget = ?, text = ? WHERE id = ?')
    .run(f.t, f.slot, f.x, f.y, f.x2, f.y2, f.angle, f.gadget, f.text, id);
  const row = ctx.db.prepare(`SELECT ${COLUMNS} FROM review_notes WHERE id = ?`).get(id) as Row;
  return reply(200, { ...row });
}

function deleteNote(ctx: ApiContext, id: number): ApiResult {
  const r = ctx.db.prepare('DELETE FROM review_notes WHERE id = ?').run(id);
  return r.changes ? reply(200, { ok: true }) : fail('Note introuvable', 404);
}

const notAllowed = (method: string, pathname: string, allowed: string): ApiResult => fail(`Méthode ${method} non permise sur ${pathname} : ${allowed}`, 405);

/** Répond aux routes /api/review-notes[/:id] ; null si la route n'en est pas une (handleApi continue alors). */
export function handleReviewNotes(ctx: ApiContext, method: string, pathname: string, query: URLSearchParams, body?: unknown): ApiResult | null {
  if (pathname !== '/api/review-notes' && !pathname.startsWith('/api/review-notes/')) return null;
  const payload = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Row;
  if (pathname === '/api/review-notes') {
    if (method === 'GET') return listNotes(ctx, query);
    if (method === 'POST') return createNote(ctx, payload);
    return notAllowed(method, pathname, 'GET ou POST');
  }
  const m = /^\/api\/review-notes\/(\d+)$/.exec(pathname);
  if (!m) return fail('Note introuvable', 404);
  const id = Number(m[1]);
  if (method === 'PUT') return updateNote(ctx, id, payload);
  if (method === 'DELETE') return deleteNote(ctx, id);
  return notAllowed(method, pathname, 'PUT ou DELETE');
}
