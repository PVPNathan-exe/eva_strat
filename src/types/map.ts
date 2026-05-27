// Modèle de données du planificateur tactique EVA.
// Pensé pour supporter les features à venir : étages multiples, ascenseurs,
// vision joueur en cône, et déplacement des joueurs entre étages.

/** Nombre maximum d'étages par carte (les maps EVA montent jusqu'à 3 niveaux). */
export const MAX_FLOORS = 3;

/** Outils disponibles dans la barre d'outils. */
export type Tool =
  | 'select'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'pen'
  | 'calibrate' // tracer une ligne de longueur connue pour fixer l'échelle
  | 'weapon'; // poser l'arme sélectionnée sur la carte

/** Type géométrique d'une forme dessinée. */
export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'pen';

/**
 * Une forme dessinée sur un étage (mur, obstacle, repère...).
 * - `line` / `pen` : utilisent `points` à plat [x0, y0, x1, y1, ...].
 * - `rect` / `ellipse` : utilisent la boîte englobante `x, y, width, height`
 *   (x,y = coin haut-gauche ; width/height toujours positifs après dessin).
 */
export interface Shape {
  id: string;
  kind: ShapeKind;
  points?: number[];
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  stroke: string;
  strokeWidth: number;
}

/** Zone reliant plusieurs étages (typiquement un ascenseur). */
export interface ElevatorZone {
  id: string;
  /** Polygone de la zone, à plat [x0, y0, x1, y1, ...]. */
  points: number[];
  /** Niveaux desservis par cette zone, ex. [0, 1, 2]. */
  levels: number[];
}

/** Un étage d'une carte : ses formes (murs) et ses zones d'ascenseur. */
export interface Floor {
  id: string;
  /** Niveau de l'étage, 0 = rez-de-chaussée. */
  level: number;
  shapes: Shape[];
  elevatorZones: ElevatorZone[];
}

/** Configuration complète d'une carte, sauvegardée/exportée d'un bloc. */
export interface MapConfig {
  id: string;
  name: string;
  /** Image de plan importée, stockée en data URL (base64). */
  backgroundImage: string | null;
  /** Échelle de la carte : nombre de pixels pour 1 mètre (null = non calibrée). */
  pixelsPerMeter: number | null;
  /** 1 à MAX_FLOORS étages. */
  floors: Floor[];
}

/** Joueur posé sur la carte (préparé pour les sessions suivantes). */
export interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  /** Étage sur lequel se trouve le joueur. */
  floorLevel: number;
  /** Orientation de la vision, en degrés (0 = vers la droite). */
  headingDeg: number;
  /** Ouverture du cône de vision, en degrés. */
  coneAngleDeg: number;
  /** Portée de la vision, en pixels carte. */
  viewRange: number;
}

/** Crée un étage vide pour un niveau donné. */
export function createEmptyFloor(level: number): Floor {
  return {
    id: crypto.randomUUID(),
    level,
    shapes: [],
    elevatorZones: [],
  };
}

/** Crée une nouvelle carte vide avec un seul étage (rez-de-chaussée). */
export function createEmptyMap(name: string): MapConfig {
  return {
    id: crypto.randomUUID(),
    name,
    backgroundImage: null,
    pixelsPerMeter: null,
    floors: [createEmptyFloor(0)],
  };
}
