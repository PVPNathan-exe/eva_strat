// Anneaux tournants d'Engine (analysis/rotors.py, map_rotors.json) : arcs pleins de chaque anneau à un instant de game, pour les dessiner sur la carte des couloirs.
// Angles de l'image : croissant = sens horaire à l'écran.

export interface RotorRing {
  nom: string;
  r_min: number; // bande de l'arc plein, fractions de la hauteur de la minimap
  r_max: number;
  omega: number; // degrés par seconde (positif : horaire)
  ouvertures: [number, number][]; // degrés à t_ref
  fenetres?: [number, number][]; // [centre, demi-largeur] en degrés à t_ref : on voit à travers, on ne passe pas
}

export interface RotorModel {
  aspect: number; // largeur / hauteur de la minimap
  centre: [number, number];
  t_ref: number; // instant de game de la mesure des ouvertures
  anneaux: RotorRing[];
}

/** Intervalles d'angle (degrés, croissants, entre 0 et 720) des arcs pleins d'un anneau à l'instant de game t : le complémentaire des ouvertures, tournées de omega x (t - t_ref). */
export function solidArcs(ring: RotorRing, t: number, tRef: number): [number, number][] {
  const shift = ring.omega * (t - tRef);
  const gaps = ring.ouvertures
    .map(([a, b]) => [(((a + shift) % 360) + 360) % 360, (((a + shift) % 360) + 360) % 360 + (b - a)] as [number, number])
    .sort((p, q) => p[0] - q[0]);
  const arcs: [number, number][] = [];
  for (let i = 0; i < gaps.length; i++) {
    const end = gaps[i][1];
    const next = i + 1 < gaps.length ? gaps[i + 1][0] : gaps[0][0] + 360;
    if (next > end) arcs.push([end, next]);
  }
  return arcs;
}

/** Intervalles d'angle (degrés) des fenêtres d'un anneau à l'instant de game t, tournées de omega x (t - t_ref). */
export function windowArcs(ring: RotorRing, t: number, tRef: number): [number, number][] {
  const shift = ring.omega * (t - tRef);
  return (ring.fenetres ?? []).map(([centre, half]) => {
    const c = (((centre + shift) % 360) + 360) % 360;
    return [c - half, c + half] as [number, number];
  });
}

/** Points (fractions de la minimap) d'un arc de cercle de l'anneau, au rayon moyen de sa bande, pour le tracer en ligne brisée. */
export function arcPoints(model: RotorModel, ring: RotorRing, [from, to]: [number, number], stepDeg = 3): [number, number][] {
  const r = (ring.r_min + ring.r_max) / 2;
  const count = Math.max(2, Math.ceil((to - from) / stepDeg) + 1);
  return Array.from({ length: count }, (_, i) => {
    const a = ((from + ((to - from) * i) / (count - 1)) * Math.PI) / 180;
    return [model.centre[0] + (r * Math.cos(a)) / model.aspect, model.centre[1] + r * Math.sin(a)] as [number, number];
  });
}
