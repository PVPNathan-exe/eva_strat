// Vue Équipe de l'onglet Stats : fonctions pures (aucune lecture de la page) qui préparent les réponses de /api/stats/team-summary pour le dessin et les tableaux.
// Grilles : mise en grille, lissage, écrêtage au 98e centile (comme heatGrid), différence kills moins morts par case ; seuil minimal de games ; joueurs par pseudo ; issues des vagues.
// Les couleurs viennent de tokens.css, lues par l'appelant puis passées en paramètre. Rien n'est inventé : une valeur null reste null.

import { blur, gridFromCells, heatColor, normalize, percentile, type Rgb } from './heatGrid.ts';
import { WAVE_ISSUES } from './waveOutcome.ts';
import type { TeamCell, TeamDuels, TeamPlayer, TeamSideName, TeamWaveTally } from '../types/statsTeam.ts';

/** Nombre de vagues décidées sous lequel un taux n'est pas affiché (même règle que la vue Retakes). */
export const MIN_DECIDED_WAVES = 5;
/** Part du 98e centile de l'appui (kills + morts lissés) sous laquelle une case de la différence est masquée : trop peu d'événements pour conclure (convention). */
export const MIN_SUPPORT_SHARE = 0.1;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Calques

/** Calques du plan, un seul à la fois. */
export type LayerId = 'presence_left' | 'presence_right' | 'deaths' | 'kills' | 'duels_lost' | 'duels_won' | 'kd';

/** heat : une chaleur dans la couleur de l'équipe ; pair : deux chaleurs (équipe et adversaires) à la même échelle ; diverging : différence signée. */
export type LayerKind = 'heat' | 'pair' | 'diverging';

export interface LayerDef {
  id: LayerId;
  label: string;
  kind: LayerKind;
  /** Vrai : le serveur ne donne ce calque que pour l'équipe entière, pas par joueur. */
  teamOnly: boolean;
  /** Ce que signifie le calque (légende, une phrase). */
  meaning: string;
}

export const LAYERS: LayerDef[] = [
  { id: 'presence_left', label: "Présence quand l'équipe est à gauche", kind: 'heat', teamOnly: false, meaning: "Temps passé vivant par case quand l'équipe jouait à gauche : ses positions préférées de ce côté." },
  { id: 'presence_right', label: "Présence quand l'équipe est à droite", kind: 'heat', teamOnly: false, meaning: "Temps passé vivant par case quand l'équipe jouait à droite : ses positions préférées de ce côté." },
  { id: 'deaths', label: 'Morts', kind: 'heat', teamOnly: true, meaning: "Où les joueurs de l'équipe meurent (nombre de morts par case)." },
  { id: 'kills', label: 'Kills', kind: 'pair', teamOnly: true, meaning: "Couleur de l'équipe : où elle meurt. Couleur des adversaires : où ils meurent, donc où l'équipe marque ses kills. Même échelle pour les deux." },
  { id: 'duels_lost', label: 'Duels perdus', kind: 'heat', teamOnly: true, meaning: "Cases où un joueur de l'équipe perd un duel (position au moment du duel)." },
  { id: 'duels_won', label: 'Duels gagnés', kind: 'heat', teamOnly: true, meaning: "Cases où un joueur de l'équipe gagne un duel (position au moment du duel)." },
  { id: 'kd', label: 'Kills moins morts', kind: 'diverging', teamOnly: true, meaning: "Par case : kills de l'équipe moins morts de l'équipe, lissés. Vert : on y marque plus qu'on n'y perd ; rouge : l'inverse ; cases trop peu fréquentées masquées." },
];

/** Définition d'un calque par son identifiant. */
export const layerDef = (id: LayerId): LayerDef => LAYERS.find((l) => l.id === id) ?? LAYERS[0];

/** Calque réellement affiché : quand un joueur est choisi, les calques « équipe seule » ne sont pas disponibles, on retombe sur la présence à gauche. */
export function effectiveLayer(layer: LayerId, hasPlayer: boolean): LayerId {
  if (!hasPlayer || !layerDef(layer).teamOnly) return layer;
  return 'presence_left';
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Seuil minimal de games

export interface Gate {
  /** Vrai : assez de games pour afficher des résultats chiffrés. */
  ok: boolean;
  /** Nombre de games qui manquent pour atteindre le seuil (0 si ok). */
  missing: number;
}

/** Règle « masqué sous `min` games » : le serveur renvoie `games` et `min` (5). */
export function gate(games: number, min: number): Gate {
  const have = Number.isFinite(games) ? Math.max(0, Math.floor(games)) : 0;
  const need = Number.isFinite(min) ? Math.max(0, Math.floor(min)) : 0;
  return have >= need ? { ok: true, missing: 0 } : { ok: false, missing: need - have };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Grilles

/** Somme de plusieurs listes de cases (une case présente dans plusieurs listes s'additionne) ; résultat trié ligne puis colonne. */
export function sumCells(lists: TeamCell[][]): TeamCell[] {
  const sum = new Map<string, TeamCell>();
  for (const cells of lists) {
    for (const [ix, iy, v] of cells) {
      if (!Number.isFinite(v)) continue;
      const key = `${iy},${ix}`;
      const known = sum.get(key);
      if (known) known[2] += v;
      else sum.set(key, [ix, iy, v]);
    }
  }
  return [...sum.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** Chaleur d'une liste de cases : mise en grille, lissée (sigma en cases), ramenée à 0..1 au 98e centile. */
export function heatNorm(cells: TeamCell[], n: number, sigma: number): Float32Array {
  return normalize(blur(gridFromCells(n, cells), n, sigma));
}

/** Deux chaleurs ramenées à la MÊME échelle (le plus grand des deux 98e centiles) : la comparaison de leur intensité reste honnête. */
export function pairNorm(a: TeamCell[], b: TeamCell[], n: number, sigma: number): [Float32Array, Float32Array] {
  const ga = blur(gridFromCells(n, a), n, sigma);
  const gb = blur(gridFromCells(n, b), n, sigma);
  const top = Math.max(percentile(ga, 0.98), percentile(gb, 0.98));
  if (top <= 0) return [new Float32Array(ga.length), new Float32Array(gb.length)];
  return [ga.map((v) => Math.min(1, v / top)), gb.map((v) => Math.min(1, v / top))];
}

/** Grille signée ramenée à -1..1 : divisée par le 98e centile des valeurs absolues, écrêtée. Tout nul : grille de zéros. */
export function signedNorm(values: Float32Array, p = 0.98): Float32Array {
  const top = percentile(values.map((v) => Math.abs(v)), p);
  if (top <= 0) return new Float32Array(values.length);
  return values.map((v) => Math.max(-1, Math.min(1, v / top)));
}

/**
 * Différence kills moins morts par case : kills et morts lissés séparément, différence, puis masque des cases dont l'appui (kills + morts lissés) est sous
 * `minShare` fois le 98e centile de l'appui (peu d'événements : le signe ne veut rien dire). Résultat entre -1 et 1 (positif : plus de kills que de morts).
 */
export function killsMinusDeaths(kills: TeamCell[], deaths: TeamCell[], n: number, sigma: number, minShare = MIN_SUPPORT_SHARE): Float32Array {
  const k = blur(gridFromCells(n, kills), n, sigma);
  const d = blur(gridFromCells(n, deaths), n, sigma);
  const support = k.map((v, i) => v + d[i]);
  const floor = minShare * percentile(support, 0.98);
  const diff = k.map((v, i) => (support[i] >= floor && support[i] > 0 ? v - d[i] : 0));
  return signedNorm(diff);
}

/** Pixels RGBA (ligne par ligne) d'une grille signée -1..1 : `good` au-dessus de zéro, `bad` en dessous, opacité qui monte avec la valeur absolue (rien sur zéro). */
export function divergingPixels(norm: Float32Array, n: number, bad: Rgb, good: Rgb, maxAlpha = 0.85): Uint8ClampedArray {
  const px = new Uint8ClampedArray(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const v = norm[i] ?? 0;
    const color = v >= 0 ? good : bad;
    px.set(heatColor(Math.abs(v), color, color, maxAlpha), i * 4);
  }
  return px;
}

/** Vrai si la grille ne contient aucune case non nulle (rien à dessiner). */
export const isBlank = (values: Float32Array): boolean => values.every((v) => v === 0);

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Joueurs

/** Un joueur par pseudo, avec ses deux côtés possibles (il peut jouer à gauche dans une game et à droite dans une autre). */
export interface PlayerGroup {
  key: string;
  name: string;
  games: number;
  seconds: number;
  bySide: Record<TeamSideName, TeamPlayer | null>;
}

/** Regroupe `players[]` du serveur (un par pseudo et par côté) par pseudo ; ordre alphabétique. */
export function playerGroups(players: TeamPlayer[]): PlayerGroup[] {
  const groups = new Map<string, PlayerGroup>();
  for (const p of players) {
    const g = groups.get(p.key) ?? { key: p.key, name: p.name, games: 0, seconds: 0, bySide: { left: null, right: null } };
    g.bySide[p.side] = p;
    g.games += p.games;
    g.seconds += p.seconds;
    groups.set(p.key, g);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Cases de présence d'un joueur : un côté, ou les deux additionnés ; liste vide si le joueur est inconnu. */
export function playerCells(players: TeamPlayer[], key: string, side: TeamSideName | 'both'): TeamCell[] {
  return sumCells(players.filter((p) => p.key === key && (side === 'both' || p.side === side)).map((p) => p.cells));
}

/** Duels d'un joueur (tous côtés confondus). */
export function playerDuels(players: TeamPlayer[], key: string): TeamDuels {
  const total: TeamDuels = { won: 0, lost: 0, other: 0 };
  for (const p of players) {
    if (p.key !== key) continue;
    total.won += p.duels_won;
    total.lost += p.duels_lost;
    total.other += p.duels_other;
  }
  return total;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Totaux et issues

/** Part de duels gagnés parmi les duels décidés (gagnés + perdus) ; null s'il n'y en a aucun. */
export function duelShare(d: TeamDuels): number | null {
  const decided = d.won + d.lost;
  return decided > 0 ? d.won / decided : null;
}

/** Kills moins morts ; null si l'un des deux n'est pas établi. */
export const killsMinusDeathsTotal = (kills: number | null, deaths: number | null): number | null => (kills === null || deaths === null ? null : kills - deaths);

/** Taux de retake réussi à afficher : null sous `minDecided` vagues décidées (ou sans taux). */
export function shownRate(t: Pick<TeamWaveTally, 'decided' | 'rate'>, minDecided = MIN_DECIDED_WAVES): number | null {
  return t.rate !== null && t.decided >= minDecided ? t.rate : null;
}

export interface OutcomeRow {
  key: string;
  label: string;
  count: number;
  /** Part des vagues comptées (0 à 1) ; null s'il n'y a aucune vague. */
  share: number | null;
}

/** Lignes du tableau des issues : l'ordre des issues connues (waveOutcome), puis les autres ; les issues à zéro vague sont omises. */
export function outcomeRows(t: Pick<TeamWaveTally, 'waves' | 'counts'>): OutcomeRow[] {
  const known = Object.keys(WAVE_ISSUES);
  const keys = [...known.filter((k) => (t.counts[k] ?? 0) > 0), ...Object.keys(t.counts).filter((k) => !known.includes(k) && t.counts[k] > 0).sort()];
  return keys.map((key) => ({
    key,
    label: WAVE_ISSUES[key]?.short ?? (key === 'unknown' ? 'Issue non lue' : key),
    count: t.counts[key],
    share: t.waves > 0 ? t.counts[key] / t.waves : null,
  }));
}

/** Pourcentage entier lisible (« 42 % »), tiret court pour une valeur absente. */
export const percentText = (v: number | null): string => (v === null || !Number.isFinite(v) ? '-' : `${Math.round(v * 100)} %`);
