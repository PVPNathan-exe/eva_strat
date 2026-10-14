// Onglet Stats : filtres communs (carte, games, équipe suivie par nom, côté, joueur) et une vue à la fois : Parcours, Morts, Présence, Retakes, Rotations, Zones sûres.
// Par défaut, une seule game est retenue (la plus récente de la carte) ; le menu Games en ajoute. Parcours, Morts et Zones sûres rejouent une game à la fois (sélecteur « Game rejouée »),
// Présence et les cumuls additionnent les games retenues. Les vues Retakes et Rotations reçoivent les anciennes props (map, games, team, slot) et, en plus, des props facultatives sur l'équipe suivie.

import { useMemo, useState, type ReactNode } from 'react';
import { Flame, Repeat, Route, ShieldCheck, Skull, Swords } from 'lucide-react';
import { eligibleGames, legacyTeam, pickGames, sideOfTeam, teamNames } from '../../lib/teamFollow';
import { StatsFilters, type StatsFilterState } from './StatsFilters';
import { StatsDeaths } from './StatsDeaths';
import { StatsPaths } from './StatsPaths';
import { StatsPresence } from './StatsPresence';
import { StatsRetakes } from './StatsRetakes';
import { StatsRotations } from './StatsRotations';
import { StatsSafe } from './StatsSafe';
import { gameLabel, INITIAL_FILTERS, mapsOf, noticeOf, specOf, useStatsGames } from './useStats';

type View = 'parcours' | 'morts' | 'presence' | 'retakes' | 'rotations' | 'safe';

const REPLAY_VIEWS: View[] = ['parcours', 'morts', 'safe'];

export function StatsTab() {
  const [view, setView] = useState<View>('parcours');
  const [filters, setFilters] = useState<StatsFilterState>(INITIAL_FILTERS);
  const [replayId, setReplayId] = useState<number | null>(null);
  const gamesLoad = useStatsGames();
  const all = useMemo(() => gamesLoad.data ?? [], [gamesLoad.data]);
  const maps = useMemo(() => mapsOf(all), [all]);
  // Carte affichée : le choix s'il existe encore, sinon la première
  const map = filters.map && maps.some(([name]) => name === filters.map) ? filters.map : (maps[0]?.[0] ?? null);
  const mapAll = useMemo(() => all.filter((g) => g.map === map), [all, map]);
  const teams = useMemo(() => teamNames(mapAll), [mapAll]);
  const spec = useMemo(() => specOf(filters), [filters]);
  // Games du réglage d'équipe et de côté, puis games retenues (par défaut la plus récente)
  const mapGames = useMemo(() => eligibleGames(mapAll, spec), [mapAll, spec]);
  const selected = useMemo(() => pickGames(mapGames, filters.chosen), [mapGames, filters.chosen]);
  // Game rejouée par Parcours, Morts et Zones sûres : le choix s'il est retenu, sinon la plus récente retenue
  const replay = selected.find((g) => g.id === replayId) ?? pickGames(selected, null)[0] ?? null;

  const notice = noticeOf(gamesLoad);
  const followed = spec.team ? (teams.find((t) => t.key === spec.team)?.label ?? null) : null;
  // Vues Retakes et Rotations : anciennes props, plus les props facultatives du suivi par nom d'équipe (elles les ignorent pour l'instant)
  const legacy = map
    ? {
        map,
        games: selected,
        team: legacyTeam(spec),
        slot: spec.team ? 0 : spec.slot,
        teamName: followed,
        sideFilter: spec.side,
        sideOf: (gameId: number) => sideOfTeam(selected.find((g) => g.id === gameId) ?? { teamA: null, teamB: null }, spec.team),
      }
    : null;

  const tab = (id: View, icon: ReactNode, label: string) => (
    <button type="button" role="tab" aria-selected={view === id} className={view === id ? 'is-active' : ''} onClick={() => setView(id)}>
      {icon} {label}
    </button>
  );

  return (
    <div className="stats">
      <div className="subtabs" role="tablist" aria-label="Vue des statistiques">
        {tab('parcours', <Route className="ic" />, 'Parcours')}
        {tab('morts', <Skull className="ic" />, 'Morts')}
        {tab('presence', <Flame className="ic" />, 'Présence')}
        {tab('retakes', <Swords className="ic" />, 'Retakes')}
        {tab('rotations', <Repeat className="ic" />, 'Rotations')}
        {tab('safe', <ShieldCheck className="ic" />, 'Zones sûres')}
      </div>
      {notice && <p className="stats__empty">{notice}</p>}
      {!notice && !legacy && <p className="stats__empty">Aucune game avec des positions lues. Lancer l'analyse détaillée d'une vidéo dans l'onglet Analyse (positions), puis calculer les statistiques : `python analysis/stats_run.py --game N`.</p>}
      {legacy && map && (
        <>
          <StatsFilters maps={maps} map={map} mapGames={mapGames} mapTotal={mapAll.length} selected={selected} teams={teams} state={filters} onChange={setFilters} />
          {selected.length > 1 && REPLAY_VIEWS.includes(view) && (
            <label className="stats__field">
              Game rejouée
              <select value={replay?.id ?? ''} onChange={(e) => setReplayId(Number(e.target.value))}>
                {selected.map((g) => (
                  <option key={g.id} value={g.id}>
                    {gameLabel(g)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {selected.length === 0 || !replay ? (
            <p className="stats__empty">
              {mapGames.length === 0 ? 'Aucune game de cette carte pour ce choix d\'équipe et de côté.' : 'Aucune game retenue : cocher au moins une game dans le menu Games.'}
            </p>
          ) : view === 'parcours' ? (
            <StatsPaths map={map} games={selected} replay={replay} spec={spec} />
          ) : view === 'morts' ? (
            <StatsDeaths map={map} games={selected} replay={replay} spec={spec} />
          ) : view === 'presence' ? (
            <StatsPresence map={map} games={selected} spec={spec} />
          ) : view === 'retakes' ? (
            <StatsRetakes {...legacy} />
          ) : view === 'rotations' ? (
            <StatsRotations {...legacy} />
          ) : (
            <StatsSafe map={map} replay={replay} spec={spec} />
          )}
        </>
      )}
    </div>
  );
}
