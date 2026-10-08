// Une icône d'arme à nommer : son logo, son usage, et un champ de nom avec les propositions de l'onglet Stratégie.

import { useState } from 'react';
import { Check, Flag, X } from 'lucide-react';
import { useAnalysisStore } from '../../store/analysisStore';
import { analysisApi, weaponIconUrl } from '../../lib/analysisApi';
import { SUGGESTIONS } from '../../lib/weaponCatalog';
import type { Weapon } from '../../types/analysis';
import { WeaponReport } from './WeaponReport';

/** Listes de propositions (une par type d'icône) à placer une fois dans la page. */
export function WeaponSuggestions() {
  return (
    <>
      {(Object.keys(SUGGESTIONS) as (keyof typeof SUGGESTIONS)[]).map((kind) => (
        <datalist key={kind} id={`weapon-names-${kind}`}>
          {SUGGESTIONS[kind].map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      ))}
    </>
  );
}

const formatTime = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export function WeaponCard({ weapon, onName }: { weapon: Weapon; onName: (id: string, name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const openAt = useAnalysisStore((s) => s.openAt);
  const loadWeapons = useAnalysisStore((s) => s.loadWeapons);
  const [reporting, setReporting] = useState(false);
  // Avis sur le nom deviné : « bon » en fait un nom saisi, « pas bon » ne le fait plus reproposer pour cette icône.
  const judge = (verdict: 'ok' | 'bad') => void analysisApi.reviewWeapon(weapon.id, { verdict }).then(() => loadWeapons()).catch(() => undefined);
  const commit = () => {
    if (draft !== null && draft.trim() !== weapon.name) onName(weapon.id, draft);
    setDraft(null);
  };
  return (
    <div className={`weapon${weapon.name ? ' is-named' : ''}${weapon.inferred ? ' is-inferred' : ''}`}>
      <img src={weaponIconUrl(weapon.id)} alt={`Icône ${weapon.id}`} />
      <div className="weapon__meta">
        <b>{weapon.id}</b>
        {weapon.inferred && <em title="Déduit de l'équipement des joueurs qui ont fait ces kills. Modifie-le si c'est faux.">deviné</em>}
        <span title="Nombre de kills ou de joueurs où cette icône a été vue">
          {weapon.uses} {weapon.kind === 'killfeed' ? 'kill' : 'joueur'}
          {weapon.uses > 1 ? 's' : ''}
        </span>
      </div>
      {weapon.sources.length > 0 && (
        <details className="weapon__sources">
          <summary>Vue dans</summary>
          <ul>
            {weapon.sources.map((s) => (
              <li key={s.gameId}>
                <button type="button" title="Ouvrir la vidéo à cet instant" onClick={() => void openAt(s.videoId, s.gameId, s.t)}>
                  {s.video}, game {s.game}
                  {s.map ? ` (${s.map})` : ''}, à {formatTime(s.t)}
                  {s.player ? `, ${s.player}` : ''}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {weapon.inferred && weapon.name && (
        <div className="weapon__judge" title="Le programme a deviné ce nom : dis-lui s'il a juste">
          <span>Deviné : bon ?</span>
          <button type="button" onClick={() => judge('ok')} aria-label="Le nom deviné est bon">
            <Check className="ic" /> Bon
          </button>
          <button type="button" onClick={() => judge('bad')} aria-label="Le nom deviné est faux">
            <X className="ic" /> Pas bon
          </button>
        </div>
      )}
      <input
        list={`weapon-names-${weapon.kind}`}
        placeholder="Nom de l'arme"
        value={draft ?? weapon.name}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <button type="button" className={`weapon__report${weapon.reported ? ' is-reported' : ''}`} onClick={() => setReporting(true)} title="Cette icône ne représente pas la bonne arme, ou plusieurs icônes sont superposées">
        <Flag className="ic" /> {weapon.reported ? 'Signalée' : 'Signaler'}
      </button>
      {reporting && <WeaponReport weapon={weapon} onClose={() => setReporting(false)} />}
    </div>
  );
}
