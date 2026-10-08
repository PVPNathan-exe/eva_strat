// État de l'onglet Analyse (non persisté : tout vient de la base via l'API).
// Le futur éditeur de stratégie temps réel se branchera sur currentTime / selectedGameId.

import { create } from 'zustand';
import { analysisApi, subscribeJob } from '../lib/analysisApi';
import type { CommentTag, Game, JobEvent, Video, VideoComment, Weapon } from '../types/analysis';
import { canonicalName } from '../lib/weaponCatalog';

// Icônes pour lesquelles l'invite de nom a déjà été fermée (« Plus tard ») : on ne redemande pas avant la prochaine analyse qui en trouve de nouvelles.
const dismissedWeapons = new Set<string>();

export interface JobState {
  running: boolean;
  jobId: string | null;
  paused: boolean;
  stage: 'download' | 'detect' | 'maps' | 'names' | 'loadout' | 'capture' | 'kills' | 'positions' | null;
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
  comments: VideoComment[];
  loadComments: () => Promise<void>;
  addComment: (t: number, text: string, tag: CommentTag, slots: number[]) => Promise<void>;
  updateComment: (id: number, patch: Partial<{ text: string; tag: CommentTag; resolved: boolean; slots: number[] }>) => Promise<void>;
  removeComment: (id: number) => Promise<void>;
  weapons: Weapon[] | null;
  weaponPromptOpen: boolean;
  loadWeapons: (promptIfNew?: boolean) => Promise<void>;
  nameWeapon: (id: string, name: string) => Promise<void>;
  closeWeaponPrompt: () => void;
  loadVideos: () => Promise<void>;
  selectVideo: (id: number | null) => Promise<void>;
  refreshGames: () => Promise<void>;
  selectGame: (id: number | null) => void;
  setCurrentTime: (t: number) => void;
  setPendingStart: (t: number | null) => void;
  requestSeek: (t: number) => void;
  /** Ouvre l'onglet Analyse sur une vidéo, une game et un instant (depuis l'onglet Armes). */
  openAt: (videoId: number, gameId: number, t: number) => Promise<void>;
  viewRequest: { view: 'analyse'; nonce: number } | null;
  controlJob: (action: 'pause' | 'resume' | 'stop') => Promise<void>;
  resumeJob: () => Promise<void>;
  startIngest: (source: string, options?: { preRoll?: number; postRoll?: number; skipIfOk?: boolean; withPositions?: boolean; posEvery?: number }) => Promise<void>;
}

const idleJob: JobState = { running: false, jobId: null, paused: false, stage: null, pct: 0, error: null, message: null };

export const useAnalysisStore = create<AnalysisState>((set, get) => {
  const watchJob = (jobId: string) =>
    subscribeJob(jobId, (e: JobEvent) => {
      if (e.event === 'progress') {
        set({ job: { running: true, jobId, paused: get().job.paused, stage: e.stage ?? null, pct: e.pct ?? 0, error: null, message: null } });
      } else if (e.event === 'done') {
        set({ job: { ...idleJob, message: e.message ?? 'Vidéo chargée' } });
        void get()
          .loadVideos()
          .then(() => (e.video_id ? get().selectVideo(e.video_id) : undefined))
          .then(() => get().loadWeapons(true))
          .catch((err: Error) => set({ job: { ...idleJob, error: err.message } }));
      } else {
        set({ job: { ...idleJob, error: e.message ?? 'Erreur inconnue' } });
      }
    });

  return {
  videos: [],
  videoId: null,
  games: [],
  selectedGameId: null,
  currentTime: 0,
  pendingStart: null,
  seekRequest: null,
  job: idleJob,
  weapons: null,
  weaponPromptOpen: false,
  comments: [],

  loadComments: async () => {
    const requested = get().videoId;
    if (requested === null) return set({ comments: [] });
    const comments = await analysisApi.comments(requested);
    if (get().videoId === requested) set({ comments });
  },

  addComment: async (t, text, tag, slots) => {
    const videoId = get().videoId;
    if (videoId === null) return;
    await analysisApi.addComment(videoId, t, text, tag, slots);
    await get().loadComments();
  },

  updateComment: async (id, patch) => {
    await analysisApi.patchComment(id, patch);
    await get().loadComments();
  },

  removeComment: async (id) => {
    await analysisApi.deleteComment(id);
    await get().loadComments();
  },

  // Liste des icônes d'armes. Après une analyse (promptIfNew), une fenêtre demande le nom de celles que le programme ne connaît pas.
  loadWeapons: async (promptIfNew = false) => {
    const list = await analysisApi.weapons();
    // Les noms déjà saisis qui correspondent à une arme de l'onglet Stratégie sont remis à son écriture (« spectre » -> « SPECTRE »).
    const fixes = list.filter((w) => w.name && !w.inferred && canonicalName(w.name) !== w.name);
    await Promise.all(fixes.map((w) => analysisApi.nameWeapon(w.id, canonicalName(w.name))));
    const weapons = list.map((w) => (w.name ? { ...w, name: canonicalName(w.name) } : w));
    const ask = promptIfNew && weapons.some((w) => !w.name && !dismissedWeapons.has(w.id));
    set({ weapons, weaponPromptOpen: ask ? true : get().weaponPromptOpen });
  },

  nameWeapon: async (id, name) => {
    const clean = canonicalName(name);
    await analysisApi.nameWeapon(id, clean);
    set({ weapons: (get().weapons ?? []).map((w) => (w.id === id ? { ...w, name: clean } : w)) });
    if (!(get().weapons ?? []).some((w) => !w.name)) set({ weaponPromptOpen: false });
    void get().refreshGames(); // les kills affichent le nom de l'arme : on les relit
  },

  closeWeaponPrompt: () => {
    for (const w of get().weapons ?? []) if (!w.name) dismissedWeapons.add(w.id);
    set({ weaponPromptOpen: false });
  },

  loadVideos: async () => {
    const videos = await analysisApi.videos();
    set({ videos });
    if (get().videoId === null && videos.length > 0) await get().selectVideo(videos[0].id);
  },

  selectVideo: async (id) => {
    set({ videoId: id, games: [], comments: [], selectedGameId: null, currentTime: 0, pendingStart: null });
    if (id !== null) {
      await get().refreshGames();
      void get().loadComments().catch(() => undefined);
    }
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
  viewRequest: null,
  openAt: async (videoId, gameId, t) => {
    if (get().videoId !== videoId) await get().selectVideo(videoId);
    set({ selectedGameId: gameId, viewRequest: { view: 'analyse', nonce: Date.now() } });
    get().requestSeek(t);
  },

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

  // Suit une analyse (en cours ou reprise après un rechargement de la page) : progression, fin, erreur.
  resumeJob: async () => {
    const { jobId, paused } = await analysisApi.currentJob();
    if (jobId && !get().job.running) {
      set({ job: { ...idleJob, running: true, jobId, paused } });
      watchJob(jobId);
    }
  },

  startIngest: async (source, { preRoll, postRoll, skipIfOk, withPositions, posEvery } = {}) => {
    set({ job: { ...idleJob, running: true } });
    try {
      const { jobId } = await analysisApi.ingest(source, { preRoll, postRoll, skipIfOk, positions: withPositions, posEvery });
      set({ job: { ...get().job, jobId } });
      watchJob(jobId);
    } catch (err) {
      set({ job: { ...idleJob, error: (err as Error).message } });
    }
  },
};
});
