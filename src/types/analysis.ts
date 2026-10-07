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

export interface Game {
  id: number;
  video_id: number;
  start_s: number;
  end_s: number;
  map: string | null;
  status: GameStatus;
  winner: string | null;
}

export const ZONE_NAMES = ['minimap', 'capture_points', 'team_a_bar', 'team_b_bar', 'timer'] as const;
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
  capture_points: 'Points de capture',
  team_a_bar: 'Équipe gauche (bandeaux)',
  team_b_bar: 'Équipe droite (bandeaux)',
  timer: 'Chrono',
};

export interface JobEvent {
  event: 'progress' | 'done' | 'error';
  stage?: 'download' | 'detect';
  pct?: number;
  games?: number;
  video_id?: number;
  message?: string;
}
