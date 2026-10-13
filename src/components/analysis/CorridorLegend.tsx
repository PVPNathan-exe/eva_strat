// Légende de la carte des couloirs (couleurs des calques de CorridorMap), à côté de la carte.

const ITEMS: { cls: string; label: string }[] = [
  { cls: 'corridor', label: "Couloirs lus : le joueur peut s'y trouver" },
  { cls: 'ride', label: 'Tyrolienne (stations reliées)' },
  { cls: 'capture', label: 'Point de capture (zone jouable)' },
  { cls: 'spawn-a', label: 'Zone de départ orange' },
  { cls: 'spawn-b', label: 'Zone de départ bleue' },
  { cls: 'spawn-n', label: 'Zone de départ neutre (tout joueur)' },
  { cls: 'under', label: 'Passage en dessous (étages superposés)' },
  { cls: 'porte', label: 'Porte tracée' },
  { cls: 'fenetre', label: 'Fenêtre tracée (on voit, on ne passe pas)' },
  { cls: 'mur', label: 'Trait de mur tracé' },
  { cls: 'tir', label: 'Tir par-dessus tracé' },
];

export function CorridorLegend() {
  return (
    <section className="legend">
      <h4>Légende</h4>
      <ul>
        {ITEMS.map((i) => (
          <li key={i.cls}>
            <i className={`legend__swatch legend__swatch--${i.cls}`} />
            {i.label}
          </li>
        ))}
      </ul>
      <p className="legend__hint">Les calques se choisissent avec le bouton « Calques » au-dessus de la carte.</p>
    </section>
  );
}
