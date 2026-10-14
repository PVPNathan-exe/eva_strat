// Données réelles de vagues (table episodes recalculée avec les vagues, copie de la base : games 16, 22 et 26 ; champs `members` et listes raccourcis) pour les tests des vues Retakes.
// Ce fichier n'est pas un test : il est importé par waveOutcome.test.ts, waveInfo.test.ts, waveStats.test.ts, episodeClock.test.ts et episodeFormat.test.ts.

import type { Episode } from '../src/types/stats.ts';

/** Game 26 (NCT contre SNV), point A, équipe B : retake réussi, rapide, teamfight gagné (4 morts de A contre 2 de B), prise à 21,0 s. */
export const REAL_SUCCESS = {
  change_t: 21.0,
  push_t: 2.2,
  window: [0.0, 26.0],
  from_team: 'A',
  to_team: 'B',
  survivors: [6, 7],
  attackers: [{ slot: 5, pos: [0.6171, 0.4138], dist_m: 3.0 }, { slot: 6, pos: [0.4059, 0.8666], dist_m: 4.3 }],
  defenders: [{ slot: 1, pos: [0.3492, 0.603], dist_m: 3.0, fate: 'mort', death_t: 10.5 }],
  deaths: [
    { slot: 5, t: 9.5, dt_push: 7.3, killer: 1, weapon: 'B25', killer_dist_m: 3.0, defenders_near: 4, cause: 'tue_sur_le_point', pos: [0.6018, 0.3873], team: 'B' },
    { slot: 1, t: 10.5, dt_push: 8.3, killer: 8, weapon: 'B29', killer_dist_m: 3.8, defenders_near: 3, cause: 'tue_sur_le_point', pos: [0.3346, 0.5688], team: 'A' },
  ],
  wave: {
    team: 'B', t_start: 2.2, t_full: 4.0, t_contact: 9.5, t_end: 21.0, duration_s: 18.8, to_contact_s: 7.3, size: 4, speed: 'rapide', n_stops: 0, stop_s: 0, mean_speed_ms: 1.67, path_m: 12.2,
    point: 'A', holder_before: 'A', holder_after: 'B', tf_result: 'won', captured_t: 21.0, capture_from: 'A', opening: false, survivors_retreated: 0,
    members: [{ slot: 8, life_idx: 0, t_exit: 2.2, t_death: 13.0 }, { slot: 6, life_idx: 0, t_exit: 2.3, t_death: 93.0 }],
    kind: 'teamfight', to_fight_s: 7.3, n_fights: 1, axis_frac: 0.57,
    fight: { t_first: 9.5, t_last: 14.5, n_kills: 6, losses: { A: 4, B: 2 }, alive_end: { A: 0, B: 2 }, winner: 'B', kind: 'teamfight', foyers: 1, engaged: { A: 4, B: 4 }, center: [0.442, 0.504], near_point: 1.0 },
  },
};

/** Game 22, point A, équipe B : duel (un seul kill), vague progressive (1 arrêt de 5 s), point neutre. */
export const REAL_DUEL = {
  change_t: null,
  push_t: 2.4,
  window: [0.0, 17.5],
  from_team: null,
  to_team: 'B',
  survivors: [7, 8, 5],
  attackers: [{ slot: 5, pos: [0.6601, 0.3414], dist_m: 4.6 }],
  defenders: [{ slot: 1, pos: [0.3132, 0.9114], dist_m: 6.4, fate: 'recule', death_t: null }],
  deaths: [{ slot: 6, t: 12.5, dt_push: 10.1, killer: 1, weapon: null, killer_dist_m: 6.4, defenders_near: 3, cause: 'tue_a_distance', pos: [0.7456, 0.9234], team: 'B' }],
  wave: {
    team: 'B', t_start: 2.4, t_full: 4.4, t_contact: 12.5, t_end: 12.5, duration_s: 10.1, to_contact_s: 10.1, size: 4, speed: 'progressif', n_stops: 1, stop_s: 5.0, mean_speed_ms: 0.93, path_m: 9.4,
    point: 'A', holder_before: null, holder_after: null, tf_result: 'duel', captured_t: null, capture_from: null, opening: false, survivors_retreated: 0,
    members: [{ slot: 6, life_idx: 0, t_exit: 2.4, t_death: 12.4 }],
    kind: 'duel', to_fight_s: 10.1, n_fights: 1, axis_frac: 0.08,
    fight: { t_first: 12.5, t_last: 12.5, n_kills: 1, losses: { A: 0, B: 1 }, alive_end: { A: 4, B: 3 }, winner: 'A', kind: 'duel', foyers: 1, engaged: { A: 1, B: 2 }, center: [0.7456, 0.9234], near_point: 0.0 },
  },
};

/** Game 16, point A, équipe B : vague de 2 joueurs sans aucun kill (aucun contact), point tenu par A. */
export const REAL_NO_CONTACT = {
  change_t: null,
  push_t: 211.4,
  window: [206.4, 226.1],
  from_team: 'A',
  to_team: 'B',
  survivors: [6, 7],
  attackers: [{ slot: 6, pos: [0.8055, 0.8011], dist_m: 9.2 }, { slot: 7, pos: [0.7754, 0.6415], dist_m: 7.8 }],
  defenders: [{ slot: 1, pos: [0.4891, 0.098], dist_m: 6.0, fate: 'reste', death_t: null }],
  deaths: [],
  wave: {
    team: 'B', t_start: 211.4, t_full: 214.4, t_contact: null, t_end: 221.1, duration_s: 9.7, to_contact_s: null, size: 2, speed: null, n_stops: 0, stop_s: 0, mean_speed_ms: 1.33, path_m: 12.9,
    point: 'A', holder_before: 'A', holder_after: 'A', tf_result: 'none', captured_t: null, capture_from: null, opening: false, survivors_retreated: 1,
    members: [{ slot: 6, life_idx: 5, t_exit: 211.4, t_death: 242.0 }, { slot: 7, life_idx: 6, t_exit: 214.4, t_death: 264.5 }],
    kind: null, to_fight_s: null, n_fights: 0, axis_frac: null, fight: null,
  },
};

/** Épisode de test : une vague réelle par défaut (issue `success`), seuls les champs utiles changent. */
export const waveEpisode = (over: Partial<Episode> = {}): Episode => ({
  id: 1, game_id: 26, kind: 'retake', point: 'A', point_to: null, team: 'B', t0: 2.2, t1: 21.0, outcome: 'success', data: REAL_SUCCESS, verdict: null, ...over,
});

/** Vague d'une issue donnée, sans rien changer d'autre à la vague réelle (sert aux tests de taux et de filtres). */
export const waveOf = (outcome: string, id: number, over: { team?: 'A' | 'B'; speed?: 'rapide' | 'progressif' | null; toContactS?: number | null; tfResult?: string; capturedT?: number | null; gameId?: number; verdict?: 'ok' | 'ko' | null } = {}): Episode => {
  const w = { ...REAL_SUCCESS.wave, team: over.team ?? 'B', speed: over.speed === undefined ? 'rapide' : over.speed, to_contact_s: over.toContactS === undefined ? 7.3 : over.toContactS, tf_result: over.tfResult ?? 'won', captured_t: over.capturedT === undefined ? null : over.capturedT };
  return waveEpisode({ id, outcome, team: over.team ?? 'B', game_id: over.gameId ?? 26, verdict: over.verdict ?? null, data: { ...REAL_SUCCESS, wave: w } });
};
