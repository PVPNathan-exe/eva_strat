// Parties sensibles : en quoi ta version diffère de celle de GitHub, laquelle est la meilleure (mesure quand elle existe), et ce que tu en fais.
// Rien n'est jamais remplacé ici sans que tu aies choisi (ou passé --yes, qui prend la recommandation : GitHub seulement si GitHub est mesuré meilleur, ou si tu n'as pas touché au fichier
// et qu'aucune mesure n'existe ; sinon ta version est gardée).

import { join } from 'node:path';
import { applyItems, backupRoot } from './apply.mjs';
import { hashManaged, readState, writeState } from './manifest.mjs';
import { groupOf, isSensitive, PARTS, partOf } from './parts.mjs';
import { runAnalysisJson } from './python.mjs';

/** Fichiers sensibles qui diffèrent de GitHub, rangés par groupe : Map groupe vers { part, items: [{path, part, action, untouched}] }. */
export function diffGroups(root, upstreamDir, state) {
  const upstream = hashManaged(upstreamDir);
  const base = new Map(Object.entries(state.files ?? {}));
  const local = hashManaged(root, new Set([...upstream.keys(), ...base.keys()]));
  const groups = new Map();
  for (const [path, U] of upstream) {
    const part = partOf(path);
    if (!isSensitive(part)) continue;
    const L = local.get(path);
    if (L === U) continue;
    const group = groupOf(path);
    if (!groups.has(group)) groups.set(group, { part, items: [] });
    groups.get(group).items.push({ path, part, action: L === undefined ? 'add' : 'overwrite', untouched: L !== undefined && base.get(path) === L, localHash: L, upstreamHash: U });
  }
  return groups;
}

/** Mesure d'un groupe : résultat de analysis/compare_parts.py, ou { verdict: 'inconnu' } quand aucune mesure n'existe pour cette partie. */
export function compareGroup(root, group, part, upstreamDir) {
  const other = join(upstreamDir, 'analysis');
  if (PARTS[part]?.metric === 'masks' && group !== 'masques:json') {
    return runAnalysisJson(root, 'compare_parts.py', ['masks', '--other', other, '--map', group.split(':')[1]]);
  }
  if (PARTS[part]?.metric === 'params') return runAnalysisJson(root, 'compare_parts.py', ['params', '--other', other]);
  return { part, verdict: 'inconnu', reason: 'pas de mesure pour cette partie : à toi de décider' };
}

/** Choix recommandé : 'github' ou 'local'. */
export function recommend(result, items) {
  if (result.verdict === 'github') return 'github';
  if (result.verdict === 'local' || result.verdict === 'equivalent') return 'local';
  return items.every((i) => i.untouched || i.action === 'add') ? 'github' : 'local'; // inconnu : GitHub seulement si tu n'as rien modifié
}

const pct = (x) => `${(x * 100).toFixed(2).replace('.', ',')} %`;

/** Lignes lisibles d'un résultat de mesure. */
export function describe(result) {
  const lines = [];
  if (result.verdict === 'inconnu') return [`  mesure impossible : ${result.reason}`];
  if (result.part === 'masques') {
    lines.push(`  positions sûres de ta base sur cette carte : ${result.points}`);
    lines.push(`  masque refuse (plus bas = mieux) : toi ${pct(result.local.rejected)}, GitHub ${pct(result.github.rejected)} ; surface praticable : toi ${pct(result.local.area)}, GitHub ${pct(result.github.area)}`);
  } else if (result.part === 'suivi') {
    lines.push(`  note du suivi (plus haut = mieux) sur ${result.datasets.join(', ')} : toi ${result.local.objective}, GitHub ${result.github.objective}`);
    lines.push(`  identité des joueurs : toi ${pct(result.local.identity_accuracy)}, GitHub ${pct(result.github.identity_accuracy)}`);
  }
  if (result.warning) lines.push(`  attention : ${result.warning}`);
  const label = { local: 'ta version est meilleure', github: 'la version de GitHub est meilleure', equivalent: 'équivalentes' }[result.verdict];
  lines.push(`  verdict : ${label}`);
  return lines;
}

/**
 * Passe les groupes sensibles en revue. `ask(question, choices, fallback)` renvoie la clé choisie : 'g' (prendre GitHub), 'l' (garder la mienne), 'c' (garder et préparer une contribution).
 * Renvoie { github: [groupes], local: [groupes], contribute: [groupes] }.
 */
export async function decide({ root, upstream, sha, groups, ask, say, only = null }) {
  const out = { github: [], local: [], contribute: [] };
  const state = readState(root);
  state.kept ??= {};
  const upstreamHashes = hashManaged(upstream);
  for (const [group, { part, items }] of groups) {
    if (only && !only.includes(group) && !only.includes(part)) continue;
    say(`\n${PARTS[part].label} : ${group} (${items.length} fichier(s) différent(s) de GitHub, ${items.every((i) => i.untouched || i.action === 'add') ? 'tu n\'y as pas touché' : 'tu les as modifiés'})`);
    let result;
    try {
      result = compareGroup(root, group, part, upstream);
    } catch (err) {
      result = { part, verdict: 'inconnu', reason: err.message.split('\n')[0] };
    }
    describe(result).forEach(say);
    const advice = recommend(result, items);
    const key = await ask(
      `  [g] prendre GitHub  [l] garder la mienne  ${result.verdict === 'local' ? '[c] garder la mienne et la proposer à GitHub  ' : ''}(recommandé : ${advice === 'github' ? 'g' : result.verdict === 'local' ? 'c' : 'l'})`,
      result.verdict === 'local' ? ['g', 'l', 'c'] : ['g', 'l'],
      advice === 'github' ? 'g' : result.verdict === 'local' ? 'c' : 'l',
    );
    if (key === 'g') {
      applyItems({ root, upstreamDir: upstream, items, state, upstreamHashes, backupDir: backupRoot(root, 'sensible') });
      out.github.push(group);
      say('  fait : ta version est sauvegardée dans .eva/backup, celle de GitHub est en place.');
    } else {
      state.kept[group] = sha;
      out[key === 'c' ? 'contribute' : 'local'].push(group);
      say(key === 'c' ? '  gardée : lance « npm run contribuer » pour la proposer.' : '  gardée telle quelle (on ne te redemande pas avant la prochaine version de GitHub).');
    }
  }
  state.pending = (state.pending ?? []).filter((p) => !out.github.includes(p.group) && !out.local.includes(p.group) && !out.contribute.includes(p.group));
  writeState(root, state);
  return out;
}
