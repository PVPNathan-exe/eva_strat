// Signaler une icône d'arme : elle ne représente pas la bonne arme, ou plusieurs icônes sont superposées.
// Le programme relit les bandeaux autour des endroits où l'icône a été vue et propose des images ; il peut recalculer l'icône seul
// (meilleures images moyennées) ou à partir de l'image que tu désignes comme modèle.

import { useEffect, useState } from 'react';
import { Flag, Loader2, Wand2, X } from 'lucide-react';
import { analysisApi, bumpIconVersion, candidateImageUrl, weaponIconUrl } from '../../lib/analysisApi';
import { useAnalysisStore } from '../../store/analysisStore';
import type { IconCandidate, Weapon } from '../../types/analysis';
import { formatTime } from '../../lib/timeline';

export function WeaponReport({ weapon, onClose }: { weapon: Weapon; onClose: () => void }) {
  const loadWeapons = useAnalysisStore((s) => s.loadWeapons);
  const [reason, setReason] = useState('');
  const [candidates, setCandidates] = useState<IconCandidate[] | null>(null);
  const canRebuild = weapon.id[0] === 'B' || weapon.id[0] === 'G';
  const [busy, setBusy] = useState<'search' | 'rebuild' | null>(canRebuild ? 'search' : null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Le signalement est enregistré dès l'ouverture ; les images sont cherchées une fois.
  useEffect(() => {
    let cancelled = false;
    void analysisApi.reviewWeapon(weapon.id, { reported: true }).then(() => loadWeapons()).catch(() => undefined);
    if (!canRebuild) return;
    analysisApi
      .iconCandidates(weapon.id)
      .then((r) => !cancelled && setCandidates(r.candidates))
      .catch((e: Error) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setBusy(null));
    return () => {
      cancelled = true;
    };
  }, [weapon.id, canRebuild, loadWeapons]);

  const rebuild = async (token?: string) => {
    setBusy('rebuild');
    setError(null);
    setMessage(null);
    try {
      const r = await analysisApi.rebuildIcon(weapon.id, token);
      bumpIconVersion();
      await loadWeapons();
      setMessage(token ? "Modèle remplacé par l'image choisie." : `Icône recalculée à partir de ${r.used.length} images.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveReason = async () => {
    if (reason.trim()) await analysisApi.reviewWeapon(weapon.id, { reported: true, reason }).catch(() => undefined);
  };

  const withdraw = async () => {
    await analysisApi.reviewWeapon(weapon.id, { reported: false }).catch(() => undefined);
    await loadWeapons();
    onClose();
  };

  return (
    <div className="calib" role="dialog" aria-label={`Signaler l'icône ${weapon.id}`}>
      <div className="report">
        <header className="report__head">
          <h3>
            <Flag className="ic" /> Signaler l'icône {weapon.id}
            {weapon.name ? ` (${weapon.name})` : ''}
          </h3>
          <button onClick={onClose} aria-label="Fermer">
            <X className="ic" />
          </button>
        </header>
        <div className="report__body">
          <div className="report__current">
            <img src={weaponIconUrl(weapon.id)} alt={`Icône ${weapon.id}`} />
            <p>
              Modèle actuel. Dis ce qui ne va pas : elle ne représente pas la bonne arme, ou deux icônes sont superposées. Le programme relit les
              bandeaux autour des endroits où il l'a vue.
            </p>
            <input value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => void saveReason()} placeholder="Remarque (facultatif)" />
          </div>

          {!canRebuild && <p className="games__empty">Seules les armes et gadgets des bandeaux (B…, G…) se recalculent : cette icône est seulement signalée.</p>}
          {canRebuild && (
            <>
              <div className="report__actions">
                <button onClick={() => void rebuild()} disabled={busy !== null || !candidates || candidates.length === 0}>
                  {busy === 'rebuild' ? <Loader2 className="ic ic--spin" /> : <Wand2 className="ic" />} Recalculer automatiquement
                </button>
                <span>
                  Les images nettes, entières et de la bonne forme (marquées « retenue ») sont moyennées. Ou choisis toi-même l'image qui servira de
                  modèle.
                </span>
              </div>
              {busy === 'search' && (
                <p>
                  <Loader2 className="ic ic--spin" /> Lecture des bandeaux autour des endroits où l'icône a été vue…
                </p>
              )}
              {candidates && candidates.length === 0 && <p className="games__empty">Aucune image trouvée : cette icône n'est lue sur aucun bandeau enregistré.</p>}
              {candidates && candidates.length > 0 && (
                <div className="report__grid">
                  {candidates.map((c) => (
                    <figure key={c.token} className={c.auto ? 'is-auto' : ''}>
                      <img src={candidateImageUrl(weapon.id, c.token)} alt={`Image à ${formatTime(c.t)}`} loading="lazy" />
                      <figcaption>
                        {formatTime(c.t)} · joueur {c.slot <= 4 ? c.slot : c.slot + 1}
                        {c.auto && <em> retenue</em>}
                      </figcaption>
                      <button onClick={() => void rebuild(c.token)} disabled={busy !== null}>
                        Utiliser comme modèle
                      </button>
                    </figure>
                  ))}
                </div>
              )}
            </>
          )}
          {message && <p className="report__ok">{message} Relance « Analyser » pour que les kills et l'équipement en profitent.</p>}
          {error && <p className="games__error">{error}</p>}
        </div>
        <footer className="report__foot">
          <button onClick={() => void withdraw()}>Retirer le signalement</button>
          <button onClick={onClose}>Fermer</button>
        </footer>
      </div>
    </div>
  );
}
