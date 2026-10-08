// Barre du haut : source (chemin .mp4 ou URL YouTube), bouton Analyser, progression,
// et choix de la vidéo déjà analysée.

import { useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { useAnalysisStore } from '../../store/analysisStore';

const STAGE_LABEL = { download: 'Téléchargement', detect: 'Détection des games', maps: 'Lecture des cartes' } as const;

export function IngestBar() {
  const [source, setSource] = useState('');
  const [picking, setPicking] = useState(false);
  const [preRoll, setPreRoll] = useState(3);
  const [postRoll, setPostRoll] = useState(1);
  const [pickError, setPickError] = useState<string | null>(null);
  const videos = useAnalysisStore((s) => s.videos);
  const videoId = useAnalysisStore((s) => s.videoId);
  const currentVideo = videos.find((v) => v.id === videoId);
  const job = useAnalysisStore((s) => s.job);
  const selectVideo = useAnalysisStore((s) => s.selectVideo);
  const startIngest = useAnalysisStore((s) => s.startIngest);

  // Champ vide : on réanalyse la vidéo choisie dans le sélecteur.
  const target = source.trim() || currentVideo?.path || '';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (target && !job.running) void startIngest(target, { preRoll, postRoll, skipIfOk: true });
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
          title={source.trim() ? 'Charge et analyse ce fichier ou cette URL' : "Analyse la vidéo choisie (rien n'est relu si toutes ses games sont déjà vérifiées)"}
        >
          Analyser
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

      {videoId !== null && currentVideo && (
        <button
          title="Relit le chrono de la vidéo choisie et propose les games (tes games confirmées ne sont jamais modifiées)"
          disabled={job.running}
          onClick={() => void startIngest(currentVideo.path, { preRoll, postRoll, skipIfOk: true })}
        >
          Détecter les games
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
              <span>{STAGE_LABEL[job.stage]}… {Math.round(job.pct)} %</span>
              <progress value={job.pct} max={100} />
            </>
          ) : (
            <span>Lecture du fichier…</span>
          )}
        </div>
      )}
      {pickError && <span className="ingest__error">{pickError}</span>}
      {job.error && <span className="ingest__error">{job.error}</span>}
      {job.message && !job.running && <span className="ingest__ok">{job.message}</span>}
    </div>
  );
}
