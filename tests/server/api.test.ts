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
