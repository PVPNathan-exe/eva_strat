// Barre d'outils : choisir une carte du dossier (src/assets/maps), gérer les
// cartes existantes, exporter / importer la config de carte en JSON.

import { useRef, useState } from 'react';
import { useMapStore } from '../store/mapStore';
import { exportMapToJSON, parseMapConfig } from '../lib/storage';
import { builtinMaps } from '../lib/builtinMaps';
import { isEbpExport, parseEbp, type ImportedPlan } from '../lib/ebpImport';
import { defaultInset } from '../lib/planInsets';
import { nameKey } from '../lib/teamFollow';
import { EbpPlanModal } from './EbpPlanModal';

export function Toolbar() {
  const maps = useMapStore((s) => s.maps);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const map = useMapStore((s) => s.getActiveMap());
  const addMap = useMapStore((s) => s.addMap);
  const setActiveMap = useMapStore((s) => s.setActiveMap);
  const setBackground = useMapStore((s) => s.setBackground);
  const upsertMap = useMapStore((s) => s.upsertMap);

  const jsonInputRef = useRef<HTMLInputElement>(null);
  const [ebp, setEbp] = useState<{ map: string; file: string; plan: ImportedPlan } | null>(null);

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

  // Un fichier JSON est soit une carte de l'application, soit un export EBP.GG (affiché dans une fenêtre, voir EbpPlanModal)
  const handleJsonChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const json: unknown = JSON.parse(await file.text());
        if (isEbpExport(json)) {
          const name = (json as { name?: unknown }).name;
          const builtin = builtinMaps.find((b) => typeof name === 'string' && nameKey(b.name) === nameKey(name)) ?? builtinMaps.find((b) => b.name === map?.name);
          if (!builtin) throw new Error('Export EBP.GG : carte inconnue, aucun plan de ce nom dans le dossier des plans.');
          setEbp({ map: builtin.name, file: file.name, plan: parseEbp(json, defaultInset(builtin.name)) });
        } else {
          upsertMap(parseMapConfig(json));
        }
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Import échoué.');
      }
    }
    e.target.value = '';
  };

  return (
    <header className="toolbar">
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
            Nouvelle carte depuis un plan…
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
      {ebp && <EbpPlanModal map={ebp.map} file={ebp.file} plan={ebp.plan} onClose={() => setEbp(null)} />}
    </header>
  );
}
