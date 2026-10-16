// Veille des patch notes du jeu (https://blog.eva.gg/en/tag/patch-notes), appelée par `npm start` (scripts/setup.mjs --run).
//
// Ce que ça fait : une fois toutes les 6 heures au plus, lit la liste des patchs (page publique, sans compte) et, pour chaque patch NOUVEAU,
// enregistre son texte dans data/patch_notes/<slug>.txt et les lignes utiles dans data/patch_notes/index.json (reviewed: false).
// Ce que ça ne fait JAMAIS : modifier une valeur de jeu. Un texte libre n'est pas fiable : l'utilisateur relit les extraits et met à jour analysis/patch_reference.json.
// Première exécution : les patchs déjà publiés sont notés comme connus (sans téléchargement), seuls les suivants sont signalés.
// Hors ligne ou page changée : silence, rien n'est écrit, la vérification sera refaite au prochain démarrage. Le démarrage n'attend jamais plus de 5 s.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractExcerpts, htmlToText, LIST_URL, parsePatchList } from './parse.mjs';

export const CHECK_EVERY_MS = 6 * 3600 * 1000;
export const BUDGET_MS = 5000;

const stateFile = (root) => join(root, '.eva', 'patches.json');
/** Dossier des textes de patch : à côté de la base (variable EVA_DATA_DIR comme le serveur), jamais dans Git. */
export const notesDir = (root) => join(process.env.EVA_DATA_DIR ?? join(root, 'data'), 'patch_notes');

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

/** Écriture atomique (fichier temporaire puis renommage) : un arrêt en cours d'écriture ne laisse pas un JSON coupé. */
function writeJson(file, data) {
  mkdirSync(join(file, '..'), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, file);
}

/** Texte d'une page, ou une erreur (réseau, code HTTP) ; la même minuterie coupe tous les appels de la veille. */
async function getText(fetchFn, url, signal) {
  const res = await fetchFn(url, { signal, headers: { 'User-Agent': 'eva-strat-patches' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/** Télécharge un patch nouveau, écrit son texte et renvoie sa ligne d'index. */
async function fetchPatch(fetchFn, dir, patch, signal, nowIso) {
  const text = htmlToText(await getText(fetchFn, patch.url, signal));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${patch.slug}.txt`), text);
  return { slug: patch.slug, title: patch.title, date: patch.date, url: patch.url, excerpts: extractExcerpts(text), reviewed: false, detectedAt: nowIso };
}

/**
 * Une vérification. Ne lève jamais d'exception. Renvoie { status, added } avec status :
 * 'recent' (moins de 6 h), 'premiere' (liste enregistrée, rien de signalé), 'a-jour', 'nouveaux' (added = lignes d'index), 'hors-ligne' (silence).
 */
export async function checkPatches({ root, fetchFn = fetch, now = () => new Date(), budgetMs = BUDGET_MS, force = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const state = readJson(stateFile(root), null);
    const nowIso = now().toISOString();
    if (!force && state?.checkedAt && now().getTime() - Date.parse(state.checkedAt) < CHECK_EVERY_MS) return { status: 'recent', added: [] };

    const patches = parsePatchList(await getText(fetchFn, LIST_URL, controller.signal));
    if (patches.length === 0) return { status: 'hors-ligne', added: [] }; // page méconnaissable : on ne marque rien comme connu

    if (!state) {
      writeJson(stateFile(root), { seen: patches.map((p) => p.slug), checkedAt: nowIso });
      return { status: 'premiere', added: [] };
    }
    const seen = new Set(state.seen ?? []);
    const dir = notesDir(root);
    const index = readJson(join(dir, 'index.json'), { patches: [] });
    const added = [];
    // du plus ancien au plus récent ; un téléchargement raté n'est pas noté comme vu (il sera repris au prochain démarrage)
    for (const patch of patches.filter((p) => !seen.has(p.slug)).reverse()) {
      try {
        added.push(await fetchPatch(fetchFn, dir, patch, controller.signal, nowIso));
        seen.add(patch.slug);
      } catch {
        // silence
      }
    }
    if (added.length > 0) {
      const known = new Set(added.map((a) => a.slug));
      writeJson(join(dir, 'index.json'), { patches: [...added.reverse(), ...index.patches.filter((p) => !known.has(p.slug))] });
    }
    writeJson(stateFile(root), { seen: [...seen], checkedAt: nowIso });
    return { status: added.length > 0 ? 'nouveaux' : 'a-jour', added };
  } catch {
    return { status: 'hors-ligne', added: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Appelée au démarrage : vérifie puis affiche un avis dans le terminal s'il y a un patch nouveau. Désactivée par EVA_NO_UPDATE=1. */
export async function watchPatches(root, log = console.log) {
  if (process.env.EVA_NO_UPDATE === '1') return { status: 'desactive', added: [] };
  const result = await checkPatches({ root });
  for (const p of result.added) log(`nouveau patch ${p.title}${p.date ? ` (${p.date})` : ''} : relire les extraits (data/patch_notes/index.json) et mettre à jour analysis/patch_reference.json`);
  return result;
}
