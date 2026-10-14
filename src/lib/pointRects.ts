// Cadres des points de capture d'une carte, en fractions de la minimap, pour entourer le point concerné sur le plan des vues Retakes et Rotations.
// Outlaw : boîtes vues (analysis/map_capture_points.json, lettres A à E) ; les autres cartes : polygones tracés (analysis/map_capture.json), une lettre par polygone dans l'ordre du fichier,
// comme analysis/point_owner.point_rects (les lettres des épisodes viennent de ce même ordre). Le calcul pur est dans episodeClock.ts.

import capturePoints from '../../analysis/map_capture_points.json';
import { rectsFromBoxes, rectsFromPolygons, type Rect } from './episodeClock';
import { readingOf } from './mapReading';

type Boxes = Record<string, { points?: Record<string, { x: number; y: number; w: number; h: number }> }>;

/** Cadres {lettre: cadre} des points de la carte ({} si la carte n'a aucun point connu). */
export function pointRectsOf(map: string): Record<string, Rect> {
  const seen = (capturePoints as Boxes)[map]?.points;
  return seen ? rectsFromBoxes(seen) : rectsFromPolygons(readingOf(map).capture);
}
