// Logique REST de l'onglet Analyse (fonctions pures, testables sans serveur HTTP).

import type { DatabaseSync } from 'node:sqlite';

export const ZONE_NAMES = ['minimap', 'capture_points', 'team_a_bar', 'team_b_bar', 'timer'] as const;
export type ZoneName = (typeof ZONE_NAMES)[number];
export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Zones = Record<ZoneName, Zone>;

export interface ApiContext {
  db: DatabaseSync;
  defaultZones: Zones;
}

export interface ApiResult {
  status: number;
  json: unknown;
}
