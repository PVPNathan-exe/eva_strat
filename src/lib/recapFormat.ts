// Fonctions pures de la vue Récap : formats (virgule décimale, notes signées), libellés en clair, cellules du tableau par joueur, liste des kills reconstruite
// depuis les notes, messages quand les tables de la game ne sont pas calculées. Aucune dépendance au navigateur.
// Les notes (-2 à +3), les seuils de duel et les teamfights sont des CONVENTIONS sans vérité terrain ; « possible » est une borne haute (plan Stats 2, section 2).

import type { CaptureScore, GameSummary, KillRow, RecapNote, RecapPlayer, RecapTeam } from '../types/statsRecap.ts';
import { videoSeek } from './episodeFormat.ts';
import { numberOfSlot } from './killTimeline.ts';
import { hasNoPointChange } from './pointChangeMarks.ts';
import { formatTime } from './timeline.ts';

/** Cellule de tableau : texte affiché et infobulle facultative. */
export interface Cell {
  text: string;
  title?: string;
}

/** Valeur absente d'une ligne : le bilan de ce joueur n'est pas calculé (jamais affiché comme 0). */
export const NA = 'n/d';
/** Valeur que le calcul n'a pas pu établir (secondaire sans délai mesuré, par exemple). */
export const NOT_ESTABLISHED = 'non établi';

const present = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

/** Nombre à virgule décimale, au plus `digits` décimales, sans « ,0 » inutile : 3 donne « 3 », 3,25 donne « 3,3 ». */
export function fmtDecimal(v: number, digits = 1): string {
  const r = Number(v.toFixed(digits));
  return String(Object.is(r, -0) ? 0 : r).replace('.', ',');
}

/** Note signée : +2, -1, 0 (convention : un impact positif aide l'équipe du joueur). */
export function signed(v: number): string {
  const r = Number(v.toFixed(1));
  if (r === 0) return '0';
  return r > 0 ? `+${fmtDecimal(r)}` : `-${fmtDecimal(-r)}`;
}

/** Opposé d'une note, sans « -0 ». */
export const opposite = (v: number): number => (v === 0 ? 0 : -v);

/** Ton d'une note : bon, mauvais ou neutre (la classe CSS en tire la couleur). */
export function impactTone(impact: number): 'good' | 'bad' | 'neutral' {
  return impact > 0 ? 'good' : impact < 0 ? 'bad' : 'neutral';
}

/** Vitesse en m/s (une décimale) ; null ou absente : « n/d ». */
export const fmtSpeed = (v: number | null | undefined): string => (present(v) ? fmtDecimal(v, 1) : NA);

/** Infobulle du 98e centile : rappelle le maximum brut et qu'il peut contenir des erreurs de lecture. */
export function speedMaxTitle(p: Pick<RecapPlayer, 'v_max' | 'v_p98'>): string {
  const p98 = present(p.v_p98) ? `98e centile : ${fmtDecimal(p.v_p98, 1)} m/s. ` : '';
  const max = present(p.v_max) ? `Maximum brut : ${fmtDecimal(p.v_max, 1)} m/s (peut contenir des erreurs de lecture).` : 'Maximum brut non disponible.';
  return p98 + max;
}

/** Entier d'une colonne : « n/d » quand la ligne de bilan manque. */
export const fmtCount = (v: number | null | undefined): string => (present(v) ? String(v) : NA);

/** Secondaires utilisés sur possibles. Possible est une borne haute : null (délai non établi) donne « non établi », jamais 0. */
export function gadgetCell(uses: number | null | undefined, possible: number | null | undefined): Cell {
  if (uses === undefined && possible === undefined) return { text: NA };
  if (!present(possible)) {
    const seen = present(uses) ? `${uses} secondaire${uses > 1 ? 's' : ''} utilisé${uses > 1 ? 's' : ''}. ` : 'Secondaire non lu. ';
    return { text: NOT_ESTABLISHED, title: `${seen}Maximum possible non établi : pas assez de cycles de gadget pour mesurer le délai de recharge.` };
  }
  const used = present(uses) ? String(uses) : '?';
  return { text: `${used} sur ${fmtDecimal(possible, 1)}`, title: 'Utilisés sur possibles. « Possible » est une borne haute calculée par délai de gadget, pas une mesure.' };
}

/** Morts avec le secondaire encore disponible : « non établi » quand le calcul ne l'a pas établi (null). */
export function unusedCell(v: number | null | undefined): Cell {
  if (v === undefined) return { text: NA };
  if (!present(v)) return { text: NOT_ESTABLISHED, title: 'Disponibilité du secondaire à la mort non établie pour ce joueur.' };
  return { text: String(v), title: 'Morts avec le secondaire encore disponible (mauvais : mourir avec).' };
}

/** Kills sur morts : rapport à une décimale ; sans mort, « sans mort » (ou 0 sans kill). */
export function killsOnDeaths(kills: number | null | undefined, deaths: number | null | undefined): Cell {
  if (!present(kills) || !present(deaths)) return { text: NA };
  const title = `${kills} kill${kills > 1 ? 's' : ''} pour ${deaths} mort${deaths > 1 ? 's' : ''}`;
  if (deaths === 0) return { text: kills > 0 ? 'sans mort' : '0', title };
  return { text: fmtDecimal(kills / deaths, 2), title };
}

/** Somme des notes (kills et morts) d'un joueur, signée ; « n/d » sans note. */
export function scoreSumCell(p: Pick<RecapPlayer, 'kill_notes' | 'death_notes' | 'score_sum' | 'kill_score_sum' | 'death_score_sum'>): Cell {
  if (p.kill_notes.length + p.death_notes.length === 0) return { text: NA, title: 'Aucune note de kill ni de mort pour ce joueur.' };
  return {
    text: signed(p.score_sum),
    title: `Notes des kills : ${signed(p.kill_score_sum)} (${p.kill_notes.length}). Notes des morts : ${signed(p.death_score_sum)} (${p.death_notes.length}). Convention, sans vérité terrain.`,
  };
}

/** Numéro de jeu (1 à 4, 6 à 9) et pseudo s'il est connu : « n° 6 (Pseudo) ». */
export function playerName(slot: number, name: string | null | undefined): string {
  return `n° ${numberOfSlot(slot)}${name ? ` (${name})` : ''}`;
}

/** Joueurs retenus (prédicat des filtres), l'équipe `first` d'abord, puis par numéro. */
export function orderPlayers(players: RecapPlayer[], first: RecapTeam, keep: (slot: number) => boolean = () => true): RecapPlayer[] {
  const rank = (p: RecapPlayer) => (p.team === first ? 0 : 1);
  return players.filter((p) => keep(p.slot)).sort((a, b) => rank(a) - rank(b) || a.slot - b.slot);
}

/** Liste des kills de la game, dans l'ordre du temps, retrouvée depuis les notes : un kill par note de tueur, plus les morts sans tueur lu. */
export function killRows(players: RecapPlayer[]): KillRow[] {
  const rows: KillRow[] = [];
  for (const p of players) {
    for (const n of p.kill_notes) {
      if (n.other_slot === null) continue;
      rows.push({ key: `${n.t}:${p.slot}:${n.other_slot}`, t: n.t, killer: p.slot, victim: n.other_slot, impact: n.impact, reasons: n.reasons });
    }
    for (const n of p.death_notes) {
      if (n.other_slot !== null) continue; // la mort a un tueur : elle est déjà portée par sa note de kill
      rows.push({ key: `${n.t}:x:${p.slot}`, t: n.t, killer: null, victim: p.slot, impact: opposite(n.impact), reasons: n.reasons });
    }
  }
  return rows.sort((a, b) => a.t - b.t || a.victim - b.victim);
}

/** Garde les kills où le tueur ou la victime est un joueur retenu par les filtres. */
export const keepKillRows = (rows: KillRow[], keep: (slot: number) => boolean): KillRow[] => rows.filter((r) => keep(r.victim) || (r.killer !== null && keep(r.killer)));

/** Raisons d'une note, en une phrase ; null quand le calcul n'en a pas enregistré. */
export function reasonsText(reasons: string[] | null | undefined): string {
  return reasons && reasons.length > 0 ? reasons.join(' ; ') : 'raisons non enregistrées';
}

/** Phrase d'un kill : « n° 1 (A) a tué n° 6 (B) » ou « n° 6 (B) mort, tueur non lu ». */
export function killSentence(row: KillRow, nameOf: (slot: number) => string | null | undefined): string {
  const victim = playerName(row.victim, nameOf(row.victim));
  if (row.killer === null) return `${victim} mort, tueur non lu`;
  return `${playerName(row.killer, nameOf(row.killer))} a tué ${victim}`;
}

/** Temps de vidéo où ouvrir un kill (5 s avant, comme les autres vues). */
export const killSeek = (gameStartS: number, t: number): number => videoSeek(gameStartS, t);

/** Notes d'un joueur (kills ou morts) triées par temps, pour une infobulle. */
export const sortNotes = (notes: RecapNote[]): RecapNote[] => [...notes].sort((a, b) => a.t - b.t);

/** Changements de point : « aucun changement de point sur cette carte » pour Engine et Helios Station. */
export function pointChangesLabel(map: string | null, n: number): string {
  if (hasNoPointChange(map)) return 'aucun changement de point sur cette carte';
  if (n <= 0) return 'aucun changement de point';
  return `${n} changement${n > 1 ? 's' : ''} de point`;
}

/** Durée de la game : « 5:12 ». */
export const durationLabel = (s: number): string => formatTime(s);

/** Dernière lecture du score de capture de chaque équipe ; null si une des deux séries est vide (scores non lus). */
export function captureScoreOf(series: { A: { v: number }[]; B: { v: number }[] } | null | undefined): CaptureScore | null {
  if (!series || series.A.length === 0 || series.B.length === 0) return null;
  return { A: series.A[series.A.length - 1].v, B: series.B[series.B.length - 1].v };
}

/** Pourcentage entier : « 99 % ». */
export const pctLabel = (v: number): string => `${Math.round(v)} %`;

/** Commande qui calcule les tables Stats d'une game. */
export const statsCommand = (gameId: number): string => `npm run stats -- --game ${gameId}`;

/** Message quand le bilan des joueurs n'est pas calculé (aucune ligne player_game_stats) ; null sinon. */
export function statsMissingNotice(s: GameSummary): string | null {
  if (s.players.some((p) => p.has_stats)) return null;
  return `Bilan des joueurs pas calculé pour cette game, lancer ${statsCommand(s.game.id)}.`;
}

/** Message quand les notes de kill ne sont pas calculées (aucune note alors que des kills existent ou que le bilan manque) ; null sinon. */
export function notesMissingNotice(s: GameSummary): string | null {
  const notes = s.players.reduce((a, p) => a + p.kill_notes.length + p.death_notes.length, 0);
  if (notes > 0) return null;
  const hasStats = s.players.some((p) => p.has_stats);
  const kills = s.players.reduce((a, p) => a + (present(p.kills) ? p.kills : 0), 0);
  if (hasStats && kills === 0) return null; // game sans aucun kill : rien à noter
  return `Notes des kills pas calculées pour cette game, lancer ${statsCommand(s.game.id)}.`;
}
