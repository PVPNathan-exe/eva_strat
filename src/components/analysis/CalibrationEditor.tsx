// Fenêtre de calibration : on dessine les zones du HUD sur une frame de la vidéo, par carte.

import { useEffect, useRef, useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { builtinMaps } from '../../lib/builtinMaps';
import { captureFrame } from '../../lib/videoRef';
import { useAnalysisStore } from '../../store/analysisStore';
import { ZONE_LABELS, ZONE_NAMES, type ZoneName, type Zones } from '../../types/analysis';

const ZONE_COLORS: Record<ZoneName, string> = {
  minimap: '#2ec27e',
  capture_points: '#f5c211',
  capture_pct_a: '#ffcf70',
  capture_pct_b: '#7fc4ff',
  team_a_bar: '#ff9f1c',
  team_b_bar: '#3d8bff',
  timer: '#ffffff',
};

type Drag = { zone: ZoneName; mode: 'move' | 'resize'; startX: number; startY: number; origin: Zones[ZoneName] };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function CalibrationEditor({ onClose }: { onClose: () => void }) {
  const selectedMap = useAnalysisStore((s) => s.games.find((g) => g.id === s.selectedGameId)?.map);
  const [map, setMap] = useState(selectedMap ?? builtinMaps[0]?.name ?? '');
  const [frame] = useState(() => captureFrame());
  const [zones, setZones] = useState<Zones | null>(null);
  const [isDefault, setIsDefault] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!map) return;
    let cancelled = false;
    analysisApi
      .calibration(map)
      .then((res) => {
        if (cancelled) return;
        setZones(res.zones);
        setIsDefault(res.isDefault);
        setStatus(null);
      })
      .catch((err: Error) => !cancelled && setStatus(err.message));
    return () => {
      cancelled = true;
    };
  }, [map]);

  const startDrag = (e: React.PointerEvent, zone: ZoneName, mode: Drag['mode']) => {
    if (!zones) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ zone, mode, startX: e.clientX, startY: e.clientY, origin: zones[zone] });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag || !zones || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;
    const o = drag.origin;
    const next =
      drag.mode === 'move'
        ? { ...o, x: clamp(o.x + dx, 0, 1 - o.w), y: clamp(o.y + dy, 0, 1 - o.h) }
        : { ...o, w: clamp(o.w + dx, 0.01, 1 - o.x), h: clamp(o.h + dy, 0.01, 1 - o.y) };
    setZones({ ...zones, [drag.zone]: next });
  };

  const save = async () => {
    if (!zones) return;
    try {
      await analysisApi.saveCalibration(map, zones);
      setIsDefault(false);
      setStatus(`Calibration enregistrée pour ${map}`);
    } catch (err) {
      setStatus((err as Error).message);
    }
  };

  return (
    <div className="calib">
      <div className="calib__panel">
        <div className="calib__head">
          <h3>Calibrer les zones du HUD</h3>
          <select value={map} onChange={(e) => { setZones(null); setMap(e.target.value); }}>
            {builtinMaps.map((m) => (
              <option key={m.id} value={m.name}>{m.name}</option>
            ))}
          </select>
          <span className="calib__hint">{isDefault ? 'Zones par défaut' : 'Zones enregistrées'}</span>
          <button onClick={() => void save()} disabled={!zones}>Enregistrer</button>
          <button onClick={onClose}>Fermer</button>
        </div>

        {!frame ? (
          <p className="games__error">
            Aucune image disponible : lance la lecture de la vidéo (ou avance un peu) puis rouvre la calibration.
          </p>
        ) : (
          <div className="calib__stage" ref={stageRef} onPointerMove={onMove} onPointerUp={() => setDrag(null)}>
            <img src={frame} alt="Frame de la vidéo" draggable={false} />
            {zones &&
              ZONE_NAMES.map((name) => {
                const z = zones[name];
                return (
                  <div
                    key={name}
                    className="calib__zone"
                    style={{
                      left: `${z.x * 100}%`,
                      top: `${z.y * 100}%`,
                      width: `${z.w * 100}%`,
                      height: `${z.h * 100}%`,
                      borderColor: ZONE_COLORS[name],
                    }}
                    onPointerDown={(e) => startDrag(e, name, 'move')}
                  >
                    <span style={{ background: ZONE_COLORS[name] }}>{ZONE_LABELS[name]}</span>
                    <i className="calib__handle" onPointerDown={(e) => startDrag(e, name, 'resize')} />
                  </div>
                );
              })}
          </div>
        )}
        {status && <p className="calib__status">{status}</p>}
      </div>
    </div>
  );
}
