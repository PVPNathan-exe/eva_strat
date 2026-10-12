// Cartographie à la main d'une carte : chargement, modification locale, enregistrement et application aux fichiers du programme.

import { useCallback, useEffect, useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { emptyAnnotation, sanitize, type MapAnnotation } from '../../lib/mapAnnotation';

export function useMapAnnotation(map: string) {
  const [annotation, setAnnotation] = useState<MapAnnotation>(emptyAnnotation);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    analysisApi
      .mapAnnotation(map)
      .then((r) => {
        if (cancelled) return;
        setAnnotation(r ? sanitize(r.data) : emptyAnnotation());
        setLoaded(true);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setMessage({ text: e.message, error: true });
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [map]);

  const update = useCallback((change: (a: MapAnnotation) => MapAnnotation) => {
    setAnnotation(change);
    setDirty(true);
    setMessage(null);
  }, []);

  const save = useCallback(async () => {
    setBusy(true);
    try {
      await analysisApi.saveMapAnnotation(map, annotation);
      setDirty(false);
      setMessage({ text: 'Cartographie enregistrée.', error: false });
      return true;
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
      return false;
    } finally {
      setBusy(false);
    }
  }, [map, annotation]);

  /** Enregistre puis écrit le masque, les murs, les tyroliennes, les portes, les départs et l'alignement dans les fichiers du programme. */
  const apply = useCallback(async () => {
    if (!(await save())) return;
    setBusy(true);
    try {
      const summary = await analysisApi.applyMapAnnotation(map);
      setMessage({ text: `Appliqué aux fichiers du programme : ${Object.entries(summary).filter(([k]) => k !== 'map').map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(', ')}. Recharge la page pour voir les couloirs mis à jour.`, error: false });
    } catch (e) {
      setMessage({ text: (e as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  }, [map, save]);

  return { annotation, loaded, dirty, busy, message, update, save, apply };
}
