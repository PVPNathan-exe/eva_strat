// Lien « ouvrir dans la vidéo » d'une ligne de détail : ouvre la vidéo au début de la game (comme le Récap, par openAt). Sans vidéo connue, le lien n'est pas montré.

import { Play } from 'lucide-react';
import { videoSeek } from '../../../lib/episodeFormat';
import { useAnalysisStore } from '../../../store/analysisStore';

interface Props {
  videoId: number | undefined;
  gameId: number;
  /** Début de la game dans la vidéo (s). */
  startS: number;
}

export function OpenInVideo({ videoId, gameId, startS }: Props) {
  const openAt = useAnalysisStore((s) => s.openAt);
  if (videoId === undefined) return <span title="Vidéo de cette game inconnue du site">n/d</span>;
  return (
    <button type="button" className="sum__open" title="Ouvre la vidéo au début de la game" onClick={() => void openAt(videoId, gameId, videoSeek(startS, 0))}>
      <Play className="ic" /> Ouvrir
    </button>
  );
}
