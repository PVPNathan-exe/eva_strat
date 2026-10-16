// Chronologie des épisodes (vues Retakes et Rotations de l'onglet Stats) : bandes de propriétaire et de point actif d'une game, repères des épisodes sur la frise,
// positions des joueurs vivants à l'instant du curseur, cadres des points, filtre d'équipe et de joueur, couleur par équipe NOMMÉE.
// Fonctions pures : temps en secondes depuis le début de la game (comme les tables Stats), positions en fractions de la minimap, aucune dépendance au navigateur.

import type { Episode, PointActive, PointOwner, TeamSide } from '../types/stats.ts';
import { involvesSlot, type Tone } from './episodeFormat.ts';
import { keptSides, paletteOf, wantedSlot, type FollowGame, type FollowSpec, type Palette } from './teamFollow.ts';
import { formatTime, spanToPct } from './timeline.ts';
import { waveInfo } from './waveInfo.ts';
import { waveIssueInfo, type MarkShape } from './waveOutcome.ts';

// ---------------------------------------------------------------- équipes et filtres

/** Numéro de joueur qui représente un côté : sert à demander la palette d'un côté entier (le côté A est l'équipe orange de gauche, le B la bleue de droite). */
export const sideSlot = (side: TeamSide): number => (side === 'A' ? 1 : 5);

/** Palette d'un côté de la game : « a » pour l'équipe suivie (par son NOM, quel que soit son côté), « b » pour ses adversaires ; sans équipe suivie, A donne « a » et B donne « b ». */
export const paletteOfSide = (game: Pick<FollowGame, 'teamA' | 'teamB'>, spec: FollowSpec, side: TeamSide): Palette => paletteOf(game, spec, sideSlot(side));

/** Nom d'une équipe de la game, avec un repli sur sa couleur quand la vidéo n'a pas de nom. */
export const sideName = (g: Pick<FollowGame, 'teamA' | 'teamB'>, side: TeamSide | null): string => (side === 'B' ? (g.teamB ?? 'équipe bleue') : (g.teamA ?? 'équipe orange'));

/** Couleur d'un propriétaire de point : palette de son équipe nommée, ou « none » (point neutre). */
export const toneOfOwner = (game: Pick<FollowGame, 'teamA' | 'teamB'>, spec: FollowSpec, owner: TeamSide | 'none'): Palette | 'none' => (owner === 'none' ? 'none' : paletteOfSide(game, spec, owner));

/** L'épisode entre dans le réglage : son équipe est l'un des côtés montrés et, si un joueur est choisi, ce joueur y participe. */
export function episodeInScope(ep: Episode, game: FollowGame, spec: FollowSpec): boolean {
  if (ep.team && !keptSides(game, spec).includes(ep.team)) return false;
  const wanted = wantedSlot(game, spec);
  return wanted !== null && involvesSlot(ep, wanted);
}

/** Épisodes séparés par palette (équipe suivie « a », adversaires « b ») : une équipe nommée garde sa couleur d'une game à l'autre même si elle change de côté. */
export function episodesByPalette(eps: Episode[], gameOf: (gameId: number) => FollowGame | undefined, spec: FollowSpec): Record<Palette, Episode[]> {
  const out: Record<Palette, Episode[]> = { a: [], b: [] };
  for (const e of eps) {
    const game = gameOf(e.game_id);
    if (game && e.team) out[paletteOfSide(game, spec, e.team)].push(e);
  }
  return out;
}

// ---------------------------------------------------------------- bandes de la frise

/** Un segment de la frise, en pourcentage de la durée de la game. */
export interface Band {
  left: number;
  width: number;
  t0: number;
  t1: number;
}

export interface OwnerBand extends Band {
  owner: TeamSide | 'none';
  tone: Palette | 'none';
}

/** Segment [t0, t1] ramené dans la game ; null s'il est vide ou hors de la game. */
export function bandOf(t0: number, t1: number, duration: number): Band | null {
  const a = Math.min(Math.max(t0, 0), duration);
  const b = Math.min(Math.max(t1, 0), duration);
  if (!(b > a) || duration <= 0) return null;
  const left = spanToPct(a, 0, duration);
  return { left, width: spanToPct(b, 0, duration) - left, t0: a, t1: b };
}

/** Bandes de propriétaire d'un point sur toute la game, dans l'ordre du temps. */
export function ownerBands(owners: PointOwner[], point: string, duration: number, toneOf: (owner: TeamSide | 'none') => Palette | 'none'): OwnerBand[] {
  return owners
    .filter((o) => o.point === point)
    .sort((x, y) => x.t0 - y.t0)
    .flatMap((o) => {
      const b = bandOf(o.t0, o.t1, duration);
      return b ? [{ ...b, owner: o.owner, tone: toneOf(o.owner) }] : [];
    });
}

/** Périodes où un point est actif (point_active) sur toute la game. */
export function activeBands(active: PointActive[], point: string, duration: number): Band[] {
  return active
    .filter((a) => a.point === point)
    .sort((x, y) => x.t0 - y.t0)
    .flatMap((a) => {
      const b = bandOf(a.t0, a.t1, duration);
      return b ? [b] : [];
    });
}

/** Points d'une game : lettres vues dans les propriétaires, le point actif et les épisodes, dans l'ordre alphabétique. */
export function pointsOf(owners: PointOwner[], active: PointActive[], eps: Episode[], known: string[] = []): string[] {
  // `known` : les points de la carte même s'ils ne sont jamais lus dans cette game (Outlaw a 5 points A à E, le E peut ne jamais s'allumer)
  const set = new Set<string>([...known, ...owners.map((o) => o.point), ...active.map((a) => a.point)]);
  for (const e of eps) for (const p of [e.point, e.point_to]) if (p) set.add(p);
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------- repères des épisodes

export type MarkKind = MarkShape | 'rotation';

/** Barre d'une vague sur la frise : du départ du spawn à la résolution, avec le repère du premier kill (positions en pourcentage de la durée de la game). */
export interface WaveBar {
  left: number;
  width: number;
  /** Position du premier kill ; null sans contact. */
  contactLeft: number | null;
  /** Vitesse de la vague (rapide ou progressive) ; null sans contact. */
  speed: 'rapide' | 'progressif' | null;
  /** Rangée de la barre dans sa ligne (0 en haut) : deux vagues qui se chevauchent ne se cachent pas. */
  row: number;
}

/** Un repère sur la frise : un épisode (ou un changement de point actif) à son instant clé, avec sa fenêtre en fond. Une vague a en plus une barre (`bar`). */
export interface EpisodeMark {
  /** Clé stable du repère (identifiant de l'épisode, ou clé du changement de point). */
  key: string;
  point: string;
  kind: MarkKind;
  tone: Tone;
  /** Instant clé (s) et position en pourcentage : pour une vague, sa résolution (fin de la barre, là où se pose le symbole de l'issue). */
  t: number;
  left: number;
  /** Fenêtre de l'épisode (début au curseur en cas de clic), en pourcentage. */
  spanLeft: number;
  spanWidth: number;
  /** Équipe de l'épisode (palette), null si inconnue. */
  palette: Palette | null;
  label: string;
  bar?: WaveBar;
}

/** Forme du repère d'une ligne de retake selon son issue (nouvelle ou ancienne, voir waveOutcome.ts). */
export const markKind = (ep: Pick<Episode, 'outcome' | 'data'>): MarkKind => waveIssueInfo(ep).shape;

/** Largeur minimale d'une barre de vague (pourcentage de la game) : une vague très courte reste visible et cliquable. */
export const MIN_BAR_PCT = 0.5;

/**
 * Repère d'une vague : barre du départ (`t_start`) à la résolution (`t_end`), repère du premier kill (`t_contact`), symbole de l'issue à la fin, couleur de l'équipe (palette).
 * Une ancienne ligne (sans `data.wave`) devient une barre de son début à sa fin.
 */
export function retakeMark(ep: Episode, duration: number, palette: Palette | null): EpisodeMark {
  const w = waveInfo(ep);
  const info = waveIssueInfo(ep);
  const t0 = w?.tStart ?? ep.t0;
  const t1 = Math.max(w?.tEnd ?? ep.t1, t0);
  const win = bandOf(t0, t1, duration);
  const left = win?.left ?? spanToPct(t0, 0, duration);
  const width = Math.max(win?.width ?? 0, MIN_BAR_PCT);
  const contact = w?.tContact ?? null;
  const speed = w?.speed ? ` (${w.speed === 'rapide' ? 'rapide' : 'progressif'})` : '';
  return {
    key: String(ep.id),
    point: ep.point ?? '?',
    kind: info.shape,
    tone: info.tone,
    t: t1,
    left: spanToPct(t1, 0, duration),
    spanLeft: left,
    spanWidth: width,
    palette,
    label: `${formatTime(t0)} : ${info.short}${speed}`,
    bar: { left, width, contactLeft: contact !== null && contact >= t0 && contact <= t1 ? spanToPct(contact, 0, duration) : null, speed: w?.speed ?? null, row: 0 },
  };
}

/** Écart minimal (pourcentage de la game) entre la fin d'une barre et le début de la suivante sur une même rangée : place pour le symbole de l'issue. */
export const BAR_GAP_PCT = 1.5;

/** Rangée de chaque barre : rangement glouton par début, une barre prend la première rangée libre (deux vagues qui se chevauchent sont superposées). Renvoie un indice de rangée par barre, dans l'ordre d'entrée. */
export function packRows(bars: { left: number; width: number }[], gap: number = BAR_GAP_PCT): number[] {
  const rows: number[] = new Array(bars.length).fill(0);
  const ends: number[] = [];
  const order = bars.map((_, i) => i).sort((a, b) => bars[a].left - bars[b].left || a - b);
  for (const i of order) {
    let r = ends.findIndex((end) => end + gap <= bars[i].left);
    if (r < 0) {
      r = ends.length;
      ends.push(0);
    }
    ends[r] = bars[i].left + bars[i].width;
    rows[i] = r;
  }
  return rows;
}

/** Une ligne de la frise : un point avec ses bandes de propriétaire, ses périodes actives et ses repères. */
export interface Lane {
  point: string;
  owners: OwnerBand[];
  active: Band[];
  marks: EpisodeMark[];
  /** Nombre de rangées de barres de vague (1 sans barre) : la ligne grandit avec elles. */
  rows: number;
}

/** Repères d'un point, les barres de vague rangées sans se chevaucher. */
function laneMarks(marks: EpisodeMark[]): { marks: EpisodeMark[]; rows: number } {
  const bars = marks.filter((m) => m.bar);
  if (bars.length === 0) return { marks, rows: 1 };
  const rows = packRows(bars.map((m) => m.bar as WaveBar));
  const placed = new Map(bars.map((m, i) => [m.key, rows[i]]));
  return { marks: marks.map((m) => (m.bar ? { ...m, bar: { ...m.bar, row: placed.get(m.key) ?? 0 } } : m)), rows: Math.max(...rows) + 1 };
}

/** Lignes de la frise : un par point, les repères rangés sur le point de leur ligne. */
export function buildLanes(points: string[], owners: PointOwner[], active: PointActive[], marks: EpisodeMark[], duration: number, toneOf: (owner: TeamSide | 'none') => Palette | 'none'): Lane[] {
  return points.map((point) => {
    const placed = laneMarks(marks.filter((m) => m.point === point));
    return { point, owners: ownerBands(owners, point, duration, toneOf), active: activeBands(active, point, duration), marks: placed.marks, rows: placed.rows };
  });
}

/** Graduations de l'axe de la frise : une par minute (une toutes les deux minutes au-delà de 15 minutes), sans dépasser la durée. */
export function axisTicks(duration: number): { t: number; left: number; label: string }[] {
  const step = duration > 900 ? 120 : 60;
  const out: { t: number; left: number; label: string }[] = [];
  for (let t = 0; t <= duration; t += step) out.push({ t, left: spanToPct(t, 0, duration), label: formatTime(t) });
  return out;
}

/** Instant (s) d'un clic à la fraction `fraction` (0 à 1) de la largeur de la frise. */
export const timeAtFraction = (fraction: number, duration: number): number => Math.min(duration, Math.max(0, fraction * duration));

/** Épisodes dont la fenêtre contient l'instant. */
export const episodesAt = <T extends { t0: number; t1: number }>(eps: T[], t: number): T[] => eps.filter((e) => e.t0 <= t && t <= e.t1);

// ---------------------------------------------------------------- positions au curseur

/** Positions lues d'un joueur vivant, triées par temps (colonnes parallèles). */
export interface SlotTrack {
  t: number[];
  x: number[];
  y: number[];
}

/** Lignes de suivi vivantes, rangées par joueur et triées ; `samples` en temps de game (useSamples). */
export function indexSamples(samples: { t: number; slot: number; x: number; y: number; alive: number | boolean }[]): Map<number, SlotTrack> {
  const rows = new Map<number, { t: number; x: number; y: number }[]>();
  for (const s of samples) {
    if (!s.alive) continue;
    const list = rows.get(s.slot) ?? [];
    list.push({ t: s.t, x: s.x, y: s.y });
    rows.set(s.slot, list);
  }
  const out = new Map<number, SlotTrack>();
  for (const [slot, list] of rows) {
    list.sort((a, b) => a.t - b.t);
    out.set(slot, { t: list.map((r) => r.t), x: list.map((r) => r.x), y: list.map((r) => r.y) });
  }
  return out;
}

/** Plus grand indice i tel que ts[i] <= t (-1 si t précède toutes les valeurs). `ts` est trié. */
export function lastAtOrBefore(ts: number[], t: number): number {
  let lo = 0;
  let hi = ts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Durée (s) pendant laquelle un joueur reste à sa dernière position lue (la cadence du suivi est de 10 lignes par seconde) : au-delà il est mort ou illisible, il disparaît. */
export const MAX_HOLD_S = 1.0;

export interface Pawn {
  slot: number;
  x: number;
  y: number;
}

/** Joueurs vivants à l'instant t : dernière position lue, si elle date de moins de MAX_HOLD_S. Un joueur mort n'a plus de ligne vivante : il n'apparaît pas. */
export function positionsAt(index: Map<number, SlotTrack>, t: number, maxHold: number = MAX_HOLD_S): Pawn[] {
  const out: Pawn[] = [];
  for (const [slot, tr] of index) {
    const i = lastAtOrBefore(tr.t, t);
    if (i >= 0 && t - tr.t[i] <= maxHold) out.push({ slot, x: tr.x[i], y: tr.y[i] });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

// ---------------------------------------------------------------- cadres des points

/** Cadre d'un point (x0, y0, x1, y1) en fractions de la minimap. */
export type Rect = [number, number, number, number];

/** Cadres des points tracés (map_capture.json) : une lettre par polygone dans l'ordre du fichier, comme analysis/point_owner.point_rects. */
export function rectsFromPolygons(polys: [number, number][][]): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  polys.forEach((poly, k) => {
    if (poly.length === 0) return;
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    out[String.fromCharCode(65 + k)] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
  return out;
}

/** Cadres des boîtes vues (map_capture_points.json, Outlaw) : centre et taille vers cadre. */
export function rectsFromBoxes(points: Record<string, { x: number; y: number; w: number; h: number }>): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  for (const [k, p] of Object.entries(points)) out[k] = [p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2];
  return out;
}
