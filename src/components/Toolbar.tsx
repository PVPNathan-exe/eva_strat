// Barre d'outils : gérer les cartes, importer une image de fond,
// exporter / importer la config de carte en JSON.

import { useRef } from 'react';
import { useMapStore } from '../store/mapStore';
import {
  exportMapToJSON,
  importMapFromJSON,
  readImageAsDataURL,
} from '../lib/storage';

export function Toolbar() {
  const maps = useMapStore((s) => s.maps);
  const activeMapId = useMapStore((s) => s.activeMapId);
  const map = useMapStore((s) => s.getActiveMap());
  const addMap = useMapStore((s) => s.addMap);
  const setActiveMap = useMapStore((s) => s.setActiveMap);
  const setBackground = useMapStore((s) => s.setBackground);
  const upsertMap = useMapStore((s) => s.upsertMap);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);

  const handleNewMap = () => {
    const name = window.prompt('Nom de la nouvelle carte :');
    if (name) addMap(name);
  };

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && map) {
      const dataUrl = await readImageAsDataURL(file);
      setBackground(map.id, dataUrl);
    }
    e.target.value = '';
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
        onChange={(e) => setActiveMap(e.target.value)}
        disabled={maps.length === 0}
      >
        {maps.length === 0 && <option value="">Aucune carte</option>}
        {maps.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>

      <button onClick={handleNewMap}>Nouvelle carte</button>

      <button onClick={() => imageInputRef.current?.click()} disabled={!map}>
        Importer image
      </button>

      <button
        onClick={() => map && exportMapToJSON(map)}
        disabled={!map}
      >
        Exporter JSON
      </button>

      <button onClick={() => jsonInputRef.current?.click()}>Importer JSON</button>

      {/* inputs fichiers cachés */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleImageChange}
      />
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
