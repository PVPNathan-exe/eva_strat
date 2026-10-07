import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobManager, type JobEvent } from '../../server/jobs.ts';

const node = process.execPath;

function collect(manager: JobManager, command: string, args: string[]): Promise<JobEvent[]> {
  const job = manager.start(command, args);
  return new Promise((resolve) => {
    const seen: JobEvent[] = [];
    job.subscribe((e) => {
      seen.push(e);
      if (e.event === 'done' || e.event === 'error') resolve(seen);
    });
  });
}

test('relaie les événements JSON du script', async () => {
  const script = `
    console.log(JSON.stringify({ event: 'progress', stage: 'detect', pct: 10 }));
    console.log(JSON.stringify({ event: 'done', video_id: 1, games: 2 }));
  `;
  const events = await collect(new JobManager(), node, ['-e', script]);
  assert.deepEqual(
    events.map((e) => e.event),
    ['progress', 'done'],
  );
  assert.equal(events[1].games, 2);
});

test('un abonné tardif reçoit l’historique', async () => {
  const manager = new JobManager();
  const job = manager.start(node, ['-e', "console.log(JSON.stringify({event:'done'}))"]);
  await new Promise((r) => setTimeout(r, 500));
  const seen: string[] = [];
  job.subscribe((e) => seen.push(e.event));
  assert.deepEqual(seen, ['done']);
});

test('un code de sortie non nul sans événement d’erreur produit une erreur', async () => {
  const events = await collect(new JobManager(), node, ['-e', "console.error('boum'); process.exit(3)"]);
  assert.equal(events.at(-1)?.event, 'error');
  assert.match(String(events.at(-1)?.message), /boum/);
});

test('une commande introuvable produit une erreur', async () => {
  const events = await collect(new JobManager(), 'commande-qui-n-existe-pas-eva', []);
  assert.equal(events.at(-1)?.event, 'error');
});

test('refuse un second job tant que le premier tourne', async () => {
  const manager = new JobManager();
  manager.start(node, ['-e', 'setTimeout(() => {}, 700)']);
  assert.throws(() => manager.start(node, ['-e', '0']), /déjà en cours/);
  await new Promise((r) => setTimeout(r, 1000));
  assert.doesNotThrow(() => manager.start(node, ['-e', '0']));
});
