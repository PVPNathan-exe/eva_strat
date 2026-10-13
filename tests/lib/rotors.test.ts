import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcPoints, solidArcs, windowArcs, type RotorModel } from '../../src/lib/rotors.ts';

const ring = { nom: 'x', r_min: 0.19, r_max: 0.21, omega: -3, ouvertures: [[100, 140], [280, 320]] as [number, number][] };

test('les arcs pleins sont le complémentaire des ouvertures à l\'instant de référence', () => {
  assert.deepEqual(solidArcs(ring, 15, 15), [[140, 280], [320, 460]]);
});

test('les ouvertures tournent avec la vitesse : anti-horaire pour une vitesse négative', () => {
  // 10 s plus tard, à -3 degrés par seconde : les ouvertures sont à 70-110 et 250-290
  assert.deepEqual(solidArcs(ring, 25, 15), [[110, 250], [290, 430]]);
  // une vitesse positive les fait avancer dans le sens horaire
  assert.deepEqual(solidArcs({ ...ring, omega: 3 }, 25, 15), [[170, 310], [350, 490]]);
});

test('un arc se trace en points au rayon moyen de la bande, autour du centre', () => {
  const model: RotorModel = { aspect: 2, centre: [0.5, 0.5], t_ref: 15, anneaux: [ring] };
  const points = arcPoints(model, ring, [0, 90]);
  assert.ok(Math.abs(points[0][0] - (0.5 + 0.2 / 2)) < 1e-9 && Math.abs(points[0][1] - 0.5) < 1e-9); // angle 0 : à droite du centre, largeur divisée par l'aspect
  const last = points[points.length - 1];
  assert.ok(Math.abs(last[0] - 0.5) < 1e-9 && Math.abs(last[1] - 0.7) < 1e-9); // angle 90 : sous le centre (y vers le bas)
});

test('les fenêtres tournent avec leur anneau', () => {
  const withWindows = { ...ring, fenetres: [[200, 10]] as [number, number][] };
  assert.deepEqual(windowArcs(withWindows, 15, 15), [[190, 210]]);
  assert.deepEqual(windowArcs(withWindows, 25, 15), [[160, 180]]); // anti-horaire : 30 degrés de moins
  assert.deepEqual(windowArcs(ring, 15, 15), []); // pas de fenêtre connue
});
