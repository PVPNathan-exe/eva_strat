// Données des armes et secondaires d'EVA (source : wiki evabattleplan.com).
// Codées en dur car l'API du wiki est verrouillée. Vérifiées depuis les fiches.

import type { Stuff, Firearm, Grenade, Utility, FalloffBand } from '../types/stuff';

export const stuffs: Stuff[] = [
  {
    kind: 'firearm',
    name: 'AK77',
    damage: { head: 17, body: 15, extremities: 14, average: 15.3 },
    falloff: [
      { fromM: 0, toM: 25, pct: 100 },
      { fromM: 25, toM: 35, pct: 83 },
      { fromM: 35, toM: null, pct: 75 },
    ],
    dispersionDeg: 0.3,
    fireRateRpm: 570,
    magazine: 35,
    reloadS: 1.8,
    bulletSpeedMs: 1000,
    equipS: 0.6,
  },
  {
    kind: 'firearm',
    name: 'ATLAS',
    description:
      "Sniper longue portée pour éliminer ses ennemis à distance sans être repéré.",
    damage: { head: 150, body: 95, extremities: 95, average: 113.3 },
    falloff: [{ fromM: 0, toM: null, pct: 100 }],
    dispersionNote: 'En visée 0 / Mobile 25',
    fireRateRpm: 60,
    magazine: 5,
    reloadS: 2.5,
    bulletSpeedMs: 3000,
    equipS: 0.9,
  },
  {
    kind: 'firearm',
    name: 'ERG',
    damage: { head: 1.62, body: 1.22, extremities: 1.1, average: 1.3 },
    falloff: [
      { fromM: 0, toM: 20, pct: 100 },
      { fromM: 20, toM: 30, pct: 80 },
      { fromM: 30, toM: null, pct: 70 },
    ],
    dispersionDeg: 0,
    fireRateRpm: 6000,
    magazine: 400,
    reloadS: 2,
    bulletSpeedMs: 5000,
    equipS: 0.6,
  },
  {
    kind: 'firearm',
    name: 'FURY',
    damage: { head: 25, body: 20, extremities: 18, average: 21 },
    falloff: [
      { fromM: 0, toM: 50, pct: 100 },
      { fromM: 50, toM: 70, pct: 80 },
      { fromM: 70, toM: null, pct: 70 },
    ],
    dispersionNote: 'Statique 0.15 / Mobile 10',
    fireRateRpm: 450,
    magazine: 75,
    reloadS: 4,
    bulletSpeedMs: 1000,
    equipS: 0.9,
  },
  {
    kind: 'firearm',
    name: 'M12 TACTICAL',
    damage: { head: 80, body: 80, extremities: 51, average: 70.3 },
    chargedDamage: { head: 100, body: 100, extremities: 100, average: 100 },
    falloff: [
      { fromM: 0, toM: 5, pct: 100 },
      { fromM: 5, toM: 10, pct: 70 },
      { fromM: 10, toM: null, pct: 60 },
    ],
    chargedFalloff: [
      { fromM: 0, toM: 5, pct: 100 },
      { fromM: 5, toM: 15, pct: 70 },
      { fromM: 15, toM: null, pct: 60 },
    ],
    dispersionDeg: 2.5,
    dispersionNote: 'Tir chargé 0',
    fireRateRpm: 150,
    magazine: 8,
    reloadS: 2,
    bulletSpeedMs: 5000,
    equipS: 0.3,
  },
  {
    kind: 'firearm',
    name: 'MP-52',
    description:
      "Fusil d'assaut automatique à forte cadence. Excelle en combat rapproché et moyenne distance.",
    damage: { head: 19, body: 16, extremities: 14, average: 16.3 },
    falloff: [
      { fromM: 0, toM: 8, pct: 100 },
      { fromM: 8, toM: 9, pct: 70 },
      { fromM: 9, toM: 15, pct: 55 },
      { fromM: 15, toM: null, pct: 45 },
    ],
    dispersionDeg: 1.431,
    fireRateRpm: 630,
    magazine: 35,
    reloadS: 1,
    bulletSpeedMs: 700,
    equipS: 0.3,
  },
  {
    kind: 'firearm',
    name: 'MX42',
    description: "Le couteau-suisse du Trooper. Bon partout, excellent entre de bonnes mains.",
    damage: { head: 15, body: 13, extremities: 10, average: 12.7 },
    falloff: [
      { fromM: 0, toM: 22, pct: 100 },
      { fromM: 22, toM: 30, pct: 85 },
      { fromM: 30, toM: null, pct: 75 },
    ],
    dispersionDeg: 0.25,
    fireRateRpm: 672,
    magazine: 40,
    reloadS: 1.5,
    bulletSpeedMs: 1000,
    equipS: 0.6,
  },
  {
    kind: 'firearm',
    name: 'NEEDLE',
    description: "Fusil énergétique à lunette, précis et longue portée.",
    damage: { head: 34, body: 30, extremities: 30, average: 31.3 },
    falloff: [{ fromM: 0, toM: null, pct: 100 }],
    dispersionDeg: 0,
    fireRateRpm: 258,
    magazine: 20,
    reloadS: 1.5,
    bulletSpeedMs: 2000,
    equipS: 0.6,
  },
  {
    kind: 'firearm',
    name: 'SOCOM',
    description: "Arme de poing réglementaire des soldats. Petite, agile, transportable.",
    damage: { head: 25, body: 20, extremities: 14, average: 19.7 },
    falloff: [
      { fromM: 0, toM: 16, pct: 100 },
      { fromM: 16, toM: null, pct: 75 },
    ],
    dispersionDeg: 0,
    fireRateRpm: 360,
    magazine: 12,
    reloadS: 0.5,
    bulletSpeedMs: 500,
    equipS: 0.1,
  },
  {
    kind: 'firearm',
    name: 'STRIKER',
    description: "Compact et mortel : l'outil parfait pour les combats rapprochés.",
    damage: { head: 19, body: 15, extremities: 13, average: 15.7 },
    falloff: [
      { fromM: 0, toM: 5, pct: 100 },
      { fromM: 5, toM: 8, pct: 65 },
      { fromM: 8, toM: 10, pct: 55 },
      { fromM: 10, toM: null, pct: 30 },
    ],
    dispersionDeg: 1.5,
    fireRateRpm: 780,
    magazine: 30,
    reloadS: 1,
    bulletSpeedMs: 700,
    equipS: 0.3,
  },
  {
    kind: 'firearm',
    name: 'T1 GAUSS',
    description: "Fusil à pompe puissant, tue en un coup au corps à corps.",
    damage: { head: 110, body: 110, extremities: 80, average: 100 },
    falloff: [
      { fromM: 0, toM: 3.5, pct: 100 },
      { fromM: 3.5, toM: 6, pct: 50 },
      { fromM: 6, toM: 10, pct: 40 },
      { fromM: 10, toM: 15, pct: 20 },
      { fromM: 15, toM: null, pct: 0 },
    ],
    dispersionDeg: 2,
    fireRateRpm: 54,
    magazine: 5,
    reloadS: 3,
    bulletSpeedMs: 5000,
    equipS: 0.5,
  },
  {
    kind: 'firearm',
    name: 'VULCAN',
    description:
      "Fusil d'assaut tirant par rafale de 3 coups. Bonne portée et bons dégâts, alternative au MP-52.",
    damage: { head: 19, body: 17, extremities: 15, average: 17 },
    falloff: [
      { fromM: 0, toM: 30, pct: 100 },
      { fromM: 30, toM: null, pct: 75 },
    ],
    dispersionNote: 'Rafale 0 / 0.1 / 0.1 · 0.20s entre rafales',
    burstCount: 3,
    fireRateRpm: 750,
    magazine: 30,
    reloadS: 1.5,
    bulletSpeedMs: 1000,
    equipS: 0.4,
  },
  {
    kind: 'firearm',
    name: 'WARDEN',
    description: "Arme de poing puissante et précise.",
    damage: { head: 49, body: 32, extremities: 28, average: 36.3 },
    falloff: [{ fromM: 0, toM: null, pct: 100 }],
    dispersionDeg: 0,
    fireRateRpm: 270,
    magazine: 9,
    reloadS: 1.2,
    bulletSpeedMs: 2000,
    equipS: 0.25,
  },
  {
    kind: 'firearm',
    name: 'WESTFIRE',
    description:
      "Fusil à levier des chasseurs de primes. Compromis entre rechargement rapide et tir puissant.",
    damage: { head: 100, body: 60, extremities: 45, average: 68.3 },
    falloff: [
      { fromM: 0, toM: 5, pct: 70 },
      { fromM: 5, toM: 25, pct: 100 },
      { fromM: 25, toM: null, pct: 80 },
    ],
    dispersionDeg: 0,
    fireRateRpm: 63,
    magazine: 9,
    reloadS: 3.6,
    bulletSpeedMs: 3000,
    equipS: 0.8,
  },
  // --- Secondaires / gadgets ---
  {
    kind: 'grenade',
    name: 'DX3',
    description:
      "Grenade plasma à dégâts de zone. S'équipe en plus des deux armes (spécialité).",
    fuseS: 3.5,
    reloadS: 45,
    maxDamage: 100,
    maxDamageRadiusM: 2,
    damageLimitRadiusM: 4,
  },
  {
    kind: 'grenade',
    name: 'STICKY',
    description:
      "Grenade antipersonnel qui adhère à la première surface. Plus précise que la DX3.",
    fuseS: 2.5,
    reloadS: 20,
    maxDamage: 95,
    maxDamageRadiusM: 3,
    damageLimitRadiusM: 5,
  },
  {
    kind: 'utility',
    name: 'SONAR',
    description:
      "Balise de reconnaissance : révèle la position des ennemis aux alentours, même à travers les murs. 1 par équipe.",
    fuseS: 0,
    reloadS: 40,
    radiusM: 8,
  },
  {
    kind: 'utility',
    name: 'SHIELD',
    description:
      "Crée une couverture temporaire sur le champ de bataille. 1 seul autorisé par équipe.",
    reloadS: 45,
    hp: 400,
    durationS: 10,
    activationS: 0.7,
  },
];

export const firearms = stuffs.filter((s): s is Firearm => s.kind === 'firearm');
export const secondaries = stuffs.filter(
  (s): s is Grenade | Utility => s.kind === 'grenade' || s.kind === 'utility',
);

/** Retrouve un item par son nom (clé d'identification utilisée dans le store). */
export function findStuff(name: string): Stuff | undefined {
  return stuffs.find((s) => s.name === name);
}

/** Libellé lisible d'un palier de falloff, ex. « 0–25 m » ou « > 35 m ». */
export function bandLabel(band: FalloffBand): string {
  return band.toM === null ? `> ${band.fromM} m` : `${band.fromM}–${band.toM} m`;
}

/**
 * Couleur d'un pourcentage de dégâts : 100 % vert → orange → rouge → gris (0 %).
 * Utilisée pour la carte de stats et les anneaux sur la carte.
 */
export function falloffColor(pct: number): string {
  if (pct <= 0) return '#5b6170';
  if (pct >= 100) return '#34c759';
  if (pct >= 80) return '#a8d54a';
  if (pct >= 60) return '#ffcc00';
  if (pct >= 40) return '#ff9500';
  return '#ff3b3b';
}
