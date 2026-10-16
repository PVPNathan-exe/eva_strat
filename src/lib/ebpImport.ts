// Import d'une stratégie exportée par EBP.GG (JSON, version 5) : lecture, contrôle et conversion vers les repères de l'application.
// EBP : `left` et `top` en pourcentage de la zone de la carte (même cadrage que notre image de plan), `angle` en degrés (0 = vers le haut, sens horaire),
// équipe jaune (gauche, orange) = joueurs 1 à 4, équipe bleue (droite) = joueurs 6 à 9.
// Application : positions normalisées de la minimap (0 à 1, y vers le bas, comme `samples`), regard en degrés (0 = vers l'est, sens horaire), joueurs 1 à 8 (bleus 5 à 8).
// Seuls les pions de chaque étape sont lus ; dessins, texte, spécialités et le bloc « immersive » sont ignorés (format non décodé).

import type { Inset } from './planInsets';
import type { TeamSide } from '../types/stats';

export interface PlanPawn {
  /** Joueur de 1 à 8 (1 à 4 orange, 5 à 8 bleu), comme `samples.slot`. */
  slot: number;
  team: TeamSide;
  /** Position sur la minimap, 0 à 1. */
  x: number;
  y: number;
  /** Regard en degrés (0 = est, 90 = sud), entre 0 inclus et 360 exclu. */
  gaze: number;
  dead: boolean;
  /** Étage EBP (0 = rez-de-chaussée), information gardée telle quelle. */
  floor: number;
}

export interface PlanStep {
  pawns: PlanPawn[];
}

export interface ImportedPlan {
  name: string;
  steps: PlanStep[];
  /** `stepsDetails[i].time` en secondes : durée supposée du passage de l'étape i à l'étape i + 1 (hypothèse, non vérifiée dans EBP.GG). */
  transitions: number[];
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Angle EBP (0 = haut, horaire) vers notre regard (0 = est, horaire), dans [0, 360). */
export function gazeFromEbp(angle: number): number {
  return (((angle - 90) % 360) + 360) % 360;
}

/** Pourcentage du plan vers position de la minimap : inverse de `planInsets.project`. */
export function minimapFromPlan(inset: Inset, leftPct: number, topPct: number): { x: number; y: number } {
  return { x: (leftPct / 100 - inset.l) / (1 - inset.l - inset.r), y: (topPct / 100 - inset.t) / (1 - inset.t - inset.b) };
}

/** Numéro EBP (jaune 1 à 4, bleu 6 à 9) vers le joueur 1 à 8. */
export function slotOfEbp(team: TeamSide, number: number): number {
  return team === 'A' ? number : number - 1;
}

function readPawn(raw: unknown, team: TeamSide, inset: Inset, where: string): PlanPawn {
  if (!isRec(raw)) throw new Error(`${where} : pion illisible`);
  const { left, top, angle, number } = raw;
  if (typeof left !== 'number' || typeof top !== 'number' || typeof number !== 'number') throw new Error(`${where} : pion sans position ou sans numéro`);
  const slot = slotOfEbp(team, number);
  const lo = team === 'A' ? 1 : 5;
  if (!Number.isInteger(slot) || slot < lo || slot > lo + 3) throw new Error(`${where} : numéro ${number} hors de l'équipe ${team === 'A' ? 'jaune (1 à 4)' : 'bleue (6 à 9)'}`);
  const { x, y } = minimapFromPlan(inset, left, top);
  return { slot, team, x, y, gaze: gazeFromEbp(typeof angle === 'number' ? angle : 0), dead: raw.dead === true, floor: typeof raw.floor === 'number' ? raw.floor : 0 };
}

/** Lit un export EBP.GG. `inset` : cadre de la minimap dans le plan de la carte. Lève une erreur au message clair si le fichier n'est pas un export lisible. */
export function parseEbp(json: unknown, inset: Inset): ImportedPlan {
  if (!isRec(json) || !Array.isArray(json.steps) || json.steps.length === 0) throw new Error("Ce fichier n'est pas un export EBP.GG (pas d'étapes)");
  const steps = json.steps.map((s, i): PlanStep => {
    if (!isRec(s) || !Array.isArray(s.yellowTeam) || !Array.isArray(s.blueTeam)) throw new Error(`Étape ${i + 1} : équipes absentes`);
    const where = `Étape ${i + 1}`;
    const pawns = [...s.yellowTeam.map((p) => readPawn(p, 'A', inset, where)), ...s.blueTeam.map((p) => readPawn(p, 'B', inset, where))];
    return { pawns: pawns.sort((a, b) => a.slot - b.slot) };
  });
  const details = Array.isArray(json.stepsDetails) ? json.stepsDetails : [];
  const transitions = steps.slice(1).map((_, i) => {
    const d = details[i];
    const ms = isRec(d) && typeof d.time === 'number' && d.time > 0 ? d.time : 2000;
    return ms / 1000;
  });
  return { name: typeof json.name === 'string' ? json.name : '', steps, transitions };
}

/** Durée totale du plan en secondes (somme des passages d'une étape à la suivante). */
export const planDuration = (plan: ImportedPlan): number => plan.transitions.reduce((a, b) => a + b, 0);

/** Début de chaque étape en secondes. */
export function stepStarts(plan: ImportedPlan): number[] {
  const out = [0];
  for (const d of plan.transitions) out.push(out[out.length - 1] + d);
  return out;
}

/** Angle de a vers b par le plus court chemin. */
function lerpAngle(a: number, b: number, k: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (((a + d * k) % 360) + 360) % 360;
}

/** Pions à l'instant `t` : interpolation linéaire entre l'étape en cours et la suivante (position et regard). Un joueur absent de l'étape suivante reste où il est. */
export function pawnsAt(plan: ImportedPlan, t: number): PlanPawn[] {
  const starts = stepStarts(plan);
  let i = starts.length - 1;
  while (i > 0 && starts[i] > t) i -= 1;
  const here = plan.steps[i].pawns;
  if (i >= plan.steps.length - 1) return here;
  const k = Math.min(1, Math.max(0, (t - starts[i]) / plan.transitions[i]));
  const next = new Map(plan.steps[i + 1].pawns.map((p) => [p.slot, p]));
  return here.map((p) => {
    const q = next.get(p.slot);
    if (!q) return p;
    return { ...p, x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, gaze: lerpAngle(p.gaze, q.gaze, k), dead: k < 1 ? p.dead : q.dead };
  });
}
