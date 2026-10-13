import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi } from '../../server/api.ts';
import { insertVideo, testContext } from './helpers.ts';

const q = (s = '') => new URLSearchParams(s);

test('GET /api/videos liste les vidéos', () => {
  const ctx = testContext();
  insertVideo(ctx);
  const res = handleApi(ctx, 'GET', '/api/videos', q(), undefined);
  assert.equal(res.status, 200);
  assert.equal((res.json as unknown[]).length, 1);
});

test('POST /api/games crée une game confirmée manuellement', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  const res = handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  assert.equal(res.status, 201);
  const list = handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined);
  const games = list.json as { start_s: number; status: string }[];
  assert.equal(games.length, 1);
  assert.equal(games[0].start_s, 100);
  assert.equal(games[0].status, 'confirmed');
});

test('POST /api/games refuse des bornes invalides', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx, 600);
  assert.equal(handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 50, end_s: 50 }).status, 400);
  assert.equal(handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: -5, end_s: 50 }).status, 400);
  assert.equal(handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 0, end_s: 9999 }).status, 400);
  assert.equal(handleApi(ctx, 'POST', '/api/games', q(), { video_id: 999, start_s: 0, end_s: 10 }).status, 400);
});

test('POST /api/games refuse un chevauchement', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const res = handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 600, end_s: 900 });
  assert.equal(res.status, 400);
  assert.match((res.json as { error: string }).error, /chevauche/i);
});

test('PATCH /api/games/:id modifie bornes, carte et statut', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  const res = handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { start_s: 120, end_s: 710, map: 'Silva', status: 'confirmed' });
  assert.equal(res.status, 200);
  const game = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as Record<string, unknown>[])[0];
  assert.equal(game.start_s, 120);
  assert.equal(game.end_s, 710);
  assert.equal(game.map, 'Silva');
});

test('PATCH autorise de rester sur ses propres bornes (pas de faux chevauchement)', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  assert.equal(handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { end_s: 710 }).status, 200);
});

test('PATCH refuse un statut inconnu et une game absente', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  assert.equal(handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { status: 'bidon' }).status, 400);
  assert.equal(handleApi(ctx, 'PATCH', '/api/games/9999', q(), { map: 'Silva' }).status, 404);
});

test('DELETE /api/games/:id supprime la game', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  assert.equal(handleApi(ctx, 'DELETE', `/api/games/${id}`, q(), undefined).status, 200);
  assert.equal((handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as unknown[]).length, 0);
  assert.equal(handleApi(ctx, 'DELETE', `/api/games/${id}`, q(), undefined).status, 404);
});

test('GET /api/calibrations renvoie les zones par défaut quand rien n’est enregistré', () => {
  const ctx = testContext();
  const res = handleApi(ctx, 'GET', '/api/calibrations', q('map=Silva'), undefined);
  assert.equal(res.status, 200);
  const body = res.json as { isDefault: boolean; zones: Record<string, unknown> };
  assert.equal(body.isDefault, true);
  assert.deepEqual(Object.keys(body.zones).sort(), ['capture_pct_a', 'capture_pct_b', 'capture_points', 'minimap', 'team_a_bar', 'team_b_bar', 'timer']);
});

test('PUT /api/calibrations enregistre puis relit les zones', () => {
  const ctx = testContext();
  const zones = { ...ctx.defaultZones, minimap: { x: 0.01, y: 0.7, w: 0.2, h: 0.28 } };
  assert.equal(handleApi(ctx, 'PUT', '/api/calibrations', q(), { map: 'Silva', zones }).status, 200);
  const body = handleApi(ctx, 'GET', '/api/calibrations', q('map=Silva'), undefined).json as {
    isDefault: boolean;
    zones: Record<string, { x: number }>;
  };
  assert.equal(body.isDefault, false);
  assert.equal(body.zones.minimap.x, 0.01);
  const other = handleApi(ctx, 'GET', '/api/calibrations', q('map=Atlantis'), undefined).json as { isDefault: boolean };
  assert.equal(other.isDefault, true);
});

test('PUT /api/calibrations refuse une zone hors de l’image', () => {
  const ctx = testContext();
  const zones = { ...ctx.defaultZones, minimap: { x: 0.9, y: 0.7, w: 0.3, h: 0.28 } };
  assert.equal(handleApi(ctx, 'PUT', '/api/calibrations', q(), { map: 'Silva', zones }).status, 400);
  assert.equal(handleApi(ctx, 'PUT', '/api/calibrations', q(), { map: '', zones: ctx.defaultZones }).status, 400);
});

test('route inconnue → 404', () => {
  const ctx = testContext();
  assert.equal(handleApi(ctx, 'GET', '/api/nimporte', q(), undefined).status, 404);
});

test('PATCH sans toucher aux bornes accepte une fin qui dépasse un peu la durée', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx, 1000);
  const id = Number(
    ctx.db.prepare("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 100, 1000.4, 'detected')").run(videoId).lastInsertRowid,
  );
  assert.equal(handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { map: 'Silva' }).status, 200);
  assert.equal(handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { end_s: 99999 }).status, 400);
});

test('PATCH efface les zones à vérifier à la confirmation, pas pour un simple changement de carte', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  const id = Number(
    ctx.db
      .prepare("INSERT INTO games (video_id, start_s, end_s, status, doubts) VALUES (?, 100, 700, 'detected', ?)")
      .run(videoId, JSON.stringify([{ start_s: 690, end_s: 700, label: 'x' }])).lastInsertRowid,
  );
  const doubts = () => (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { doubts: unknown[] }[])[0].doubts;
  handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { map: 'Silva' });
  assert.equal(doubts().length, 1);
  handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { status: 'confirmed' });
  assert.equal(doubts().length, 0);
});

test('les positions sont comptées par game et effacées quand on déplace une borne', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  const id = Number(ctx.db.prepare("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 100, 700, 'confirmed')").run(videoId).lastInsertRowid);
  ctx.db.prepare("INSERT INTO samples (game_id, frame, t, slot, team, x, y) VALUES (?, 0, 100, 1, 'A', 0.1, 0.2)").run(id);
  const samples = () => (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { samples: number }[])[0].samples;
  assert.equal(samples(), 1);
  handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { map: 'Silva' });
  assert.equal(samples(), 1);
  handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { end_s: 710 });
  assert.equal(samples(), 0);
});

test('la liste des games porte les pseudos, l’équipement et les kills (avec headshot)', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  const id = Number(ctx.db.prepare("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 100, 700, 'confirmed')").run(videoId).lastInsertRowid);
  ctx.db.prepare("INSERT INTO players (game_id, slot, name) VALUES (?, 1, 'SHADYJ4Y'), (?, 5, 'ORXPAPY')").run(id, id);
  ctx.db.prepare("INSERT INTO loadouts (game_id, slot, weapon1, weapon2, gadget) VALUES (?, 1, 'B1', 'B2', 'G1')").run(id);
  ctx.db.prepare("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon, headshot, kind) VALUES (?, 150, 1, 5, 'W3', 1, 'kill'), (?, 160, NULL, 5, NULL, 0, 'environment')").run(id, id);
  const game = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as Record<string, unknown>[])[0];
  assert.deepEqual(game.players, [
    { slot: 1, name: 'SHADYJ4Y', weapon1: 'B1', weapon2: 'B2', gadget: 'G1' },
    { slot: 5, name: 'ORXPAPY', weapon1: null, weapon2: null, gadget: null },
  ]);
  assert.deepEqual(game.kills, [
    { t: 150, killer: 1, victim: 5, weapon: 'W3', weaponName: null, stuff: null, headshot: true, kind: 'kill' },
    { t: 160, killer: null, victim: 5, weapon: null, weaponName: null, stuff: null, headshot: false, kind: 'environment' },
  ]);
});

test('GET /api/capture renvoie la courbe de score de chaque équipe', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  const id = Number(ctx.db.prepare("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 100, 700, 'confirmed')").run(videoId).lastInsertRowid);
  ctx.db.prepare("INSERT INTO capture_state (game_id, t, point, pct, team) VALUES (?, 100, 'score_A', 0, 'A'), (?, 101, 'score_A', 3, 'A'), (?, 100, 'score_B', 0, 'B')").run(id, id, id);
  const res = handleApi(ctx, 'GET', '/api/capture', q(`game=${id}`), undefined);
  assert.deepEqual(res.json, { A: [{ t: 100, v: 0 }, { t: 101, v: 3 }], B: [{ t: 100, v: 0 }] });
  assert.equal(handleApi(ctx, 'GET', '/api/capture', q(), undefined).status, 400);
});

test('une correction échange deux joueurs d’une équipe sur une période, et l’annuler remet tout en place', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  const id = Number(ctx.db.prepare("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 100, 700, 'confirmed')").run(videoId).lastInsertRowid);
  const put = ctx.db.prepare("INSERT INTO samples (game_id, frame, t, slot, team, x, y) VALUES (?, ?, ?, ?, 'A', ?, 0.5)");
  for (let i = 0; i < 6; i++) {
    put.run(id, i, 100 + i, 1, 0.1);
    put.run(id, i, 100 + i, 2, 0.9);
  }
  const x = (slot: number, t: number) =>
    (ctx.db.prepare('SELECT x FROM samples WHERE game_id = ? AND slot = ? AND t = ?').get(id, slot, t) as { x: number }).x;
  const created = handleApi(ctx, 'POST', '/api/corrections', q(), { game_id: id, slot_a: 1, slot_b: 2, t0: 102, t1: 104 });
  assert.equal(created.status, 201);
  assert.deepEqual([x(1, 101), x(1, 103), x(1, 105)], [0.1, 0.9, 0.1]);
  const list = handleApi(ctx, 'GET', '/api/corrections', q(`game=${id}`), undefined).json as { id: number }[];
  assert.equal(list.length, 1);
  assert.equal(handleApi(ctx, 'DELETE', `/api/corrections/${list[0].id}`, q(), undefined).status, 200);
  assert.deepEqual([x(1, 103), x(2, 103)], [0.1, 0.9]);
  assert.equal((handleApi(ctx, 'GET', '/api/corrections', q(`game=${id}`), undefined).json as unknown[]).length, 0);
});

test('une correction refuse deux joueurs d’équipes différentes, deux fois le même, une période inversée', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  const id = Number(ctx.db.prepare("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 100, 700, 'confirmed')").run(videoId).lastInsertRowid);
  const post = (body: object) => handleApi(ctx, 'POST', '/api/corrections', q(), { game_id: id, t0: 100, t1: 200, ...body }).status;
  assert.equal(post({ slot_a: 1, slot_b: 5 }), 400);
  assert.equal(post({ slot_a: 3, slot_b: 3 }), 400);
  assert.equal(post({ slot_a: 1, slot_b: 2, t0: 300, t1: 200 }), 400);
  assert.equal(post({ slot_a: 1, slot_b: 9 }), 400);
  assert.equal(handleApi(ctx, 'POST', '/api/corrections', q(), { game_id: 9999, slot_a: 1, slot_b: 2, t0: 100, t1: 200 }).status, 404);
});

test('les kills portent le nom de l’arme, et pour une grenade celle équipée par le tueur', () => {
  const ctx = testContext();
  ctx.weaponNames = () => ({ W2: 'GRENADE', W3: 'SPECTRE', G1: 'STICKY', G2: 'DX3' });
  const videoId = insertVideo(ctx);
  const id = Number(ctx.db.prepare("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 100, 700, 'confirmed')").run(videoId).lastInsertRowid);
  ctx.db.prepare("INSERT INTO players (game_id, slot, name) VALUES (?, 1, 'SHADYJ4Y'), (?, 2, 'NCTXSPIRIT'), (?, 5, 'ORXPAPY')").run(id, id, id);
  ctx.db.prepare("INSERT INTO loadouts (game_id, slot, weapon1, weapon2, gadget) VALUES (?, 1, 'B1', 'B2', 'G1'), (?, 2, 'B1', 'B2', 'G2')").run(id, id);
  ctx.db.prepare("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon) VALUES (?, 110, 1, 5, 'W2'), (?, 120, 2, 5, 'W2'), (?, 130, 1, 5, 'W3'), (?, 140, 1, 5, 'W9')").run(id, id, id, id);
  const kills = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { kills: { weaponName: string | null; stuff: string | null }[] }[])[0].kills;
  assert.deepEqual(kills.map((k) => [k.weaponName, k.stuff]), [
    ['GRENADE', 'STICKY'], // tué par Shady, dont le gadget est la sticky
    ['GRENADE', 'DX3'],
    ['SPECTRE', 'SPECTRE'],
    [null, null], // icône jamais nommée
  ]);
});

test('les commentaires sont liés à un instant, rattachés à leur game, filtrés par vidéo et modifiables', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx, 900);
  const gameId = Number(ctx.db.prepare("INSERT INTO games (video_id, start_s, end_s, status) VALUES (?, 100, 400, 'confirmed')").run(videoId).lastInsertRowid);
  const post = (body: object) => handleApi(ctx, 'POST', '/api/comments', q(), { video_id: videoId, ...body });
  assert.equal(post({ t: 150.5, text: '  Le joueur 2 est mal suivi  ', tag: 'suivi', slots: [5, 2, 2] }).status, 201);
  assert.equal(post({ t: 600, text: 'Rotation trop lente', tag: 'equipe' }).status, 201); // hors game
  const list = handleApi(ctx, 'GET', '/api/comments', q(`video=${videoId}`), undefined).json as Record<string, unknown>[];
  assert.deepEqual(list.map((c) => [c.t, c.tag, c.text, c.game_id, c.slots, c.resolved]), [
    [150.5, 'suivi', 'Le joueur 2 est mal suivi', gameId, [2, 5], false],
    [600, 'equipe', 'Rotation trop lente', null, [], false],
  ]);
  const id = list[0].id as number;
  assert.equal(handleApi(ctx, 'PATCH', `/api/comments/${id}`, q(), { resolved: true }).status, 200);
  assert.equal(handleApi(ctx, 'PATCH', `/api/comments/${id}`, q(), { text: 'Corrigé', tag: 'note', slots: [1] }).status, 200);
  const after = (handleApi(ctx, 'GET', '/api/comments', q(`video=${videoId}`), undefined).json as Record<string, unknown>[])[0];
  assert.deepEqual([after.text, after.tag, after.slots, after.resolved], ['Corrigé', 'note', [1], true]);
  assert.equal(handleApi(ctx, 'DELETE', `/api/comments/${id}`, q(), undefined).status, 200);
  assert.equal(handleApi(ctx, 'DELETE', `/api/comments/${id}`, q(), undefined).status, 404);
  assert.equal((handleApi(ctx, 'GET', '/api/comments', q(`video=${videoId}`), undefined).json as unknown[]).length, 1);
});

test('un commentaire invalide est refusé : texte vide, catégorie inconnue, instant hors vidéo, joueurs invalides', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx, 900);
  const post = (body: object) => handleApi(ctx, 'POST', '/api/comments', q(), { video_id: videoId, t: 10, text: 'ok', ...body }).status;
  assert.equal(post({ text: '   ' }), 400);
  assert.equal(post({ tag: 'autre' }), 400);
  assert.equal(post({ t: 5000 }), 400);
  assert.equal(post({ t: -1 }), 400);
  assert.equal(post({ slots: [9] }), 400);
  assert.equal(post({ slots: 'x' }), 400);
  assert.equal(handleApi(ctx, 'POST', '/api/comments', q(), { video_id: 999, t: 1, text: 'ok' }).status, 404);
  assert.equal(handleApi(ctx, 'GET', '/api/comments', q(), undefined).status, 400);
});

test('les noms des équipes d\'une game se saisissent et se lisent, et un diminutif retient son nom complet', () => {
  const ctx = testContext();
  const video = insertVideo(ctx);
  const created = handleApi(ctx, 'POST', '/api/games', q(), { video_id: video, start_s: 10, end_s: 400 });
  const id = (created.json as { id: number }).id;
  assert.equal(handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { team_a: '  Snake Venom ', team_b: 'NCT' }).status, 200);
  const game = (handleApi(ctx, 'GET', '/api/games', q(`video=${video}`), undefined).json as { team_a: string; team_b: string }[])[0];
  assert.deepEqual([game.team_a, game.team_b], ['Snake Venom', 'NCT']);
  handleApi(ctx, 'PATCH', `/api/games/${id}`, q(), { team_a: '' });  // vider efface ; l'autre équipe est conservée
  const again = (handleApi(ctx, 'GET', '/api/games', q(`video=${video}`), undefined).json as { team_a: string | null; team_b: string }[])[0];
  assert.deepEqual([again.team_a, again.team_b], [null, 'NCT']);

  assert.equal(handleApi(ctx, 'PUT', '/api/teams', q(), { tag: 'snv', name: 'Snake Venom' }).status, 200);
  assert.deepEqual(handleApi(ctx, 'GET', '/api/teams', q(), undefined).json, { SNV: 'Snake Venom' });
  assert.equal(handleApi(ctx, 'PUT', '/api/teams', q(), { tag: 'x', name: 'Trop court' }).status, 400);
  handleApi(ctx, 'PUT', '/api/teams', q(), { tag: 'SNV', name: '' });
  assert.deepEqual(handleApi(ctx, 'GET', '/api/teams', q(), undefined).json, {});
});


test('GET /api/flags renvoie les positions non confirmées et le joueur observé', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  ctx.db.prepare("INSERT INTO sample_flags (game_id, frame, slot, flag) VALUES (?, 12, 3, 'unconfirmed')").run(id);
  ctx.db.prepare('INSERT INTO observed_segments (game_id, slot, t0, t1) VALUES (?, 8, 114.6, 166.1)').run(id);
  const res = handleApi(ctx, 'GET', '/api/flags', q(`game=${id}`), undefined);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(res.json)), { unconfirmed: [[12, 3]], observed: [{ slot: 8, t0: 114.6, t1: 166.1 }] });
  assert.equal(handleApi(ctx, 'GET', '/api/flags', q(), undefined).status, 400);
});

test('GET /api/reliability renvoie la carte de fiabilité fournie, ou null', () => {
  const ctx = testContext();
  assert.equal(handleApi(ctx, 'GET', '/api/reliability', q('map=Polaris'), undefined).json, null);
  ctx.reliability = (map) => (map === 'Polaris' ? { map, grid: 16, cells: [] } : null);
  assert.deepEqual(handleApi(ctx, 'GET', '/api/reliability', q('map=Polaris'), undefined).json, { map: 'Polaris', grid: 16, cells: [] });
  assert.equal(handleApi(ctx, 'GET', '/api/reliability', q('map=../x'), undefined).status, 400);
});


test('les corrections à la main (position et regard) se créent, se listent et se suppriment', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  const created = handleApi(ctx, 'POST', '/api/marks', q(), { game_id: id, slot: 8, t: 226.4, x: 0.5, y: 0.55, angle: -30 });
  assert.equal(created.status, 201);
  const only = handleApi(ctx, 'POST', '/api/marks', q(), { game_id: id, slot: 3, t: 300, x: 0.2, y: 0.4 });
  assert.equal(only.status, 201);
  const list = JSON.parse(JSON.stringify(handleApi(ctx, 'GET', '/api/marks', q(`game=${id}`), undefined).json)) as { slot: number; angle: number | null }[];
  assert.deepEqual(list.map((m) => [m.slot, m.angle]), [[8, 330], [3, null]]); // l'angle est ramené entre 0 et 360, le regard est facultatif
  assert.equal(handleApi(ctx, 'POST', '/api/marks', q(), { game_id: id, slot: 9, t: 226, x: 0.5, y: 0.5 }).status, 400);
  assert.equal(handleApi(ctx, 'POST', '/api/marks', q(), { game_id: id, slot: 1, t: 226, x: 1.5, y: 0.5 }).status, 400);
  assert.equal(handleApi(ctx, 'POST', '/api/marks', q(), { game_id: id, slot: 1, t: 5, x: 0.5, y: 0.5 }).status, 400);
  assert.equal(handleApi(ctx, 'POST', '/api/marks', q(), { game_id: 999, slot: 1, t: 226, x: 0.5, y: 0.5 }).status, 404);
  const markId = (created.json as { id: number }).id;
  assert.equal(handleApi(ctx, 'DELETE', `/api/marks/${markId}`, q(), undefined).status, 200);
  assert.equal((handleApi(ctx, 'GET', '/api/marks', q(`game=${id}`), undefined).json as unknown[]).length, 1);
});

test('cartographie à la main : enregistrement, relecture et refus des entrées invalides', () => {
  const ctx = testContext();
  assert.equal(handleApi(ctx, 'GET', '/api/map-annotations', q('map=Atlantis'), undefined).json, null);
  const data = { colors: [{ rgb: [10, 20, 30], tol: 8, cls: 'porte_vitre' }], tps: [], spawns: { A: [], B: [] } };
  assert.equal(handleApi(ctx, 'PUT', '/api/map-annotations', q('map=Atlantis'), { data }).status, 200);
  const back = JSON.parse(JSON.stringify(handleApi(ctx, 'GET', '/api/map-annotations', q('map=Atlantis'), undefined).json)) as { data: typeof data };
  assert.equal(back.data.colors[0].cls, 'porte_vitre');
  const again = handleApi(ctx, 'PUT', '/api/map-annotations', q('map=Atlantis'), { data: { colors: [] } });
  assert.equal(again.status, 200);
  assert.equal(handleApi(ctx, 'PUT', '/api/map-annotations', q('map=../etc'), { data }).status, 400);
  assert.equal(handleApi(ctx, 'PUT', '/api/map-annotations', q('map=Atlantis'), { data: [1] }).status, 400);
  assert.equal(handleApi(ctx, 'PUT', '/api/map-annotations', q('map=Atlantis'), {}).status, 400);
});

test('le niveau (étage ou dessous) d\'une correction à la main est enregistré et relu', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  assert.equal(handleApi(ctx, 'POST', '/api/marks', q(), { game_id: id, slot: 2, t: 105, x: 0.32, y: 0.6, angle: 0, level: 'dessous' }).status, 201);
  assert.equal(handleApi(ctx, 'POST', '/api/marks', q(), { game_id: id, slot: 3, t: 106, x: 0.2, y: 0.4, level: 'etage' }).status, 201);
  assert.equal(handleApi(ctx, 'POST', '/api/marks', q(), { game_id: id, slot: 4, t: 107, x: 0.2, y: 0.4 }).status, 201); // niveau non précisé
  assert.equal(handleApi(ctx, 'POST', '/api/marks', q(), { game_id: id, slot: 4, t: 108, x: 0.2, y: 0.4, level: 'cave' }).status, 400);
  const list = JSON.parse(JSON.stringify(handleApi(ctx, 'GET', '/api/marks', q(`game=${id}`), undefined).json)) as { slot: number; level: string | null }[];
  assert.deepEqual(list.map((m) => [m.slot, m.level]), [[2, 'dessous'], [3, 'etage'], [4, null]]);
});

test('un kill se marque et se démarque « libanaise » ; un kill inconnu est refusé', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  ctx.db.prepare("INSERT INTO kills (game_id, t, killer_slot, victim_slot, weapon, headshot, kind) VALUES (?, 230.4, 1, 8, 'B12', 0, 'kill')").run(id);
  const get = () => JSON.parse(JSON.stringify(handleApi(ctx, 'GET', '/api/kill-flags', q(`game=${id}`), undefined).json)) as [number, number][];
  assert.deepEqual(get(), []);
  assert.equal(handleApi(ctx, 'PUT', '/api/kill-flags', q(), { game_id: id, t: 230.41, victim: 8, libanaise: true }).status, 200); // instant à 0,05 s près
  assert.deepEqual(get(), [[230.4, 8]]);
  assert.equal(handleApi(ctx, 'PUT', '/api/kill-flags', q(), { game_id: id, t: 230.4, victim: 8, libanaise: true }).status, 200); // deux fois : pas de doublon
  assert.equal(get().length, 1);
  assert.equal(handleApi(ctx, 'PUT', '/api/kill-flags', q(), { game_id: id, t: 400, victim: 8, libanaise: true }).status, 404);
  assert.equal(handleApi(ctx, 'PUT', '/api/kill-flags', q(), { game_id: id, t: 230.4, victim: 8, libanaise: false }).status, 200);
  assert.deepEqual(get(), []);
});

test('les points de capture vus sur la minimap sont lus par game et triés par temps', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 100, end_s: 700 });
  const id = (handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json as { id: number }[])[0].id;
  ctx.db.prepare("INSERT INTO capture_boxes (game_id, t0, t1, x, y, w, h, point) VALUES (?, 125, 210, 0.25, 0.37, 0.12, 0.09, 'B')").run(id);
  ctx.db.prepare("INSERT INTO capture_boxes (game_id, t0, t1, x, y, w, h, point) VALUES (?, 35, 120, 0.5, 0.82, 0.12, 0.1, 'C')").run(id);
  const got = JSON.parse(JSON.stringify(handleApi(ctx, 'GET', '/api/capture-boxes', q(`game=${id}`), undefined).json)) as { t0: number; point: string }[];
  assert.deepEqual(got.map((b) => [b.t0, b.point]), [[35, 'C'], [125, 'B']]);
  assert.deepEqual(handleApi(ctx, 'GET', '/api/capture-boxes', q('game=999'), undefined).json, []);
  assert.equal(handleApi(ctx, 'GET', '/api/capture-boxes', q(), undefined).status, 400);
});

test('des noms d\'équipes valables pour un morceau de vidéo vont aux games du morceau et aux games posées ensuite', () => {
  const ctx = testContext();
  const videoId = insertVideo(ctx);
  for (const [s, e] of [[100, 200], [300, 400], [500, 600]]) handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: s, end_s: e });
  const names = () => (JSON.parse(JSON.stringify(handleApi(ctx, 'GET', '/api/games', q(`video=${videoId}`), undefined).json)) as { team_a: string | null; team_b: string | null }[]).map((g) => `${g.team_a}/${g.team_b}`);
  assert.deepEqual(names(), ['null/null', 'null/null', 'null/null']);
  const put = handleApi(ctx, 'PUT', '/api/team-ranges', q(), { video_id: videoId, start_s: 0, end_s: 450, team_a: ' NCT ', team_b: 'SNV' });
  assert.equal(put.status, 201);
  assert.equal((put.json as { games: number }).games, 2);
  assert.deepEqual(names(), ['NCT/SNV', 'NCT/SNV', 'null/null']); // la troisième game est hors du morceau
  // un second morceau qui chevauche le premier le remplace
  handleApi(ctx, 'PUT', '/api/team-ranges', q(), { video_id: videoId, start_s: 250, end_s: 700, team_a: 'OMG', team_b: null });
  assert.deepEqual(names(), ['NCT/SNV', 'OMG/SNV', 'OMG/null']); // un côté sans nom ne touche pas l'autre côté
  const ranges = JSON.parse(JSON.stringify(handleApi(ctx, 'GET', '/api/team-ranges', q(`video=${videoId}`), undefined).json)) as { id: number; start_s: number }[];
  assert.equal(ranges.length, 1); // le premier morceau [0, 450] chevauche [250, 700] : il est remplacé en entier
  // une game posée plus tard dans un morceau reçoit ses noms
  handleApi(ctx, 'POST', '/api/games', q(), { video_id: videoId, start_s: 650, end_s: 690 });
  assert.equal(names().at(-1), 'OMG/null');
  // oublier un morceau garde les noms déjà donnés
  assert.equal(handleApi(ctx, 'DELETE', `/api/team-ranges/${ranges[0].id}`, q(), undefined).status, 200);
  assert.deepEqual(names().slice(0, 3), ['NCT/SNV', 'OMG/SNV', 'OMG/null']);
  assert.equal(handleApi(ctx, 'PUT', '/api/team-ranges', q(), { video_id: videoId, start_s: 10, end_s: 5, team_a: 'X' }).status, 400);
  assert.equal(handleApi(ctx, 'PUT', '/api/team-ranges', q(), { video_id: videoId, start_s: 0, end_s: 5 }).status, 400);
});
