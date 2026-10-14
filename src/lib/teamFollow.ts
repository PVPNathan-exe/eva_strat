// Suivi d'une équipe par son NOM dans l'onglet Stats : selon la vidéo, une équipe est orange (côté gauche, joueurs 1 à 4, games.team_a) ou bleue (côté droit, joueurs 5 à 8, games.team_b).
// Les fonctions pures de ce fichier disent, pour une game et un réglage des filtres, quelle équipe est suivie, quels joueurs sont gardés et quelle couleur de palette ils prennent :
// la palette « a » est toujours celle de l'équipe suivie (jeton --c-owner-a), la palette « b » celle de ses adversaires (--c-owner-b), quel que soit leur côté dans la game.
// Sans équipe suivie, la palette « a » est l'équipe de gauche (orange) et la « b » celle de droite (bleue) : le comportement d'avant.

import type { TeamSide } from '../types/stats.ts';

/** Côté de la game : l'équipe de gauche (orange, A), de droite (bleue, B), ou les deux. */
export type SideFilter = 'both' | 'left' | 'right';
/** Qui afficher quand une équipe est suivie : tout le monde, l'équipe suivie seule ou ses adversaires seuls. */
export type ShowFilter = 'both' | 'followed' | 'opponents';
/** Palette de couleur : « a » = équipe suivie (ou orange sans suivi), « b » = adversaires (ou bleue sans suivi). */
export type Palette = 'a' | 'b';

/** Ce que le suivi d'équipe lit dans une game. */
export interface FollowGame {
  id: number;
  teamA: string | null;
  teamB: string | null;
  players: { slot: number; name: string }[];
}

/** Réglage des filtres d'équipe et de joueur. */
export interface FollowSpec {
  /** Nom d'équipe suivi, sous sa forme normalisée (nameKey) ; null : pas d'équipe suivie, les équipes sont prises par côté. */
  team: string | null;
  /** Avec une équipe suivie : côté qu'elle occupe dans la game ; sans : équipe de gauche ou de droite. */
  side: SideFilter;
  /** Avec une équipe suivie seulement : qui afficher. */
  show: ShowFilter;
  /** Sans équipe suivie : joueur (slot 1 à 8), 0 pour tous. */
  slot: number;
  /** Avec une équipe suivie : pseudo (normalisé) du joueur, null pour tous. */
  player: string | null;
}

export const NO_FOLLOW: FollowSpec = { team: null, side: 'both', show: 'both', slot: 0, player: null };

/** Nom comparé sans tenir compte des majuscules, des accents ni des espaces en trop (« Team  Éclair » = « team eclair »). */
export function nameKey(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Côté d'un numéro de joueur : 1 à 4 à gauche (A, orange), 5 à 8 à droite (B, bleue). */
export const sideOfSlot = (slot: number): TeamSide => (slot <= 4 ? 'A' : 'B');
const other = (side: TeamSide): TeamSide => (side === 'A' ? 'B' : 'A');

/** Place du joueur dans son équipe, de 1 à 4 : donne la nuance de la couleur. */
export const rankOfSlot = (slot: number): number => ((slot - 1) % 4) + 1;

/** Une équipe vue sur la carte : clé normalisée, nom tel qu'écrit la première fois et nombre de games où elle joue. */
export interface TeamName {
  key: string;
  label: string;
  games: number;
}

/** Noms d'équipe des games (les deux côtés), regroupés par nom normalisé ; les plus fréquents d'abord. */
export function teamNames(games: Pick<FollowGame, 'teamA' | 'teamB'>[]): TeamName[] {
  const seen = new Map<string, TeamName>();
  for (const g of games) {
    const keys = new Set<string>();
    for (const label of [g.teamA, g.teamB]) {
      const key = nameKey(label);
      if (!key || keys.has(key)) continue;
      keys.add(key);
      const known = seen.get(key);
      if (known) known.games += 1;
      else seen.set(key, { key, label: (label as string).trim(), games: 1 });
    }
  }
  return [...seen.values()].sort((a, b) => b.games - a.games || a.label.localeCompare(b.label));
}

/** Côté que l'équipe suivie occupe dans la game (null : pas d'équipe suivie, ou elle ne joue pas cette game). */
export function sideOfTeam(game: Pick<FollowGame, 'teamA' | 'teamB'>, team: string | null): TeamSide | null {
  if (!team) return null;
  if (nameKey(game.teamA) === team) return 'A';
  if (nameKey(game.teamB) === team) return 'B';
  return null;
}

/** Vrai si la game entre dans le réglage : sans équipe suivie, toujours ; avec, l'équipe y joue du côté demandé. */
export function gameEligible(game: Pick<FollowGame, 'teamA' | 'teamB'>, spec: FollowSpec): boolean {
  if (!spec.team) return true;
  const side = sideOfTeam(game, spec.team);
  if (!side) return false;
  return spec.side === 'both' || (spec.side === 'left') === (side === 'A');
}

/** Games du réglage (celles où l'équipe suivie joue du côté demandé). */
export const eligibleGames = <T extends Pick<FollowGame, 'teamA' | 'teamB'>>(games: T[], spec: FollowSpec): T[] => games.filter((g) => gameEligible(g, spec));

/** Côtés (A orange à gauche, B bleue à droite) dont les joueurs sont montrés dans cette game. */
export function keptSides(game: Pick<FollowGame, 'teamA' | 'teamB'>, spec: FollowSpec): TeamSide[] {
  if (!spec.team) return spec.side === 'left' ? ['A'] : spec.side === 'right' ? ['B'] : ['A', 'B'];
  const mine = sideOfTeam(game, spec.team);
  if (!mine) return [];
  return spec.show === 'followed' ? [mine] : spec.show === 'opponents' ? [other(mine)] : ['A', 'B'];
}

/** Numéro de joueur de ce pseudo dans la game (null : il n'y joue pas). */
export function slotOfPlayer(game: Pick<FollowGame, 'players'>, player: string): number | null {
  return game.players.find((p) => nameKey(p.name) === player)?.slot ?? null;
}

/** Numéro de joueur demandé par le filtre Joueur dans cette game : 0 pour tous, null si ce joueur n'y est pas. */
export function wantedSlot(game: FollowGame, spec: FollowSpec): number | null {
  if (spec.team) return spec.player ? slotOfPlayer(game, spec.player) : 0;
  return spec.slot;
}

/** Vrai si les lignes de ce joueur sont gardées dans cette game. */
export function keepsSlot(game: FollowGame, spec: FollowSpec, slot: number): boolean {
  if (!keptSides(game, spec).includes(sideOfSlot(slot))) return false;
  const wanted = wantedSlot(game, spec);
  return wanted === 0 || wanted === slot;
}

/** Palette d'un joueur : « a » pour l'équipe suivie (quel que soit son côté), « b » pour ses adversaires ; sans équipe suivie, le côté décide. */
export function paletteOf(game: Pick<FollowGame, 'teamA' | 'teamB'>, spec: FollowSpec, slot: number): Palette {
  const mine = sideOfTeam(game, spec.team);
  if (!mine) return sideOfSlot(slot) === 'A' ? 'a' : 'b';
  return sideOfSlot(slot) === mine ? 'a' : 'b';
}

/** Garde les lignes (vies, morts, lignes de suivi) des joueurs retenus ; `games` donne la game de chaque ligne par game_id. */
export function filterByScope<T extends { game_id: number; slot: number }>(rows: T[], games: FollowGame[], spec: FollowSpec): T[] {
  const byId = new Map(games.map((g) => [g.id, g]));
  return rows.filter((r) => {
    const g = byId.get(r.game_id);
    return !!g && keepsSlot(g, spec, r.slot);
  });
}

/** Pseudos (normalisés, avec leur écriture) des joueurs montrés dans ces games : choix du filtre Joueur quand une équipe est suivie. */
export function playerChoices(games: FollowGame[], spec: FollowSpec): { key: string; label: string }[] {
  const out = new Map<string, string>();
  for (const g of games) {
    const sides = keptSides(g, { ...spec, show: 'both' });
    for (const p of g.players) {
      const key = nameKey(p.name);
      if (key && sides.includes(sideOfSlot(p.slot)) && !out.has(key)) out.set(key, p.name.trim());
    }
  }
  return [...out.entries()].map(([key, label]) => ({ key, label })).sort((a, b) => a.label.localeCompare(b.label));
}

/** Noms à écrire dans les légendes d'une game pour chaque palette. */
export function paletteNames(game: Pick<FollowGame, 'teamA' | 'teamB'>, spec: FollowSpec): Record<Palette, string> {
  const mine = sideOfTeam(game, spec.team);
  if (!mine) return { a: game.teamA ?? 'Équipe de gauche (orange)', b: game.teamB ?? 'Équipe de droite (bleue)' };
  const name = (side: TeamSide) => (side === 'A' ? game.teamA : game.teamB);
  return { a: name(mine) ?? 'Équipe suivie', b: name(other(mine)) ?? 'Adversaires' };
}

/** Une requête de présence : games regroupées qui partagent la même équipe et le même joueur à demander au serveur. */
export interface PresenceGroup {
  games: number[];
  team?: TeamSide;
  slot?: number;
}

/**
 * Requêtes de présence d'un réglage. Sans équipe suivie : une seule (côté et joueur du filtre). Avec une équipe suivie : le numéro d'équipe et de joueur
 * dépendent de la game (l'équipe est à gauche dans l'une, à droite dans l'autre), donc les games sont regroupées par équipe demandée et joueur demandé.
 */
export function presenceGroups(games: FollowGame[], spec: FollowSpec): PresenceGroup[] {
  const groups = new Map<string, PresenceGroup>();
  for (const g of games) {
    if (!gameEligible(g, spec)) continue;
    const sides = keptSides(g, spec);
    const slot = wantedSlot(g, spec);
    if (sides.length === 0 || slot === null) continue;
    if (slot !== 0 && !sides.includes(sideOfSlot(slot))) continue; // joueur d'un côté qui n'est pas montré
    const team = sides.length === 1 ? sides[0] : undefined;
    const key = `${team ?? '*'}|${slot}`;
    const group = groups.get(key) ?? { games: [], team, slot: slot || undefined };
    group.games.push(g.id);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Équipe (A ou B) à passer aux vues Retakes et Rotations, qui ne connaissent que les côtés : « tout » quand une équipe est suivie. */
export function legacyTeam(spec: FollowSpec): TeamSide | 'all' {
  if (spec.team) return 'all';
  return spec.side === 'left' ? 'A' : spec.side === 'right' ? 'B' : 'all';
}

/** Games retenues parmi celles du réglage : le choix de l'utilisateur, ou par défaut la plus récente (numéro de game le plus grand, l'ordre de l'analyse). */
export function pickGames<T extends { id: number }>(eligible: T[], chosen: number[] | null): T[] {
  if (chosen) return eligible.filter((g) => chosen.includes(g.id));
  if (eligible.length === 0) return [];
  return [eligible.reduce((best, g) => (g.id > best.id ? g : best))];
}

/** Classes CSS de palette d'un joueur (voir stats.css) : couleur de l'équipe suivie ou de ses adversaires, nuance selon sa place dans l'équipe. */
export const palClass = (palette: Palette, slot: number): string => `pal pal--${palette} pal--r${rankOfSlot(slot)}`;
