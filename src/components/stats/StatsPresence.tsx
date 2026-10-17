// Vue Présence : chaleur du temps passé par case de la minimap, pour une équipe ou un joueur, sur les games retenues.
// La grille est agrégée par le serveur (/api/stats/presence) ; lissage, mise à l'échelle et couleurs sont faits ici (lib/heatGrid.ts, couleurs de tokens.css).

import { useEffect, useMemo, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { blur, gridFromCells, heatPixels, normalize, totalSeconds } from '../../lib/heatGrid';
import { formatTime } from '../../lib/timeline';
import { presenceGroups, type FollowSpec } from '../../lib/teamFollow';
import { noticeOf, tokenRgb, usePresenceGroups, type StatsGame } from './useStats';
import { StatsMapBase } from './StatsMapBase';

const GRID_N = 64; // côté de la grille demandée au serveur

interface Props {
  map: string;
  /** Games retenues : la présence est additionnée sur toutes. */
  games: StatsGame[];
  spec: FollowSpec;
}

/** Couche de chaleur : un canevas n par n étiré sur la minimap (le navigateur interpole entre les cases). */
function HeatLayer({ pixels, n }: { pixels: Uint8ClampedArray; n: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, n, n); // jamais de pixels de la carte précédente
    ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), n, n), 0, 0);
  }, [pixels, n]);
  return <canvas ref={ref} width={n} height={n} className="stats__heat" />;
}

export function StatsPresence({ map, games, spec }: Props) {
  const [sigma, setSigma] = useState(1.5);
  const [corridors, setCorridors] = useState(false);
  const [stations, setStations] = useState(false);
  const [spawns, setSpawns] = useState(true);
  // Une requête par groupe de games qui partagent l'équipe et le joueur demandés (l'équipe suivie change de côté d'une game à l'autre)
  const groups = useMemo(() => presenceGroups(games, spec), [games, spec]);
  const load = usePresenceGroups(map, groups, GRID_N);

  const view = useMemo(() => {
    if (!load.data) return null;
    const n = load.data.n;
    const raw = gridFromCells(n, load.data.cells);
    const norm = normalize(blur(raw, n, sigma));
    return { n, total: totalSeconds(raw), pixels: heatPixels(norm, n, tokenRgb('--c-heat-low', [42, 47, 61]), tokenRgb('--c-heat-high', [255, 159, 28])) };
  }, [load.data, sigma]);

  const notice = noticeOf(load);
  const empty = !notice && (!view || view.total <= 0);

  return (
    <div className="stats__view">
      <div className="stats__bar">
        <details className="menu">
          <summary>
            <SlidersHorizontal className="ic" /> Affichage
          </summary>
          <div className="menu__panel">
            <label className="stats__range">
              Lissage : {sigma === 0 ? 'aucun' : `${sigma.toFixed(1).replace('.', ',')} case${sigma >= 2 ? 's' : ''}`}
              <input type="range" min={0} max={4} step={0.5} value={sigma} onChange={(e) => setSigma(Number(e.target.value))} />
            </label>
            <label><input type="checkbox" checked={spawns} onChange={(e) => setSpawns(e.target.checked)} /> Zones de départ</label>
            <label><input type="checkbox" checked={stations} onChange={(e) => setStations(e.target.checked)} /> Tyroliennes</label>
            <label><input type="checkbox" checked={corridors} onChange={(e) => setCorridors(e.target.checked)} /> Couloirs</label>
          </div>
        </details>
        {!notice && view && view.total > 0 && (
          <span className="stats__count">
            Présence cumulée : {formatTime(view.total)} sur {load.data?.games ?? games.length} game{(load.data?.games ?? games.length) > 1 ? 's' : ''}
          </span>
        )}
        <span className="stats__scale" aria-label="Échelle de la chaleur : de peu à beaucoup de temps passé">
          peu <i /> beaucoup
        </span>
      </div>
      {notice && <p className="stats__empty">{notice}</p>}
      {empty && <p className="stats__empty">Aucune présence pour ce choix. Elle se calcule à partir des vies, game par game : `python analysis/stats_run.py --game N`.</p>}
      <StatsMapBase map={map} corridors={corridors} stations={stations} spawns={spawns}>
        {({ boxStyle }) =>
          view && view.total > 0 ? (
            <div className="statsmap__layer" style={boxStyle}>
              <HeatLayer key={map} pixels={view.pixels} n={view.n} />
            </div>
          ) : null
        }
      </StatsMapBase>
      <details className="help">
        <summary>Comment lire la chaleur</summary>
        <p className="help__body">
          Chaque case de la minimap (grille de {GRID_N} sur {GRID_N}) cumule le temps pendant lequel le joueur ou l'équipe choisis y étaient vivants, sur toutes les games retenues (une seule par défaut, la plus récente). Avec une équipe suivie, la chaleur est celle de cette équipe (ou de ses adversaires) quel que soit son côté dans chaque game ; le filtre Côté garde les games où elle joue à gauche ou à droite. La couleur est relative à la
          case la plus occupée (les 2 % de cases les plus chaudes sont écrêtées), donc elle montre où on passe, pas combien de temps exactement. Le lissage étale chaque case sur ses voisines pour lire les grandes
          zones ; à zéro, on voit les cases brutes. Pour comparer deux équipes ou deux joueurs, changer les filtres en haut.
        </p>
      </details>
    </div>
  );
}
