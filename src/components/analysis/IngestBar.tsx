// Barre du haut : source (chemin .mp4 ou URL YouTube), bouton Analyser, progression,
// et choix de la vidéo déjà analysée.

import { useState } from 'react';
import { analysisApi } from '../../lib/analysisApi';
import { useAnalysisStore } from '../../store/analysisStore';

const STAGE_LABEL = { download: 'Téléchargement', detect: 'Détection des games' } as const;

export function IngestBar() {
  const [source, setSource] = useState('');
  const [picking, setPicking] = useState(false);
  const [singleGame, setSingleGame] = useState(false);
  const [preRoll, setPreRoll] = useState(3);
  const [pickError, setPickError] = useState<string | null>(null);
  const videos = useAnalysisStore((s) => s.videos);
  const videoId = useAnalysisStore((s) => s.videoId);
  const job = useAnalysisStore((s) => s.job);
  const selectVideo = useAnalysisStore((s) => s.selectVideo);
  const startIngest = useAnalysisStore((s) => s.startIngest);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (source.trim() && !job.running) void startIngest(source.trim(), { singleGame, preRoll });
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
        <label className="ingest__single" title="Crée directement une game couvrant toute la vidéo">
          <input type="checkbox" checked={singleGame} onChange={(e) => setSingleGame(e.target.checked)} disabled={job.running} />
          1 seule game
        </label>
        <label className="ingest__single" title="Secondes gardées avant le départ du chrono (compte à rebours)">
          Marge
          <input
            className="ingest__preroll"
            type="number"
            min={0}
            max={60}
            step={0.5}
            value={preRoll}
            onChange={(e) => setPreRoll(Math.min(60, Math.max(0, Number(e.target.value) || 0)))}
            disabled={job.running || singleGame}
          />
          s
        </label>
        <button type="submit" disabled={job.running || !source.trim()}>
          Analyser
        </button>
      </form>

      {videos.length > 0 && (
        <select value={videoId ?? ''} onChange={(e) => void selectVideo(Number(e.target.value))}>
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.path.split(/[\\/]/).pop()}
            </option>
          ))}
        </select>
      )}

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
