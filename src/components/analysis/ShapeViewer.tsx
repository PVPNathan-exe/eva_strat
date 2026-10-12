// Forme des joueurs lue par le programme, dessinée sur la vraie minimap de la vidéo : un disque et sa pointe (le regard) à la position calculée. Si le contour ne colle pas
// à la pastille réelle, la position ou le regard est faux. Les contours rouges sont des positions que la vraie minimap ne confirme pas.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analysisApi, streamUrl } from '../../lib/analysisApi';
import { loadTinted, readingOf, type Rgb } from '../../lib/mapReading';
import { MARKER_RADIUS, pinOutline } from '../../lib/pinShape';
import { flagKey, unconfirmedSet } from '../../lib/replayFlags';
import { formatTime } from '../../lib/timeline';
import { useAnalysisStore } from '../../store/analysisStore';
import type { Game, GameFlags, Sample, Zone } from '../../types/analysis';
import { useGameFlags } from './useGameFlags';

const TEAM_COLOR = { A: '#ff9f1c', B: '#3d8bff' } as const;
const WIDTH = 920; // largeur du canevas en pixels (la minimap agrandie)
const RED: Rgb = [255, 59, 59];
const COHERENCE_LOW = 0.4; // en dessous, les directions lues se contredisent : regard incertain
const number = (slot: number) => (slot <= 4 ? slot : slot + 1);

interface Frame {
  t: number;
  frame: number;
  rows: Sample[];
}

function groupFrames(samples: Sample[]): Frame[] {
  const by = new Map<number, Frame>();
  for (const s of samples) {
    const f = by.get(s.frame) ?? { t: s.t, frame: s.frame, rows: [] };
    f.rows.push(s);
    by.set(s.frame, f);
  }
  return [...by.values()].sort((a, b) => a.t - b.t);
}

function nearestFrame(frames: Frame[], t: number): Frame | null {
  if (frames.length === 0) return null;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = frames[Math.max(lo - 1, 0)];
  const b = frames[lo];
  return Math.abs(a.t - t) <= Math.abs(b.t - t) ? a : b;
}

export function ShapeViewer({ game }: { game: Game }) {
  const videoId = game.video_id;
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [zone, setZone] = useState<Zone | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [time, setTime] = useState(game.start_s);
  const [playing, setPlaying] = useState(false);
  const [shapes, setShapes] = useState(true);
  const [corridors, setCorridors] = useState(false);
  const [showCoh, setShowCoh] = useState(true); // indice de cohérence du regard à côté du numéro
  const [mask, setMask] = useState<HTMLCanvasElement | null>(null);
  const { flags } = useGameFlags(game.id, game.map, game.samples);
  const setCurrentTime = useAnalysisStore((s) => s.setCurrentTime);
  const startTime = useAnalysisStore((s) => s.currentTime);

  useEffect(() => {
    analysisApi.calibration(game.map ?? '').then((c) => setZone(c.zones.minimap)).catch(() => setZone(null));
    analysisApi.samples(game.id).then(setSamples).catch(() => setSamples([]));
    const url = game.map ? readingOf(game.map).maskUrl : null;
    if (url) loadTinted(url, RED, 110).then(setMask).catch(() => setMask(null));
  }, [game.id, game.map]);

  const frames = useMemo(() => groupFrames(samples), [samples]);
  const unconfirmed = useMemo(() => unconfirmedSet(flags as GameFlags | null), [flags]);

  // Dessin : minimap agrandie de l'image courante de la vidéo, puis couloirs et formes lues.
  const draw = useCallback(() => {
    const cv = canvas.current;
    const v = video.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !v || !ctx || !zone || !v.videoWidth) return;
    const height = Math.round((WIDTH * zone.h * v.videoHeight) / (zone.w * v.videoWidth));
    if (cv.width !== WIDTH || cv.height !== height) {
      cv.width = WIDTH;
      cv.height = height;
    }
    ctx.drawImage(v, zone.x * v.videoWidth, zone.y * v.videoHeight, zone.w * v.videoWidth, zone.h * v.videoHeight, 0, 0, WIDTH, height);
    if (corridors && mask) ctx.drawImage(mask, 0, 0, WIDTH, height);
    if (!shapes) return;
    const f = nearestFrame(frames, v.currentTime);
    if (!f || Math.abs(f.t - v.currentTime) > 0.6) return;
    const radius = MARKER_RADIUS * WIDTH;
    for (const s of f.rows) {
      const cx = s.x * WIDTH;
      const cy = s.y * height;
      const bad = s.alive && unconfirmed.has(flagKey(f.frame, s.slot));
      if (!s.alive) {
        ctx.strokeStyle = '#ff3b3b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - radius, cy - radius);
        ctx.lineTo(cx + radius, cy + radius);
        ctx.moveTo(cx + radius, cy - radius);
        ctx.lineTo(cx - radius, cy + radius);
        ctx.stroke();
        continue;
      }
      const outline = pinOutline(cx, cy, radius, s.angle);
      ctx.beginPath();
      outline.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
      ctx.closePath();
      ctx.lineWidth = 2;
      const doubtfulGaze = s.gaze_coh !== null && s.gaze_coh !== undefined && s.gaze_coh < COHERENCE_LOW;
      ctx.strokeStyle = bad ? '#ff3b3b' : doubtfulGaze ? '#ffb454' : '#35e07a';
      ctx.setLineDash((s.confidence ?? 1) < 0.6 || doubtfulGaze ? [4, 3] : []);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = TEAM_COLOR[s.team];
      ctx.font = '700 15px system-ui, sans-serif';
      const coh = s.gaze_coh !== null && s.gaze_coh !== undefined ? ` ${Math.round(s.gaze_coh * 100)}` : '';
      ctx.fillText(`${number(s.slot)}${showCoh ? coh : ''}`, cx + radius + 3, cy - radius);
    }
  }, [zone, frames, shapes, corridors, mask, unconfirmed, showCoh]);

  useEffect(() => {
    draw();
  }, [draw, time]);

  // Lecture : on redessine à chaque image affichée.
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const tick = () => {
      const v = video.current;
      if (v) {
        setTime(v.currentTime);
        setCurrentTime(v.currentTime);
        draw();
      }
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, draw, setCurrentTime]);

  const seek = (t: number) => {
    const v = video.current;
    const clamped = Math.min(Math.max(t, game.start_s), game.end_s);
    if (v) v.currentTime = clamped;
    setTime(clamped);
    setCurrentTime(clamped);
  };

  // Au premier affichage on reprend l'instant courant de l'onglet Analyse s'il est dans la game.
  const started = useRef(false);
  const onLoaded = () => {
    if (started.current) return;
    started.current = true;
    seek(startTime >= game.start_s && startTime <= game.end_s ? startTime : game.start_s);
  };

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (playing) v.pause();
    else void v.play();
    setPlaying(!playing);
  };

  return (
    <div className="shapes">
      <video ref={video} className="shapes__video" src={streamUrl(videoId)} muted preload="auto" onLoadedMetadata={onLoaded} onSeeked={draw} />
      <canvas ref={canvas} className="shapes__canvas" />
      <div className="shapes__bar">
        <button onClick={toggle}>{playing ? 'Pause' : 'Lecture'}</button>
        <button onClick={() => seek(time - 1)}>-1 s</button>
        <button onClick={() => seek(time - 0.1)}>-0,1 s</button>
        <button onClick={() => seek(time + 0.1)}>+0,1 s</button>
        <button onClick={() => seek(time + 1)}>+1 s</button>
        <input type="range" min={game.start_s} max={game.end_s} step={0.1} value={time} onChange={(e) => seek(Number(e.target.value))} />
        <span className="shapes__time">{formatTime(time - game.start_s)}</span>
      </div>
      <div className="shapes__opts">
        <label><input type="checkbox" checked={shapes} onChange={(e) => setShapes(e.target.checked)} /> Formes lues (disque et pointe)</label>
        <label><input type="checkbox" checked={showCoh} onChange={(e) => setShowCoh(e.target.checked)} /> Indice de cohérence du regard (0 à 100)</label>
        <label><input type="checkbox" checked={corridors} onChange={(e) => setCorridors(e.target.checked)} /> Couloirs lus</label>
      </div>
      <p className="shapes__note">
        Contour vert : disque et pointe tels que le programme les a lus (pointillé : lecture peu sûre). Contour rouge : position que la vraie minimap ne confirme pas. Contour orange pointillé : regard incertain (les directions lues se contredisent, indice sous 40). Le nombre à côté du numéro est l'indice de cohérence du regard : mesuré, le regard lu est dans le cap pour 47 % des lignes sous 20, 66 % de 40 à 60 et 96 % au-dessus de 80.
        Croix rouge : joueur mort. Le contour doit recouvrir la pastille réelle et sa pointe doit viser dans le même sens que le triangle de la pastille.
      </p>
    </div>
  );
}
