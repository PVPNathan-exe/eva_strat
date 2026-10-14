// Commandes de mise à jour, de comparaison, de contribution et de remise à zéro (voir le README, « Mises à jour et remises à zéro »).
//   npm run maj                         met à jour le CODE depuis GitHub (main), signale les parties sensibles différentes sans les toucher
//   npm run maj -- sensibles            compare tes parties sensibles à GitHub et te laisse choisir, partie par partie
//   npm run maj -- --check              montre ce qui serait fait, sans rien écrire
//   npm run comparer [-- masques|suivi|armes|modeles] [--map Carte]   qui est le meilleur, toi ou GitHub (mesure quand elle existe)
//   npm run contribuer                  prépare un dossier à proposer pour les parties où ta version est mesurée meilleure
//   npm run reset -- <partie> [--map Carte] [--game N]   remet UNE partie à zéro (masques, suivi, armes, modeles, calibrages, cartographie, corrections, cache)
// Options : --yes (prend la recommandation affichée, sans question), --dry-run (montre sans écrire).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeAsk, makeConfirm } from './prompt.mjs';
import { betterGroups, howToPropose, writeContribution } from './contribute.mjs';
import { readState } from './manifest.mjs';
import { printUpdate } from './report.mjs';
import { DB_PARTS, FILE_PARTS, runReset } from './reset.mjs';
import { compareGroup, decide, describe, diffGroups } from './sensitive.mjs';
import { getUpstream, repoInfo } from './source.mjs';
import { runUpdate } from './update.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const say = (s = '') => console.log(s);

export function parseArgs(argv) {
  const flags = { yes: false, dryRun: false, check: false, map: undefined, game: undefined };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') flags.yes = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--check') flags.check = true;
    else if (a === '--map') flags.map = argv[++i];
    else if (a === '--game') flags.game = Number(argv[++i]);
    else positional.push(a);
  }
  return { flags, positional };
}

const HELP = `Commandes :
  npm run maj [-- sensibles | --check]      mise à jour depuis GitHub
  npm run comparer [-- masques|suivi|armes|modeles] [--map Carte]
  npm run contribuer
  npm run reset -- <partie> [--map Carte] [--game N] [--dry-run] [--yes]
Parties à remettre à zéro : ${[...FILE_PARTS, ...DB_PARTS].join(', ')}`;

async function withUpstream(fn) {
  const up = await getUpstream(repoInfo(root));
  try {
    return await fn(up);
  } finally {
    up.cleanup();
  }
}

async function main(argv) {
  const [cmd = 'maj', ...rest] = argv;
  const { flags, positional } = parseArgs(rest);
  const ask = makeAsk({ yes: flags.yes });
  const confirm = makeConfirm({ yes: flags.yes });
  if (cmd === 'aide' || cmd === '--help' || cmd === 'help') return say(HELP);

  if (cmd === 'maj') {
    if (positional[0] === 'sensibles') {
      return withUpstream(async (up) => {
        const state = readState(root);
        const groups = diffGroups(root, up.dir, state);
        if (!groups.size) return say('Tes parties sensibles sont identiques à celles de GitHub : rien à décider.');
        const out = await decide({ root, upstream: up.dir, sha: up.sha, groups, ask, say });
        say(`\nRésumé : GitHub pris pour ${out.github.length}, gardé le mien pour ${out.local.length + out.contribute.length}.`);
        if (out.contribute.length) say('« npm run contribuer » prépare le dossier à proposer.');
      });
    }
    return printUpdate(await runUpdate({ root, dryRun: flags.check || flags.dryRun, force: true }), say);
  }

  if (cmd === 'comparer') {
    return withUpstream(async (up) => {
      const groups = diffGroups(root, up.dir, readState(root));
      const wanted = positional[0];
      let shown = 0;
      for (const [group, { part, items }] of groups) {
        if ((wanted && part !== wanted) || (flags.map && group !== `masques:${flags.map}`)) continue;
        shown += 1;
        say(`\n${group} : ${items.length} fichier(s) différent(s) de GitHub`);
        describe(compareGroup(root, group, part, up.dir)).forEach(say);
      }
      if (!shown) say('Rien à comparer : ta version est identique à celle de GitHub pour ce choix.');
    });
  }

  if (cmd === 'contribuer') {
    return withUpstream(async (up) => {
      const found = betterGroups(root, up.dir, { say });
      if (!found.length) return say("Aucune partie où ta version est mesurée meilleure que celle de GitHub : rien à proposer (« npm run comparer » montre les mesures).");
      found.forEach((f) => (say(`\n${f.group}`), describe(f.result).forEach(say)));
      const { dir } = writeContribution({ root, found, sha: up.sha });
      howToPropose(root, dir).forEach((l) => say(l));
    });
  }

  if (cmd === 'reset') {
    const [part] = positional;
    if (!part) return say(HELP);
    return runReset({ root, part, map: flags.map, game: flags.game, dryRun: flags.dryRun, confirm, say });
  }

  say(`Commande inconnue : ${cmd}\n${HELP}`);
  process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`Erreur : ${err.message}`);
    process.exit(1);
  });
}
