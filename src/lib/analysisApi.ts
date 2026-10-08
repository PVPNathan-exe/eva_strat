// Appels HTTP vers le plugin Vite (/api). Les erreurs du serveur remontent en Error(message).

import type { CaptureSeries, CommentTag, Correction, Game, JobEvent, Sample, Video, VideoComment, Weapon, Zones } from '../types/analysis';

async function parse<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Erreur serveur (${res.status})`);
  return data as T;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const weaponIconUrl = (id: string) => `/api/weapons/${id}/icon`;
export const streamUrl = (videoId: number) => `/api/videos/${videoId}/stream`;

export const analysisApi = {
  videos: () => fetch('/api/videos').then(parse<Video[]>),
  games: (videoId: number) => fetch(`/api/games?video=${videoId}`).then(parse<Game[]>),
  weapons: () => fetch('/api/weapons', { cache: 'no-store' }).then(parse<Weapon[]>),
  nameWeapon: (id: string, name: string) => fetch(`/api/weapons/${id}`, jsonInit('PUT', { name })).then(parse<{ ok: true }>),
  capture: (gameId: number) => fetch(`/api/capture?game=${gameId}`, { cache: 'no-store' }).then(parse<CaptureSeries>),
  corrections: (gameId: number) => fetch(`/api/corrections?game=${gameId}`, { cache: 'no-store' }).then(parse<Correction[]>),
  swapPlayers: (gameId: number, slotA: number, slotB: number, t0: number, t1: number) =>
    fetch('/api/corrections', jsonInit('POST', { game_id: gameId, slot_a: slotA, slot_b: slotB, t0, t1 })).then(parse<{ id: number }>),
  undoCorrection: (id: number) => fetch(`/api/corrections/${id}`, { method: 'DELETE' }).then(parse<{ ok: true }>),
  comments: (videoId: number) => fetch(`/api/comments?video=${videoId}`, { cache: 'no-store' }).then(parse<VideoComment[]>),
  addComment: (videoId: number, t: number, text: string, tag: CommentTag, slots: number[]) =>
    fetch('/api/comments', jsonInit('POST', { video_id: videoId, t, text, tag, slots })).then(parse<{ id: number }>),
  patchComment: (id: number, patch: Partial<{ text: string; tag: CommentTag; resolved: boolean; slots: number[] }>) =>
    fetch(`/api/comments/${id}`, jsonInit('PATCH', patch)).then(parse<{ ok: true }>),
  deleteComment: (id: number) => fetch(`/api/comments/${id}`, { method: 'DELETE' }).then(parse<{ ok: true }>),
  samples: (gameId: number) => fetch(`/api/samples?game=${gameId}`).then(parse<Sample[]>),
  createGame: (videoId: number, start: number, end: number, map?: string) =>
    fetch('/api/games', jsonInit('POST', { video_id: videoId, start_s: start, end_s: end, map })).then(parse<{ id: number }>),
  patchGame: (id: number, patch: Partial<Pick<Game, 'start_s' | 'end_s' | 'map' | 'status' | 'winner'>>) =>
    fetch(`/api/games/${id}`, jsonInit('PATCH', patch)).then(parse<{ ok: true }>),
  deleteGame: (id: number) => fetch(`/api/games/${id}`, { method: 'DELETE' }).then(parse<{ ok: true }>),
  calibration: (map: string) =>
    fetch(`/api/calibrations?map=${encodeURIComponent(map)}`).then(parse<{ map: string; zones: Zones; isDefault: boolean }>),
  saveCalibration: (map: string, zones: Zones) =>
    fetch('/api/calibrations', jsonInit('PUT', { map, zones })).then(parse<{ ok: true }>),
  currentJob: () => fetch('/api/jobs/current', { cache: 'no-store' }).then(parse<{ jobId: string | null; paused: boolean }>),
  ingest: (source: string, options: { detect?: boolean; preRoll?: number; postRoll?: number; skipIfOk?: boolean; positions?: boolean; posEvery?: number } = {}) =>
    fetch('/api/ingest', jsonInit('POST', { source, ...options })).then(parse<{ jobId: string }>),
  jobControl: (jobId: string, action: 'pause' | 'resume' | 'stop') =>
    fetch(`/api/jobs/${jobId}/${action}`, jsonInit('POST', {})).then(parse<{ ok: true }>),
  pickFile: () => fetch('/api/pick-file', jsonInit('POST', {})).then(parse<{ path: string | null }>),
};

/** Suit un job d'analyse en SSE. Renvoie la fonction pour fermer la connexion. */
export function subscribeJob(jobId: string, onEvent: (e: JobEvent) => void): () => void {
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.onmessage = (msg) => {
    const event = JSON.parse(msg.data) as JobEvent;
    onEvent(event);
    if (event.event === 'done' || event.event === 'error') source.close();
  };
  source.onerror = () => {
    source.close();
    onEvent({ event: 'error', message: 'Connexion au serveur perdue' });
  };
  return () => source.close();
}
