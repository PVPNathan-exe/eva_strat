// Boutons « ok » et « ko » d'un épisode détecté : l'utilisateur juge si la détection est juste. Le jugement est enregistré par PUT /api/stats/episodes/:id.
// Un second clic sur le même bouton retire le jugement. Le parent garde la valeur affichée (onChange) pour recalculer les taux sans recharger.

import { useState } from 'react';
import { Check, X } from 'lucide-react';
import { statsApi } from '../../lib/statsApi';

type Verdict = 'ok' | 'ko' | null;

interface Props {
  episodeId: number;
  verdict: Verdict;
  onChange: (id: number, verdict: Verdict) => void;
}

export function ValidateEpisode({ episodeId, verdict, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = (wanted: 'ok' | 'ko') => {
    const next: Verdict = verdict === wanted ? null : wanted;
    setBusy(true);
    setError(null);
    statsApi
      .setVerdict(episodeId, next)
      .then(() => onChange(episodeId, next))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="epv">
      <span className="epv__label">Cette détection est-elle juste ?</span>
      <button type="button" className={`epv__btn epv__btn--ok${verdict === 'ok' ? ' is-active' : ''}`} aria-pressed={verdict === 'ok'} disabled={busy} onClick={() => choose('ok')}>
        <Check className="ic" /> Juste (ok)
      </button>
      <button type="button" className={`epv__btn epv__btn--ko${verdict === 'ko' ? ' is-active' : ''}`} aria-pressed={verdict === 'ko'} disabled={busy} onClick={() => choose('ko')}>
        <X className="ic" /> Faux (ko)
      </button>
      {error && <span className="epv__error">Enregistrement impossible : {error}</span>}
    </div>
  );
}
