// Vue Joueurs de l'onglet Stats : les statistiques globales de chaque joueur sur toutes ses games (toutes cartes ou la carte du filtre), triables par colonne,
// et en dessous le détail game par game du joueur choisi (clic sur sa ligne) avec un total en pied de tableau et un lien vers la vidéo.
// Données : /api/stats/players-summary (statsSummaryApi). Équipe suivie par son nom = palette « a » (teamFollow). Notes et duels : conventions sans vérité terrain.

import { useMemo, useState } from 'react';
import { nameKey, type FollowSpec } from '../../lib/teamFollow';
import { statsSummaryApi } from '../../lib/statsSummaryApi';
import { emptyStatsNotice, palOfTeam, palRowClass, partialStatsNotice, totalPlayerGames } from '../../lib/summaryFormat';
import { sortByColumn } from './global-stats/columns';
import { OpenInVideo } from './global-stats/OpenInVideo';
import { playerGameColumns, playerSummaryColumns } from './global-stats/playerColumns';
import { useVideoIds } from './global-stats/useVideoIds';
import { mapOfScope, type SummaryScopeChoice } from './global-stats/scopeChoice';
import { SortableTable, type SortState } from './global-stats/SortableTable';
import { SummaryHelp } from './global-stats/SummaryHelp';
import { SummaryScope } from './global-stats/SummaryScope';
import { noticeOf, useLoad } from './useStats';
import '../../styles/stats-summary.css';

interface Props {
  /** Carte du filtre (étendue « Carte »). */
  map: string;
  spec: FollowSpec;
}

export function StatsPlayers({ map, spec }: Props) {
  const [scope, setScope] = useState<SummaryScopeChoice>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ col: 'kills', dir: 'desc' });
  const [gameSort, setGameSort] = useState<SortState>({ col: 'game', dir: 'asc' });
  const videoOf = useVideoIds();
  const mapParam = mapOfScope(scope, map);
  const scopeKey = mapParam ?? '*';

  const load = useLoad(`players-summary:${scopeKey}`, () => statsSummaryApi.players({ map: mapParam }));
  const summary = load.data;
  const min = summary?.min ?? 5;
  const columns = useMemo(() => playerSummaryColumns(min), [min]);
  const rows = useMemo(() => (summary ? sortByColumn(summary.players, columns, sort) : []), [summary, columns, sort]);
  // Le joueur choisi n'existe plus dans cette étendue : on ne montre pas son détail
  const selected = picked && summary?.players.some((p) => p.key === picked) ? picked : null;
  const chosen = summary?.players.find((p) => p.key === selected);

  const detail = useLoad(selected ? `players-summary:${scopeKey}:${selected}` : null, () => statsSummaryApi.players({ map: mapParam, player: selected }));
  const gameColumns = useMemo(() => playerGameColumns(), []);
  const perGame = useMemo(() => detail.data?.per_game ?? [], [detail.data]);
  const gameRows = useMemo(() => sortByColumn(perGame, gameColumns, gameSort), [perGame, gameColumns, gameSort]);
  const followed = spec.team ? (summary?.players.find((p) => nameKey(p.team) === spec.team)?.team ?? spec.team) : null;

  const notice = noticeOf(load);
  const empty = summary ? emptyStatsNotice(summary.players, 'joueur', mapParam) : null;
  const detailNotice = selected ? noticeOf(detail) : null;
  const partial = partialStatsNotice(perGame);

  return (
    <div className="stats__view sum">
      <SummaryScope map={map} scope={scope} onScope={setScope} followed={followed} games={summary?.games ?? null} />
      {notice && <p className="stats__empty">{notice}</p>}
      {empty && <p className="stats__empty">{empty}</p>}
      {rows.length > 0 && (
        <SortableTable
          label="Statistiques globales par joueur"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.key}
          sort={sort}
          onSort={setSort}
          selected={selected}
          onSelect={(key) => setPicked(key === selected ? null : String(key))}
          rowClass={(r) => palRowClass(palOfTeam(r.team, spec.team))}
        />
      )}
      {rows.length > 0 && !selected && <p className="stats__empty">Cliquer une ligne pour voir ce joueur game par game.</p>}
      {selected && chosen && (
        <section className="sum__detail" aria-label={`Détail de ${chosen.name}`}>
          <h3 className="sum__h">Détail de {chosen.name}, game par game</h3>
          {detailNotice && <p className="stats__empty">{detailNotice}</p>}
          {partial && <p className="stats__empty">{partial}</p>}
          {!detailNotice && gameRows.length === 0 && <p className="stats__empty">Aucune game détaillée pour ce joueur.</p>}
          {gameRows.length > 0 && (
            <SortableTable
              label={`Games de ${chosen.name}`}
              columns={gameColumns}
              rows={gameRows}
              rowKey={(r) => r.game_id}
              sort={gameSort}
              onSort={setGameSort}
              rowClass={(r) => palRowClass(palOfTeam(r.team, spec.team))}
              total={{
                label: `Total (${perGame.filter((r) => r.has_stats).length} games avec bilan)`,
                title: 'Somme des games avec bilan ; vitesse moyenne pondérée par le temps vivant, 98e centile = médiane des games.',
                row: totalPlayerGames(perGame),
              }}
              open={(r) => <OpenInVideo videoId={videoOf(r.game_id)} gameId={r.game_id} startS={r.start_s} />}
            />
          )}
        </section>
      )}
      <SummaryHelp kind="joueurs" />
    </div>
  );
}
