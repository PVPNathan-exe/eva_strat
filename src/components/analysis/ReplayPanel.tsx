// Replay des positions d'une game sur le plan de sa carte.
// Le temps suit la vidéo, ou une horloge propre (lecture, vitesse) pour rejouer sans la vidéo.
// Les positions sont normalisées sur la minimap du jeu : un cadre réglable (par carte) les ramène sur l'image du plan.

import { useEffect, useMemo, useRef, useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { builtinMaps } from '../../lib/builtinMaps';
import { formatTime } from '../../lib/timeline';
import { getVideoElement } from '../../lib/videoRef';
import { useAnalysisStore } from '../../store/analysisStore';
import type { Game, Sample } from '../../types/analysis';

const TEAM_COLOR = { A: '#ff9f1c', B: '#3d8bff' } as const;
const RATES = [0.5, 1, 2, 4, 8];
const TRAIL_S = 12;
const MAX_JUMP = 0.3; // au-delà, pas d'interpolation ni de trait (réapparition)
const MAX_GAP_S = 2.5; // trou entre deux lectures au-delà duquel on ne relie plus les points

// Cadre de la minimap dans l'image du plan (fractions des bords). Réglable, mémorisé par carte.
type Inset = { l: number; t: number; r: number; b: number };
const DEFAULT_INSET: Inset = { l: 0.01, t: 0.022, r: 0.01, b: 0.045 };

const insetKey = (map: string) => `eva_strat:replay-inset:${map}`;

function loadInset(map: string): Inset {
  try {
    const raw = localStorage.getItem(insetKey(map));
    if (raw) return { ...DEFAULT_INSET, ...(JSON.parse(raw) as Partial<Inset>) };
  } catch {
    // stockage indisponible : valeur par défaut
  }
  return DEFAULT_INSET;
}

const numberOfSlot = (slot: number) => (slot <= 4 ? slot : slot + 1);

interface Frame {
  t: number;
  bySlot: Map<number, Sample>;
}

function groupFrames(samples: Sample[]): Frame[] {
  const frames = new Map<number, Frame>();
  for (const s of samples) {
    let f = frames.get(s.frame);
    if (!f) frames.set(s.frame, (f = { t: s.t, bySlot: new Map() }));
    f.bySlot.set(s.slot, s);
  }
  return [...frames.values()].sort((a, b) => a.t - b.t);
}

function frameIndexAt(frames: Frame[], t: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

interface Shown {
  slot: number;
  team: 'A' | 'B';
  x: number;
  y: number;
  angle: number | null;
  alive: boolean;
  confidence: number | null;
}

/** Angle intermédiaire par le plus court chemin (359° -> 1° ne fait pas le tour). */
function lerpAngle(a: number, b: number, k: number): number {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return (a + d * k + 360) % 360;
}

function shownAt(frames: Frame[], t: number): Shown[] {
  if (frames.length === 0) return [];
  const i = frameIndexAt(frames, t);
  const a = frames[i];
  const b = frames[i + 1];
  const k = b && b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
  const out: Shown[] = [];
  for (const [slot, s] of a.bySlot) {
    let { x, y } = s;
    let angle = s.angle;
    const n = b?.bySlot.get(slot);
    if (n && s.alive && n.alive && n.t - s.t <= MAX_GAP_S && Math.hypot(n.x - s.x, n.y - s.y) < MAX_JUMP) {
      x = s.x + (n.x - s.x) * k;
      y = s.y + (n.y - s.y) * k;
      if (s.angle !== null && n.angle !== null) angle = lerpAngle(s.angle, n.angle, k);
    }
    out.push({ slot, team: s.team, x, y, angle, alive: !!s.alive, confidence: s.confidence });
  }
  return out;
}

export function ReplayPanel({ game, large = false }: { game: Game; large?: boolean }) {
  const currentTime = useAnalysisStore((s) => s.currentTime);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [t, setT] = useState(game.start_s);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [trails, setTrails] = useState(false);
  const [weaponNames, setWeaponNames] = useState<Record<string, string>>({});
  const [labels, setLabels] = useState(large); // pseudos affichés d'emblée dans la vue agrandie
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const [inset, setInset] = useState<Inset>(() => loadInset(game.map ?? ''));
  const raf = useRef(0);
  // Position de la vidéo lue à chaque image affichée (et non toutes les ~250 ms comme l'événement timeupdate) : mouvement continu.
  const [live, setLive] = useState<number | null>(null);

  const requestSeek = useAnalysisStore((s) => s.requestSeek);
  const nameOf = useMemo(() => new Map(game.players.map((p) => [p.slot, p.name])), [game.players]);
  const plan = useMemo(() => builtinMaps.find((m) => m.name === game.map), [game.map]);
  const frames = useMemo(() => (samples ? groupFrames(samples) : []), [samples]);

  useEffect(() => {
    analysisApi
      .weapons()
      .then((list) => setWeaponNames(Object.fromEntries(list.filter((w) => w.name).map((w) => [w.id, w.name]))))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    analysisApi
      .samples(game.id)
      .then((rows) => !cancelled && (setSamples(rows), setError(null)))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [game.id, game.samples]);

  useEffect(() => {
    if (!follow) return;
    let id = 0;
    const tick = () => {
      const el = getVideoElement();
      if (el) setLive((prev) => (prev === el.currentTime ? prev : el.currentTime));
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [follow]);

  // Horloge propre : avance en temps réel × vitesse, s'arrête à la fin de la game.
  useEffect(() => {
    if (!playing || follow) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((cur) => {
        const next = cur + dt * rate;
        if (next >= game.end_s) {
          setPlaying(false);
          return game.end_s;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, follow, rate, game.end_s]);

  const time = follow ? Math.min(Math.max(live ?? currentTime, game.start_s), game.end_s) : t;
  const shown = useMemo(() => shownAt(frames, time).filter((p) => !hidden.has(p.slot)), [frames, time, hidden]);

  const trailPaths = useMemo(() => {
    if (!trails || frames.length === 0) return [];
    // Une traînée s'interrompt à une mort, une disparition (combat, pastille cachée) ou une réapparition :
    // on ne relie jamais deux points séparés, sinon le trait traverserait les murs.
    const i = frameIndexAt(frames, time);
    const out: { key: string; team: 'A' | 'B'; points: string }[] = [];
    const slots = new Set<number>();
    for (let j = i; j >= 0 && frames[j].t >= time - TRAIL_S; j--) for (const s of frames[j].bySlot.keys()) slots.add(s);
    for (const slot of slots) {
      let run: string[] = [];
      let prev: Sample | null = null;
      let team: 'A' | 'B' = slot <= 4 ? 'A' : 'B';
      let n = 0;
      const flush = () => {
        if (run.length > 1) out.push({ key: `${slot}-${n++}`, team, points: run.join(' ') });
        run = [];
      };
      for (let j = Math.max(0, frameIndexAt(frames, time - TRAIL_S)); j <= i; j++) {
        const s = frames[j].bySlot.get(slot);
        if (!s || !s.alive || hidden.has(slot)) {
          flush();
          prev = null;
          continue;
        }
        if (prev && (s.t - prev.t > MAX_GAP_S || Math.hypot(s.x - prev.x, s.y - prev.y) > MAX_JUMP)) flush();
        team = s.team;
        const p = pos(inset, s.x, s.y);
        run.push(`${p.x},${p.y}`);
        prev = s;
      }
      flush();
    }
    return out;
  }, [trails, frames, time, hidden, inset]);

  const slotsPresent = useMemo(() => {
    const set = new Set<number>();
    for (const f of frames) for (const s of f.bySlot.keys()) set.add(s);
    return [...set].sort((a, b) => a - b);
  }, [frames]);

  const changeInset = (patch: Partial<Inset>) => {
    const next = { ...inset, ...patch };
    setInset(next);
    try {
      if (game.map) localStorage.setItem(insetKey(game.map), JSON.stringify(next));
    } catch {
      // stockage indisponible : le réglage vaut pour cette session seulement
    }
  };

  const seek = (value: number) => {
    setFollow(false);
    setPlaying(false);
    setT(value);
  };

  const togglePlay = () => {
    if (follow) {
      setFollow(false);
      setT(time >= game.end_s - 0.5 ? game.start_s : time);
      setPlaying(true);
    } else {
      if (!playing && t >= game.end_s - 0.5) setT(game.start_s);
      setPlaying(!playing);
    }
  };

  if (error) return <p className="games__error">{error}</p>;
  if (samples === null) return <p className="games__empty">Chargement des positions…</p>;
  if (frames.length === 0) return <p className="games__empty">Aucune position lue pour cette game. Lance « Analyser ».</p>;

  return (
    <div className={`replay${large ? ' replay--large' : ''}`}>
      <div className="replay__stage">
        {plan ? <img src={plan.src} alt={`Plan ${plan.name}`} draggable={false} /> : <div className="replay__noplan" />}
        {trails && (
          <svg className="replay__trails" viewBox="0 0 100 100" preserveAspectRatio="none">
            {trailPaths.map((p) => (
              <polyline key={p.key} points={p.points} fill="none" stroke={TEAM_COLOR[p.team]} strokeWidth={2} vectorEffect="non-scaling-stroke" opacity={0.7} />
            ))}
          </svg>
        )}
        {shown.map((p) => {
          const { x, y } = pos(inset, p.x, p.y);
          return (
            <div
              key={p.slot}
              className={`replay__dot${p.alive ? '' : ' is-dead'}${(p.confidence ?? 1) < 0.5 ? ' is-unsure' : ''}`}
              style={{ left: `${x}%`, top: `${y}%`, ['--c' as string]: TEAM_COLOR[p.team] }}
              title={`${nameOf.get(p.slot) ?? 'Joueur'} · n° ${numberOfSlot(p.slot)}${p.alive ? '' : ' (mort)'}${p.confidence !== null && p.confidence < 1 ? ` · identité ${Math.round(p.confidence * 100)} %` : ''}`}
            >
              {p.alive && p.angle !== null && <i className="replay__dir" style={{ transform: `rotate(${p.angle}deg)` }} />}
              <b>{p.alive ? numberOfSlot(p.slot) : '✕'}</b>
              {labels && nameOf.get(p.slot) && <em className="replay__name">{nameOf.get(p.slot)}</em>}
            </div>
          );
        })}
        {!plan && <p className="replay__hint">Choisis la carte de la game pour afficher son plan.</p>}
      </div>

      <div className="replay__bar">
        <button onClick={togglePlay} title={follow ? 'Rejouer sans la vidéo' : playing ? 'Pause' : 'Lecture'}>
          {!follow && playing ? '⏸' : '▶'}
        </button>
        <input
          type="range"
          min={game.start_s}
          max={game.end_s}
          step={0.1}
          value={time}
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="replay__time">
          {formatTime(time - game.start_s)} / {formatTime(game.end_s - game.start_s)}
        </span>
        <select value={rate} onChange={(e) => setRate(Number(e.target.value))} disabled={follow}>
          {RATES.map((r) => (
            <option key={r} value={r}>{r}×</option>
          ))}
        </select>
      </div>

      <div className="replay__opts">
        <label>
          <input type="checkbox" checked={follow} onChange={(e) => { setFollow(e.target.checked); setPlaying(false); setT(time); }} />
          Suivre la vidéo
        </label>
        <label>
          <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} />
          Pseudos
        </label>
        <label>
          <input type="checkbox" checked={trails} onChange={(e) => setTrails(e.target.checked)} />
          Traînées
        </label>
      </div>

      <div className="replay__legend">
        {slotsPresent.map((slot) => (
          <button
            key={slot}
            className={hidden.has(slot) ? 'is-off' : ''}
            style={{ ['--c' as string]: TEAM_COLOR[slot <= 4 ? 'A' : 'B'] }}
            onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(slot)) n.delete(slot); else n.add(slot); return n; })}
            title={`${nameOf.get(slot) ?? 'Joueur'} · n° ${numberOfSlot(slot)} : afficher / masquer`}
          >
            {numberOfSlot(slot)}
          </button>
        ))}
      </div>

      {game.kills.length > 0 && (
        <div className="replay__kills">
          <strong>Kills ({game.kills.length})</strong>
          <ul>
            {game.kills.map((k) => (
              <li key={`${k.t}-${k.victim}`} className={Math.abs(time - k.t) < 3 ? 'is-now' : ''}>
                <button onClick={() => { setFollow(true); setPlaying(false); requestSeek(Math.max(game.start_s, k.t - 2)); }} title="Aller à ce kill dans la vidéo">
                  {formatTime(k.t - game.start_s)}
                </button>
                {k.killer === null ? (
                  <span className="kill__env" title="Aucun tueur dans le killfeed : mort du décor ou action d'un admin">décor</span>
                ) : k.killer === k.victim ? (
                  <span className="kill__env" title="Même pseudo des deux côtés">suicide</span>
                ) : (
                  <span style={{ color: TEAM_COLOR[k.killer > 4 ? 'B' : 'A'] }}>{nameOf.get(k.killer) ?? `n° ${numberOfSlot(k.killer)}`}</span>
                )}
                <i title={weaponNames[k.weapon ?? ''] ?? k.weapon ?? 'arme inconnue'}>{k.weapon ? (weaponNames[k.weapon] ?? k.weapon) : '·'}{k.headshot ? ' 🎯' : ''}</i>
                <span style={{ color: TEAM_COLOR[k.victim > 4 ? 'B' : 'A'] }}>{nameOf.get(k.victim) ?? `n° ${numberOfSlot(k.victim)}`}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <details className="replay__align">
        <summary>Alignement sur le plan</summary>
        {(['l', 't', 'r', 'b'] as const).map((k) => (
          <label key={k}>
            {{ l: 'Gauche', t: 'Haut', r: 'Droite', b: 'Bas' }[k]}
            <input type="range" min={-0.05} max={0.2} step={0.002} value={inset[k]} onChange={(e) => changeInset({ [k]: Number(e.target.value) })} />
          </label>
        ))}
        <button onClick={() => changeInset(DEFAULT_INSET)}>Réinitialiser</button>
      </details>
    </div>
  );
}

function pos(inset: Inset, x: number, y: number) {
  return { x: (inset.l + x * (1 - inset.l - inset.r)) * 100, y: (inset.t + y * (1 - inset.t - inset.b)) * 100 };
}
