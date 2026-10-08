// Onglet Armes : toutes les icônes d'armes vues par l'analyse (killfeed, armes des bandeaux, gadgets), à nommer une fois pour toutes.
// Les noms sont enregistrés dans analysis/weapon_icons/names.json (versionné avec le projet).

import { useEffect, useMemo, useState } from 'react';
import { analysisApi, weaponIconUrl } from '../../lib/analysisApi';
import type { Weapon, WeaponKind } from '../../types/analysis';

const SECTIONS: { kind: WeaponKind; title: string; hint: string }[] = [
  { kind: 'arme', title: 'Armes des joueurs (bandeaux)', hint: "Les deux armes de chaque joueur, principale et secondaire : l'arme tenue est en noir sur le bandeau, l'autre en pâle." },
  { kind: 'killfeed', title: 'Armes du killfeed', hint: "L'icône entre le tueur et la victime. La petite cible est le marqueur de headshot : elle n'est pas comptée dans l'arme." },
  { kind: 'gadget', title: 'Gadgets (bandeaux)', hint: 'La troisième icône du bandeau.' },
];

export function WeaponsTab() {
  const [weapons, setWeapons] = useState<Weapon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [onlyUnnamed, setOnlyUnnamed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    analysisApi
      .weapons()
      .then((list) => {
        if (!cancelled) {
          setWeapons(list);
          setError(null);
        }
      })
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (w: Weapon) => {
    const name = (drafts[w.id] ?? w.name).trim();
    if (name === w.name) return;
    try {
      await analysisApi.nameWeapon(w.id, name);
      setWeapons((list) => (list ?? []).map((x) => (x.id === w.id ? { ...x, name } : x)));
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([id]) => id !== w.id)));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const known = useMemo(() => [...new Set((weapons ?? []).map((w) => w.name).filter(Boolean))].sort(), [weapons]);
  const unnamed = (weapons ?? []).filter((w) => !w.name).length;

  return (
    <div className="weapons">
      <header className="weapons__head">
        <h2>Armes</h2>
        <span>{weapons ? `${weapons.length} icônes, ${unnamed} sans nom` : 'Chargement…'}</span>
        <label>
          <input type="checkbox" checked={onlyUnnamed} onChange={(e) => setOnlyUnnamed(e.target.checked)} />
          Seulement celles sans nom
        </label>
      </header>
      <p className="weapons__intro">
        Écris le nom de chaque arme sous son logo. Plusieurs icônes peuvent porter le même nom (une même arme est parfois vue sous des
        aspects différents). Les noms sont ensuite affichés dans la liste des kills du replay.
      </p>
      {error && <p className="games__error">{error}</p>}
      {weapons && weapons.length === 0 && (
        <p className="games__empty">Aucune icône pour l'instant : lance « Analyser » sur une vidéo, les armes vues apparaîtront ici.</p>
      )}
      <datalist id="weapon-names">
        {known.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {SECTIONS.map(({ kind, title, hint }) => {
        const list = (weapons ?? []).filter((w) => w.kind === kind && (!onlyUnnamed || !w.name));
        if (list.length === 0) return null;
        return (
          <section key={kind} className="weapons__section">
            <h3>
              {title} <small>({list.length})</small>
            </h3>
            <p className="weapons__hint">{hint}</p>
            <div className="weapons__grid">
              {list.map((w) => (
                <div key={w.id} className={`weapon${w.name ? ' is-named' : ''}`}>
                  <img src={weaponIconUrl(w.id)} alt={`Icône ${w.id}`} />
                  <div className="weapon__meta">
                    <b>{w.id}</b>
                    <span title="Nombre de kills ou de joueurs où cette icône a été vue">
                      {w.uses} {kind === 'killfeed' ? 'kill' : 'joueur'}
                      {w.uses > 1 ? 's' : ''}
                    </span>
                  </div>
                  <input
                    list="weapon-names"
                    placeholder="Nom de l'arme"
                    value={drafts[w.id] ?? w.name}
                    onChange={(e) => setDrafts((d) => ({ ...d, [w.id]: e.target.value }))}
                    onBlur={() => void save(w)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
