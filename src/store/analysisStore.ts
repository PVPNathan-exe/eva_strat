// État de l'onglet Analyse (non persisté : tout vient de la base via l'API).
// Le futur éditeur de stratégie temps réel se branchera sur currentTime / selectedGameId.

import { create } from 'zustand';
import { analysisApi, subscribeJob } from '../lib/analysisApi';
import type { Game, JobEvent, Video } from '../types/analysis';

export interface JobState {
  running: boolean;
  jobId: string | null;
  paused: boolean;
  stage: 'download' | 'detect' | 'maps' | null;
  pct: number;
  error: string | null;
  message: string | null;
}

interface AnalysisState {
  videos: Video[];
  videoId: number | null;
  games: Game[];
  selectedGameId: number | null;
  currentTime: number;
  pendingStart: number | null;
  seekRequest: { t: number; nonce: number } | null;
  job: JobState;
  loadVideos: () => Promise<void>;
  selectVideo: (id: number | null) => Promise<void>;
  refreshGames: () => Promise<void>;
  selectGame: (id: number | null) => void;
  setCurrentTime: (t: number) => void;
  setPendingStart: (t: number | null) => void;
  requestSeek: (t: number) => void;
  controlJob: (action: 'pause' | 'resume' | 'stop') => Promise<void>;
  startIngest: (source: string, options?: { preRoll?: number; postRoll?: number; skipIfOk?: boolean }) => Promise<void>;
}

const idleJob: JobState = { running: false, jobId: null, paused: false, stage: null, pct: 0, error: null, message: null };

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  videos: [],
  videoId: null,
  games: [],
  selectedGameId: null,
  currentTime: 0,
  pendingStart: null,
  seekRequest: null,
  job: idleJob,

  loadVideos: async () => {
    const videos = await analysisApi.videos();
    set({ videos });
    if (get().videoId === null && videos.length > 0) await get().selectVideo(videos[0].id);
  },

  selectVideo: async (id) => {
    set({ videoId: id, games: [], selectedGameId: null, currentTime: 0, pendingStart: null });
    if (id !== null) await get().refreshGames();
  },

  refreshGames: async () => {
    const requested = get().videoId;
    if (requested === null) return;
    const games = await analysisApi.games(requested);
    // Réponse ignorée si l'utilisateur a changé de vidéo entre-temps.
    if (get().videoId === requested) set({ games });
  },

  selectGame: (id) => set({ selectedGameId: id }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setPendingStart: (t) => set({ pendingStart: t }),
  requestSeek: (t) => set({ seekRequest: { t, nonce: Date.now() } }),

  controlJob: async (action) => {
    const { jobId, running } = get().job;
    if (!jobId || !running) return;
    try {
      await analysisApi.jobControl(jobId, action);
      if (action !== 'stop') set({ job: { ...get().job, paused: action === 'pause' } });
    } catch (err) {
      set({ job: { ...get().job, error: (err as Error).message } });
    }
  },

  startIngest: async (source, { preRoll, postRoll, skipIfOk } = {}) => {
    set({ job: { ...idleJob, running: true } });
    try {
      const { jobId } = await analysisApi.ingest(source, { preRoll, postRoll, skipIfOk });
      set({ job: { ...get().job, jobId } });
      subscribeJob(jobId, (e: JobEvent) => {
        if (e.event === 'progress') {
          set({ job: { running: true, jobId, paused: get().job.paused, stage: e.stage ?? null, pct: e.pct ?? 0, error: null, message: null } });
        } else if (e.event === 'done') {
          set({ job: { ...idleJob, message: e.message ?? 'Vidéo chargée' } });
          void get()
            .loadVideos()
            .then(() => (e.video_id ? get().selectVideo(e.video_id) : undefined))
            .catch((err: Error) => set({ job: { ...idleJob, error: err.message } }));
        } else {
          set({ job: { ...idleJob, error: e.message ?? 'Erreur inconnue' } });
        }
      });
    } catch (err) {
      set({ job: { ...idleJob, error: (err as Error).message } });
    }
  },
}));
