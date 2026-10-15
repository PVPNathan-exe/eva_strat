// Portes à boutons d'une carte (Reef Point) : blocs de porte, boutons et animation d'ouverture. Données écrites par analysis/plan_from_mask.py (analysis/map_door_blocks.json) ;
// (les données elles-mêmes sont lues par doorData.ts) ; durées mesurées sur la vidéo « NCT vs OR », game 23 de Reef Point (voir CLAUDE.md). Fonctions pures : le temps est passé en millisecondes, aucune horloge ici.
//
// Une porte est faite de DEUX BATTANTS posés l'un contre l'autre dans le sens du chemin, chacun aussi large que le chemin (mesuré sur la minimap de la vidéo : deux cases en série). Ils
// s'ouvrent en coulissant chacun vers son bord du chemin, en s'amincissant jusqu'à une fine barre contre le bord ; à la fermeture ils reviennent l'un contre l'autre.
// Une pression sur un bouton inverse les portes qu'il commande. Pour chaque porte : les battants deviennent verts dès la pression et restent pleins `hold_s` secondes, puis ils bougent pendant
// `move_s` secondes. Pendant ce temps la porte ne réagit plus aux boutons. Un joueur peut passer dès que la porte est un peu ouverte (voir doorPassable), pas si elle est complètement fermée.

export type DoorState = 'open' | 'closed';

export interface DoorBlock {
  id: string;
  /** Nom à afficher (gauche, centre, droite). */
  name?: string;
  /** Centre de la porte, en pixels du plan. */
  cx: number;
  cy: number;
  /** Longueur de la porte dans le sens du chemin (les deux battants ensemble) et largeur du chemin à cet endroit (largeur d'un battant). Pixels du plan. */
  along: number;
  across: number;
  /** Direction du chemin (de `along`), en degrés. */
  angle: number;
  initial: DoorState;
}

export interface DoorButton {
  id: string;
  /** Portes inversées par ce bouton. */
  toggles: string[];
  x: number;
  y: number;
  color: string;
}

export interface DoorAnim {
  hold_s: number;
  move_s: number;
}

export interface DoorSetup {
  /** Taille du plan en pixels : les coordonnées ci-dessus sont dans ce repère. */
  plan: [number, number];
  doors: DoorBlock[];
  buttons: DoorButton[];
  anim: DoorAnim;
}

/** Une porte en cours de mouvement. */
export interface DoorRun {
  from: DoorState;
  startMs: number;
}

/** État d'une porte : son état posé, et son mouvement en cours s'il y en a un. */
export interface DoorEntry {
  state: DoorState;
  run?: DoorRun;
}

export type DoorStates = Record<string, DoorEntry>;

/** Ce qu'il faut dessiner : `closed` de 0 (ouverte, rien à voir) à 1 (fermée, bloc plein) ; `active` pendant le mouvement (bloc vert). */
export interface DoorView {
  closed: number;
  active: boolean;
}

/** Durée totale d'un mouvement de porte, en secondes. */
export const totalSeconds = (anim: DoorAnim) => anim.hold_s + anim.move_s;

const flip = (s: DoorState): DoorState => (s === 'open' ? 'closed' : 'open');
const closedness = (s: DoorState) => (s === 'closed' ? 1 : 0);

/** Portes dans leur état de départ (aucun mouvement). */
export function initialStates(setup: DoorSetup): DoorStates {
  return Object.fromEntries(setup.doors.map((d) => [d.id, { state: d.initial }]));
}

/** L'état d'une porte une fois son mouvement fini (ou son état posé s'il n'y en a pas). */
export function settledState(entry: DoorEntry, nowMs: number, anim: DoorAnim): DoorState {
  if (!entry.run) return entry.state;
  return (nowMs - entry.run.startMs) / 1000 >= totalSeconds(anim) ? flip(entry.run.from) : entry.state;
}

/** Aspect d'une porte à l'instant donné. */
export function doorView(entry: DoorEntry, nowMs: number, anim: DoorAnim): DoorView {
  const run = entry.run;
  if (!run) return { closed: closedness(entry.state), active: false };
  const elapsed = (nowMs - run.startMs) / 1000;
  const to = flip(run.from);
  if (elapsed >= totalSeconds(anim)) return { closed: closedness(to), active: false };
  const progress = Math.max(0, (elapsed - anim.hold_s) / anim.move_s);
  return { closed: closedness(run.from) + (closedness(to) - closedness(run.from)) * progress, active: true };
}

/** Une porte est en mouvement à cet instant. */
export const isMoving = (entry: DoorEntry, nowMs: number, anim: DoorAnim) => !!entry.run && (nowMs - entry.run.startMs) / 1000 < totalSeconds(anim);

/** Pression sur un bouton : chaque porte commandée qui n'est pas en mouvement s'inverse (son mouvement démarre à `nowMs`). Renvoie de nouveaux états, ou les mêmes si rien ne change. */
export function press(states: DoorStates, button: DoorButton, nowMs: number, anim: DoorAnim): DoorStates {
  let changed = false;
  const next: DoorStates = { ...states };
  for (const id of button.toggles) {
    const entry = states[id];
    if (!entry || isMoving(entry, nowMs, anim)) continue;
    const base = settledState(entry, nowMs, anim);
    next[id] = { state: base, run: { from: base, startMs: nowMs } };
    changed = true;
  }
  return changed ? next : states;
}

/** Épaisseur minimale (part d'un demi-bloc) d'un battant en mouvement : à moitié ouvert il reste une barre contre le bord, comme sur la minimap. */
export const MIN_LEAF = 0.12;

/** Un joueur peut passer dès que la porte est un peu ouverte ; complètement fermée (`closed` = 1), non. Pendant le délai d'une porte qui va s'ouvrir elle est encore fermée. */
export const doorPassable = (view: DoorView) => view.closed < 1;

/**
 * Battants d'une porte pour une fermeture de 0 (ouverte) à 1 (fermée) : deux rectangles (pixels du plan), un contre chaque bord du chemin. À `closed` = 1 ils se touchent au milieu ;
 * en dessous ils s'amincissent vers leur bord extérieur (le bord extérieur ne bouge pas). Le plus mince fait MIN_LEAF d'un demi-bloc tant que la porte bouge.
 */
export function leafCorners(door: DoorBlock, closed = 1): [number, number][][] {
  const a = (door.angle * Math.PI) / 180;
  const u = [Math.cos(a), Math.sin(a)];
  const n = [-Math.sin(a), Math.cos(a)];
  const half = door.along / 2;
  const w = door.across / 2;
  const t = half * Math.max(0, Math.min(1, closed));
  const leaf = (from: number, to: number): [number, number][] =>
    [
      [from, -w],
      [to, -w],
      [to, w],
      [from, w],
    ].map(([s, c]) => [door.cx + u[0] * s + n[0] * c, door.cy + u[1] * s + n[1] * c] as [number, number]);
  return [leaf(-half, -half + t), leaf(half - t, half)];
}
