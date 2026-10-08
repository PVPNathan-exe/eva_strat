// Onglet Armes : toutes les icônes d'armes vues par l'analyse (killfeed, armes des bandeaux, gadgets), à nommer une fois pour toutes.
// Les noms sont enregistrés dans analysis/weapon_icons/names.json (versionné avec le projet). L'application les demande d'elle-même
// quand une icône est inconnue (voir WeaponPrompt) ; cet onglet sert à les revoir ou les corriger.

import { useEffect, useState } from 'react';
import { useAnalysisStore } from '../../store/analysisStore';
import type { WeaponKind } from '../../types/analysis';
import { WeaponCard, WeaponSuggestions } from './WeaponCard';

const SECTIONS: { kind: WeaponKind; title: string; hint: string }[] = [
  { kind: 'arme', title: 'Armes des joueurs (bandeaux)', hint: "Les deux armes de chaque joueur, principale et secondaire : l'arme tenue est en noir sur le bandeau, l'autre en pâle." },
  { kind: 'killfeed', title: 'Armes du killfeed', hint: "L'icône entre le tueur et la victime. La petite cible est le marqueur de headshot : elle n'est pas comptée dans l'arme. Le logo de grenade (le même pour toutes les grenades) est reconnu tout seul et n'apparaît pas ici." },
  { kind: 'gadget', title: 'Gadgets (bandeaux)', hint: 'La troisième icône du bandeau.' },
];

export function WeaponsTab() {
  const weapons = useAnalysisStore((s) => s.weapons);
  const loadWeapons = useAnalysisStore((s) => s.loadWeapons);
  const nameWeapon = useAnalysisStore((s) => s.nameWeapon);
  const [onlyUnnamed, setOnlyUnnamed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadWeapons().catch((err: Error) => setError(err.message));
  }, [loadWeapons]);

  const unnamed = (weapons ?? []).filter((w) => !w.name).length;
  const save = (id: string, name: string) => void nameWeapon(id, name).catch((err: Error) => setError(err.message));

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
        Ces noms servent au programme (liste des kills, équipement des joueurs). Il déduit tout seul le nom des armes du killfeed à partir de
        l'équipement des joueurs qui ont fait les kills (marqué « deviné ») et ne te demande que ce qu'il ne trouve pas.
        Le logo de grenade du killfeed, identique pour toutes les grenades, n'est pas affiché. Les propositions viennent de l'onglet Stratégie, tu peux aussi écrire un autre nom. Plusieurs icônes peuvent porter le même
        nom (une même arme est parfois vue sous des aspects différents).
      </p>
      {error && <p className="games__error">{error}</p>}
      {weapons && weapons.length === 0 && (
        <p className="games__empty">Aucune icône pour l'instant : lance « Analyser » sur une vidéo, les armes vues apparaîtront ici.</p>
      )}
      <WeaponSuggestions />
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
                <WeaponCard key={w.id} weapon={w} onName={save} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
