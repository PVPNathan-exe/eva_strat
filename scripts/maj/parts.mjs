// Parties du programme pour les mises à jour, les comparaisons et les remises à zéro.
// Le code (interface, serveur, programmes Python, docs) se met à jour sans rien demander. Les parties SENSIBLES influencent les calculs et peuvent avoir été réglées par l'utilisateur :
// elles ne sont jamais modifiées sans son accord (voir sensitive.mjs). `data/` (base, cache) et `.eva/` (état des mises à jour) ne sont jamais touchés.

/** Dossiers et fichiers hors de toute mise à jour (chemins relatifs à la racine, avec « / »). */
export const NEVER_TOUCH = ['data/', '.eva/', '.git/', 'node_modules/', 'dist/', 'dist-ssr/'];

/** Fichiers JSON de cartes : un dictionnaire par fichier, une entrée par carte (clés « _doc » exceptées). */
const MAP_JSON = /^analysis\/map_[a-z_]+\.json$/;

export const PARTS = {
  masques: {
    label: 'Masques et réglages des cartes',
    metric: 'masks', // mesurable : part des positions sûres que le masque rejette (analysis/compare_parts.py)
    perMap: true,
    match: (p) => p.startsWith('analysis/map_masks/') || p.startsWith('analysis/map_reliability/') || MAP_JSON.test(p),
  },
  suivi: {
    label: 'Réglages du suivi des joueurs',
    metric: 'params', // mesurable : note de tune.py sur les jeux de données
    perMap: false,
    match: (p) => p === 'analysis/tracking_params.json' || p === 'analysis/tracking_params.history.jsonl' || p.startsWith('analysis/datasets/'),
  },
  armes: {
    label: "Noms et images des icônes d'armes",
    metric: null, // pas de mesure : la base cite les icônes par numéro, à décider à la main
    perMap: false,
    match: (p) => p.startsWith('analysis/weapon_icons/'),
  },
  modeles: {
    label: 'Modèles de chiffres, noms de cartes et zones par défaut',
    metric: null,
    perMap: false,
    match: (p) => /^analysis\/[^/]+\.npz$/.test(p) || p === 'analysis/default_zones.json' || p.startsWith('analysis/map_names/'),
  },
};

/** Partie d'un fichier : 'masques', 'suivi', 'armes', 'modeles' (sensibles), 'code', ou null (jamais touché). */
export function partOf(path) {
  if (NEVER_TOUCH.some((n) => path === n.replace(/\/$/, '') || path.startsWith(n))) return null;
  if (path.includes('/__pycache__/') || path.endsWith('.pyc') || path.startsWith('analysis/weapon_icons/candidates/')) return null; // fichiers recréés à la demande
  for (const [id, part] of Object.entries(PARTS)) if (part.match(path)) return id;
  return 'code';
}

export const isSensitive = (part) => part !== 'code' && part !== null;

const MASK_SUFFIX = /_(classes|controle|lignes|mediane|stations|plan_ajouts|plan_retraits)$/;

/** Carte d'un fichier du dossier analysis/map_masks (Polaris.png, Reef Point_lignes.png...), ou null. */
export function mapOfPath(path) {
  const m = /^analysis\/map_masks\/([^/]+)\.(?:png|jpg)$/.exec(path);
  return m ? m[1].replace(MASK_SUFFIX, '') : null;
}

/** Clé de décision d'un fichier sensible : « masques:Polaris » pour un fichier de masque, « masques:json » pour les autres fichiers de cartes, sinon le nom de la partie. */
export function groupOf(path) {
  const part = partOf(path);
  if (part !== 'masques') return part;
  const map = mapOfPath(path);
  return `masques:${map ?? 'json'}`;
}
