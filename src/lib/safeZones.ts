// Zones couvertes par chaque équipe à un instant, et zones sûres.
//
// DEUX ZONES PAR JOUEUR. Un joueur vivant a une zone de TIR (les cases qu'une balle peut atteindre : les vitres, les fenêtres et les portes vitrées fermées bloquent, la portée
// utile de son arme limite, lib/weaponRange.ts) et une zone de VISION (les cases qu'il voit : les vitres laissent voir, même portée par défaut, VISION_RANGE_M pour la changer).
// La vision contient toujours le tir. Le regard n'est pas utilisé (toutes les directions). Les positions viennent des lignes de suivi en temps de game.
//
// ZONE SÛRE. Une case est « couverte » par une équipe quand un de ses joueurs la VOIT ou peut la TIRER. Elle est sûre pour une équipe quand elle est couverte par elle seule :
// une case vue par l'ennemi à travers une vitre n'est donc PAS sûre (elle est repérée), même hors de portée de tir ou protégée des balles. Les cases « repérées sans
// être tirables » sont comptées à part (counts.sightOnlyA et sightOnlyB) et la couche peut montrer la zone de tir seule ou la zone de vision seule (zonePixels, `show`).
//
// PORTES. Fermées par défaut, elles bloquent la vue et les balles. Une porte s'ouvre quand un joueur vivant, de n'importe quelle équipe, est à DOOR_OPEN_M mètres ou
// moins de son segment (positions de l'instant choisi). Une porte vitrée fermée laisse voir et bloque les balles ; ouverte, elle laisse tout passer.
// `doors: null` : portes ouvertes en permanence (comme avant).
//
// ÉTAGES. Sur Atlantis et The Cliff le masque est l'union des deux niveaux. Quand le niveau d'un joueur est connu (`level: 'etage'`) et que la grille a été construite avec
// l'image « dessous » (buildGrid, 5e paramètre), il voit avec la grille de l'étage (le sol réservé au niveau du dessous n'y est pas praticable). Niveau inconnu ou rez-de-chaussée :
// grille commune. LIMITE : les lignes de suivi n'ont pas de niveau (il n'existe que dans les corrections à la main), donc le niveau est inconnu pour tous les joueurs tant que
// l'appelant ne le renseigne pas ; `Instant.unknownLevel` dit combien de joueurs sont dans ce cas sur une carte à deux étages.

import { castView, doorsOpenedBy, DOOR_OPEN_M, layerGrid, viewPolygon, withClosedDoors, withOpenedGlass, withRotors, type BlockGrid, type Level, type Segment, type SightMode, type View } from './visibility.ts';
import type { RotorModel } from './rotors.ts';
import { medianRange, rangeOfPlayer, type IconNames } from './weaponRange.ts';

/** Écart (s) au plus entre l'instant demandé et la ligne de suivi d'un joueur. */
export const MAX_GAP_S = 1.5;
/** Cache : nombre d'instants gardés. */
export const CACHE_SIZE = 32;
/** Portée de la vision (mètres) : null, la vision a la même portée que le tir (la zone « repérée sans être tirable » vient alors des vitres et des portes seulement) ;
 *  un nombre (OPEN_RANGE_M pour toute la ligne de vue) étend la vision au delà de la portée de l'arme. Jamais plus courte que la portée de tir. */
export const VISION_RANGE_M: number | null = null;

/** Ligne de suivi, temps de game. */
export interface PositionSample {
  t: number;
  slot: number;
  team: 'A' | 'B';
  x: number;
  y: number;
  alive: number;
  /** Niveau sur une carte à deux étages, quand il est connu (corrections à la main) ; absent ou null : inconnu. */
  level?: Level | null;
}

/** Un joueur qui couvre : position, portée (mètres) et si elle est estimée. */
export interface Shooter {
  slot: number;
  team: 'A' | 'B';
  x: number;
  y: number;
  rangeM: number;
  estimated: boolean;
  /** Arme qui donne la portée (null quand elle est estimée) et portée sans limite. */
  weapon?: string | null;
  open?: boolean;
  /** Portée de vision de ce joueur (mètres), sinon VISION_RANGE_M, sinon la portée de tir. */
  visionM?: number;
  /** Niveau du joueur sur une carte à deux étages, inconnu quand absent ou null. */
  level?: Level | null;
}

/** Portée de vision d'un joueur : jamais sous sa portée de tir. */
export const visionRangeOf = (s: Shooter): number => Math.max(s.rangeM, s.visionM ?? VISION_RANGE_M ?? s.rangeM);

/** Lignes de suivi rangées par joueur et triées par temps (à faire une fois par game). */
export function indexSamples(samples: PositionSample[]): Map<number, PositionSample[]> {
  const by = new Map<number, PositionSample[]>();
  for (const s of samples) {
    const list = by.get(s.slot);
    if (list) list.push(s);
    else by.set(s.slot, [s]);
  }
  for (const list of by.values()) list.sort((a, b) => a.t - b.t);
  return by;
}

/** Ligne la plus proche de t dans une liste triée (recherche par dichotomie). */
function nearest(list: PositionSample[], t: number): PositionSample | null {
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = list[lo];
  const b = lo > 0 ? list[lo - 1] : null;
  return a && b ? (Math.abs(b.t - t) <= Math.abs(a.t - t) ? b : a) : (a ?? b);
}

/** Joueurs vivants à l'instant t : la ligne de suivi la plus proche (à MAX_GAP_S près), qui doit être vivante. */
export function positionsAt(index: Map<number, PositionSample[]>, t: number, maxGapS = MAX_GAP_S): PositionSample[] {
  const out: PositionSample[] = [];
  for (const list of index.values()) {
    const s = nearest(list, t);
    if (s && s.alive && Math.abs(s.t - t) <= maxGapS) out.push(s);
  }
  return out.sort((a, b) => a.slot - b.slot);
}

/** Joueurs vivants et leur portée : arme lue du joueur (la plus longue des deux), sinon médiane des armes lues dans la game (marquée estimée). */
export function shootersAt(positions: PositionSample[], players: { slot: number; weapon1: string | null; weapon2: string | null }[], names: IconNames = {}): Shooter[] {
  const fallback = medianRange(players.flatMap((p) => [p.weapon1, p.weapon2]), names);
  return positions.map((p) => {
    const mine = players.find((q) => q.slot === p.slot);
    const r = rangeOfPlayer(mine?.weapon1, mine?.weapon2, fallback, names);
    return { slot: p.slot, team: p.team, x: p.x, y: p.y, rangeM: r.rangeM, estimated: r.estimated, weapon: r.weapon, open: r.open, level: p.level ?? null };
  });
}

/** Bits de l'état d'une case. */
export const COVER_A = 1;
export const COVER_B = 2;

/** Ce que compte comme « couvert » : `balles` (zone de tir seule), `vue` (zone de vision seule), `tous` (vision ou tir, la règle des zones sûres). */
export type CoverMode = SightMode | 'tous';

export interface ZoneResult {
  w: number;
  h: number;
  /** Par case : COVER_A et/ou COVER_B selon le mode (0 : personne ne couvre). `tous` : vision ou tir. Les cases de mur ne sont jamais couvertes. */
  state: Uint8Array;
  /** Zone de tir seule (COVER_A, COVER_B) : rempli en mode `balles` et `tous`. */
  shot: Uint8Array;
  /** Zone de vision seule (COVER_A, COVER_B) : rempli en mode `vue` et `tous`. */
  seen: Uint8Array;
  shooters: Shooter[];
  /** Vue de chaque joueur (vision, ou tir en mode `balles`) et zone de tir de chacun (même tableau en mode `balles`). */
  views: View[];
  shotViews: View[];
}

/** Les deux grilles d'un joueur : celle des balles et celle de la vue. */
export interface ZoneGrids {
  shot: BlockGrid;
  sight: BlockGrid;
}

/** Vrai si deux grilles bloquent exactement les mêmes cases (même tableau, ou mêmes valeurs). */
function sameBlocking(a: BlockGrid, b: BlockGrid): boolean {
  if (a.blocked === b.blocked) return true;
  for (let i = 0; i < a.blocked.length; i++) if (a.blocked[i] !== b.blocked[i]) return false;
  return true;
}

/**
 * Zones à partir des joueurs : union des vues de chaque équipe. `pick` donne les deux grilles de chaque joueur (niveau, portes, anneaux déjà posés). Quand ces grilles sont
 * identiques et que la vision a la même portée que le tir, un seul jeu de rayons sert aux deux zones.
 */
function computeDual(pick: (s: Shooter) => ZoneGrids, shooters: Shooter[], size: { w: number; h: number }, mode: CoverMode): ZoneResult {
  const n = size.w * size.h;
  const shotMark = { A: new Uint8Array(n), B: new Uint8Array(n) };
  const seenMark = { A: new Uint8Array(n), B: new Uint8Array(n) };
  const same = new Map<ZoneGrids, boolean>();
  const empty = (s: Shooter): View => ({ x: s.x, y: s.y, rangeM: s.rangeM, dist: new Float32Array(0) });
  const shotViews: View[] = [];
  const views: View[] = [];
  for (const s of shooters) {
    const g = pick(s);
    if (!same.has(g)) same.set(g, sameBlocking(g.shot, g.sight));
    const vr = visionRangeOf(s);
    if (mode === 'tous' && same.get(g) && vr === s.rangeM) {
      const v = castView(g.sight, s.x, s.y, vr, seenMark[s.team], shotMark[s.team]);
      shotViews.push(v);
      views.push(v);
      continue;
    }
    const shotView = mode === 'vue' ? empty(s) : castView(g.shot, s.x, s.y, s.rangeM, shotMark[s.team]);
    const seenView = mode === 'balles' ? shotView : castView(g.sight, s.x, s.y, vr, seenMark[s.team]);
    shotViews.push(shotView);
    views.push(seenView);
  }
  const bits = (m: { A: Uint8Array; B: Uint8Array }) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = (m.A[i] ? COVER_A : 0) | (m.B[i] ? COVER_B : 0);
    return out;
  };
  const shot = bits(shotMark);
  const seen = bits(seenMark);
  const state = new Uint8Array(n);
  for (let i = 0; i < n; i++) state[i] = mode === 'balles' ? shot[i] : mode === 'vue' ? seen[i] : shot[i] | seen[i];
  return { w: size.w, h: size.h, state, shot, seen, shooters, views, shotViews };
}

/** Zones couvertes à partir des joueurs sur une seule grille (tir et vision identiques) : union des vues de chaque équipe. `sight` : grille de la vue, si elle diffère de celle du tir. */
export function computeZones(grid: BlockGrid, shooters: Shooter[], sight: BlockGrid = grid, mode: CoverMode = 'tous'): ZoneResult {
  const grids: ZoneGrids = { shot: grid, sight };
  return computeDual(() => grids, shooters, grid, mode);
}

/**
 * Surfaces en nombre de cases libres : sûres pour A, sûres pour B, couvertes par les deux, non couvertes (hors murs). `sightOnlyA` et `sightOnlyB` : cases que l'équipe
 * ne fait que voir (aucun de ses joueurs ne peut les tirer), par exemple derrière une vitre.
 */
export function zoneCounts(result: ZoneResult, grid: BlockGrid): { safeA: number; safeB: number; contested: number; uncovered: number; open: number; sightOnlyA: number; sightOnlyB: number } {
  const c = { safeA: 0, safeB: 0, contested: 0, uncovered: 0, open: 0, sightOnlyA: 0, sightOnlyB: 0 };
  for (let i = 0; i < result.state.length; i++) {
    if (grid.blocked[i]) continue;
    c.open++;
    const s = result.state[i];
    if (s === COVER_A) c.safeA++;
    else if (s === COVER_B) c.safeB++;
    else if (s === (COVER_A | COVER_B)) c.contested++;
    else c.uncovered++;
    if (result.seen[i] & COVER_A && !(result.shot[i] & COVER_A)) c.sightOnlyA++;
    if (result.seen[i] & COVER_B && !(result.shot[i] & COVER_B)) c.sightOnlyB++;
  }
  return c;
}

export type Rgb = [number, number, number];

/** Couleurs de la couche (jetons de tokens.css lus par l'appelant) et opacité 0 à 255. */
export interface ZoneColors {
  a: Rgb;
  b: Rgb;
  contested: Rgb;
  alpha: number;
}

/** Ce que la couche dessine : les zones sûres (`safe`, règle vision ou tir), la zone de tir seule (`shot`) ou la zone de vision seule (`seen`). */
export type ZoneShow = 'safe' | 'shot' | 'seen';

/** Pixels RGBA de la couche : zone de A seul, de B seul, des deux (moins opaque). `only` limite à une équipe (la zone contestée reste montrée). */
export function zonePixels(result: ZoneResult, colors: ZoneColors, only: 'A' | 'B' | 'all' = 'all', show: ZoneShow = 'safe'): Uint8ClampedArray {
  const px = new Uint8ClampedArray(result.w * result.h * 4);
  const source = show === 'shot' ? result.shot : show === 'seen' ? result.seen : result.state;
  for (let i = 0; i < source.length; i++) {
    const s = source[i];
    let color: Rgb | null = null;
    let alpha = colors.alpha;
    if (s === COVER_A && only !== 'B') color = colors.a;
    else if (s === COVER_B && only !== 'A') color = colors.b;
    else if (s === (COVER_A | COVER_B)) {
      color = colors.contested;
      alpha = colors.alpha * 0.55;
    }
    if (!color) continue;
    px[i * 4] = color[0];
    px[i * 4 + 1] = color[1];
    px[i * 4 + 2] = color[2];
    px[i * 4 + 3] = alpha;
  }
  return px;
}

/** Contours (fractions de la minimap) de la vue de chaque joueur de l'instant : `vue` la zone de vision, `tir` la zone de tir. */
export const outlinesOf = (result: ZoneResult, kind: 'vue' | 'tir' = 'vue'): { slot: number; team: 'A' | 'B'; points: [number, number][] }[] =>
  (kind === 'tir' ? result.shotViews : result.views).map((v, i) => ({ slot: result.shooters[i].slot, team: result.shooters[i].team, points: viewPolygon(v) }));

/** Petit cache par instant (le plus ancien sorti en premier). */
export function createCache<T>(max = CACHE_SIZE) {
  const map = new Map<string, T>();
  return {
    get(key: string): T | undefined {
      const v = map.get(key);
      if (v !== undefined) {
        map.delete(key); // le plus récemment lu passe en dernier
        map.set(key, v);
      }
      return v;
    },
    set(key: string, value: T) {
      map.set(key, value);
      if (map.size > max) map.delete(map.keys().next().value as string);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}

/** Ce qu'il faut pour calculer un instant. */
export interface InstantInput {
  base: BlockGrid;
  /** Ce qui compte comme couvert (défaut `tous` : vision ou tir). `balles` et `vue` redonnent l'ancien calcul à une seule zone. */
  mode?: CoverMode;
  /** Portes opaques de la carte (segments), fermées sauf si un joueur est à doorOpenM : ou null, portes ouvertes en permanence. */
  doors: Segment[] | null;
  /** Portes vitrées de la carte (segments) : fermées, elles laissent voir et bloquent les balles ; ouvertes (joueur proche), tout passe. null ou absent : sans effet. */
  glassDoors?: Segment[] | null;
  /** Distance d'ouverture des portes en mètres (défaut DOOR_OPEN_M). */
  doorOpenM?: number;
  /** Anneaux tournants de la carte (Engine), ou null. */
  rotors: RotorModel | null;
  /** Instant de game (s), utile aux anneaux. */
  t: number;
  shooters: Shooter[];
}

/** État d'une porte à l'instant : son segment, si elle est ouverte (un joueur à moins de doorOpenM) et si elle est vitrée. */
export interface DoorState {
  segment: Segment;
  open: boolean;
  glass: boolean;
}

export interface Instant {
  result: ZoneResult;
  counts: ReturnType<typeof zoneCounts>;
  /** Durée du calcul en millisecondes (grille de l'instant comprise). */
  ms: number;
  /** Portes de l'instant (opaques puis vitrées), vide sans portes. */
  doors: DoorState[];
  /** Grille de la carte à l'instant (portes, anneaux) qui a servi à compter les surfaces. */
  grid: BlockGrid;
  /** Joueurs dont le niveau est inconnu sur une carte à deux étages (étages mélangés pour eux) ; 0 sur les autres cartes. */
  unknownLevel: number;
}

/** Calcul complet d'un instant : grilles (étage, anneaux, portes), vues, zones et surfaces. */
export function computeInstant(input: InstantInput): Instant {
  const t0 = performance.now();
  const mode = input.mode ?? 'tous';
  const openM = input.doorOpenM ?? DOOR_OPEN_M;
  const solid = input.doors ?? [];
  const glass = input.glassDoors ?? [];
  const solidOpen = doorsOpenedBy(solid, input.shooters, openM);
  const glassOpen = doorsOpenedBy(glass, input.shooters, openM);
  const closed = solid.filter((_, i) => !solidOpen[i]);
  const doorStates: DoorState[] = [
    ...solid.map((segment, i) => ({ segment, open: solidOpen[i], glass: false })),
    ...glass.map((segment, i) => ({ segment, open: glassOpen[i], glass: true })),
  ];
  const hasLevels = Boolean(input.base.layers?.etage);
  const cache = new Map<string, ZoneGrids>();
  const gridsOf = (level: Level | null): ZoneGrids => {
    const key = level ?? '';
    const hit = cache.get(key);
    if (hit) return hit;
    let shot = layerGrid(input.base, 'balles', level);
    let sight = layerGrid(input.base, 'vue', level);
    const shared = shot.blocked === sight.blocked && !input.rotors; // pas de vitre : une seule grille travaillée
    if (input.rotors) {
      shot = withRotors(shot, input.rotors, input.t, 'balles');
      sight = withRotors(sight, input.rotors, input.t, 'vue');
    }
    if (!shared) shot = withOpenedGlass(shot, sight, glass.filter((_, i) => glassOpen[i]));
    if (closed.length > 0) {
      shot = withClosedDoors(shot, closed);
      sight = shared ? shot : withClosedDoors(sight, closed);
    } else if (shared) sight = shot;
    const grids = { shot, sight };
    cache.set(key, grids);
    return grids;
  };
  const levelOf = (s: Shooter): Level | null => (hasLevels && s.level === 'etage' ? 'etage' : null);
  const result = computeDual((s) => gridsOf(levelOf(s)), input.shooters, input.base, mode);
  const reference = gridsOf(null);
  const grid = mode === 'balles' ? reference.shot : reference.sight;
  const counts = zoneCounts(result, grid);
  const unknownLevel = hasLevels ? input.shooters.filter((s) => !s.level).length : 0;
  return { result, counts, ms: performance.now() - t0, doors: doorStates, grid, unknownLevel };
}
