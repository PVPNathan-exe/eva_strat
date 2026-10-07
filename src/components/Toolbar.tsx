// Barre d'outils : choisir une carte du dossier (src/assets/maps), gérer les
// cartes existantes, exporter / importer la config de carte en JSON.

import { useRef } from 'react';
import { useMapStore } from '../store/mapStore';
import { exportMapToJSON, importMapFromJSON } from '../lib/storage';
import { builtinMaps } from '../lib/builtinMaps';

export function Toolbar() {
  const maps = useMapStore((s) => s.maps);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const map = useMapStore((s) => s.getActiveMap());
  const addMap = useMapStore((s) => s.addMap);
  const setActiveMap = useMapStore((s) => s.setActiveMap);
  const setBackground = useMapStore((s) => s.setBackground);
  const upsertMap = useMapStore((s) => s.upsertMap);

  const jsonInputRef = useRef<HTMLInputElement>(null);

  // Confirme avant de quitter la carte active (évite un changement accidentel).
  // Le travail est de toute façon sauvegardé, c'est juste un garde-fou.
  const confirmSwitch = (targetId: string) => {
    if (!activeMapId || targetId === activeMapId) return true;
    return window.confirm('Changer de carte ?');
  };

  // Bascule sur une carte existante (1er menu), avec confirmation.
  const handleSelectMap = (id: string) => {
    if (id && confirmSwitch(id)) setActiveMap(id);
  };

  // Choisir un plan du dossier : chaque plan devient SA propre carte.
  // Si une carte du même nom existe déjà, on bascule dessus (avec confirmation,
  // pas de doublon) ; sinon on en crée une nouvelle avec ce plan en fond.
  const handlePickBuiltin = (id: string) => {
    const builtin = builtinMaps.find((b) => b.id === id);
    if (!builtin) return;
    const existing = maps.find((m) => m.name === builtin.name);
    if (existing) {
      if (confirmSwitch(existing.id)) {
        // Auto-correction : remet le bon plan si le fond a dérivé (ancienne donnée).
        if (existing.backgroundImage !== builtin.src) {
          setBackground(existing.id, builtin.src);
        }
        setActiveMap(existing.id);
      }
      return;
    }
    addMap(builtin.name);
    const newMapId = useMapStore.getState().activeMapId;
    if (newMapId) setBackground(newMapId, builtin.src);
  };

  const handleJsonChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const imported = await importMapFromJSON(file);
        upsertMap(imported);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Import échoué.');
      }
    }
    e.target.value = '';
  };

  return (
    <header className="toolbar">
      <strong className="toolbar__brand">EVA Strat</strong>

      <select
        value={activeMapId ?? ''}
        onChange={(e) => handleSelectMap(e.target.value)}
        disabled={maps.length === 0}
      >
        {maps.length === 0 && <option value="">Aucune carte</option>}
        {maps.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      {builtinMaps.length > 0 && (
        <select
          value=""
          onChange={(e) => handlePickBuiltin(e.target.value)}
        >
          <option value="" disabled>
            Choisir une carte…
          </option>
          {builtinMaps.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      <button
        onClick={() => map && exportMapToJSON(map)}
        disabled={!map}
      >
        Exporter JSON
      </button>

      <button onClick={() => jsonInputRef.current?.click()}>Importer JSON</button>

      {/* input fichier caché (import JSON) */}
      <input
        ref={jsonInputRef}
        type="file"
        accept="application/json"
        hidden
        onChange={handleJsonChange}
      />
    </header>
  );
}
