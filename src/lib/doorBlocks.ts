// Portes à boutons d'une carte (Reef Point) : blocs de porte, boutons et animation d'ouverture. Données écrites par analysis/plan_from_mask.py (analysis/map_door_blocks.json) ;
// (les données elles-mêmes sont lues par doorData.ts) ; durées mesurées sur la vidéo « NCT vs OR », game 23 de Reef Point (voir CLAUDE.md). Fonctions pures : le temps est passé en millisecondes, aucune horloge ici.
//
// Une pression sur un bouton inverse les portes qu'il commande. Pour chaque porte : le bloc se colore en vert dès la pression et reste plein `hold_s` secondes, puis le bloc se
// rétrécit (porte qui s'ouvre) ou grandit (porte qui se ferme) pendant `move_s` secondes. Pendant ce temps la porte ne réagit plus aux boutons.

export type DoorState = 'open' | 'closed';

export interface DoorBlock {
  id: string;
  /** Centre du bloc, en pixels du plan. */
  cx: number;
  cy: number;
  /** Longueur du bloc, en travers du chemin (toute la largeur du chemin), et épaisseur, dans le sens du chemin. Pixels du plan. */
  len: number;
  depth: number;
  /** Angle de la longueur du bloc, en degrés. */
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

/** Quatre coins du bloc (pixels du plan) pour une fermeture de 0 à 1 : l'épaisseur est proportionnelle à `closed`, le centre ne bouge pas. */
export function blockCorners(door: DoorBlock, closed = 1): [number, number][] {
  const a = (door.angle * Math.PI) / 180;
  const u = [Math.cos(a), Math.sin(a)];
  const n = [-Math.sin(a), Math.cos(a)];
  const hl = door.len / 2;
  const hd = (door.depth * closed) / 2;
  return [
    [door.cx - u[0] * hl - n[0] * hd, door.cy - u[1] * hl - n[1] * hd],
    [door.cx + u[0] * hl - n[0] * hd, door.cy + u[1] * hl - n[1] * hd],
    [door.cx + u[0] * hl + n[0] * hd, door.cy + u[1] * hl + n[1] * hd],
    [door.cx - u[0] * hl + n[0] * hd, door.cy - u[1] * hl + n[1] * hd],
  ];
}
