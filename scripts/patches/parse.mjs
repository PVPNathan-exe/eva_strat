// Lecture des pages du blog du jeu : liste des patchs, texte d'un patch, phrases utiles.
// Aucune valeur de jeu n'est déduite ici : un texte libre n'est pas fiable, on ne fait que retrouver les lignes à relire.

export const BLOG = 'https://blog.eva.gg';
export const LIST_URL = `${BLOG}/en/tag/patch-notes`;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: '...' };

/** Remplace les entités HTML courantes (nommées et numériques). */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, name) => {
    if (name[0] === '#') {
      const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[name.toLowerCase()] ?? all;
  });
}

/** Date « MM/JJ/AAAA » du blog en « AAAA-MM-JJ » ; null si le format est inconnu. */
export function isoDate(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((text ?? '').trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/**
 * Liste des patchs de la page d'étiquette : un `<article>` par patch, le lien est https://blog.eva.gg/en/<slug>
 * (les liens d'étiquette `/en/tag/...` ne sont pas des patchs). Renvoie [{ slug, title, date, url }], dans l'ordre de la page.
 */
export function parsePatchList(html) {
  const out = [];
  const seen = new Set();
  for (const block of html.split(/<article\b/i).slice(1)) {
    const link = /href="https:\/\/blog\.eva\.gg\/en\/([^"/?#]+)"/i.exec(block);
    if (!link || link[1] === 'tag' || seen.has(link[1])) continue;
    const slug = link[1];
    const title = /<h3[^>]*>[\s\S]*?<a [^>]*>([\s\S]*?)<\/a>/i.exec(block)?.[1];
    const date = /<time[^>]*datetime="([^"]*)"/i.exec(block)?.[1];
    seen.add(slug);
    out.push({ slug, title: decodeEntities((title ?? slug).replace(/<[^>]*>/g, '')).trim() || slug, date: isoDate(date), url: `${BLOG}/en/${slug}` });
  }
  return out;
}

/** Texte d'une page, une ligne par bloc ou rangée de tableau, les cellules séparées par une espace. `chrome` : retire aussi en-tête, navigation et pied de page. */
function flatten(html, chrome) {
  const dropped = chrome ? 'script|style|noscript|svg|header|nav|footer' : 'script|style|noscript|svg';
  const text = html
    .replace(new RegExp(`<(${dropped})\\b[\\s\\S]*?<\\/\\1>`, 'gi'), ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|li|tr|h[1-6]|div|section|article|table|ul|ol|blockquote)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ');
  return decodeEntities(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Texte d'une page de patch sans balises, scripts ni styles ; sans en-tête ni pied de page, sauf si cela ne laisse presque rien (contenu rangé dans un de ces éléments). */
export function htmlToText(html) {
  const clean = flatten(html, true);
  return clean.length >= 200 ? clean : flatten(html, false);
}

/** Mots qui signalent une valeur de jeu à relire (gadgets, délais, dégâts, portées). */
const KEYWORDS = /cooldown|recharge|shield|sonar|sticky|dx3|med ?pack|echo|clone|gadget|grenade|d[ée]g[âa]ts?|damage|range|delay|dur[ée]e|duration/i;

/** Rangée de tableau d'armes : au moins deux couples « valeur (ancienne valeur) », par exemple « 95 (100) 3 (2) ». */
const TABLE_ROW = /\d+(?:[.,]\d+)?\s*\(\s*\d+(?:[.,]\d+)?\s*\)(?:.*?)\d+(?:[.,]\d+)?\s*\(\s*\d+(?:[.,]\d+)?\s*\)/;

export const MAX_EXCERPTS = 60;
export const MAX_EXCERPT_LEN = 300;

/** Lignes utiles d'un texte de patch (au plus MAX_EXCERPTS, chacune coupée à MAX_EXCERPT_LEN), sans doublon, dans l'ordre. */
export function extractExcerpts(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (l.length < 4 || out.includes(l.slice(0, MAX_EXCERPT_LEN))) continue;
    if (KEYWORDS.test(l) || TABLE_ROW.test(l)) out.push(l.slice(0, MAX_EXCERPT_LEN));
    if (out.length >= MAX_EXCERPTS) break;
  }
  return out;
}
