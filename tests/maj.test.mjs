import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { groupOf, mapOfPath, partOf } from '../scripts/maj/parts.mjs';
import { planUpdate } from '../scripts/maj/plan.mjs';
import { runUpdate } from '../scripts/maj/update.mjs';
import { readState } from '../scripts/maj/manifest.mjs';
import { decide, recommend } from '../scripts/maj/sensitive.mjs';
import { filesOfPart, runReset } from '../scripts/maj/reset.mjs';
import { writeContribution } from '../scripts/maj/contribute.mjs';
import { parseArgs } from '../scripts/maj/cli.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'eva-maj-test-'));

function put(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

const read = (root, rel) => readFileSync(join(root, rel), 'utf-8');

// ------------------------------------------------------------------ parties

test('chaque fichier est rangé dans sa partie, et data/ et .eva/ ne sont jamais touchés', () => {
  assert.equal(partOf('src/App.tsx'), 'code');
  assert.equal(partOf('analysis/tracking.py'), 'code');
  assert.equal(partOf('analysis/map_masks/Polaris.png'), 'masques');
  assert.equal(partOf('analysis/map_stations.json'), 'masques');
  assert.equal(partOf('analysis/map_reliability/Polaris.json'), 'masques');
  assert.equal(partOf('analysis/tracking_params.json'), 'suivi');
  assert.equal(partOf('analysis/datasets/ceres-1.json.gz'), 'suivi');
  assert.equal(partOf('analysis/weapon_icons/names.json'), 'armes');
  assert.equal(partOf('analysis/minimap_digits.npz'), 'modeles');
  assert.equal(partOf('analysis/map_names/Polaris.png'), 'modeles');
  assert.equal(partOf('data/eva.db'), null);
  assert.equal(partOf('.eva/state.json'), null);
  assert.equal(partOf('node_modules/x/index.js'), null);
  assert.equal(partOf('analysis/__pycache__/x.pyc'), null);
  assert.equal(partOf('analysis/weapon_icons/candidates/a.png'), null);
});

test('carte et groupe d\'un fichier de masque', () => {
  assert.equal(mapOfPath('analysis/map_masks/Polaris.png'), 'Polaris');
  assert.equal(mapOfPath('analysis/map_masks/Reef Point_lignes.png'), 'Reef Point');
  assert.equal(mapOfPath('analysis/map_masks/The Cliff_plan_ajouts.png'), 'The Cliff');
  assert.equal(mapOfPath('analysis/map_stations.json'), null);
  assert.equal(groupOf('analysis/map_masks/Polaris_classes.png'), 'masques:Polaris');
  assert.equal(groupOf('analysis/map_stations.json'), 'masques:json');
  assert.equal(groupOf('analysis/tracking_params.json'), 'suivi');
  assert.equal(groupOf('src/App.tsx'), 'code');
});

// ------------------------------------------------------------------ plan

const maps = (o) => new Map(Object.entries(o));
const action = (path, B, L, U) => planUpdate(maps(B), maps(L), maps(U)).find((i) => i.path === path)?.action;

test('plan : code inchangé par l\'utilisateur, GitHub a bougé : remplacé', () => {
  assert.equal(action('src/a.ts', { 'src/a.ts': '1' }, { 'src/a.ts': '1' }, { 'src/a.ts': '2' }), 'overwrite');
});
test('plan : code modifié par l\'utilisateur, GitHub n\'a pas bougé : gardé', () => {
  assert.equal(action('src/a.ts', { 'src/a.ts': '1' }, { 'src/a.ts': 'moi' }, { 'src/a.ts': '1' }), 'keep');
});
test('plan : code modifié des deux côtés : GitHub l\'emporte (sauvegarde faite à l\'application)', () => {
  assert.equal(action('src/a.ts', { 'src/a.ts': '1' }, { 'src/a.ts': 'moi' }, { 'src/a.ts': '2' }), 'overwrite');
});
test('plan : code sans base qui diffère de GitHub : remplacé ; absent : ajouté ; identique : same', () => {
  assert.equal(action('src/a.ts', {}, { 'src/a.ts': 'vieux' }, { 'src/a.ts': 'neuf' }), 'overwrite');
  assert.equal(action('src/a.ts', {}, {}, { 'src/a.ts': 'neuf' }), 'add');
  assert.equal(action('src/a.ts', {}, { 'src/a.ts': 'x' }, { 'src/a.ts': 'x' }), 'same');
});
test('plan : code supprimé de GitHub : supprimé seulement s\'il n\'a pas été modifié', () => {
  assert.equal(action('src/a.ts', { 'src/a.ts': '1' }, { 'src/a.ts': '1' }, {}), 'delete');
  assert.equal(action('src/a.ts', { 'src/a.ts': '1' }, { 'src/a.ts': 'moi' }, {}), 'keep');
});
test('plan : un fichier sensible différent n\'est jamais remplacé, il est à décider', () => {
  const p = 'analysis/map_masks/Polaris.png';
  assert.equal(action(p, { [p]: '1' }, { [p]: '1' }, { [p]: '2' }), 'diverge'); // pas touché, GitHub a bougé
  assert.equal(action(p, { [p]: '1' }, { [p]: 'moi' }, { [p]: '2' }), 'diverge'); // modifié des deux côtés
  assert.equal(action(p, {}, { [p]: 'moi' }, { [p]: '2' }), 'diverge'); // sans base : tenu pour modifié
  assert.equal(action(p, { [p]: '1' }, { [p]: 'moi' }, { [p]: '1' }), 'keep'); // GitHub n'a pas bougé : rien à décider
});
test('plan : fichier sensible neuf de GitHub : ajout à décider ; supprimé par l\'utilisateur : pas ramené', () => {
  const p = 'analysis/map_masks/Neuve.png';
  assert.equal(action(p, {}, {}, { [p]: '1' }), 'add');
  assert.equal(action(p, { [p]: '1' }, {}, { [p]: '2' }), 'keep');
});

// ------------------------------------------------------------------ mise à jour de bout en bout (GitHub simulé par un dossier)

function scenario() {
  const root = tmp();
  const up = tmp();
  const v1 = { 'src/app.ts': 'v1', 'src/gone.ts': 'old', 'analysis/map_masks/Polaris.png': 'masque-github-1', 'analysis/tracking_params.json': '{"v":1}', 'README.md': 'r1' };
  put(up, v1);
  put(root, { 'data/eva.db': 'MA BASE', ...v1 });
  return { root, up };
}

test('première synchronisation d\'un dossier identique : rien à faire, l\'état est enregistré', async () => {
  const { root, up } = scenario();
  const r = await runUpdate({ root, source: up });
  assert.equal(r.status, 'a-jour');
  assert.ok(readState(root).sha?.startsWith('dossier-'));
  assert.equal((await runUpdate({ root, source: up })).status, 'a-jour'); // deuxième contrôle : rien à télécharger
});

test('mise à jour : le code est remplacé et sauvegardé, le sensible n\'est pas touché, data/ non plus', async () => {
  const { root, up } = scenario();
  await runUpdate({ root, source: up });
  // GitHub avance : code modifié, un fichier supprimé, un fichier neuf, un masque et des réglages changés
  put(up, { 'src/app.ts': 'v2', 'src/new.ts': 'neuf', 'analysis/map_masks/Polaris.png': 'masque-github-2', 'analysis/tracking_params.json': '{"v":2}' });
  writeFileSync(join(up, 'README.md'), 'r1');
  // chez l'utilisateur : masque modifié à la main, réglages du suivi laissés tels quels
  put(root, { 'analysis/map_masks/Polaris.png': 'MON MASQUE' });
  rmSync(join(up, 'src/gone.ts'));
  const r = await runUpdate({ root, source: up });
  assert.equal(r.status, 'mis-a-jour');
  assert.equal(read(root, 'src/app.ts'), 'v2');
  assert.equal(read(root, 'src/new.ts'), 'neuf');
  assert.equal(existsSync(join(root, 'src/gone.ts')), false);
  assert.equal(read(root, 'analysis/map_masks/Polaris.png'), 'MON MASQUE'); // jamais écrasé
  assert.equal(read(root, 'analysis/tracking_params.json'), '{"v":1}'); // jamais écrasé, même resté tel quel
  assert.equal(read(root, 'data/eva.db'), 'MA BASE');
  assert.deepEqual(r.pending.map((p) => p.group).sort(), ['masques:Polaris', 'suivi']);
  // l'ancien code est dans la sauvegarde
  const saved = readdirSync(join(root, '.eva', 'backup'));
  assert.equal(readFileSync(join(root, '.eva', 'backup', saved[0], 'src/app.ts'), 'utf-8'), 'v1');
  assert.equal((await runUpdate({ root, source: up })).status, 'a-jour'); // pas de nouveau téléchargement, le rappel reste
});

test('un fichier de code modifié par l\'utilisateur alors que GitHub n\'a pas bougé reste tel quel', async () => {
  const { root, up } = scenario();
  await runUpdate({ root, source: up });
  put(root, { 'src/app.ts': 'ma version' });
  put(up, { 'src/other.ts': 'x' }); // GitHub change autre chose
  await runUpdate({ root, source: up });
  assert.equal(read(root, 'src/app.ts'), 'ma version');
});

test('simulation : rien n\'est écrit', async () => {
  const { root, up } = scenario();
  await runUpdate({ root, source: up });
  put(up, { 'src/app.ts': 'v2' });
  const r = await runUpdate({ root, source: up, dryRun: true });
  assert.equal(r.status, 'a-faire');
  assert.deepEqual(r.todo, ['overwrite src/app.ts']);
  assert.equal(read(root, 'src/app.ts'), 'v1');
});

test('installation Git : rien n\'est écrit, seulement un avis', async () => {
  const { root, up } = scenario();
  mkdirSync(join(root, '.git'));
  const r = await runUpdate({ root, source: up });
  assert.equal(r.status, 'nouveautes-git');
  assert.equal(existsSync(join(root, '.eva')), false);
});

test('source introuvable : hors ligne, jamais d\'exception', async () => {
  const { root } = scenario();
  const r = await runUpdate({ root, source: join(root, 'nexiste-pas') });
  assert.equal(r.status, 'hors-ligne');
});

// ------------------------------------------------------------------ choix sur les parties sensibles

test('recommandation : mesure d\'abord, sinon GitHub seulement si rien n\'a été modifié', () => {
  assert.equal(recommend({ verdict: 'github' }, [{ untouched: false, action: 'overwrite' }]), 'github');
  assert.equal(recommend({ verdict: 'local' }, [{ untouched: true, action: 'overwrite' }]), 'local');
  assert.equal(recommend({ verdict: 'equivalent' }, [{ untouched: true, action: 'overwrite' }]), 'local');
  assert.equal(recommend({ verdict: 'inconnu' }, [{ untouched: true, action: 'overwrite' }]), 'github');
  assert.equal(recommend({ verdict: 'inconnu' }, [{ untouched: false, action: 'overwrite' }]), 'local');
});

async function pendingScenario() {
  const { root, up } = scenario();
  await runUpdate({ root, source: up });
  put(up, { 'analysis/weapon_icons/names.json': '{"B1":"X"}' });
  put(root, { 'analysis/weapon_icons/names.json': '{"B1":"MIEN"}' });
  const { diffGroups } = await import('../scripts/maj/sensitive.mjs');
  return { root, up, groups: diffGroups(root, up, readState(root)) };
}

test('choisir GitHub remplace le fichier sensible après sauvegarde', async () => {
  const { root, up, groups } = await pendingScenario();
  const out = await decide({ root, upstream: up, sha: 'sha1', groups, ask: async () => 'g', say: () => {} });
  assert.deepEqual(out.github, ['armes']);
  assert.equal(read(root, 'analysis/weapon_icons/names.json'), '{"B1":"X"}');
  const saved = readdirSync(join(root, '.eva', 'backup')).find((n) => n.endsWith('sensible'));
  assert.equal(readFileSync(join(root, '.eva', 'backup', saved, 'analysis/weapon_icons/names.json'), 'utf-8'), '{"B1":"MIEN"}');
});

test('garder la sienne ne touche à rien et n\'est pas redemandé pour cette version', async () => {
  const { root, up, groups } = await pendingScenario();
  const out = await decide({ root, upstream: up, sha: 'sha1', groups, ask: async () => 'l', say: () => {} });
  assert.deepEqual(out.local, ['armes']);
  assert.equal(read(root, 'analysis/weapon_icons/names.json'), '{"B1":"MIEN"}');
  assert.equal(readState(root).kept.armes, 'sha1');
});

// ------------------------------------------------------------------ remise à zéro

test('fichiers d\'une partie : armes = avis seulement, suivi = réglages seulement, masques par carte', () => {
  const all = ['analysis/weapon_icons/names.json', 'analysis/weapon_icons/reviews.json', 'analysis/tracking_params.json', 'analysis/tracking_params.history.jsonl', 'analysis/map_masks/Polaris.png', 'analysis/map_masks/Polaris_lignes.png', 'analysis/map_masks/Ceres.png', 'analysis/map_stations.json', 'src/App.tsx'];
  assert.deepEqual(filesOfPart('armes', all), ['analysis/weapon_icons/reviews.json']);
  assert.deepEqual(filesOfPart('suivi', all), ['analysis/tracking_params.json']);
  assert.deepEqual(filesOfPart('masques', all, 'Polaris'), ['analysis/map_masks/Polaris.png', 'analysis/map_masks/Polaris_lignes.png']);
  assert.equal(filesOfPart('masques', all).length, 4);
});

test('reset des réglages du suivi : ta version est sauvegardée, celle de GitHub est remise, le reste n\'est pas touché', async () => {
  const { root, up } = scenario();
  await runUpdate({ root, source: up });
  put(root, { 'analysis/tracking_params.json': '{"v":"moi"}', 'analysis/weapon_icons/reviews.json': 'mes avis' });
  const lines = [];
  const r = await runReset({ root, part: 'suivi', confirm: async () => true, say: (s) => lines.push(s), source: up });
  assert.equal(r.done, true);
  assert.equal(read(root, 'analysis/tracking_params.json'), '{"v":1}');
  assert.equal(read(root, 'analysis/weapon_icons/reviews.json'), 'mes avis');
  assert.equal(readFileSync(join(r.backupDir, 'analysis/tracking_params.json'), 'utf-8'), '{"v":"moi"}');
});

test('reset refusé : rien n\'est touché ; simulation : rien n\'est touché', async () => {
  const { root, up } = scenario();
  await runUpdate({ root, source: up });
  put(root, { 'analysis/tracking_params.json': '{"v":"moi"}' });
  await runReset({ root, part: 'suivi', confirm: async () => false, say: () => {}, source: up });
  assert.equal(read(root, 'analysis/tracking_params.json'), '{"v":"moi"}');
  await runReset({ root, part: 'suivi', dryRun: true, confirm: async () => true, say: () => {}, source: up });
  assert.equal(read(root, 'analysis/tracking_params.json'), '{"v":"moi"}');
});

test('reset d\'une partie inconnue : erreur claire', async () => {
  await assert.rejects(runReset({ root: tmp(), part: 'tout', confirm: async () => true, say: () => {} }), /Partie inconnue/);
});

// ------------------------------------------------------------------ contribution et ligne de commande

test('la contribution contient les fichiers et le rapport, rien n\'est envoyé', () => {
  const root = tmp();
  put(root, { 'analysis/map_masks/Polaris.png': 'mon masque' });
  const found = [{ group: 'masques:Polaris', part: 'masques', items: [{ path: 'analysis/map_masks/Polaris.png' }], result: { part: 'masques', verdict: 'local', points: 900, local: { rejected: 0.0004, area: 0.3 }, github: { rejected: 0.02, area: 0.3 } } }];
  const { dir, groups } = writeContribution({ root, found, sha: 'abcdef1234567890' });
  assert.deepEqual(groups, ['masques:Polaris']);
  assert.equal(readFileSync(join(dir, 'fichiers/analysis/map_masks/Polaris.png'), 'utf-8'), 'mon masque');
  const report = readFileSync(join(dir, 'RAPPORT.md'), 'utf-8');
  assert.match(report, /abcdef12/);
  assert.match(report, /masques:Polaris/);
  assert.match(report, /ta version est meilleure/);
});

test('arguments de la ligne de commande', () => {
  const { flags, positional } = parseArgs(['masques', '--map', 'Reef Point', '--yes', '--dry-run', '--game', '7']);
  assert.deepEqual(positional, ['masques']);
  assert.deepEqual(flags, { yes: true, dryRun: true, check: false, map: 'Reef Point', game: 7 });
});
