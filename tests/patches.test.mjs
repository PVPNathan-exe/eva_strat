import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractExcerpts, htmlToText, isoDate, parsePatchList } from '../scripts/patches/parse.mjs';
import { checkPatches, notesDir } from '../scripts/patches/watch.mjs';

// Les essais n'écrivent jamais dans le vrai dossier des données.
delete process.env.EVA_DATA_DIR;

// Extrait réaliste de la page d'étiquette du blog (deux patchs, un lien d'étiquette qui n'est pas un patch).
const card = (slug, title, date) => `
  <div class="list-item xl:tw-col-span-4">
    <article class="post post--overlay">
      <div class="post__thumb"><a href="https://blog.eva.gg/en/${slug}"><div class="box-background-image"></div></a></div>
      <div class="post__text"><h3 class="post__title f-24"><a href="https://blog.eva.gg/en/${slug}">${title}</a></h3>
        <time class="time published" datetime="${date}" title="${date}">${date}</time></div>
      <a href="https://blog.eva.gg/en/${slug}" class="link-overlay"></a>
      <a href="https://blog.eva.gg/en/tag/patch-notes" class="post__cat">Patch notes</a>
    </article>
  </div>`;
const listPage = (...cards) => `<html><body><a href="https://blog.eva.gg/en/tag/patch-notes">Patch notes</a>${cards.join('\n')}</body></html>`;
const CARD_A = card('saison-8-patchnote-1.8.2.33', 'Saison 8 : patch note 1.8.2.33', '10/06/2026');
const CARD_B = card('patchnote.0.5.2-1.5.2', 'Patch note 0.5.2 &amp; 1.5.2', '01/22/2025');
const CARD_NEW = card('saison-8-patchnote-1.8.3', 'Saison 8 : patch note 1.8.3', '10/20/2026');

const PATCH_HTML = `<html><head><style>.x{color:red}</style><script>var cooldown = 1;</script></head><body>
  <header><nav>Menu damage</nav></header>
  <h1>Patch note 0.5.2</h1><p>Welcome to the patch. ${'Texte de remplissage sans mot utile. '.repeat(8)}</p>
  <table><tr><th>STICKY</th><th>Damages</th><th>OS range (m)</th><th>Damage range (m)</th><th>Delay Before Explosion (sec)</th><th>Cooldown Time (sec)</th></tr>
  <tr><td>STICKY</td><td>95 (100)</td><td>3 (2)</td><td>5 (3)</td><td>2,5 (2,7)</td><td>20 (35)</td></tr></table>
  <p>The map Polaris was polished &amp; fixed.</p><footer>cooldown footer</footer></body></html>`;

test('la liste du blog est lue : slug, titre décodé, date ISO, lien ; les liens d\'étiquette sont ignorés', () => {
  const list = parsePatchList(listPage(CARD_A, CARD_B));
  assert.equal(list.length, 2);
  assert.deepEqual(list[0], { slug: 'saison-8-patchnote-1.8.2.33', title: 'Saison 8 : patch note 1.8.2.33', date: '2026-10-06', url: 'https://blog.eva.gg/en/saison-8-patchnote-1.8.2.33' });
  assert.equal(list[1].slug, 'patchnote.0.5.2-1.5.2');
  assert.equal(list[1].title, 'Patch note 0.5.2 & 1.5.2');
  assert.equal(list[1].date, '2025-01-22');
  assert.deepEqual(parsePatchList('<html>rien</html>'), []);
  assert.equal(isoDate('13-45'), null);
});

test('le texte retire balises, scripts, styles, en-tête et pied de page, et aplatit les tableaux', () => {
  const text = htmlToText(PATCH_HTML);
  assert.ok(!text.includes('<'));
  assert.ok(!text.includes('var cooldown'));
  assert.ok(!text.includes('color:red'));
  assert.ok(!text.includes('Menu damage'));
  assert.ok(!text.includes('cooldown footer'));
  assert.ok(text.includes('STICKY Damages OS range (m) Damage range (m) Delay Before Explosion (sec) Cooldown Time (sec)'));
  assert.ok(text.includes('STICKY 95 (100) 3 (2) 5 (3) 2,5 (2,7) 20 (35)'));
  assert.ok(text.includes('Polaris was polished & fixed'));
  // une page dont tout le contenu est rangé dans un <header> garde son texte
  assert.ok(htmlToText('<header><p>Sticky cooldown 20 s</p></header>').includes('Sticky cooldown 20 s'));
});

test('les phrases utiles sont retrouvées (en-tête et rangée du tableau STICKY), pas les autres', () => {
  const lines = extractExcerpts(htmlToText(PATCH_HTML));
  assert.ok(lines.includes('STICKY Damages OS range (m) Damage range (m) Delay Before Explosion (sec) Cooldown Time (sec)'));
  assert.ok(lines.includes('STICKY 95 (100) 3 (2) 5 (3) 2,5 (2,7) 20 (35)'));
  assert.ok(!lines.some((l) => l.startsWith('Welcome')));
  assert.ok(!lines.some((l) => l.includes('Polaris')));
  const rowOnly = extractExcerpts('M4 95 (100) 3 (2) 5 (3)\nAK 12 (13)\nMed pack cooldown 45 s reduced to 20 s\nLe shield se déploie en 0,5 s\nrien ici');
  assert.deepEqual(rowOnly, ['M4 95 (100) 3 (2) 5 (3)', 'Med pack cooldown 45 s reduced to 20 s', 'Le shield se déploie en 0,5 s']);
  assert.deepEqual(extractExcerpts(''), []);
});

// ------------------------------------------------------------------ veille (fetch injecté, aucun réseau)

const root = () => mkdtempSync(join(tmpdir(), 'eva-patches-test-'));
/** Faux fetch : table url -> HTML ; une valeur Error simule une panne. */
const fakeFetch = (pages, calls = []) => async (url) => {
  calls.push(url);
  const page = pages[url];
  if (page === undefined) return { ok: false, status: 404, text: async () => '' };
  if (page instanceof Error) throw page;
  return { ok: true, status: 200, text: async () => page };
};
const LIST = 'https://blog.eva.gg/en/tag/patch-notes';
const at = (iso) => () => new Date(iso);

test('première exécution : les patchs existants sont connus, rien n\'est téléchargé ni signalé', async () => {
  const dir = root();
  const calls = [];
  const res = await checkPatches({ root: dir, fetchFn: fakeFetch({ [LIST]: listPage(CARD_A, CARD_B) }, calls), now: at('2026-10-16T08:00:00Z') });
  assert.equal(res.status, 'premiere');
  assert.deepEqual(res.added, []);
  assert.deepEqual(calls, [LIST]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.eva', 'patches.json'), 'utf-8')).seen, ['saison-8-patchnote-1.8.2.33', 'patchnote.0.5.2-1.5.2']);
  assert.ok(!existsSync(notesDir(dir)));
});

test('moins de 6 heures après : aucune requête ; deuxième exécution avec un patch de plus : un nouveau, texte et extraits écrits', async () => {
  const dir = root();
  await checkPatches({ root: dir, fetchFn: fakeFetch({ [LIST]: listPage(CARD_A, CARD_B) }), now: at('2026-10-16T08:00:00Z') });

  const calls = [];
  const pages = { [LIST]: listPage(CARD_NEW, CARD_A, CARD_B), 'https://blog.eva.gg/en/saison-8-patchnote-1.8.3': PATCH_HTML };
  const early = await checkPatches({ root: dir, fetchFn: fakeFetch(pages, calls), now: at('2026-10-16T13:00:00Z') });
  assert.equal(early.status, 'recent');
  assert.equal(calls.length, 0);

  const res = await checkPatches({ root: dir, fetchFn: fakeFetch(pages, calls), now: at('2026-10-16T15:00:00Z') });
  assert.equal(res.status, 'nouveaux');
  assert.equal(res.added.length, 1);
  assert.equal(res.added[0].slug, 'saison-8-patchnote-1.8.3');
  const index = JSON.parse(readFileSync(join(notesDir(dir), 'index.json'), 'utf-8'));
  assert.equal(index.patches.length, 1);
  assert.equal(index.patches[0].reviewed, false);
  assert.equal(index.patches[0].date, '2026-10-20');
  assert.ok(index.patches[0].excerpts.some((l) => l.startsWith('STICKY 95 (100)')));
  assert.ok(readFileSync(join(notesDir(dir), 'saison-8-patchnote-1.8.3.txt'), 'utf-8').includes('Polaris'));

  const again = await checkPatches({ root: dir, fetchFn: fakeFetch(pages), now: at('2026-10-17T08:00:00Z') });
  assert.equal(again.status, 'a-jour');
  assert.deepEqual(again.added, []);
});

test('hors ligne, erreur HTTP ou page méconnaissable : silence, rien n\'est écrit, jamais d\'exception', async () => {
  for (const pages of [{ [LIST]: new Error('fetch failed') }, {}, { [LIST]: '<html>maintenance</html>' }]) {
    const dir = root();
    const res = await checkPatches({ root: dir, fetchFn: fakeFetch(pages), now: at('2026-10-16T08:00:00Z') });
    assert.equal(res.status, 'hors-ligne');
    assert.ok(!existsSync(join(dir, '.eva', 'patches.json')));
  }
});

test('un patch dont le téléchargement échoue n\'est pas noté comme vu : il est repris plus tard', async () => {
  const dir = root();
  await checkPatches({ root: dir, fetchFn: fakeFetch({ [LIST]: listPage(CARD_B) }), now: at('2026-10-16T08:00:00Z') });
  const list = listPage(CARD_NEW, CARD_B);
  const broken = await checkPatches({ root: dir, fetchFn: fakeFetch({ [LIST]: list }), now: at('2026-10-16T15:00:00Z') });
  assert.equal(broken.status, 'a-jour');
  const retry = await checkPatches({ root: dir, fetchFn: fakeFetch({ [LIST]: list, 'https://blog.eva.gg/en/saison-8-patchnote-1.8.3': PATCH_HTML }), now: at('2026-10-16T22:00:00Z') });
  assert.equal(retry.status, 'nouveaux');
});

test('la minuterie coupe une requête qui ne répond pas', async () => {
  const hang = (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort'))));
  const started = Date.now();
  const res = await checkPatches({ root: root(), fetchFn: hang, budgetMs: 50 });
  assert.equal(res.status, 'hors-ligne');
  assert.ok(Date.now() - started < 2000);
});
