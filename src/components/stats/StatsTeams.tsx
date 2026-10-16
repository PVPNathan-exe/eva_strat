// Vue Équipes de l'onglet Stats : les statistiques globales de chaque équipe sur toutes ses games (toutes cartes ou la carte du filtre), triables par colonne,
// et en dessous le détail game par game de l'équipe choisie (clic sur sa ligne) avec un total en pied de tableau et un lien vers la vidéo.
// Données : /api/stats/teams-summary (statsSummaryApi). Le score de capture final n'est pas un résultat de match : aucune victoire ni défaite n'est déduite.

import { useMemo, useState } from 'react';
import { nameKey, type FollowSpec } from '../../lib/teamFollow';
import { statsSummaryApi } from '../../lib/statsSummaryApi';
import { emptyStatsNotice, palOfTeam, palRowClass, partialStatsNotice, totalTeamGames } from '../../lib/summaryFormat';
import { sortByColumn } from './global-stats/columns';
import { OpenInVideo } from './global-stats/OpenInVideo';
import { useVideoIds } from './global-stats/useVideoIds';
import { mapOfScope, type SummaryScopeChoice } from './global-stats/scopeChoice';
import { SortableTable, type SortState } from './global-stats/SortableTable';
import { SummaryHelp } from './global-stats/SummaryHelp';
import { SummaryScope } from './global-stats/SummaryScope';
import { teamGameColumns, teamSummaryColumns } from './global-stats/teamColumns';
import { noticeOf, useLoad } from './useStats';
import '../../styles/stats-summary.css';

interface Props {
  /** Carte du filtre (étendue « Carte »). */
  map: string;
  spec: FollowSpec;
}

export function StatsTeams({ map, spec }: Props) {
  const [scope, setScope] = useState<SummaryScopeChoice>('all');
  const [picked, setPicked] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ col: 'games', dir: 'desc' });
  const [gameSort, setGameSort] = useState<SortState>({ col: 'game', dir: 'asc' });
  const videoOf = useVideoIds();
  const mapParam = mapOfScope(scope, map);
  const scopeKey = mapParam ?? '*';

  const load = useLoad(`teams-summary:${scopeKey}`, () => statsSummaryApi.teams({ map: mapParam }));
  const summary = load.data;
  const min = summary?.min ?? 5;
  const columns = useMemo(() => teamSummaryColumns(min), [min]);
  const rows = useMemo(() => (summary ? sortByColumn(summary.teams, columns, sort) : []), [summary, columns, sort]);
  // L'équipe choisie n'existe plus dans cette étendue : on ne montre pas son détail
  const selected = picked && summary?.teams.some((t) => t.key === picked) ? picked : null;
  const chosen = summary?.teams.find((t) => t.key === selected);

  const detail = useLoad(selected ? `teams-summary:${scopeKey}:${selected}` : null, () => statsSummaryApi.teams({ map: mapParam, team: selected }));
  const gameColumns = useMemo(() => teamGameColumns(), []);
  const perGame = useMemo(() => detail.data?.per_game ?? [], [detail.data]);
  const gameRows = useMemo(() => sortByColumn(perGame, gameColumns, gameSort), [perGame, gameColumns, gameSort]);
  const followed = spec.team ? (summary?.teams.find((t) => nameKey(t.name) === spec.team)?.name ?? spec.team) : null;

  const notice = noticeOf(load);
  const empty = summary ? emptyStatsNotice(summary.teams, 'équipe', mapParam) : null;
  const detailNotice = selected ? noticeOf(detail) : null;
  const partial = partialStatsNotice(perGame);
  const detailPal = palRowClass(palOfTeam(chosen?.name, spec.team));

  return (
    <div className="stats__view sum">
      <SummaryScope map={map} scope={scope} onScope={setScope} followed={followed} games={summary?.games ?? null} />
      {notice && <p className="stats__empty">{notice}</p>}
      {empty && <p className="stats__empty">{empty}</p>}
      {rows.length > 0 && (
        <SortableTable
          label="Statistiques globales par équipe"
          columns={columns}
          rows={rows}
          rowKey={(r) => r.key}
          sort={sort}
          onSort={setSort}
          selected={selected}
          onSelect={(key) => setPicked(key === selected ? null : String(key))}
          rowClass={(r) => palRowClass(palOfTeam(r.name, spec.team))}
        />
      )}
      {rows.length > 0 && !selected && <p className="stats__empty">Cliquer une ligne pour voir cette équipe game par game.</p>}
      {selected && chosen && (
        <section className="sum__detail" aria-label={`Détail de ${chosen.name}`}>
          <h3 className="sum__h">Détail de {chosen.name}, game par game</h3>
          {detailNotice && <p className="stats__empty">{detailNotice}</p>}
          {partial && <p className="stats__empty">{partial}</p>}
          {!detailNotice && gameRows.length === 0 && <p className="stats__empty">Aucune game détaillée pour cette équipe.</p>}
          {gameRows.length > 0 && (
            <SortableTable
              label={`Games de ${chosen.name}`}
              columns={gameColumns}
              rows={gameRows}
              rowKey={(r) => r.game_id}
              sort={gameSort}
              onSort={setGameSort}
              rowClass={() => detailPal}
              total={{
                label: `Total (${perGame.filter((r) => r.has_stats).length} games avec bilan)`,
                title: 'Somme des games avec bilan ; capture finale moyennée sur les games où elle est lue.',
                row: totalTeamGames(perGame),
              }}
              open={(r) => <OpenInVideo videoId={videoOf(r.game_id)} gameId={r.game_id} startS={r.start_s} />}
            />
          )}
        </section>
      )}
      <SummaryHelp kind="équipes" />
    </div>
  );
}
