// « Ce que voit le programme » : calques dessinés sur la vidéo pour vérifier la lecture à l'œil.
// Zones du HUD lues, pastilles de la minimap (numéro, direction, mort, doute), cases des bandeaux avec l'équipement lu, kills récents du killfeed.
// Rien n'est recalculé ici : on affiche ce qui est enregistré pour la game en cours.

import { useEffect, useMemo, useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { formatTime } from '../../lib/timeline';
import type { VisionLayers } from '../../lib/vision';
import { useAnalysisStore } from '../../store/analysisStore';
import type { Game, Sample, Zone, Zones } from '../../types/analysis';
import { ZONE_LABELS } from '../../types/analysis';

const TEAM_COLOR = { A: '#ff9f1c', B: '#3d8bff' } as const;
const KILLFEED = { x: 0.78, y: 0.19, w: 0.22, h: 0.3 }; // même zone que analysis/killfeed.py
const ICON_BOXES = {
  arme1: { x: 0.3, w: 0.24, y: 0.33, h: 0.17 },
  arme2: { x: 0.53, w: 0.27, y: 0.33, h: 0.17 },
  gadget: { x: 0.8, w: 0.16, y: 0.33, h: 0.17 },
} as const; // mêmes cases que analysis/loadout.py (relatives à un bandeau)
const number = (slot: number) => (slot <= 4 ? slot : slot + 1);

function nearest(times: number[], t: number): number | null {
  if (times.length === 0) return null;
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const a = times[Math.max(lo - 1, 0)];
  const b = times[lo];
  return Math.abs(a - t) <= Math.abs(b - t) ? a : b;
}

export function VisionOverlay({ width, height, layers }: { width: number; height: number; layers: VisionLayers }) {
  const time = useAnalysisStore((s) => s.currentTime);
  const games = useAnalysisStore((s) => s.games);
  const selectedId = useAnalysisStore((s) => s.selectedGameId);
  const weapons = useAnalysisStore((s) => s.weapons);
  const game: Game | undefined = useMemo(
    () => games.find((g) => g.id === selectedId) ?? games.find((g) => time >= g.start_s && time <= g.end_s),
    [games, selectedId, time],
  );
  const [zones, setZones] = useState<Zones | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);

  const map = game?.map ?? '';
  useEffect(() => {
    let cancelled = false;
    analysisApi
      .calibration(map)
      .then((c) => !cancelled && setZones(c.zones))
      .catch(() => !cancelled && setZones(null));
    return () => {
      cancelled = true;
    };
  }, [map]);

  const gameId = game?.id ?? null;
  const hasSamples = (game?.samples ?? 0) > 0;
  useEffect(() => {
    let cancelled = false;
    if (gameId === null || !hasSamples) return;
    analysisApi
      .samples(gameId)
      .then((s) => !cancelled && setSamples(s))
      .catch(() => !cancelled && setSamples([]));
    return () => {
      cancelled = true;
    };
  }, [gameId, hasSamples]);

  const byTime = useMemo(() => {
    const m = new Map<number, Sample[]>();
    for (const s of gameId !== null && hasSamples ? samples : []) m.set(s.t, [...(m.get(s.t) ?? []), s]);
    return m;
  }, [samples, gameId, hasSamples]);
  const times = useMemo(() => [...byTime.keys()].sort((a, b) => a - b), [byTime]);

  if (!zones || width <= 0 || height <= 0) return null;
  const rect = (z: Zone) => ({ x: z.x * width, y: z.y * height, w: z.w * width, h: z.h * height });
  const nameOf = new Map((game?.players ?? []).map((p) => [p.slot, p.name]));
  const weaponName = (id: string | null) => (id ? (weapons?.find((w) => w.id === id)?.name || id) : '?');

  const t = nearest(times, time);
  const marks = t !== null && Math.abs(t - time) < 0.6 ? (byTime.get(t) ?? []) : [];
  const mini = rect(zones.minimap);

  const recent = (game?.kills ?? []).filter((k) => k.t <= time + 0.3 && k.t >= time - 6);

  return (
    <svg className="vision" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {layers.zones &&
        (Object.keys(zones) as (keyof Zones)[]).map((name) => {
          const r = rect(zones[name]);
          return (
            <g key={name}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} className="vision__zone" />
              <text x={r.x + 3} y={r.y + 11} className="vision__label">
                {ZONE_LABELS[name]}
              </text>
            </g>
          );
        })}

      {layers.bandeaux &&
        (['team_a_bar', 'team_b_bar'] as const).flatMap((key, side) => {
          const r = rect(zones[key]);
          return [0, 1, 2, 3].map((i) => {
            const slot = side * 4 + i + 1;
            const p = game?.players.find((q) => q.slot === slot);
            const bx = r.x + (r.w / 4) * i;
            const bw = r.w / 4;
            return (
              <g key={slot}>
                <rect x={bx} y={r.y} width={bw} height={r.h} className="vision__banner" />
                {(Object.keys(ICON_BOXES) as (keyof typeof ICON_BOXES)[]).map((k) => {
                  const b = ICON_BOXES[k];
                  return <rect key={k} x={bx + b.x * bw} y={r.y + b.y * r.h} width={b.w * bw} height={b.h * r.h} className={`vision__icon vision__icon--${k}`} />;
                })}
                <text x={bx + 3} y={r.y + r.h + 12} className="vision__label">
                  {number(slot)} {p?.name ?? '?'}
                </text>
                {(['weapon1', 'weapon2', 'gadget'] as const).map((field, line) => (
                  <text key={field} x={bx + 3} y={r.y + r.h + 24 + line * 12} className={`vision__label vision__eq vision__eq--${line}`}>
                    {p ? weaponName(p[field]) : '?'}
                  </text>
                ))}
              </g>
            );
          });
        })}

      {layers.minimap &&
        marks.map((s) => {
          const cx = mini.x + s.x * mini.w;
          const cy = mini.y + s.y * mini.h;
          const color = TEAM_COLOR[s.team];
          const doubtful = (s.confidence ?? 1) < 0.6;
          const a = ((s.angle ?? 0) * Math.PI) / 180;
          return (
            <g key={s.slot}>
              {s.alive ? (
                <>
                  <circle cx={cx} cy={cy} r={11} fill="none" stroke={doubtful ? '#ffd166' : '#35e07a'} strokeWidth={2} strokeDasharray={doubtful ? '3 3' : undefined} />
                  {s.angle !== null && <line x1={cx} y1={cy} x2={cx + Math.cos(a) * 24} y2={cy + Math.sin(a) * 24} stroke="#fff" strokeWidth={2.5} />}
                </>
              ) : (
                <path d={`M${cx - 7} ${cy - 7} L${cx + 7} ${cy + 7} M${cx + 7} ${cy - 7} L${cx - 7} ${cy + 7}`} stroke="#ff4d4d" strokeWidth={2.5} />
              )}
              <text x={cx + 13} y={cy - 9} className="vision__num" fill={color}>
                {number(s.slot)}
                {doubtful ? '?' : ''}
              </text>
            </g>
          );
        })}

      {layers.killfeed && (
        <g>
          <rect x={KILLFEED.x * width} y={KILLFEED.y * height} width={KILLFEED.w * width} height={KILLFEED.h * height} className="vision__zone vision__zone--kill" />
          {recent.map((k, i) => {
            const killer = k.kind === 'environment' ? 'décor' : k.killer === null ? 'tueur ?' : (nameOf.get(k.killer) ?? `n° ${number(k.killer)}`);
            const tag = k.kind === 'inferred' ? ' (déduit)' : '';
            const line = `${formatTime(k.t - (game?.start_s ?? 0))} ${killer}${tag} · ${k.stuff ?? k.weaponName ?? weaponName(k.weapon)} · ${nameOf.get(k.victim) ?? `n° ${number(k.victim)}`}`;
            return (
              <text key={`${k.t}-${k.victim}`} x={KILLFEED.x * width - 6} y={KILLFEED.y * height + 14 + i * 14} textAnchor="end" className="vision__label">
                {line}
              </text>
            );
          })}
        </g>
      )}
    </svg>
  );
}
