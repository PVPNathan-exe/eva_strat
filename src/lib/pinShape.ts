// Forme d'une pastille de joueur sur la minimap : un disque prolongé d'une pointe (le regard).

/** Rayon d'une pastille de joueur, en fraction de la largeur de la minimap (mesuré sur les disques lus). */
export const MARKER_RADIUS = 0.0165;

const STEPS = 48;
const TIP = 1.7; // la pointe dépasse du disque jusqu'à 1,7 rayon du centre

/** Contour d'une pastille en forme d'épingle (disque plus pointe) dans un repère en pixels : points du polygone, la pointe vers `angleDeg` (0 = droite, 90 = bas). Sans angle : le disque seul. */
export function pinOutline(cx: number, cy: number, radius: number, angleDeg: number | null): [number, number][] {
  const point = (a: number, r = radius): [number, number] => [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  if (angleDeg === null) return Array.from({ length: STEPS }, (_, i) => point((i / STEPS) * Math.PI * 2));
  const tip = (angleDeg * Math.PI) / 180;
  const open = Math.acos(1 / TIP); // les deux côtés de la pointe sont tangents au disque
  const out: [number, number][] = [];
  for (let i = 0; i <= STEPS; i++) out.push(point(tip + open + (i / STEPS) * (Math.PI * 2 - 2 * open)));
  out.push(point(tip, radius * TIP));
  return out;
}

