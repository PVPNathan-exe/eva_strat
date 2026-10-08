export interface Video {
  id: number;
  path: string;
  source_url: string | null;
  duration_s: number;
  fps: number;
  width: number;
  height: number;
}

export type GameStatus = 'detected' | 'confirmed';

export interface Doubt {
  start_s: number;
  end_s: number;
  label: string;
}

export interface CaptureSeries {
  A: { t: number; v: number }[];
  B: { t: number; v: number }[];
}

export interface Correction {
  id: number;
  t0: number;
  t1: number;
  slot_a: number;
  slot_b: number;
}

export type CommentTag = 'suivi' | 'equipe' | 'note';

export interface VideoComment {
  id: number;
  video_id: number;
  game_id: number | null;
  t: number;
  tag: CommentTag;
  text: string;
  slots: number[];
  resolved: boolean;
  created_at: string;
}

export type WeaponKind = 'killfeed' | 'arme' | 'gadget';

export interface Weapon {
  id: string;
  kind: WeaponKind;
  name: string;
  /** Nom déduit par le programme (équipement des tueurs), pas saisi. */
  inferred: boolean;
  uses: number;
  /** Signalée par l'utilisateur (ne représente pas la bonne arme, ou icônes superposées). */
  reported: boolean;
  /** Avis de l'utilisateur sur le nom deviné. */
  verdict: 'ok' | 'bad' | null;
  /** Où l'icône a été vue (vidéo, game, instant, joueur). */
  sources: { videoId: number; gameId: number; video: string; game: number; map: string | null; t: number; player: string | null }[];
}

/** Avancement d'un travail de fond sur une icône (recherche d'images candidates, recalcul). */
export interface IconWork {
  action?: 'candidates' | 'rebuild';
  state: 'none' | 'queued' | 'running' | 'done' | 'error';
  result?: { candidates?: IconCandidate[]; used?: string[] };
  error?: string;
}

/** Image candidate pour recalculer une icône (lue sur un bandeau, autour d'un endroit où l'icône a été vue). */
export interface IconCandidate {
  token: string;
  game: number;
  slot: number;
  field: string;
  t: number;
  /** Netteté du relief : une icône nette est en noir sur le bandeau. */
  held: number;
  sharp: number;
  /** Image que le recalcul automatique retiendrait. */
  auto: boolean;
}

export interface Kill {
  t: number;
  killer: number | null;
  victim: number;
  weapon: string | null;
  /** Nom donné à l'icône de l'arme (null tant qu'elle n'est pas nommée). */
  weaponName: string | null;
  /** Équipement réel : pour le logo « GRENADE », la grenade équipée par le tueur (DX3, STICKY). */
  stuff: string | null;
  headshot: boolean;
  kind: 'kill' | 'suicide' | 'environment' | 'unknown' | 'inferred' | null;
}

export interface Game {
  id: number;
  video_id: number;
  start_s: number;
  end_s: number;
  map: string | null;
  status: GameStatus;
  winner: string | null;
  doubts: Doubt[];
  samples: number;
  players: { slot: number; name: string; weapon1: string | null; weapon2: string | null; gadget: string | null }[];
  kills: Kill[];
}

export interface Sample {
  frame: number;
  t: number;
  slot: number;
  team: 'A' | 'B';
  x: number;
  y: number;
  angle: number | null;
  alive: number;
  confidence: number | null;
}

export const ZONE_NAMES = ['minimap', 'capture_points', 'capture_pct_a', 'capture_pct_b', 'team_a_bar', 'team_b_bar', 'timer'] as const;
export type ZoneName = (typeof ZONE_NAMES)[number];

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Zones = Record<ZoneName, Zone>;

export const ZONE_LABELS: Record<ZoneName, string> = {
  minimap: 'Minimap',
  capture_points: 'Points de capture (sous le chrono)',
  capture_pct_a: '% de capture équipe gauche',
  capture_pct_b: '% de capture équipe droite',
  team_a_bar: 'Équipe gauche (bandeaux + numéros)',
  team_b_bar: 'Équipe droite (bandeaux + numéros)',
  timer: 'Chrono',
};

export interface JobEvent {
  event: 'progress' | 'done' | 'error';
  stage?: 'download' | 'detect' | 'maps' | 'names' | 'loadout' | 'capture' | 'kills' | 'positions';
  pct?: number;
  video_id?: number;
  message?: string;
}
