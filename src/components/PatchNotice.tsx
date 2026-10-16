// Bandeau discret : un nouveau patch du jeu a été détecté au démarrage (scripts/patches/watch.mjs). Rien n'est modifié automatiquement :
// l'utilisateur relit les extraits, met à jour analysis/patch_reference.json à la main, puis marque le patch relu. Invisible s'il n'y a rien de nouveau.

import { useEffect, useState } from 'react';
import { Check, Info } from 'lucide-react';
import { jsonInit, parse } from '../lib/analysisApi';

interface PatchNote {
  slug: string;
  title: string;
  date: string | null;
  url: string;
  excerpts: string[];
}

export function PatchNotice() {
  const [patches, setPatches] = useState<PatchNote[]>([]);

  // Lecture au chargement ; une erreur (serveur sans la route, hors Vite) laisse simplement le bandeau caché.
  useEffect(() => {
    fetch('/api/patch-notes', { cache: 'no-store' })
      .then(parse<{ patches: PatchNote[] }>)
      .then((r) => setPatches(r.patches))
      .catch(() => undefined);
  }, []);

  const markReviewed = (slug: string) => {
    fetch(`/api/patch-notes/${encodeURIComponent(slug)}`, jsonInit('PUT', { reviewed: true }))
      .then(parse<{ ok: true }>)
      .then(() => setPatches((list) => list.filter((p) => p.slug !== slug)))
      .catch(() => undefined);
  };

  if (patches.length === 0) return null;
  return (
    <div className="patch-notice" role="status">
      {patches.map((p) => (
        <div className="patch-notice__item" key={p.slug}>
          <span className="patch-notice__text">
            <Info className="ic" aria-hidden="true" /> Nouveau patch : <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a>
            {p.date ? ` (${p.date})` : ''}. Relire les extraits et mettre à jour analysis/patch_reference.json.
          </span>
          <button type="button" className="patch-notice__done" onClick={() => markReviewed(p.slug)}>
            <Check className="ic" aria-hidden="true" /> Marqué relu
          </button>
          <details className="help patch-notice__extracts">
            <summary>Voir</summary>
            {p.excerpts.length === 0 ? (
              <p className="help__body">Aucune ligne utile trouvée : ouvrir le patch pour le lire en entier.</p>
            ) : (
              <ul className="patch-notice__list">
                {p.excerpts.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            )}
          </details>
        </div>
      ))}
    </div>
  );
}
