import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blockCorners, doorView, initialStates, isMoving, press, settledState, totalSeconds, type DoorAnim, type DoorButton, type DoorSetup } from '../src/lib/doorBlocks.ts';

const anim: DoorAnim = { hold_s: 3.3, move_s: 5.7 };
const setup: DoorSetup = {
  plan: [1000, 500],
  anim,
  doors: [
    { id: 'G', cx: 100, cy: 100, len: 100, depth: 40, angle: 0, initial: 'closed' },
    { id: 'C', cx: 500, cy: 100, len: 80, depth: 40, angle: 90, initial: 'open' },
  ],
  buttons: [],
};
const rouge: DoorButton = { id: 'rouge', toggles: ['G', 'C'], x: 0, y: 0, color: '#f00' };
const vert: DoorButton = { id: 'vert', toggles: ['C'], x: 0, y: 0, color: '#0f0' };

test('la durée totale est le délai plus le mouvement (9,0 s mesurées sur la vidéo)', () => {
  assert.equal(totalSeconds(anim), 9);
});

test('Reef Point a trois portes et deux boutons, le rouge commande les trois et le vert seulement celle du centre', () => {
  const all = JSON.parse(readFileSync(new URL('../analysis/map_door_blocks.json', import.meta.url), 'utf8')) as Record<string, DoorSetup>;
  const reef = all['Reef Point'];
  assert.equal(reef.doors.length, 3);
  assert.deepEqual(reef.doors.map((d) => d.initial), ['closed', 'open', 'closed']);
  assert.deepEqual(reef.buttons.map((b) => b.toggles.length), [3, 1]);
  assert.deepEqual(reef.buttons[1].toggles, ['C']);
  assert.equal(all['Polaris'], undefined);
  // la carte est symétrique : la porte de droite est le miroir de celle de gauche, celle du centre est sur l'axe
  const [g, c, d] = reef.doors;
  assert.ok(Math.abs(g.cx + d.cx - 2 * c.cx) < 0.3, 'portes de côté symétriques autour de celle du centre');
  assert.ok(Math.abs(c.cx - reef.plan[0] / 2) < 1, 'porte du centre sur le milieu du plan');
});

test('états de départ : portes de côté fermées, porte du centre ouverte', () => {
  const s = initialStates(setup);
  assert.deepEqual(doorView(s.G, 0, anim), { closed: 1, active: false });
  assert.deepEqual(doorView(s.C, 0, anim), { closed: 0, active: false });
});

test('pression sur le bouton rouge : les portes s\'inversent, vertes dès la pression, bloc plein pendant le délai puis il bouge', () => {
  const s = press(initialStates(setup), rouge, 1000, anim);
  assert.deepEqual(doorView(s.G, 1000, anim), { closed: 1, active: true });
  assert.deepEqual(doorView(s.G, 1000 + 3000, anim), { closed: 1, active: true }); // encore dans le délai de 3,3 s
  const half = doorView(s.G, 1000 + 3300 + 2850, anim); // à mi-mouvement
  assert.ok(Math.abs(half.closed - 0.5) < 1e-9 && half.active);
  assert.deepEqual(doorView(s.G, 1000 + 9000, anim), { closed: 0, active: false }); // ouverte
  // la porte du centre fait le chemin inverse
  assert.deepEqual(doorView(s.C, 1000 + 3300, anim), { closed: 0, active: true });
  assert.deepEqual(doorView(s.C, 1000 + 9000, anim), { closed: 1, active: false });
});

test('le bouton vert ne touche que la porte du centre', () => {
  const s = press(initialStates(setup), vert, 0, anim);
  assert.equal(s.G.run, undefined);
  assert.ok(s.C.run);
});

test('une porte en mouvement ignore les boutons ; une fois finie elle repart dans l\'autre sens', () => {
  const s1 = press(initialStates(setup), rouge, 0, anim);
  assert.equal(press(s1, rouge, 5000, anim), s1); // rien ne change : tout est en mouvement
  assert.ok(isMoving(s1.G, 8999, anim) && !isMoving(s1.G, 9000, anim));
  assert.equal(settledState(s1.G, 9000, anim), 'open');
  const s2 = press(s1, rouge, 20000, anim);
  assert.deepEqual(doorView(s2.G, 20000, anim), { closed: 0, active: true }); // elle part de l'état ouvert
  assert.deepEqual(doorView(s2.G, 29000, anim), { closed: 1, active: false }); // et se referme
});

test('coins du bloc : toute la longueur, épaisseur proportionnelle à la fermeture, centre fixe', () => {
  const door = setup.doors[0];
  const full = blockCorners(door, 1);
  assert.deepEqual(full[0], [50, 80]);
  assert.deepEqual(full[2], [150, 120]);
  const half = blockCorners(door, 0.5);
  assert.deepEqual(half[0], [50, 90]);
  assert.deepEqual(half[2], [150, 110]);
});
