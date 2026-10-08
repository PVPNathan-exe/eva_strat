// Fenêtre qui s'ouvre après une analyse quand le programme a rencontré des icônes d'armes qu'il ne connaît pas : elle demande leur nom.

import { useAnalysisStore } from '../../store/analysisStore';
import { WeaponCard, WeaponSuggestions } from './WeaponCard';

export function WeaponPrompt() {
  const open = useAnalysisStore((s) => s.weaponPromptOpen);
  const weapons = useAnalysisStore((s) => s.weapons);
  const nameWeapon = useAnalysisStore((s) => s.nameWeapon);
  const close = useAnalysisStore((s) => s.closeWeaponPrompt);
  const unnamed = (weapons ?? []).filter((w) => !w.name);

  if (!open || unnamed.length === 0) return null;
  return (
    <div className="calib">
      <div className="calib__panel weapon-prompt">
        <div className="calib__head">
          <h3>
            {unnamed.length} icône{unnamed.length > 1 ? 's' : ''} d'arme inconnue{unnamed.length > 1 ? 's' : ''}
          </h3>
          <button onClick={close}>Plus tard</button>
        </div>
        <p className="weapons__intro">
          Le programme ne connaît pas {unnamed.length > 1 ? 'ces icônes' : 'cette icône'}. Choisis son nom dans la liste (armes de l'onglet
          Stratégie) ; c'est seulement utile pour l'analyse. Le programme a déjà déduit tout ce qu'il pouvait de l'équipement des joueurs.
        </p>
        <WeaponSuggestions />
        <div className="weapons__grid">
          {unnamed.map((w) => (
            <WeaponCard key={w.id} weapon={w} onName={(id, name) => void nameWeapon(id, name)} />
          ))}
        </div>
      </div>
    </div>
  );
}
