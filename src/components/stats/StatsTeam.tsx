// Vue Équipe de l'onglet Stats : pour l'équipe suivie (par son nom), où elle joue le plus selon le côté, où elle meurt, marque, gagne et perd ses duels, par case de la minimap.
// Les grilles viennent de /api/stats/team-summary (agrégées par le serveur) ; lissage, échelle et couleurs sont faits ici (lib/teamView.ts, couleurs de tokens.css).
// Sous le seuil de games renvoyé par le serveur (`min`, 5), aucun résultat chiffré ni carte n'est montré : seule la règle est expliquée.

import { useMemo, useState } from 'react';
import { Layers, SlidersHorizontal } from 'lucide-react';
import { statsTeamApi } from '../../lib/statsTeamApi';
import { eligibleGames, type FollowSpec } from '../../lib/teamFollow';
import { effectiveLayer, gate, LAYERS, layerDef, playerGroups, type LayerId } from '../../lib/teamView';
import { noticeOf, tokenRgb, useLoad, type StatsGame } from './useStats';
import { StatsMapBase } from './StatsMapBase';
import { HeatCanvas } from './team/HeatCanvas';
import { layerImages, type LayerColors } from './team/teamLayers';
import { TeamLegend } from './team/TeamLegend';
import { OutcomesTable, PlayersTable, TotalsTable } from './team/TeamTotals';

const GRID_N = 64; // côté de la grille demandée au serveur

interface Props {
  map: string;
  /** Games retenues : l'équipe suivie y est résumée (le serveur ne garde que celles où elle joue du côté demandé). */
  games: StatsGame[];
  spec: FollowSpec;
}

const SIDE_TEXT = { both: 'les deux côtés', left: 'le côté gauche', right: 'le côté droit' } as const;

/** Couleurs du calque lues dans tokens.css (valeurs de repli si un jeton n'est pas en #rrggbb). */
function layerColors(): LayerColors {
  return {
    low: tokenRgb('--c-heat-low', [42, 47, 61]),
    a: tokenRgb('--c-owner-a', [255, 159, 28]),
    b: tokenRgb('--c-owner-b', [61, 139, 255]),
    good: tokenRgb('--c-stats-life', [53, 224, 122]),
    bad: tokenRgb('--c-stats-death', [255, 59, 59]),
  };
}

export function StatsTeam({ map, games, spec }: Props) {
  const [chosenLayer, setLayer] = useState<LayerId | null>(null); // null : calque par défaut, la présence du côté où l'équipe a joué
  const [sigma, setSigma] = useState(2);
  const [corridors, setCorridors] = useState(false);
  const [stations, setStations] = useState(false);
  const [spawns, setSpawns] = useState(true);
  // Joueur choisi ici : suit le filtre Joueur d'en haut tant qu'on n'a rien choisi, ou jusqu'à ce que ce filtre change
  const [pick, setPick] = useState<{ base: string | null; value: string | null } | null>(null);
  const playerKey = pick && pick.base === spec.player ? pick.value : spec.player;

  const ids = useMemo(() => eligibleGames(games, spec).map((g) => g.id), [games, spec]);
  const team = spec.team;
  const key = team && ids.length ? `team:${map}:${team}:${spec.side}:${GRID_N}:${ids.join(',')}` : null;
  const load = useLoad(key, () => statsTeamApi.teamSummary({ map, team: team as string, games: ids, side: spec.side, n: GRID_N }));
  const data = load.data;

  const groups = useMemo(() => (data ? playerGroups(data.players) : []), [data]);
  const group = groups.find((g) => g.key === playerKey) ?? null;
  const defaultLayer: LayerId = data && data.presence.left.length === 0 && data.presence.right.length > 0 ? 'presence_right' : 'presence_left';
  const shown = effectiveLayer(chosenLayer ?? defaultLayer, group !== null);
  const status = data ? gate(data.games, data.min) : null;

  const images = useMemo(() => (data && status?.ok ? layerImages(data, shown, sigma, group, layerColors()) : []), [data, status?.ok, shown, sigma, group]);
  const blank = images.length > 0 && images.every((i) => i.blank);
  const notice = noticeOf(load);

  return (
    <div className="stats__view team">
      {!team && <p className="stats__empty">Choisir une équipe suivie dans les filtres : cette vue résume une équipe par son nom, quel que soit son côté dans chaque game.</p>}
      {team && ids.length === 0 && <p className="stats__empty">Aucune game retenue où cette équipe joue de ce côté.</p>}
      {team && ids.length > 0 && notice && <p className="stats__empty">{notice}</p>}
      {data && !notice && (
        <p className="stats__count">
          Équipe {data.team} : {data.games} game{data.games > 1 ? 's' : ''} retenue{data.games > 1 ? 's' : ''} sur {map} ({SIDE_TEXT[data.side]}). Résultats masqués sous {data.min} games.
        </p>
      )}
      {data && !notice && status && !status.ok && (
        <p className="team__gate" role="status">
          Pas assez de games pour afficher des résultats : {data.games} sur {data.min} nécessaires, il en manque {status.missing}. Ajouter des games dans le menu Games (ou retirer le filtre de côté) ; en dessous de ce nombre, une carte ou un total ne
          dirait presque rien de fiable.
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
                {LAYERS.map((l) => {
                  const off = group !== null && l.teamOnly;
                  return (
                    <label key={l.id} className={off ? 'team__off' : undefined}>
                      <input type="radio" name="team-layer" checked={shown === l.id} disabled={off} onChange={() => setLayer(l.id)} /> {l.label}
                    </label>
                  );
                })}
                {group !== null && <p className="team__note">Avec un joueur choisi, seule sa présence est calculée par le serveur : les autres calques ne sont disponibles que pour l'équipe entière.</p>}
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
              Joueur
              <select value={group?.key ?? ''} onChange={(e) => setPick({ base: spec.player, value: e.target.value || null })}>
                <option value="">Équipe entière</option>
                {groups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <TeamLegend layer={shown} team={data.team} games={data.games} player={group?.name ?? null} />
          {blank && (
            <p className="stats__empty">
              Rien à montrer pour ce calque
              {(shown === 'presence_left' || shown === 'presence_right') && ` : l'équipe n'a pas joué ${shown === 'presence_left' ? 'à gauche' : 'à droite'} dans ces games`}.
            </p>
          )}
          <StatsMapBase map={map} corridors={corridors} stations={stations} spawns={spawns}>
            {({ boxStyle, warp }) =>
              images.length > 0 && !blank ? (
                <div className="statsmap__layer" style={boxStyle} aria-label={layerDef(shown).label}>
                  {images.map((img, i) => (
                    <HeatCanvas key={`${map}-${i}`} pixels={img.pixels} n={data.n} warp={warp} />
                  ))}
                </div>
              ) : null
            }
          </StatsMapBase>
          <TotalsTable data={data} />
          <OutcomesTable data={data} />
          <PlayersTable data={data} selected={group?.key ?? null} onPick={(k) => setPick({ base: spec.player, value: k })} />
        </>
      )}
      <details className="help">
        <summary>Comment lire cette vue</summary>
        <p className="help__body">
          Chaque case de la minimap (grille de {GRID_N} sur {GRID_N}) cumule, sur les games retenues où l'équipe suivie joue, ce qu'elle y a fait, quel que soit son côté dans chaque game ; la couleur est relative à la case la plus chargée (les 2 % les plus fortes
          sont écrêtées). « Présence » montre les positions préférées de chaque côté : ce sont les cases les plus fréquentées, la route exacte entre elles n'est pas calculée. Les cartes de morts, de duels perdus et de « kills moins morts » désignent des zones
          faibles, mais c'est une INTERPRÉTATION : seuls les chiffres sont mesurés, pas la cause. Un joueur qui attire les adversaires pendant que son équipe gagne ailleurs rend une position correcte malgré ses morts ; ou bien l'adversaire a oublié un côté de la
          carte et la zone paraît calme sans être mal tenue. Les cases peu fréquentées sont masquées dans la différence kills moins morts (convention : sous 10 % de l'appui des cases les plus chargées). Le seuil de 5 games est une convention : en dessous, aucun
          résultat n'est montré.
        </p>
      </details>
    </div>
  );
}
