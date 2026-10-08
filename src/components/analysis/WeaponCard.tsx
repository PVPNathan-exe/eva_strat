// Une icône d'arme à nommer : son logo, son usage, et un champ de nom avec les propositions de l'onglet Stratégie.

import { useState } from 'react';
import { weaponIconUrl } from '../../lib/analysisApi';
import { SUGGESTIONS } from '../../lib/weaponCatalog';
import type { Weapon } from '../../types/analysis';

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

export function WeaponCard({ weapon, onName }: { weapon: Weapon; onName: (id: string, name: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== weapon.name) onName(weapon.id, draft);
    setDraft(null);
  };
  return (
    <div className={`weapon${weapon.name ? ' is-named' : ''}`}>
      <img src={weaponIconUrl(weapon.id)} alt={`Icône ${weapon.id}`} />
      <div className="weapon__meta">
        <b>{weapon.id}</b>
        <span title="Nombre de kills ou de joueurs où cette icône a été vue">
          {weapon.uses} {weapon.kind === 'killfeed' ? 'kill' : 'joueur'}
          {weapon.uses > 1 ? 's' : ''}
        </span>
      </div>
      <input
        list={`weapon-names-${weapon.kind}`}
        placeholder="Nom de l'arme"
        value={draft ?? weapon.name}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}
