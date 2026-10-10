// Barre du haut : source (chemin .mp4 ou URL YouTube), bouton « Détecter les games » (première étape : repérer les games par le chrono),
// progression, et choix de la vidéo déjà chargée. L'analyse détaillée se lance ensuite depuis le panneau « Analyse détaillée » (AnalysisPlan).

import { useState } from 'react';
import { Pause, Play, Square } from 'lucide-react';
import { analysisApi } from '../../lib/analysisApi';
import { useAnalysisStore } from '../../store/analysisStore';

const STAGE_LABEL = { download: 'Téléchargement', detect: 'Détection des games', maps: 'Lecture des cartes', names: 'Lecture des pseudos', loadout: 'Lecture des équipements', capture: 'Lecture des scores', kills: 'Lecture du killfeed', positions: 'Positions des joueurs' } as const;

export function IngestBar() {
  const [source, setSource] = useState('');
  const [picking, setPicking] = useState(false);
  const { preRoll, postRoll, posEvery } = useAnalysisStore((st) => st.options);
  const setOptions = useAnalysisStore((st) => st.setOptions);
  const setPreRoll = (v: number) => setOptions({ preRoll: v });
  const setPostRoll = (v: number) => setOptions({ postRoll: v });
  const setPosEvery = (v: number) => setOptions({ posEvery: v });
  const [pickError, setPickError] = useState<string | null>(null);
  const videos = useAnalysisStore((s) => s.videos);
  const videoId = useAnalysisStore((s) => s.videoId);
  const currentVideo = videos.find((v) => v.id === videoId);
  const job = useAnalysisStore((s) => s.job);
  const selectVideo = useAnalysisStore((s) => s.selectVideo);
  const startIngest = useAnalysisStore((s) => s.startIngest);
  const controlJob = useAnalysisStore((s) => s.controlJob);

  // Champ vide : on reprend la vidéo choisie dans le sélecteur. Un champ rempli désigne toujours un NOUVEAU fichier (ou un autre déjà connu).
  const target = source.trim() || currentVideo?.path || '';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (target && !job.running) void startIngest(target, { preRoll, postRoll, skipIfOk: true, detectOnly: true });
  };

  const browse = async () => {
    setPicking(true);
    setPickError(null);
    try {
      const { path } = await analysisApi.pickFile();
      if (path) setSource(path);
    } catch (err) {
      setPickError((err as Error).message);
    } finally {
      setPicking(false);
    }
  };

  return (
    <div className="ingest">
      <form className="ingest__form" onSubmit={submit}>
        <button type="button" onClick={() => void browse()} disabled={job.running || picking}>
          {picking ? 'Sélection…' : 'Parcourir…'}
        </button>
        <input
          className="ingest__input"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Colle un chemin .mp4 ou une URL YouTube, ou clique sur Parcourir"
          disabled={job.running || picking}
        />
        <button
          type="submit"
          disabled={job.running || !target}
          title="Repère les games par le chrono. Rien n'est relu si la vidéo a déjà ses games : tu confirmes ensuite les bornes et tu choisis quoi analyser dans « Analyse détaillée ». Champ vide : vidéo choisie."
        >
          Détecter les games
        </button>
      </form>

      <div className="ingest__row">
          <label className="ingest__single" title="Secondes gardées avant le départ du chrono (compte à rebours)">
            Avant
            <input
              className="ingest__preroll"
              type="number"
              min={0}
              max={60}
              step={0.5}
              value={preRoll}
              onChange={(e) => setPreRoll(Math.min(60, Math.max(0, Number(e.target.value) || 0)))}
              disabled={job.running}
            />
            s
          </label>
          <label className="ingest__single" title="Secondes gardées après la fin du chrono (écran de victoire)">
            Après
            <input
              className="ingest__preroll"
              type="number"
              min={0}
              max={120}
              step={0.5}
              value={postRoll}
              onChange={(e) => setPostRoll(Math.min(120, Math.max(0, Number(e.target.value) || 0)))}
              disabled={job.running}
            />
            s
          </label>
          <label className="ingest__single" title="Une lecture de la minimap toutes les N images de la vidéo : 6 = 5 par seconde à 30 i/s. Moins = plus précis (replay plus fluide, analyse plus longue).">
            Positions : toutes les
            <input
              className="ingest__preroll"
              type="number"
              min={1}
              max={60}
              step={1}
              value={posEvery}
              onChange={(e) => setPosEvery(Math.min(60, Math.max(1, Math.round(Number(e.target.value)) || 1)))}
              disabled={job.running}
            />
            frames
          </label>

      {videoId !== null && currentVideo && (
        <button
          title="Refait la détection de cette vidéo avec les réglages Avant / Après ci-contre. Les games dont les bornes ne changent pas gardent leur analyse ; tes games confirmées ne sont jamais modifiées."
          disabled={job.running}
          onClick={() => void startIngest(currentVideo.path, { preRoll, postRoll, skipIfOk: true, detectOnly: true, redetect: true })}
        >
          Refaire la détection
        </button>
      )}

      {videos.length > 0 && (
        <select value={videoId ?? ''} onChange={(e) => void selectVideo(Number(e.target.value))}>
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.path.split(/[\\/]/).pop()}
            </option>
          ))}
        </select>
      )}
      </div>

      {job.running && (
        <div className="ingest__progress">
          {job.stage ? (
            <>
              <span>
                {job.gameCount > 0 ? `Game ${job.gameIndex} sur ${job.gameCount} · ` : ''}
                {job.paused ? 'En pause' : `${STAGE_LABEL[job.stage]}…`} {Math.round(job.pct)} %
              </span>
              <progress value={job.pct} max={100} />
            </>
          ) : (
            <span>Lecture du fichier…</span>
          )}
          <button disabled={!job.jobId} onClick={() => void controlJob(job.paused ? 'resume' : 'pause')}>
            {job.paused ? <Play className="ic" /> : <Pause className="ic" />} {job.paused ? 'Reprendre' : 'Pause'}
          </button>
          <button className="ingest__stop" onClick={() => void controlJob('stop')}>
            <Square className="ic" /> Arrêter
          </button>
        </div>
      )}
      {pickError && <span className="ingest__error">{pickError}</span>}
      {job.error && <span className="ingest__error">{job.error}</span>}
      {job.message && !job.running && <span className="ingest__ok">{job.message}</span>}
    </div>
  );
}
