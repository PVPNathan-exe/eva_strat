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

export interface Kill {
  t: number;
  killer: number | null;
  victim: number;
  weapon: string | null;
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
  players: { slot: number; name: string }[];
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
  stage?: 'download' | 'detect' | 'maps' | 'names' | 'kills' | 'positions';
  pct?: number;
  video_id?: number;
  message?: string;
}
