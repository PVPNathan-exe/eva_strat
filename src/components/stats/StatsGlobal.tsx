// Vue Global de l'onglet Stats : toutes les équipes d'une carte, sans équipe suivie. Positions les plus fortes, présence, morts et duels par côté (orange à gauche, bleu à droite),
// issues des vagues et stratégies (par vitesse et par taille de vague). Les grilles viennent de /api/stats/global (agrégées par le serveur) ; lissage et couleurs sont faits ici.
// Sous le seuil de games renvoyé par le serveur (`min`, 5), aucun résultat chiffré ni carte n'est montré : seule la règle est expliquée.

import { useMemo, useState } from 'react';
import { Layers, SlidersHorizontal } from 'lucide-react';
import { statsTeamApi } from '../../lib/statsTeamApi';
import type { FollowSpec } from '../../lib/teamFollow';
import { GLOBAL_LAYERS, globalLayerDef, globalLayers, SIDE_CHOICES, type GlobalLayerId, type SideChoice } from '../../lib/globalView';
import { gate } from '../../lib/teamView';
import { noticeOf, tokenRgb, useLoad, type StatsGame } from './useStats';
import { StatsMapBase } from './StatsMapBase';
import { GlobalCanvas } from './global/GlobalCanvas';
import { globalImages, type GlobalColors } from './global/globalLayers';
import { GlobalLegend } from './global/GlobalLegend';
import { GlobalOutcomes, SidesTable, StrategyBlock } from './global/GlobalTables';

const GRID_N = 64; // côté de la grille demandée au serveur

interface Props {
  map: string;
  /** Games retenues de la carte : toutes les équipes y sont résumées. */
  games: StatsGame[];
  /** Réglage d'équipe des filtres : ignoré ici, la vue Global n'a pas d'équipe suivie. */
  spec: FollowSpec;
}

/** Couleurs des couches lues dans tokens.css (valeurs de repli si un jeton n'est pas en #rrggbb). */
function layerColors(): GlobalColors {
  return {
    low: tokenRgb('--c-heat-low', [42, 47, 61]),
    left: tokenRgb('--c-owner-a', [255, 159, 28]),
    right: tokenRgb('--c-owner-b', [61, 139, 255]),
  };
}

export function StatsGlobal({ map, games }: Props) {
  const [layer, setLayer] = useState<GlobalLayerId>('strong');
  const [side, setSide] = useState<SideChoice>('both');
  const [sigma, setSigma] = useState(2);
  const [corridors, setCorridors] = useState(false);
  const [stations, setStations] = useState(false);
  const [spawns, setSpawns] = useState(true);

  const ids = useMemo(() => games.filter((g) => g.map === map).map((g) => g.id), [games, map]);
  const key = ids.length ? `global:${map}:${GRID_N}:${ids.join(',')}` : null;
  const load = useLoad(key, () => statsTeamApi.global({ map, games: ids, n: GRID_N }));
  const data = load.data;
  const status = data ? gate(data.games, data.min) : null;

  const images = useMemo(() => (data && status?.ok ? globalImages(globalLayers(data, layer, side, sigma), data.n, layerColors()) : []), [data, status?.ok, layer, side, sigma]);
  const blank = images.length > 0 && images.every((i) => i.blank);
  const notice = noticeOf(load);

  return (
    <div className="stats__view global">
      {ids.length === 0 && <p className="stats__empty">Aucune game retenue sur cette carte.</p>}
      {ids.length > 0 && notice && <p className="stats__empty">{notice}</p>}
      {data && !notice && (
        <p className="stats__count">
          {data.games} game{data.games > 1 ? 's' : ''} retenue{data.games > 1 ? 's' : ''} sur {map}, toutes équipes. Résultats masqués sous {data.min} games.
        </p>
      )}
      {data && !notice && status && !status.ok && (
        <p className="global__gate" role="status">
          Pas assez de games pour afficher des résultats : {data.games} sur {data.min} nécessaires, il en manque {status.missing}. Ajouter des games dans le menu Games ; en dessous de ce nombre, une carte ou un total ne dirait presque rien de fiable.
        </p>
      )}
      {data && !notice && status?.ok && (
        <>
          <div className="stats__bar">
            <details className="menu">
              <summary>
                <Layers className="ic" /> Calques
              </summary>
              <div className="menu__panel">
                {GLOBAL_LAYERS.map((l) => (
                  <label key={l.id}>
                    <input type="radio" name="global-layer" checked={layer === l.id} onChange={() => setLayer(l.id)} /> {l.label}
                  </label>
                ))}
              </div>
            </details>
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
            <label className="stats__field">
              Côté
              <select value={side} onChange={(e) => setSide(e.target.value as SideChoice)}>
                {SIDE_CHOICES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <GlobalLegend layer={layer} games={data.games} />
          {blank && <p className="stats__empty">Rien à montrer pour ce calque et ce côté dans ces games.</p>}
          <StatsMapBase map={map} corridors={corridors} stations={stations} spawns={spawns}>
            {({ boxStyle, warp }) =>
              images.length > 0 && !blank ? (
                <div className="statsmap__layer" style={boxStyle} aria-label={globalLayerDef(layer).label}>
                  {images.map((img) => (
                    <GlobalCanvas key={`${map}-${img.side}`} pixels={img.pixels} n={data.n} warp={warp} />
                  ))}
                </div>
              ) : null
            }
          </StatsMapBase>
          <SidesTable data={data} />
          <GlobalOutcomes data={data} />
          <StrategyBlock data={data} />
        </>
      )}
      <details className="help">
        <summary>Comment lire cette vue</summary>
        <p className="help__body">
          Cette vue cumule toutes les équipes d'une carte, sans en suivre une : le côté gauche (orange, équipe A) et le côté droit (bleu, équipe B) sont comptés séparément, car une position n'a pas la même valeur selon le côté de départ. Chaque case de la minimap
          (grille de {GRID_N} sur {GRID_N}) cumule ce qui s'y est passé ; la couleur est relative à la case la plus chargée (les 2 % les plus fortes sont écrêtées), à la même échelle pour les deux côtés quand les deux sont affichés. Les positions « fortes » sont une
          INTERPRÉTATION des chiffres : une case est dite forte quand le côté y marque plus de kills qu'il n'y meurt (ou y gagne plus de duels qu'il n'en perd) ; seuls les chiffres sont mesurés, pas la cause (une position peut être forte parce que l'adversaire
          l'a laissée libre). Les cases peu fréquentées sont masquées dans ces différences (convention : sous 10 % de l'appui des cases les plus chargées). Toute valeur sous le seuil de 5 games est masquée, et le taux de retake réussi l'est sous 5 vagues décidées
          (convention). La question « quelle stratégie a le mieux marché » n'est traitée qu'avec les données disponibles : les issues des vagues par vitesse (rapide ou progressif) et par taille. Une stratégie plus fine (routes empruntées, ordre des rotations)
          n'est pas encore calculée ; les taux mélangent toutes les équipes, leur niveau et leur côté, et ne prouvent pas une cause.
        </p>
      </details>
    </div>
  );
}
